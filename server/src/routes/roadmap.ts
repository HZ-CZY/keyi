import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { AuthRequest, authMiddleware } from '../middleware/auth';

/**
 * 站点升级进度（用户在「设置 → 站点升级进度」看到的公开路线图）
 * ─────────────────────────────────────────────────────────────
 * 数据完全由后台维护（本站由管理员直接入库），学生端只读。
 *   GET /api/roadmap   返回全部条目 + 各状态计数
 *
 * 状态语义（顺序即展示顺序）：
 *   planned 计划中  —— 方向认可，未排期
 *   todo    待开始  —— 已排期，还没动手
 *   doing   进行中  —— 正在写/在测
 *   done    已完成  —— 已上线
 *
 * 分类（前端用来做筛选 chip）：
 *   feature 新功能 / improve 体验优化 / bug 问题修复 / balance 数值调整
 */
const router = Router();

const STATUSES = ['planned', 'todo', 'doing', 'done'] as const;
const CATEGORIES = ['feature', 'improve', 'bug', 'balance'] as const;

let tableEnsured = false;

function ensureTable(): void {
  if (tableEnsured) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS site_roadmap (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      title          TEXT    NOT NULL,
      detail         TEXT    NOT NULL DEFAULT '',
      category       TEXT    NOT NULL DEFAULT 'feature',
      status         TEXT    NOT NULL DEFAULT 'planned',
      version        TEXT,
      sort           INTEGER NOT NULL DEFAULT 100,
      source_idea_id INTEGER,
      created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_site_roadmap_status ON site_roadmap(status);
  `);
  tableEnsured = true;
}

interface RoadmapRow {
  id: number;
  title: string;
  detail: string;
  category: string;
  status: string;
  version: string | null;
  sort: number;
  updated_at: number;
}

/** 公开读取（需登录，避免未登录爬虫抓走全部规划） */
router.get('/', authMiddleware, (_req: AuthRequest, res: Response) => {
  ensureTable();
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT id, title, detail, category, status, version, sort, updated_at
       FROM site_roadmap
       ORDER BY CASE status
                  WHEN 'doing'   THEN 0
                  WHEN 'todo'    THEN 1
                  WHEN 'planned' THEN 2
                  ELSE 3
                END,
                sort ASC, id ASC`
    )
    .all() as RoadmapRow[];

  const counts: Record<string, number> = { planned: 0, todo: 0, doing: 0, done: 0 };
  for (const r of rows) {
    if (STATUSES.includes(r.status as any)) counts[r.status] += 1;
  }

  // 已完成条目按更新时间倒序，其余按 sort —— 让「最近上线」排在最前面
  const done = rows.filter((r) => r.status === 'done').sort((a, b) => b.updated_at - a.updated_at);
  const rest = rows.filter((r) => r.status !== 'done');

  const latest = rows.reduce((m, r) => Math.max(m, Number(r.updated_at) || 0), 0);

  res.json({
    counts,
    updatedAt: latest,
    statuses: STATUSES,
    categories: CATEGORIES,
    items: [...rest, ...done],
  });
});

export default router;
