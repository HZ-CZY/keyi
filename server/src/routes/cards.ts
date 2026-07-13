import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { answerCard, getNextStatesPreview, CardState } from '../scheduler/ebbinghaus';

const router = Router();
router.use(authMiddleware);

// Convert **text** → <b> and ==text== → highlighted span
function renderMarkup(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/==([^=]+)==/g, '<span class="mark-highlight">$1</span>');
}

// Generate MCQ options for cards in MCQ phase (queue=0)
// distractorsPool: merged pool (original deck first, then current deck, then all cards)
function generateMcqOptions(card: any, fields: string[], distractorsPool: string[]): { options: { label: string; text: string; isCorrect: boolean }[]; correctAnswer: string } | null {
  if (card.notetype_name === '选择题') {
    const answerLetter = (fields[5] || '').trim().toUpperCase();
    const optIdx = { 'A': 1, 'B': 2, 'C': 3, 'D': 4 }[answerLetter];
    if (optIdx === undefined) return null;
    const labels = ['A', 'B', 'C', 'D'];
    const options = labels.map((label, i) => ({
      label,
      text: fields[i + 1] || '',
      isCorrect: label === answerLetter,
    }));
    return { options, correctAnswer: answerLetter };
  }

  const correctText = fields[1] || fields[0] || '';
  const correctLen = correctText.length;

  // Deduplicate and filter
  const unique = [...new Set(distractorsPool.filter(d => d && d !== correctText && d.length > 0 && d.length < 100))];
  // Score by length similarity, then shuffle top candidates
  const scored = unique.map(d => ({ text: d, score: Math.abs(d.length - correctLen) }));
  // Shuffle to break ties randomly
  for (let i = scored.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [scored[i], scored[j]] = [scored[j], scored[i]];
  }
  scored.sort((a, b) => a.score - b.score);
  // Pick 3 from top 8 randomly
  const topN = Math.min(scored.length, 8);
  const pool = scored.slice(0, topN);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const distractors = pool.slice(0, 3).map(d => d.text);

  while (distractors.length < 3) {
    distractors.push(`其他答案 ${distractors.length + 1}`);
  }

  const allTexts = [correctText, ...distractors];
  const labels = ['A', 'B', 'C', 'D'];
  for (let i = allTexts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allTexts[i], allTexts[j]] = [allTexts[j], allTexts[i]];
  }
  const correctLabel = labels[allTexts.indexOf(correctText)];
  const options = allTexts.map((text, i) => ({
    label: labels[i],
    text,
    isCorrect: labels[i] === correctLabel,
  }));
  return { options, correctAnswer: correctLabel };
}

// Get due cards for review
router.get('/due', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deckId = req.query.deck_id ? parseInt(req.query.deck_id as string) : null;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    let query = `
      SELECT c.*, n.fields, n.tags, n.notetype_id, nt.name as notetype_name,
             nt.css, nt.template_q_format, nt.template_a_format, nt.field_names
      FROM cards c
      JOIN notes n ON n.id = c.note_id
      JOIN notetypes nt ON nt.id = n.notetype_id
      WHERE c.user_id = ?
    `;
    const params: any[] = [req.userId];

    if (deckId) {
      query += ' AND c.deck_id = ?';
      params.push(deckId);
    }

    // Get cards due now (review + learning), plus new cards
    query += ` AND (
      (c.queue = 0) OR
      (c.queue IN (1, 3) AND c.due <= unixepoch()) OR
      (c.queue = 2 AND c.due <= unixepoch())
    ) ORDER BY c.queue ASC, c.due ASC LIMIT ?`;
    params.push(limit);

    const cards = db.prepare(query).all(...params);

    // Generate MCQ options pool
    // originalDeckPool: from the card's original small deck (primary)
    // currentDeckPool: from the current deck (fallback)
    // allCardsPool: from all user's cards (final fallback)
    const cardIds = (cards as any[]).map(c => c.id);

    const extractFields = (r: any): string => {
      try {
        const f = JSON.parse(r.fields);
        return Array.isArray(f) ? (f[1] || f[0] || '') : String(r.fields);
      } catch { return String(r.fields); }
    };
    const filterValid = (t: string) => t && t.length > 0 && t.length < 100;

    // Build pools per original_deck_id
    const originalDeckPools = new Map<number, string[]>();
    const currentDeckPools = new Map<number, string[]>();

    // For cards with NULL original_deck_id, resolve via source_note_id
    // Notes in merged decks point back to their source note in the original small deck
    const noteIdToOriginalDeck = new Map<number, number>();
    const cardsNeedingResolution = (cards as any[]).filter(c => !c.original_deck_id);
    if (cardsNeedingResolution.length > 0) {
      const noteIds = cardsNeedingResolution.map(c => c.note_id);
      const placeholders = noteIds.map(() => '?').join(',');
      const sourceRows = db.prepare(`
        SELECT un.id as note_id, sc.deck_id as source_deck_id
        FROM notes un
        JOIN notes an ON an.guid = un.guid AND an.user_id = 2
        JOIN cards sc ON sc.note_id = an.source_note_id AND sc.user_id = 2
        WHERE un.id IN (${placeholders}) AND an.source_note_id IS NOT NULL
      `).all(...noteIds) as any[];
      for (const row of sourceRows) {
        noteIdToOriginalDeck.set(row.note_id, row.source_deck_id);
      }
    }

    if (cardIds.length > 0) {
      // Resolve effective original_deck_id for each card
      const getEffectiveOriginalDeckId = (c: any): number | null => {
        if (c.original_deck_id) return c.original_deck_id;
        const resolvedDeckId = noteIdToOriginalDeck.get(c.note_id);
        return resolvedDeckId || null;
      };

      // Group cards by resolved original_deck_id and deck_id
      const originalDeckIds = [...new Set(
        (cards as any[]).map(c => getEffectiveOriginalDeckId(c)).filter(Boolean)
      )] as number[];
      const currentDeckIds = [...new Set((cards as any[]).map(c => c.deck_id))];

      // Fetch from original small decks
      for (const odId of originalDeckIds) {
        const rows = db.prepare(`
          SELECT n.fields FROM cards c
          JOIN notes n ON n.id = c.note_id
          WHERE c.deck_id = ? AND c.user_id = ?
          ORDER BY RANDOM() LIMIT 40
        `).all(odId, req.userId) as any[];
        originalDeckPools.set(odId, rows.map(extractFields).filter(filterValid));
      }

      // Fetch from current decks
      for (const cdId of currentDeckIds) {
        const rows = db.prepare(`
          SELECT n.fields FROM cards c
          JOIN notes n ON n.id = c.note_id
          WHERE c.deck_id = ? AND c.user_id = ?
          ORDER BY RANDOM() LIMIT 40
        `).all(cdId, req.userId) as any[];
        currentDeckPools.set(cdId, rows.map(extractFields).filter(filterValid));
      }

      // Fetch from all user's cards (final fallback)
      const allCardsRows = db.prepare(`
        SELECT n.fields FROM cards c
        JOIN notes n ON n.id = c.note_id
        WHERE c.user_id = ?
        ORDER BY RANDOM() LIMIT 80
      `).all(req.userId) as any[];
      var allCardsPool = allCardsRows.map(extractFields).filter(filterValid);
    }

    // Get notes data for display
    const result = (cards as any[]).map(card => {
      let fields: string[];
      try {
        fields = JSON.parse(card.fields);
        if (!Array.isArray(fields)) fields = card.fields.split('\x1f');
      } catch {
        fields = String(card.fields).split('\x1f');
      }

      // Get field names for template rendering
      let fieldNames: string[] = [];
      try {
        if (card.field_names) {
          fieldNames = JSON.parse(card.field_names);
        }
      } catch { /* keep empty */ }

      return {
        id: card.id,
        noteId: card.note_id,
        deckId: card.deck_id,
        queue: card.queue,
        due: card.due,
        interval: card.interval,
        easeFactor: card.ease_factor,
        reps: card.reps,
        lapses: card.lapses,
        remainingSteps: card.remaining_steps,
        flags: card.flags,
        notetypeId: card.notetype_id,
        notetypeName: card.notetype_name,
        css: card.css,
        templateQFormat: card.template_q_format,
        templateAFormat: card.template_a_format,
        fields,
        fieldNames,
        tags: card.tags ? card.tags.split(/\s+/) : [],
        // Render question/answer
        question: renderTemplate(card.template_q_format, fields, fieldNames),
        answer: renderTemplate(card.template_a_format, fields, fieldNames),
        // MCQ options for new cards (queue=0, step 0)
        // Use card's original small deck first, then current deck, then all cards
        mcqOptions: card.queue === 0 && (card.remaining_steps || 0) === 0 ? (() => {
          const correctText = fields[1] || fields[0] || '';
          const effectiveOriginalDeckId = card.original_deck_id || noteIdToOriginalDeck.get(card.note_id) || null;
          const originalPool = effectiveOriginalDeckId ? (originalDeckPools.get(effectiveOriginalDeckId) || []) : [];
          const currentPool = currentDeckPools.get(card.deck_id) || [];
          // Prioritize: pick 3 from original pool first, fallback to current, then all
          const seen = new Set<string>([correctText]);
          const pickDistractors = (pool: string[], count: number): string[] => {
            const picked: string[] = [];
            const shuffled = [...pool].sort(() => Math.random() - 0.5);
            for (const text of shuffled) {
              if (picked.length >= count) break;
              if (!seen.has(text) && text.length > 0 && text.length < 100) {
                seen.add(text);
                picked.push(text);
              }
            }
            return picked;
          };
          let distractors = pickDistractors(originalPool, 3);
          if (distractors.length < 3) {
            distractors = [...distractors, ...pickDistractors(currentPool, 3 - distractors.length)];
          }
          if (distractors.length < 3) {
            distractors = [...distractors, ...pickDistractors(allCardsPool || [], 3 - distractors.length)];
          }
          while (distractors.length < 3) {
            distractors.push(`其他答案 ${distractors.length + 1}`);
          }
          const allTexts = [correctText, ...distractors];
          // Shuffle and assign labels
          const labels = ['A', 'B', 'C', 'D'];
          for (let i = allTexts.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allTexts[i], allTexts[j]] = [allTexts[j], allTexts[i]];
          }
          const correctLabel = labels[allTexts.indexOf(correctText)];
          return {
            options: allTexts.map((text, i) => ({
              label: labels[i], text,
              isCorrect: labels[i] === correctLabel,
            })),
            correctAnswer: correctLabel,
          }
        })() : null,
        // Learning step info (0=MCQ, 1=看答案回想原句, 2=看原句回想答案)
        learningStep: card.queue === 0 ? (card.remaining_steps || 0) : -1,
        // Next states for button preview
        nextStates: getNextStatesPreview(card.queue, card.remaining_steps || 0, card.interval),
      };
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Answer a card (core review action)
router.post('/:id/answer', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const card = db.prepare(
      'SELECT * FROM cards WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.userId) as any;

    if (!card) {
      res.status(404).json({ error: '卡片不存在' });
      return;
    }

    const { rating, timeMs } = req.body;
    if (!rating || ![1, 2, 3, 4].includes(rating)) {
      res.status(400).json({ error: '无效评分（必须为1-4）' });
      return;
    }

    const cardState: CardState = {
      queue: card.queue,
      due: card.due,
      interval: card.interval,
      reps: card.reps,
      lapses: card.lapses,
      remaining_steps: card.remaining_steps || 0,
    };

    const { card: nextCard, log } = answerCard(cardState, rating, timeMs || 0);

    // Update card
    db.prepare(`
      UPDATE cards SET
        queue = ?, due = ?, interval = ?, ease_factor = ?,
        reps = ?, lapses = ?, remaining_steps = ?, modified_at = unixepoch()
      WHERE id = ?
    `).run(
      nextCard.queue, nextCard.due, nextCard.interval, 2.5,
      nextCard.reps, nextCard.lapses, nextCard.remaining_steps, card.id
    );

    // Write review log
    db.prepare(`
      INSERT INTO revlog (user_id, card_id, ease, interval, last_interval, ease_factor, time_ms, review_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.userId, card.id, rating, nextCard.interval, card.interval,
      2.5, timeMs || 0, card.queue
    );

    res.json({
      cardId: card.id,
      nextState: {
        queue: nextCard.queue,
        due: nextCard.due,
        interval: nextCard.interval,
        remaining_steps: nextCard.remaining_steps,
      },
      log,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get all cards in a deck
router.get('/deck/:deckId', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const cards = db.prepare(`
      SELECT c.*, n.fields, n.tags
      FROM cards c
      JOIN notes n ON n.id = c.note_id
      WHERE c.deck_id = ? AND c.user_id = ?
      ORDER BY c.id
    `).all(req.params.deckId, req.userId);
    res.json(cards);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get distractor pool for MCQ generation (returns answer texts from the deck)
router.get('/distractors/:deckId', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deckId = parseInt(req.params.deckId);
    const rows = db.prepare(`
      SELECT n.fields, n.notetype_id, nt.name as notetype_name
      FROM cards c
      JOIN notes n ON n.id = c.note_id
      JOIN notetypes nt ON nt.id = n.notetype_id
      WHERE c.deck_id = ? AND c.user_id = ?
      ORDER BY RANDOM() LIMIT 80
    `).all(deckId, req.userId) as any[];

    const pool = rows.map(r => {
      let fields: string[];
      try {
        fields = JSON.parse(r.fields);
        if (!Array.isArray(fields)) fields = r.fields.split('\x1f');
      } catch {
        fields = String(r.fields).split('\x1f');
      }
      return {
        text: fields[1] || fields[0] || '',
        notetype: r.notetype_name || '',
      };
    }).filter((item: any) => item.text && item.text.length > 0 && item.text.length < 100);

    res.json(pool);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get distractor pool from ALL user's cards (for MCQ fallback)
router.get('/all-distractors', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT n.fields, n.notetype_id, nt.name as notetype_name
      FROM cards c
      JOIN notes n ON n.id = c.note_id
      JOIN notetypes nt ON nt.id = n.notetype_id
      WHERE c.user_id = ?
      ORDER BY RANDOM() LIMIT 80
    `).all(req.userId) as any[];

    const pool = rows.map(r => {
      let fields: string[];
      try {
        fields = JSON.parse(r.fields);
        if (!Array.isArray(fields)) fields = r.fields.split('\x1f');
      } catch {
        fields = String(r.fields).split('\x1f');
      }
      return {
        text: fields[1] || fields[0] || '',
        notetype: r.notetype_name || '',
      };
    }).filter((item: any) => item.text && item.text.length > 0 && item.text.length < 100);

    res.json(pool);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get stats overview
router.get('/stats/overview', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();

    const totalCards = db.prepare(
      'SELECT COUNT(*) as count FROM cards WHERE user_id = ?'
    ).get(req.userId) as any;

    const dueToday = db.prepare(`
      SELECT COUNT(*) as count FROM cards WHERE user_id = ?
      AND ((queue IN (1,3) AND due <= unixepoch()) OR (queue = 2 AND due <= unixepoch()))
    `).get(req.userId) as any;

    const dueTomorrow = db.prepare(`
      SELECT COUNT(*) as count FROM cards WHERE user_id = ?
      AND ((queue IN (1,3) AND due > unixepoch() AND due <= unixepoch() + 86400)
         OR (queue = 2 AND due > unixepoch() AND due <= unixepoch() + 86400))
    `).get(req.userId) as any;

    const newCards = db.prepare(
      'SELECT COUNT(*) as count FROM cards WHERE user_id = ? AND queue = 0'
    ).get(req.userId) as any;

    const todayReviews = db.prepare(`
      SELECT COUNT(*) as count FROM revlog
      WHERE user_id = ? AND date(reviewed_at, 'unixepoch') = date('now')
    `).get(req.userId) as any;

    const streak = calculateStreak(db, req.userId!);

    res.json({
      totalCards: totalCards.count,
      dueToday: dueToday.count,
      dueTomorrow: dueTomorrow.count,
      newCards: newCards.count,
      todayReviews: todayReviews.count,
      streak,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: render card template with field name mapping
function renderTemplate(template: string, fields: string[], fieldNames: string[] = []): string {
  let result = template;

  // Build a map from field name (case-insensitive) to field value
  const fieldMap: Record<string, string> = {};
  for (let i = 0; i < fieldNames.length && i < fields.length; i++) {
    fieldMap[fieldNames[i].toLowerCase()] = fields[i] || '';
  }
  // Also allow numeric field references (e.g., {{1}})
  for (let i = 0; i < fields.length; i++) {
    fieldMap[String(i + 1)] = fields[i] || '';
  }

  const frontSide = fields[0] || '';

  // First pass: replace {{FieldName}} with actual values
  result = result.replace(/\{\{([^}]+)\}\}/g, (_match: string, fieldName: string) => {
    if (fieldName.toLowerCase() === 'frontside') {
      // Placeholder - will be replaced in second pass
      return '___FRONTSIDE___';
    }
    const key = fieldName.toLowerCase().trim();
    if (key in fieldMap) {
      return fieldMap[key];
    }
    // Try to match by index (1-based)
    const idx = parseInt(fieldName);
    if (!isNaN(idx) && idx >= 1 && idx <= fields.length) {
      return fields[idx - 1] || '';
    }
    return '';
  });

  // Second pass: replace FrontSide placeholder with the question content
  result = result.replace(/___FRONTSIDE___/g, frontSide);

  // Third pass: convert markers to HTML
  // **text** → bold
  result = result.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  // ==text== → highlight
  result = result.replace(/==([^=]+)==/g, '<span class="mark-highlight">$1</span>');

  return result;
}

function calculateStreak(db: any, userId: number): number {
  try {
    const rows = db.prepare(`
      SELECT DISTINCT date(reviewed_at, 'unixepoch') as review_date
      FROM revlog
      WHERE user_id = ?
      ORDER BY review_date DESC
      LIMIT 365
    `).all(userId) as any[];

    if (rows.length === 0) return 0;
    const today = new Date().toISOString().split('T')[0];
    let streak = 0;
    let checkDate = new Date(today);
    const dates = new Set(rows.map(r => r.review_date));

    // If no review today, check from yesterday
    if (!dates.has(today)) {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    for (let i = 0; i < 365; i++) {
      const dateStr = checkDate.toISOString().split('T')[0];
      if (dates.has(dateStr)) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  } catch {
    return 0;
  }
}

export default router;
