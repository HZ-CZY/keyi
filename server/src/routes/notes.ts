import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
router.use(authMiddleware);

// Get notetypes
router.get('/notetypes', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const types = db.prepare(
      'SELECT * FROM notetypes WHERE user_id = ?'
    ).all(req.userId);
    res.json(types);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create notetype
router.post('/notetypes', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { name, css, kind, fieldNames, templateQFormat, templateAFormat } = req.body;
    if (!name || !fieldNames || fieldNames.length === 0) {
      res.status(400).json({ error: '名称和字段不能为空' });
      return;
    }
    const result = db.prepare(`
      INSERT INTO notetypes (user_id, name, css, kind, field_names, template_q_format, template_a_format)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.userId, name, css || '',
      kind || 'normal',
      JSON.stringify(fieldNames),
      templateQFormat || fieldNames.map((f: string) => `{{${f}}}`).join('<br>'),
      templateAFormat || `{{FrontSide}}<hr>${fieldNames.map((f: string) => `{{${f}}}`).join('<br>')}`
    );
    const notetype = db.prepare('SELECT * FROM notetypes WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(notetype);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Add note (and generate cards)
router.post('/', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { notetypeId, deckId, fields, tags } = req.body;
    if (!notetypeId || !deckId || !fields || fields.length === 0) {
      res.status(400).json({ error: '笔记类型ID、牌组ID和字段不能为空' });
      return;
    }

    const guid = uuidv4();
    const fieldsJson = JSON.stringify(fields);
    const sortField = fields[0] || '';

    const result = db.prepare(`
      INSERT INTO notes (user_id, guid, notetype_id, tags, fields, sort_field)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.userId, guid, notetypeId, tags || '', fieldsJson, sortField);

    const noteId = result.lastInsertRowid;

    // Generate cards for this note (one per template, simplified)
    const now = Math.floor(Date.now() / 1000);
    const cardResult = db.prepare(`
      INSERT INTO cards (user_id, note_id, deck_id, template_idx, queue, due, interval, ease_factor, reps, lapses, remaining_steps)
      VALUES (?, ?, ?, 0, 0, ?, 0, 2.5, 0, 0, 0)
    `).run(req.userId, noteId, deckId, now);

    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
    res.status(201).json({ note, cardId: cardResult.lastInsertRowid });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update note
router.put('/:id', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { fields, tags } = req.body;
    const existing = db.prepare('SELECT id FROM notes WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.userId);
    if (!existing) {
      res.status(404).json({ error: '笔记不存在' });
      return;
    }
    db.prepare(`
      UPDATE notes SET
        fields = COALESCE(?, fields),
        tags = COALESCE(?, tags),
        sort_field = COALESCE(?, sort_field),
        modified_at = unixepoch()
      WHERE id = ? AND user_id = ?
    `).run(
      fields ? JSON.stringify(fields) : null,
      tags !== undefined ? tags : null,
      fields && fields.length > 0 ? fields[0] : null,
      req.params.id, req.userId
    );
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
    res.json(note);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
