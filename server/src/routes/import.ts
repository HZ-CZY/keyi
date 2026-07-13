import { Router, Response } from 'express';
import multer from 'multer';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { parseApkg, parseCsvNotes } from '../import/apkg';
import { v4 as uuidv4 } from 'uuid';
import { isClassicalChineseDeck, getOrCreateTranslationNotetype, stripHtml, translateDeckNotes } from '../import/translator';

const router = Router();
router.use(authMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

// Import APKG file
router.post('/apkg', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: '未上传文件' });
      return;
    }

    const db = getDb();
    const data = parseApkg(req.file.buffer);

    const stats = {
      decks: 0,
      notetypes: 0,
      notes: 0,
      cards: 0,
      media: 0,
    };

    // Build ID mappings
    const notetypeMap = new Map<number, number>();
    const deckMap = new Map<number, number>();
    const noteMap = new Map<number, number>();
    const cardMap = new Map<number, number>();

    // Import in transaction
    const importAll = db.transaction(() => {
      // Import notetypes
      for (const nt of data.notetypes) {
        const fieldsJson = JSON.stringify(nt.fieldNames);
        const existing = db.prepare(
          'SELECT id FROM notetypes WHERE user_id = ? AND name = ?'
        ).get(req.userId, nt.name) as any;

        if (existing) {
          notetypeMap.set(nt.id, existing.id);
        } else {
          const result = db.prepare(`
            INSERT INTO notetypes (user_id, name, css, kind, field_names, template_q_format, template_a_format)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(req.userId, nt.name, nt.css, nt.kind, fieldsJson, nt.templateQFormat, nt.templateAFormat);
          notetypeMap.set(nt.id, result.lastInsertRowid as number);
          stats.notetypes++;
        }
      }

      // Import decks
      const sortedDecks = [...data.decks].sort((a, b) => a.id - b.id);
      for (const deck of sortedDecks) {
        const parentId = deck.parentId ? deckMap.get(deck.parentId) : null;
        const existing = db.prepare(
          'SELECT id FROM decks WHERE user_id = ? AND name = ?'
        ).get(req.userId, deck.name) as any;

        if (existing) {
          deckMap.set(deck.id, existing.id);
        } else {
          const result = db.prepare(
            'INSERT INTO decks (user_id, parent_id, name, description) VALUES (?, ?, ?, ?)'
          ).run(req.userId, parentId, deck.name, deck.description || '');
          deckMap.set(deck.id, result.lastInsertRowid as number);
          stats.decks++;
        }
      }

      // Import notes
      for (const note of data.notes) {
        const newNotetypeId = notetypeMap.get(note.notetypeId);
        if (!newNotetypeId) continue;

        // Check if note with same guid already exists
        const existing = db.prepare(
          'SELECT id FROM notes WHERE user_id = ? AND guid = ?'
        ).get(req.userId, note.guid) as any;

        let noteId: number;
        if (existing) {
          noteId = existing.id;
          db.prepare(
            'UPDATE notes SET fields = ?, tags = ?, modified_at = unixepoch() WHERE id = ?'
          ).run(JSON.stringify(note.fields), note.tags, noteId);
        } else {
          const result = db.prepare(`
            INSERT INTO notes (user_id, guid, notetype_id, tags, fields, sort_field)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(req.userId, note.guid, newNotetypeId, note.tags, JSON.stringify(note.fields), note.sortField);
          noteId = result.lastInsertRowid as number;
          stats.notes++;
        }
        noteMap.set(note.id, noteId);
      }

      // Import cards
      const insertCard = db.prepare(`
        INSERT INTO cards (user_id, note_id, deck_id, template_idx, queue, due, interval, ease_factor, reps, lapses, remaining_steps)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const card of data.cards) {
        const noteId = noteMap.get(card.noteId);
        const deckId = deckMap.get(card.deckId) || deckMap.get(card.originalDeckId);
        if (!noteId || !deckId) continue;

        const cardResult = insertCard.run(
          req.userId, noteId, deckId, card.templateIdx,
          card.queue, card.due, card.interval, card.easeFactor,
          card.reps, card.lapses, card.remainingSteps
        );
        cardMap.set(card.id, cardResult.lastInsertRowid as number);
        stats.cards++;
      }

      // Import media
      for (const media of data.mediaFiles) {
        db.prepare(
          'INSERT INTO media (user_id, filename, original_name, mime_type, data) VALUES (?, ?, ?, ?, ?)'
        ).run(req.userId, media.filename, media.originalName, 'application/octet-stream', media.data);
        stats.media++;
      }

      // Import revlog
      const insertRevlog = db.prepare(`
        INSERT INTO revlog (user_id, card_id, ease, interval, last_interval, ease_factor, time_ms, review_type, reviewed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const rl of data.revlog) {
        const cardId = cardMap.get(rl.cardId);
        if (cardId) {
          insertRevlog.run(req.userId, cardId, rl.ease, rl.interval, rl.lastInterval,
            rl.factor / 1000, rl.time, rl.type, Math.floor(Date.now() / 1000));
        }
      }
    });

    importAll();

    // Auto-translate classical Chinese deck notes after import
    const importedDeckNames = data.decks.map(d => d.name);
    const classicalDecks = importedDeckNames.filter(name => isClassicalChineseDeck(name));
    if (classicalDecks.length > 0) {
      // Trigger async translation for matching decks
      for (const deckName of classicalDecks) {
        const newDeck = db.prepare(
          'SELECT id FROM decks WHERE user_id = ? AND name = ?'
        ).get(req.userId, deckName) as any;
        if (newDeck) {
          translateDeckNotes(db, newDeck.id, req.userId!)
            .then(r => {
              if (r.translated > 0) {
                console.log(`[Auto-Translate] Deck "${deckName}": ${r.translated} notes translated`);
              }
            })
            .catch(err => console.error(`[Auto-Translate] ${deckName}:`, err.message));
        }
      }
    }

    res.json({
      success: true,
      message: `已导入 ${stats.decks} 个牌组、${stats.notetypes} 个笔记类型、${stats.notes} 条笔记、${stats.cards} 张卡片、${stats.media} 个媒体文件`,
      stats,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Import CSV notes into a deck
router.post('/csv', upload.single('file'), (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: '未上传文件' });
      return;
    }

    const { deckId, notetypeId, fieldNames: fieldNamesStr } = req.body;
    if (!deckId || !notetypeId || !fieldNamesStr) {
      res.status(400).json({ error: '缺少牌组ID、笔记类型ID和字段名' });
      return;
    }

    const db = getDb();
    const fieldNames = fieldNamesStr.split(',').map((f: string) => f.trim());
    const csvContent = req.file.buffer.toString('utf-8');
    const notes = parseCsvNotes(csvContent, fieldNames);

    let imported = 0;
    const addNote = db.transaction(() => {
      for (const note of notes) {
        const fieldsJson = JSON.stringify(note.fields);
        const sortField = note.fields[0] || '';
        const result = db.prepare(`
          INSERT INTO notes (user_id, guid, notetype_id, tags, fields, sort_field)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(req.userId, uuidv4(), parseInt(notetypeId), note.tags, fieldsJson, sortField);
        const noteId = result.lastInsertRowid as number;

        db.prepare(`
          INSERT INTO cards (user_id, note_id, deck_id, template_idx, queue, due, interval, ease_factor, reps, lapses, remaining_steps)
          VALUES (?, ?, ?, 0, 0, unixepoch(), 0, 2.5, 0, 0, 0)
        `).run(req.userId, noteId, parseInt(deckId));
        imported++;
      }
    });

    addNote();

    res.json({ success: true, imported });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
