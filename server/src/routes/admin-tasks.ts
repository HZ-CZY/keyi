import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { AuthRequest, adminMiddleware } from '../middleware/auth';

/**
 * 校园小岛每日任务 · 管理端 CRUD（挂载于 /api/admin/tasks，全文件 adminMiddleware）。
 *  - GET    /        全部任务（含禁用），按 sort, id 升序
 *  - POST   /        新建任务（type 必填；key 自动生成：checkin→'checkin'，learn→'learn'+target，review→'review'+target，
 *                    冲突时追加 _2/_3… 直到唯一；enabled 默认 1）
 *  - PUT    /:id     局部更新（仅 title/target/reward/sort/enabled；key 与 type 不可改，
 *                    target 变化也不改 key —— 账本流水 source 依赖旧 key 保持稳定）
 *  - DELETE /:id     删除任务（coins_ledger 流水保留，仅任务不再出现）
 */
const router = Router();
router.use(adminMiddleware);

/* 【2026-11-06 安全修复】
 * 1) 单任务奖励上限：接口层拦住天文数字（01-06 出现过 1e9 / 6.6e9 级别奖励被领走）。
 * 2) 审计：本文件的增删改此前**完全没有写 admin_audit_logs**，导致 11-04~11-06
 *    的后台改奖励事件查不到操作人。现在每次写操作都留痕，带操作者与前后值。 */
const MAX_TASK_REWARD = 1000;

function audit(
  db: import('better-sqlite3').Database,
  adminId: number | undefined,
  action: string,
  taskId: number | null,
  detail: string
) {
  try {
    db.prepare(
      'INSERT INTO admin_audit_logs (admin_id, action, target_user_id, detail, created_at) VALUES (?, ?, ?, ?, unixepoch())'
    ).run(adminId ?? null, action, null, detail);
  } catch {
    /* 审计失败不阻塞业务，但会写 server.log */
    console.error('[audit] 写审计失败', action, detail);
  }
}

const VALID_TYPES = ['learn', 'review', 'checkin'];

interface TaskRow {
  id: number;
  key: string;
  type: string;
  title: string;
  target: number;
  reward: number;
  sort: number;
  enabled: number;
  created_at: number;
  updated_at: number;
}

/** 生成全局唯一 key：base 冲突时追加 _2、_3… */
function genUniqueKey(db: import('better-sqlite3').Database, base: string): string {
  const exists = db.prepare('SELECT 1 FROM tasks WHERE key = ?');
  if (!exists.get(base)) return base;
  let i = 2;
  while (exists.get(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** GET /api/admin/tasks — 全量列表（含禁用） */
router.get('/', (_req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM tasks ORDER BY sort ASC, id ASC')
      .all() as TaskRow[];
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/admin/tasks — 新建任务 */
router.post('/', (req: AuthRequest, res: Response) => {
  try {
    const { type, title, target, reward, sort } = req.body ?? {};

    if (typeof type !== 'string' || !VALID_TYPES.includes(type)) {
      res.status(400).json({ error: 'type 必须为 learn/review/checkin' });
      return;
    }
    if (typeof title !== 'string' || title.trim() === '') {
      res.status(400).json({ error: 'title 不能为空' });
      return;
    }
    if (!isNonNegInt(target)) {
      res.status(400).json({ error: 'target 必须为 ≥0 的整数' });
      return;
    }
    if (!isNonNegInt(reward)) {
      res.status(400).json({ error: 'reward 必须为 ≥0 的整数' });
      return;
    }
    if (reward > MAX_TASK_REWARD) {
      res.status(400).json({ error: `单任务奖励不得超过 ${MAX_TASK_REWARD} 铜板` });
      return;
    }
    let sortVal = 0;
    if (sort !== undefined) {
      if (typeof sort !== 'number' || !Number.isInteger(sort)) {
        res.status(400).json({ error: 'sort 必须为整数' });
        return;
      }
      sortVal = sort;
    }

    const db = getDb();
    // key 自动生成：checkin→'checkin'；learn/review→type+target（与 seed 风格一致 learn20/review20）
    const base = type === 'checkin' ? 'checkin' : `${type}${target}`;
    const key = genUniqueKey(db, base);

    const result = db
      .prepare(
        `INSERT INTO tasks (key, type, title, target, reward, sort, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, unixepoch(), unixepoch())`
      )
      .run(key, type, title.trim(), target, reward, sortVal);

    const row = db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(result.lastInsertRowid) as TaskRow | undefined;
    audit(db, req.userId, 'task_create', Number(result.lastInsertRowid),
      `新建任务「${title.trim()}」key=${key} type=${type} target=${target} reward=${reward}`);
    res.json({ ...row, success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/admin/tasks/:id — 局部更新（不可改 key/type） */
router.put('/:id', (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: '任务 id 不合法' });
      return;
    }
    const body = req.body ?? {};
    const fields: string[] = [];
    const values: unknown[] = [];

    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.trim() === '') {
        res.status(400).json({ error: 'title 不能为空' });
        return;
      }
      fields.push('title = ?');
      values.push(body.title.trim());
    }
    if (body.target !== undefined) {
      if (!isNonNegInt(body.target)) {
        res.status(400).json({ error: 'target 必须为 ≥0 的整数' });
        return;
      }
      fields.push('target = ?');
      values.push(body.target);
    }
    if (body.reward !== undefined) {
      if (!isNonNegInt(body.reward)) {
        res.status(400).json({ error: 'reward 必须为 ≥0 的整数' });
        return;
      }
      if (body.reward > MAX_TASK_REWARD) {
        res.status(400).json({ error: `单任务奖励不得超过 ${MAX_TASK_REWARD} 铜板` });
        return;
      }
      fields.push('reward = ?');
      values.push(body.reward);
    }
    if (body.sort !== undefined) {
      if (typeof body.sort !== 'number' || !Number.isInteger(body.sort)) {
        res.status(400).json({ error: 'sort 必须为整数' });
        return;
      }
      fields.push('sort = ?');
      values.push(body.sort);
    }
    if (body.enabled !== undefined) {
      const en = Number(body.enabled);
      if (en !== 0 && en !== 1) {
        res.status(400).json({ error: 'enabled 必须为 0 或 1' });
        return;
      }
      fields.push('enabled = ?');
      values.push(en);
    }
    if (fields.length === 0) {
      res.status(400).json({ error: '没有可更新的字段（title/target/reward/sort/enabled）' });
      return;
    }

    const db = getDb();
    const before = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    if (!before) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }
    fields.push('updated_at = unixepoch()');
    values.push(id);
    const result = db
      .prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
    if (Number(result.changes) === 0) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }

    const row = db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(id) as TaskRow | undefined;
    audit(db, req.userId, 'task_update', id,
      `修改任务「${before.key}」：reward ${before.reward}→${row?.reward}，target ${before.target}→${row?.target}，enabled ${before.enabled}→${row?.enabled}`);
    res.json({ ...row, success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/admin/tasks/:id — 删除任务（账本流水保留） */
router.delete('/:id', (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: '任务 id 不合法' });
      return;
    }
    const db = getDb();
    const gone = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    if (Number(result.changes) === 0) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }
    res.json({ success: true, deletedId: id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
