import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(adminMiddleware);

// ── Changelog CRUD ─────────────────────────────────

// List all changelog entries
router.get('/changelog', (_req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const entries = db.prepare(
      'SELECT id, version, date, description, created_at, updated_at FROM changelog ORDER BY created_at DESC'
    ).all();
    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create changelog entry
router.post('/changelog', (req: AuthRequest, res: Response) => {
  try {
    const { version, date, description } = req.body;
    if (!version || !date || !description) {
      res.status(400).json({ error: '缺少必要字段 (version, date, description)' });
      return;
    }
    const db = getDb();
    const result = db.prepare(
      'INSERT INTO changelog (version, date, description) VALUES (?, ?, ?)'
    ).run(version, date, description);
    res.json({ id: result.lastInsertRowid, success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update changelog entry
router.put('/changelog/:id', (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { version, date, description } = req.body;
    const db = getDb();
    db.prepare(
      'UPDATE changelog SET version = ?, date = ?, description = ?, updated_at = unixepoch() WHERE id = ?'
    ).run(version, date, description, id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete changelog entry
router.delete('/changelog/:id', (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();
    db.prepare('DELETE FROM changelog WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Site Content management (version info & software statement) ──

// Get all site content (from settings table)
router.get('/site-content', (_req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT key, value FROM settings WHERE key IN ('app_name', 'app_version', 'build_date', 'software_statement')"
    ).all() as { key: string; value: string }[];
    const content: Record<string, string> = {};
    for (const row of rows) {
      content[row.key] = row.value;
    }
    res.json(content);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update site content
router.put('/site-content', (req: AuthRequest, res: Response) => {
  try {
    const { key, value } = req.body;
    if (!key) {
      res.status(400).json({ error: '缺少 key' });
      return;
    }
    const db = getDb();
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Public endpoints (no auth) ──────────────────────

// Admin: list feedback
router.get('/feedback', (_req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const entries = db.prepare(
      'SELECT id, user_id, username, content, contact, created_at FROM feedback ORDER BY created_at DESC'
    ).all();
    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: delete feedback
router.delete('/feedback/:id', (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();
    db.prepare('DELETE FROM feedback WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const publicRouter = Router();

// Public: submit feedback (must be logged in)
publicRouter.post('/feedback', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      res.status(400).json({ error: '反馈内容不能为空' });
      return;
    }
    const db = getDb();
    const username = (db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId) as any)?.username || '未知';
    db.prepare(
      "INSERT INTO feedback (user_id, username, content) VALUES (?, ?, ?)"
    ).run(req.userId, username, content.trim());
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Public: get changelog
publicRouter.get('/changelog', (_req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const entries = db.prepare(
      'SELECT id, version, date, description FROM changelog ORDER BY created_at DESC'
    ).all();
    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Public: get site content
publicRouter.get('/site-content', (_req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT key, value FROM settings WHERE key IN ('app_name', 'app_version', 'build_date', 'software_statement')"
    ).all() as { key: string; value: string }[];
    const content: Record<string, string> = {};
    for (const row of rows) {
      content[row.key] = row.value;
    }
    // Default fallbacks
    if (!content.app_name) content.app_name = '刻忆间隔学习平台';
    if (!content.app_version) content.app_version = 'v2.1.0';
    if (!content.build_date) content.build_date = '2026-06-22';
    if (!content.software_statement) {
      content.software_statement = '刻忆间隔学习平台 (Keyi) 是一个基于间隔重复原理的开源学习工具。\n\n本平台使用 Ebbinghaus 遗忘曲线算法优化学习效率，数据存储在本地服务器。\n\n平台不收集任何个人隐私数据，所有学习数据仅存储于您部署的服务器上。\n\n本软件按"原样"提供，不提供任何明示或暗示的保证。';
    }
    res.json(content);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { publicRouter };
export default router;
