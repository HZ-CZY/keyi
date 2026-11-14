import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { AuthRequest, authMiddleware } from '../middleware/auth';

/**
 * 点击埋点 + 统计
 * ─────────────────────────────────────────────────────────
 * 前端在全局 click 上自动提取锚点（data-track > aria-label/title/文本），
 * 批量上报到这里；管理端按页面 / 锚点 / 用户 / 日期聚合。
 *   POST /api/analytics/click           批量上报（登录用户）
 *   GET  /api/analytics/admin/overview  聚合统计（管理员）
 */
const router = Router();

function ensureTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS click_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER,
      path       TEXT NOT NULL,
      target     TEXT NOT NULL,
      label      TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_click_events_path   ON click_events(path, created_at);
    CREATE INDEX IF NOT EXISTS idx_click_events_target ON click_events(target);
    CREATE INDEX IF NOT EXISTS idx_click_events_time   ON click_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_click_events_user   ON click_events(user_id);
  `);
}

/* 埋点统计仅对指定账号开放（按用户名白名单，而非全部管理员） */
const ANALYTICS_VIEWERS = ['admin', '陈子洋'];

function canViewAnalytics(req: AuthRequest): boolean {
  const row = getDb()
    .prepare('SELECT username FROM users WHERE id = ?')
    .get(req.userId) as { username?: string } | undefined;
  return !!row && ANALYTICS_VIEWERS.includes(row.username || '');
}

/** 批量上报点击（最多 50 条/次） */
router.post('/click', authMiddleware, (req: AuthRequest, res: Response) => {
  ensureTable();
  const raw = (req.body as any)?.events;
  const arr = Array.isArray(raw) ? raw.slice(0, 50) : [];
  if (arr.length === 0) {
    res.status(400).json({ error: 'empty' });
    return;
  }
  const db = getDb();
  const stmt = db.prepare('INSERT INTO click_events (user_id, path, target, label) VALUES (?, ?, ?, ?)');
  const insertMany = db.transaction((rows: any[]) => {
    for (const e of rows) {
      const path = String(e?.path || '').slice(0, 200);
      const target = String(e?.target || '').slice(0, 300);
      if (!path || !target) continue;
      stmt.run(req.userId ?? null, path, target, String(e?.label || '').slice(0, 200));
    }
  });
  insertMany(arr);
  res.json({ ok: true, saved: arr.length });
});

/** 聚合统计（管理员） */
router.get('/admin/overview', authMiddleware, (req: AuthRequest, res: Response) => {
  ensureTable();
  if (!canViewAnalytics(req)) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const db = getDb();
  const todayStart = Math.floor(Date.now() / 1000) - 86400;

  const total = (db.prepare('SELECT COUNT(*) c FROM click_events').get() as { c: number }).c;
  const today = (db.prepare('SELECT COUNT(*) c FROM click_events WHERE created_at >= ?').get(todayStart) as { c: number }).c;

  const pages = db
    .prepare('SELECT path, COUNT(*) c FROM click_events GROUP BY path ORDER BY c DESC LIMIT 20')
    .all() as { path: string; c: number }[];

  const targets = db
    .prepare(`
      SELECT path, target, COALESCE(MAX(label), '') AS label, COUNT(*) c
      FROM click_events GROUP BY path, target ORDER BY c DESC LIMIT 50
    `)
    .all() as { path: string; target: string; label: string; c: number }[];

  const users = db
    .prepare(`
      SELECT e.user_id, COALESCE(u.username, '未知') AS username, COUNT(*) c
      FROM click_events e LEFT JOIN users u ON u.id = e.user_id
      GROUP BY e.user_id ORDER BY c DESC LIMIT 20
    `)
    .all() as { user_id: number | null; username: string; c: number }[];

  const daily = db
    .prepare(`
      SELECT date(created_at, 'unixepoch', '+8 hours') AS day, COUNT(*) c
      FROM click_events WHERE created_at >= ?
      GROUP BY day ORDER BY day
    `)
    .all(todayStart - 6 * 86400) as { day: string; c: number }[];

  res.json({ total, today, pages, targets, users, daily });
});

export default router;
