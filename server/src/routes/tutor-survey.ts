import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { AuthRequest, authMiddleware, adminMiddleware } from '../middleware/auth';

/**
 * AI 讲题 · 功能意见征集
 * ─────────────────────────────────────────────────────────
 * 首页「排行榜」入口下方新增入口，弹窗内嵌演示视频，问学生对
 * 「AI 讲题（拍照讲解 + 分步板书）」的付费意愿。
 * 陈浩铎、朱栋安账号不参与（前端隐藏 + 后端 403 双保险）。
 *
 * [2026-11-09] 已下架：SURVEY_OPEN=false，学生端入口移除，GET/POST 均拒绝；
 * 管理端 /admin/list 保留，历史数据可在 后台 → 新功能问卷 查看。
 *
 *   GET  /api/tutor-survey/mine        我的填写状态与内容（登录）
 *   POST /api/tutor-survey             提交 / 覆盖提交（登录）
 *   GET  /api/tutor-survey/admin/list  全部结果 + 统计（管理员）
 */
const router = Router();

/** 后台数据仅陈子洋可看（陈浩铎、朱栋安都不在其中） */
const OWNER_ONLY = ['陈子洋'];

/** 征集开关：false = 已结束收集（学生端入口同步下架，后台数据仍可查看） */
const SURVEY_OPEN = false;

/** 不参与征集的账号 */
const EXCLUDED_USERNAMES = ['陈浩铎', '朱栋安'];

const WILL_PAY = ['yes', 'depends', 'no'];
const PRICE = ['free', 'p1', 'p3', 'p5', 'vip'];
const GRADES = ['小学', '初一', '初二', '初三', '高一', '高二', '高三', '其他'];
const WANTS = ['homework', 'exam', 'preview', 'steps', 'check', 'other'];
const MAX_COMMENT = 300;

function ensureTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS tutor_survey (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      username    TEXT    NOT NULL,
      will_pay    TEXT    NOT NULL,
      price       TEXT,
      grade       TEXT,
      wants       TEXT,
      comment     TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tutor_survey_user ON tutor_survey(user_id);
  `);
}

function isExcluded(userId: number): boolean {
  const row = getDb()
    .prepare('SELECT username FROM users WHERE id = ?')
    .get(userId) as { username?: string } | undefined;
  return !!row?.username && EXCLUDED_USERNAMES.includes(row.username);
}

/** 我的状态：是否已填 + 已填内容 */
router.get('/mine', authMiddleware, (req: AuthRequest, res: Response) => {
  ensureTable();
  const userId = req.userId!;
  if (!SURVEY_OPEN || isExcluded(userId)) {
    return res.json({ hidden: true, filled: false });
  }
  const row = getDb()
    .prepare('SELECT will_pay, price, grade, wants, comment, created_at, updated_at FROM tutor_survey WHERE user_id = ?')
    .get(userId) as any;
  if (!row) return res.json({ hidden: false, filled: false });
  let wants: string[] = [];
  try { wants = row.wants ? JSON.parse(row.wants) : []; } catch { wants = []; }
  res.json({
    hidden: false,
    filled: true,
    data: {
      willPay: row.will_pay,
      price: row.price,
      grade: row.grade,
      wants,
      comment: row.comment,
      at: row.updated_at || row.created_at,
    },
  });
});

/** 提交（同一人只保留一条，重复提交即更新） */
router.post('/', authMiddleware, (req: AuthRequest, res: Response) => {
  ensureTable();
  const userId = req.userId!;
  if (!SURVEY_OPEN) {
    return res.status(403).json({ error: '该问卷已结束收集，感谢参与' });
  }
  if (isExcluded(userId)) {
    return res.status(403).json({ error: '本账号不参与该征集' });
  }

  const { willPay, price, grade, wants, comment } = req.body || {};
  if (!WILL_PAY.includes(willPay)) {
    return res.status(400).json({ error: '请先回答是否愿意付费' });
  }
  if (price != null && price !== '' && !PRICE.includes(price)) {
    return res.status(400).json({ error: '价格选项不合法' });
  }
  if (grade != null && grade !== '' && !GRADES.includes(grade)) {
    return res.status(400).json({ error: '年级选项不合法' });
  }

  const wantsArr: string[] = Array.isArray(wants)
    ? wants.filter((w: any) => WANTS.includes(w)).slice(0, 10)
    : [];
  const commentStr = typeof comment === 'string' ? comment.trim().slice(0, MAX_COMMENT) : '';

  const u = getDb().prepare('SELECT username FROM users WHERE id = ?').get(userId) as
    | { username?: string } | undefined;

  getDb()
    .prepare(
      `INSERT INTO tutor_survey (user_id, username, will_pay, price, grade, wants, comment, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
       ON CONFLICT(user_id) DO UPDATE SET
         will_pay   = excluded.will_pay,
         price      = excluded.price,
         grade      = excluded.grade,
         wants      = excluded.wants,
         comment    = excluded.comment,
         updated_at = unixepoch()`
    )
    .run(
      userId,
      u?.username || '',
      willPay,
      price || null,
      grade || null,
      wantsArr.length ? JSON.stringify(wantsArr) : null,
      commentStr || null
    );

  res.json({ ok: true });
});

/** 管理端：列表 + 汇总统计（仅陈子洋可见） */
router.get('/admin/list', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response) => {
  const who = getDb().prepare('SELECT username FROM users WHERE id = ?').get(req.userId!) as
    | { username?: string } | undefined;
  if (!who?.username || !OWNER_ONLY.includes(who.username)) {
    return res.status(403).json({ error: '无权查看该数据' });
  }
  ensureTable();
  const db = getDb();
  const rows = db
    .prepare('SELECT id, username, will_pay, price, grade, wants, comment, created_at, updated_at FROM tutor_survey ORDER BY COALESCE(updated_at, created_at) DESC')
    .all() as any[];

  const list = rows.map((r) => {
    let wants: string[] = [];
    try { wants = r.wants ? JSON.parse(r.wants) : []; } catch { wants = []; }
    return {
      id: r.id,
      username: r.username,
      willPay: r.will_pay,
      price: r.price,
      grade: r.grade,
      wants,
      comment: r.comment,
      at: r.updated_at || r.created_at,
    };
  });

  const total = list.length;
  const byWillPay: Record<string, number> = { yes: 0, depends: 0, no: 0 };
  const byPrice: Record<string, number> = { free: 0, p1: 0, p3: 0, p5: 0, vip: 0, '': 0 };
  const byGrade: Record<string, number> = {};
  const byWants: Record<string, number> = {};
  for (const r of list) {
    byWillPay[r.willPay] = (byWillPay[r.willPay] || 0) + 1;
    byPrice[r.price || ''] = (byPrice[r.price || ''] || 0) + 1;
    if (r.grade) byGrade[r.grade] = (byGrade[r.grade] || 0) + 1;
    for (const w of r.wants) byWants[w] = (byWants[w] || 0) + 1;
  }

  res.json({ total, byWillPay, byPrice, byGrade, byWants, list });
});

export default router;
