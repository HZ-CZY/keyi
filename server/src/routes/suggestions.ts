import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { addCoins } from '../lib/coins';

/**
 * 想法征集（实词大赛排行榜下方）
 * ─────────────────────────────────────────────────────────
 * 学生提交「想要的功能 / 玩法 / 改进」；管理员采纳后发放 300 铜板。
 * 表在首次访问时懒创建（ensureTable），不依赖启动迁移的执行顺序。
 *   POST   /api/suggestions              提交想法（登录）
 *   GET    /api/suggestions/mine         我的想法（登录）
 *   GET    /api/suggestions/admin/list   全部想法（管理员）
 *   POST   /api/suggestions/admin/:id/accept  采纳并 +300 铜板（管理员）
 *   POST   /api/suggestions/admin/:id/reject  拒绝（管理员）
 */
const router = Router();

const MIN_LEN = 5;
const MAX_LEN = 300;
const REWARD = 300;
const DAILY_LIMIT = 5;

/** 幂等建表：每个入口调用一次，首次访问时创建 */
function ensureTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS idea_suggestions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      content     TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'pending',
      reward      INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      reviewed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_idea_suggestions_user   ON idea_suggestions(user_id);
    CREATE INDEX IF NOT EXISTS idx_idea_suggestions_status ON idea_suggestions(status);
  `);
}

/** 管理员判定：直接查库里的 role，避免依赖请求上下文里的角色 */
function isAdmin(req: AuthRequest): boolean {
  const row = getDb()
    .prepare('SELECT role FROM users WHERE id = ?')
    .get(req.userId) as { role?: string } | undefined;
  return row?.role === 'admin';
}

/** 提交想法 */
router.post('/', authMiddleware, (req: AuthRequest, res: Response) => {
  // [2026-10-28] 用户端想法征集已下线；后台仍可查看与处理历史提交
  res.status(403).json({ error: '想法征集已结束，感谢参与' });
  return;
  // eslint-disable-next-line no-unreachable
  ensureTable();
  const content = String((req.body as any)?.content ?? '').trim();
  if (content.length < MIN_LEN) {
    res.status(400).json({ error: `想法至少写 ${MIN_LEN} 个字` });
    return;
  }
  if (content.length > MAX_LEN) {
    res.status(400).json({ error: `想法最多 ${MAX_LEN} 个字` });
    return;
  }

  const db = getDb();
  // 防刷：每人 24 小时内最多 5 条
  const since = Math.floor(Date.now() / 1000) - 86400;
  const n = db
    .prepare('SELECT COUNT(*) AS c FROM idea_suggestions WHERE user_id = ? AND created_at >= ?')
    .get(req.userId, since) as { c: number };
  if (n.c >= DAILY_LIMIT) {
    res.status(429).json({ error: '今天提交的想法有点多啦，明天再来吧' });
    return;
  }

  const info = db
    .prepare('INSERT INTO idea_suggestions (user_id, content) VALUES (?, ?)')
    .run(req.userId, content);
  res.json({ id: Number(info.lastInsertRowid), status: 'pending', reward: REWARD });
});

/** 我的想法（最近 20 条，含状态与奖励） */
router.get('/mine', authMiddleware, (req: AuthRequest, res: Response) => {
  ensureTable();
  const rows = getDb()
    .prepare(
      'SELECT id, content, status, reward, created_at FROM idea_suggestions WHERE user_id = ? ORDER BY id DESC LIMIT 20'
    )
    .all(req.userId);
  res.json(rows);
});

/** 管理端：列表（待处理优先） */
router.get('/admin/list', authMiddleware, (req: AuthRequest, res: Response) => {
  ensureTable();
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const rows = getDb()
    .prepare(`
      SELECT s.id, s.user_id, u.username, s.content, s.status, s.reward,
             s.created_at, s.reviewed_at
      FROM idea_suggestions s
      LEFT JOIN users u ON u.id = s.user_id
      ORDER BY (s.status = 'pending') DESC, s.id DESC
      LIMIT 200
    `)
    .all();
  res.json(rows);
});

/** 管理端：采纳（发 300 铜板） */
router.post('/admin/:id/accept', authMiddleware, (req: AuthRequest, res: Response) => {
  ensureTable();
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const id = Number(req.params.id);
  const db = getDb();
  const row = db
    .prepare('SELECT id, user_id, status FROM idea_suggestions WHERE id = ?')
    .get(id) as { id: number; user_id: number; status: string } | undefined;
  if (!row) {
    res.status(404).json({ error: '想法不存在' });
    return;
  }
  if (row.status === 'accepted') {
    res.status(400).json({ error: '该想法已采纳' });
    return;
  }

  db.prepare(
    "UPDATE idea_suggestions SET status = 'accepted', reward = ?, reviewed_at = unixepoch() WHERE id = ?"
  ).run(REWARD, id);
  addCoins(row.user_id, REWARD, 'idea_accepted', id);
  res.json({ ok: true, reward: REWARD });
});

/** 管理端：拒绝 */
router.post('/admin/:id/reject', authMiddleware, (req: AuthRequest, res: Response) => {
  ensureTable();
  if (!isAdmin(req)) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const id = Number(req.params.id);
  const info = getDb()
    .prepare("UPDATE idea_suggestions SET status = 'rejected', reviewed_at = unixepoch() WHERE id = ? AND status = 'pending'")
    .run(id);
  if (info.changes === 0) {
    res.status(400).json({ error: '无法处理（不存在或已处理）' });
    return;
  }
  res.json({ ok: true });
});

export default router;
