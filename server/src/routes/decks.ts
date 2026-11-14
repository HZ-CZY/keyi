import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { sendDeckToUser } from './admin';

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

// ── Shelf 书架 (2026-08-21) ──────────────────────────────────────────
// 上架牌组列表：admin published=1 的牌组（用户自助添加入口）
// 注意: 必须放在 /:id 之前注册，否则会被 GET /:id 吞掉
router.get('/shelf', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const adminUser = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as any;
    if (!adminUser) {
      res.json([]);
      return;
    }
    const rows = db.prepare(`
      SELECT d.id, d.name, d.description,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.user_id = d.user_id) AS card_count,
        EXISTS(SELECT 1 FROM decks u WHERE u.user_id = ? AND u.source_deck_id = d.id) AS added
      FROM decks d
      WHERE d.user_id = ? AND d.published = 1 AND d.merged_into_id IS NULL
      ORDER BY d.id DESC
    `).all(req.userId, adminUser.id);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 用户把书架牌组添加到自己账号（复用 sendDeckToUser 智能同步）
router.post('/shelf/:deckId/add', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deckId = parseInt(req.params.deckId);
    const adminUser = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as any;
    if (!adminUser) {
      res.status(404).json({ error: '无管理员牌组' });
      return;
    }
    const deck = db.prepare(
      'SELECT id FROM decks WHERE id = ? AND user_id = ? AND published = 1 AND merged_into_id IS NULL'
    ).get(deckId, adminUser.id) as any;
    if (!deck) {
      res.status(404).json({ error: '该牌组未上架' });
      return;
    }
    const result = sendDeckToUser(db, deckId, adminUser.id, req.userId!);
    res.json({ success: true, isUpdate: result.isUpdate, stats: result.stats, message: result.message });
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
    const existing = db.prepare('SELECT id, name FROM decks WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.userId);
    if (!existing) {
      res.status(404).json({ error: '牌组不存在' });
      return;
    }
    /* 2026-09-30：普通用户不能改卡组名，只有管理员可以（管理端「重命名」也走这个接口）。
       权威拦截 —— 前端铅笔按钮已移除，直接打接口同样要拦住。description/parentId 不受影响。 */
    if (name && String(name) !== String((existing as any).name)) {
      const u = db.prepare('SELECT role FROM users WHERE id = ?').get(req.userId) as any;
      if (!u || u.role !== 'admin') {
        res.status(403).json({ error: '卡组名不能修改' });
        return;
      }
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
    const deckId = Number(req.params.id);
    const deck = db.prepare('SELECT id, name, published FROM decks WHERE id = ? AND user_id = ?')
      .get(deckId, req.userId) as any;
    if (!deck) {
      res.status(404).json({ error: '牌组不存在' });
      return;
    }

    /* 【2026-10-21】原来只 DELETE decks 一行，卡片全变成孤儿：
       牌组没了、卡还在库里，占空间也会继续出现在统计/抽题里。
       现在事务级联：revlog → cards → 无引用的 notes → 解除合并关系 → deck。 */
    const run = db.transaction(() => {
      const noteIds = db.prepare('SELECT DISTINCT note_id FROM cards WHERE deck_id = ? AND user_id = ?')
        .all(deckId, req.userId).map((r: any) => r.note_id as number);
      const cardIds = db.prepare('SELECT id FROM cards WHERE deck_id = ? AND user_id = ?')
        .all(deckId, req.userId).map((r: any) => r.id as number);

      /* 先清复习记录，否则会留下指向不存在卡片的孤儿 revlog，
         排行榜/统计的 COUNT 还会把它们算进去。 */
      for (let i = 0; i < cardIds.length; i += 200) {
        const chunk = cardIds.slice(i, i + 200);
        if (!chunk.length) continue;
        const ph = chunk.map(() => '?').join(',');
        db.prepare(`DELETE FROM revlog WHERE card_id IN (${ph})`).run(...chunk);
      }

      const cards = db.prepare('DELETE FROM cards WHERE deck_id = ? AND user_id = ?').run(deckId, req.userId);
      for (let i = 0; i < noteIds.length; i += 200) {
        const chunk = noteIds.slice(i, i + 200);
        if (!chunk.length) continue;
        const ph = chunk.map(() => '?').join(',');
        db.prepare(`DELETE FROM notes WHERE id IN (${ph}) AND NOT EXISTS (SELECT 1 FROM cards WHERE note_id = notes.id)`)
          .run(...chunk);
      }
      db.prepare('UPDATE decks SET merged_into_id = NULL, modified_at = unixepoch() WHERE merged_into_id = ?')
        .run(deckId);
      db.prepare('DELETE FROM decks WHERE id = ? AND user_id = ?').run(deckId, req.userId);
      return cards.changes;
    });

    const deletedCards = run();
    res.json({ success: true, deletedCards, published: !!deck.published });
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
