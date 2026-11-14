import { Router, Response } from 'express';
import { getDb } from '../../db/database';
import { adminMiddleware, AuthRequest } from '../../middleware/auth';

const router = Router();

// ── 全局功能开关（feature flags） ──────────────────────────────────
// GET /api/admin/feature-flags — 列出所有模块开关（管理员）
router.get('/feature-flags', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      'SELECT key, label, enabled FROM feature_flags ORDER BY rowid'
    ).all() as { key: string; label: string; enabled: number }[];
    res.json(
      rows.map((r) => ({ key: r.key, label: r.label, enabled: r.enabled === 1 }))
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/feature-flags/:key — 切换单个模块开关（管理员）
router.put('/feature-flags/:key', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { key } = req.params;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled 必须是布尔值' });
      return;
    }
    const existing = db.prepare('SELECT key FROM feature_flags WHERE key = ?').get(key);
    if (!existing) {
      res.status(404).json({ error: '未知的模块开关: ' + key });
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    db.prepare('UPDATE feature_flags SET enabled = ?, updated_at = ? WHERE key = ?').run(
      enabled ? 1 : 0,
      now,
      key
    );
    const row = db.prepare(
      'SELECT key, label, enabled FROM feature_flags WHERE key = ?'
    ).get(key) as { key: string; label: string; enabled: number };
    res.json({ key: row.key, label: row.label, enabled: row.enabled === 1 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
