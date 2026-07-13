import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// List all decks (user-facing — exclude merged source decks)
router.get('/', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const decks = db.prepare(`
      SELECT d.*,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) as card_count,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.queue = 0) as new_count,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.queue IN (1,3)) as learning_count,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.queue = 2 AND c.due <= unixepoch()) as review_count
      FROM decks d
      WHERE d.user_id = ? AND d.merged_into_id IS NULL
      ORDER BY d.name
    `).all(req.userId);
    res.json(decks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get single deck
router.get('/:id', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deck = db.prepare(`
      SELECT d.*, dc.*
      FROM decks d
      LEFT JOIN deck_config dc ON dc.deck_id = d.id
      WHERE d.id = ? AND d.user_id = ?
    `).get(req.params.id, req.userId);
    if (!deck) {
      res.status(404).json({ error: '牌组不存在' });
      return;
    }
    res.json(deck);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create deck
router.post('/', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { name, description, parentId } = req.body;
    if (!name) {
      res.status(400).json({ error: '需要牌组名称' });
      return;
    }
    const result = db.prepare(
      'INSERT INTO decks (user_id, parent_id, name, description) VALUES (?, ?, ?, ?)'
    ).run(req.userId, parentId || null, name, description || '');

    const deckId = result.lastInsertRowid;
    // Create default config
    db.prepare(`
      INSERT INTO deck_config (user_id, deck_id) VALUES (?, ?)
    `).run(req.userId, deckId);

    const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(deckId);
    res.status(201).json(deck);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update deck
router.put('/:id', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { name, description, parentId } = req.body;
    const existing = db.prepare('SELECT id FROM decks WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.userId);
    if (!existing) {
      res.status(404).json({ error: '牌组不存在' });
      return;
    }
    db.prepare(
      'UPDATE decks SET name = COALESCE(?, name), description = COALESCE(?, description), parent_id = ?, modified_at = unixepoch() WHERE id = ? AND user_id = ?'
    ).run(name || null, description || null, parentId !== undefined ? parentId : null, req.params.id, req.userId);
    const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(req.params.id);
    res.json(deck);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete deck
router.delete('/:id', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM decks WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.userId);
    if (result.changes === 0) {
      res.status(404).json({ error: '牌组不存在' });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get deck config
router.get('/:id/config', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const config = db.prepare(
      'SELECT * FROM deck_config WHERE deck_id = ? AND user_id = ?'
    ).get(req.params.id, req.userId);
    if (!config) {
      res.status(404).json({ error: '配置不存在' });
      return;
    }
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update deck config
router.put('/:id/config', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deck = db.prepare('SELECT id FROM decks WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.userId);
    if (!deck) {
      res.status(404).json({ error: '牌组不存在' });
      return;
    }

    const fields = [
      'learn_steps', 'relearn_steps', 'initial_ease', 'easy_multiplier',
      'hard_multiplier', 'interval_multiplier', 'maximum_review_interval',
      'minimum_lapse_interval', 'graduating_interval_good', 'graduating_interval_easy',
      'new_per_day', 'reviews_per_day', 'leech_threshold', 'lapse_multiplier'
    ];

    const updates: string[] = [];
    const values: any[] = [];
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        const dbField = field.replace(/([A-Z])/g, '_$1').toLowerCase();
        updates.push(`${dbField} = ?`);
        if (field === 'learn_steps' || field === 'relearn_steps') {
          values.push(JSON.stringify(req.body[field]));
        } else {
          values.push(req.body[field]);
        }
      }
    }

    if (updates.length > 0) {
      // Upsert
      const existing = db.prepare('SELECT id FROM deck_config WHERE deck_id = ? AND user_id = ?')
        .get(req.params.id, req.userId);
      if (existing) {
        db.prepare(
          `UPDATE deck_config SET ${updates.join(', ')} WHERE deck_id = ? AND user_id = ?`
        ).run(...values, req.params.id, req.userId);
      } else {
        db.prepare(
          `INSERT INTO deck_config (user_id, deck_id, ${updates.map(u => u.split(' = ')[0]).join(', ')}) VALUES (?, ?, ${updates.map(() => '?').join(', ')})`
        ).run(req.userId, req.params.id, ...values);
      }
    }

    const config = db.prepare('SELECT * FROM deck_config WHERE deck_id = ?').get(req.params.id);
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Deck stats
router.get('/:id/stats', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN c.queue = 0 THEN 1 ELSE 0 END) as new_cards,
        SUM(CASE WHEN c.queue IN (1,3) THEN 1 ELSE 0 END) as learning,
        SUM(CASE WHEN c.queue = 2 AND c.due <= unixepoch() THEN 1 ELSE 0 END) as due_reviews,
        SUM(CASE WHEN c.queue = 2 THEN 1 ELSE 0 END) as total_review
      FROM cards c
      WHERE c.deck_id = ? AND c.user_id = ?
    `).get(req.params.id, req.userId);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
