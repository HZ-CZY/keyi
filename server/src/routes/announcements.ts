import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { adminMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(adminMiddleware);

// List all announcements
router.get('/announcements', (_req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      'SELECT id, title, content, published, created_at, updated_at FROM announcements ORDER BY created_at DESC'
    ).all() as any[];
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create announcement
router.post('/announcements', (req: AuthRequest, res: Response) => {
  try {
    const { title, content, published } = req.body;
    if (!title || !content) {
      res.status(400).json({ error: '缺少标题或内容' });
      return;
    }
    const db = getDb();
    const result = db.prepare(
      'INSERT INTO announcements (title, content, published) VALUES (?, ?, ?)'
    ).run(title, content, published ?? 1);
    res.json({ id: result.lastInsertRowid, success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update announcement
router.put('/announcements/:id', (req: AuthRequest, res: Response) => {
  try {
    const { title, content, published } = req.body;
    const db = getDb();
    const updates: string[] = [];
    const values: any[] = [];
    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (content !== undefined) { updates.push('content = ?'); values.push(content); }
    if (published !== undefined) { updates.push('published = ?'); values.push(published); }
    if (updates.length === 0) {
      res.status(400).json({ error: '没有需要更新的字段' });
      return;
    }
    updates.push('updated_at = unixepoch()');
    values.push(req.params.id);
    db.prepare(`UPDATE announcements SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete announcement
router.delete('/announcements/:id', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle publish status
router.post('/announcements/:id/toggle-publish', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const ann = db.prepare('SELECT published FROM announcements WHERE id = ?').get(req.params.id) as any;
    if (!ann) {
      res.status(404).json({ error: '公告不存在' });
      return;
    }
    const newPublished = ann.published ? 0 : 1;
    db.prepare('UPDATE announcements SET published = ?, updated_at = unixepoch() WHERE id = ?').run(newPublished, req.params.id);
    res.json({ success: true, published: newPublished });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Public endpoint (no admin auth required) ──
const publicRouter = Router();

// Get latest published announcement that user hasn't dismissed
publicRouter.get('/announcements/latest', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = req.userId;
    let row: any;
    if (userId) {
      row = db.prepare(`
        SELECT a.id, a.title, a.content, a.created_at
        FROM announcements a
        WHERE a.published = 1
          AND a.id NOT IN (SELECT announcement_id FROM user_announcement_dismissals WHERE user_id = ?)
        ORDER BY a.created_at DESC
        LIMIT 1
      `).get(userId) as any;
    } else {
      row = db.prepare(
        'SELECT id, title, content, created_at FROM announcements WHERE published = 1 ORDER BY created_at DESC LIMIT 1'
      ).get() as any;
    }
    res.json(row || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Dismiss an announcement (mark as seen)
publicRouter.post('/announcements/:id/dismiss', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: '请先登录' });
      return;
    }
    const annId = parseInt(req.params.id);
    if (isNaN(annId)) {
      res.status(400).json({ error: '无效的公告ID' });
      return;
    }
    // Check if announcement exists and is published
    const ann = db.prepare('SELECT id FROM announcements WHERE id = ? AND published = 1').get(annId) as any;
    if (!ann) {
      res.status(404).json({ error: '公告不存在或未发布' });
      return;
    }
    db.prepare(`
      INSERT OR IGNORE INTO user_announcement_dismissals (user_id, announcement_id, dismissed_at)
      VALUES (?, ?, unixepoch())
    `).run(userId, annId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { publicRouter };
export default router;
