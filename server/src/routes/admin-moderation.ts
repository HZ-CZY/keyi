// 管理端：头像审核 + 封号系统 + 审计日志（2026-09-09）
// 挂载点 /api/admin，所有接口均要求管理员权限。

import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { adminMiddleware, AuthRequest } from '../middleware/auth';
import {
  isBanDurationKey,
  resolveBanUntil,
  logAdminAction,
  deleteAvatarFile,
  deleteOrphanAvatarFile,
  BAN_DURATION_LABELS,
  formatCnTime,
} from '../lib/moderation';

const router = Router();
router.use(adminMiddleware);

// ── 头像审核 ──────────────────────────────────────────────────────────

// GET /admin/avatar-reviews?status=pending|approved|rejected|all
router.get('/avatar-reviews', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const rawStatus = String(req.query.status || 'pending');
    const status = ['pending', 'approved', 'rejected'].includes(rawStatus) ? rawStatus : 'all';
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '200')) || 200, 1), 500);

    const rows = db
      .prepare(
        `SELECT ar.id, ar.user_id, ar.pending_url, ar.prev_url, ar.status,
                ar.reason, ar.created_at, ar.reviewed_at, ar.reviewer_id,
                u.username AS username,
                COALESCE(u.avatar_url, '') AS current_avatar,
                ru.username AS reviewer_name
         FROM avatar_reviews ar
         JOIN users u ON u.id = ar.user_id
         LEFT JOIN users ru ON ru.id = ar.reviewer_id
         WHERE (? = 'all' OR ar.status = ?)
         ORDER BY ar.created_at DESC
         LIMIT ?`
      )
      .all(status, status, limit) as any[];

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/avatar-reviews/:id/approve — 通过：新头像正式生效
router.post('/avatar-reviews/:id/approve', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const reviewId = parseInt(req.params.id);
    if (isNaN(reviewId)) {
      res.status(400).json({ error: '无效的审核记录ID' });
      return;
    }

    const review = db.prepare('SELECT * FROM avatar_reviews WHERE id = ?').get(reviewId) as any;
    if (!review) {
      res.status(404).json({ error: '审核记录不存在' });
      return;
    }
    if (review.status !== 'pending') {
      res.status(400).json({ error: '该申请已处理，无法重复审核' });
      return;
    }

    // 记录被替换掉的旧头像（审核通过前的生效头像），用于后续安全清理
    const before = db
      .prepare("SELECT COALESCE(avatar_url, '') AS avatar_url FROM users WHERE id = ?")
      .get(review.user_id) as any;
    const replacedUrl = String((before && before.avatar_url) || review.prev_url || '').trim();

    db.transaction(() => {
      db.prepare('UPDATE users SET avatar_url = ?, pending_avatar_url = ? WHERE id = ?').run(
        review.pending_url,
        '',
        review.user_id
      );
      db.prepare(
        "UPDATE avatar_reviews SET status = 'approved', reason = '', reviewed_at = unixepoch(), reviewer_id = ? WHERE id = ?"
      ).run(req.userId ?? null, reviewId);
    })();

    // 清理孤儿文件：仅当旧头像是系统生成格式且已无人引用时才删除，失败不影响审核结果
    const orphanRemoved = deleteOrphanAvatarFile(replacedUrl, reviewId);

    logAdminAction(
      req.userId,
      'avatar_approve',
      review.user_id,
      `通过头像审核（新头像：${review.pending_url}${orphanRemoved ? `，旧头像文件已清理：${replacedUrl}` : ''}）`
    );

    res.json({ success: true, avatarUrl: review.pending_url, orphanRemoved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/avatar-reviews/:id/reject { reason } — 驳回：删除待审文件并记录原因
router.post('/avatar-reviews/:id/reject', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const reviewId = parseInt(req.params.id);
    if (isNaN(reviewId)) {
      res.status(400).json({ error: '无效的审核记录ID' });
      return;
    }

    /* 【2026-10-15 按需求】驳回原因改为**可选**。
       有些驳回（图片明显不合规、含二维码广告等）不需要额外解释，
       强制填写只会让管理员随手打一个字，反而降低信息质量。
       留空时学生端只显示「审核未通过，请重新上传」。 */
    const reason = String(req.body?.reason || '').trim().slice(0, 200);

    const review = db.prepare('SELECT * FROM avatar_reviews WHERE id = ?').get(reviewId) as any;
    if (!review) {
      res.status(404).json({ error: '审核记录不存在' });
      return;
    }
    if (review.status !== 'pending') {
      res.status(400).json({ error: '该申请已处理，无法重复审核' });
      return;
    }

    db.transaction(() => {
      db.prepare('UPDATE users SET pending_avatar_url = ? WHERE id = ?').run('', review.user_id);
      db.prepare(
        "UPDATE avatar_reviews SET status = 'rejected', reason = ?, reviewed_at = unixepoch(), reviewer_id = ? WHERE id = ?"
      ).run(reason, req.userId ?? null, reviewId);
    })();

    // 驳回后删除待审文件，避免占用磁盘
    deleteAvatarFile(review.pending_url);

    logAdminAction(
      req.userId,
      'avatar_reject',
      review.user_id,
      reason ? `驳回头像审核，原因：${reason}` : '驳回头像审核（未填写原因）'
    );

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 封号系统 ──────────────────────────────────────────────────────────

// POST /admin/users/:id/ban { duration: '1d'|'7d'|'30d'|'perm', reason }
router.post('/users/:id/ban', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const targetId = parseInt(req.params.id);
    if (isNaN(targetId)) {
      res.status(400).json({ error: '无效的用户ID' });
      return;
    }

    const { duration, reason } = req.body || {};
    if (!isBanDurationKey(duration)) {
      res.status(400).json({ error: '请选择有效的封禁时长（1天/7天/30天/永久）' });
      return;
    }
    const banReason = String(reason || '').trim();
    if (!banReason) {
      res.status(400).json({ error: '请填写封禁原因' });
      return;
    }

    const target = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(targetId) as any;
    if (!target) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }
    if (target.role === 'admin') {
      res.status(400).json({ error: '不能封禁管理员账号' });
      return;
    }
    if (targetId === req.userId) {
      res.status(400).json({ error: '不能封禁自己的账号' });
      return;
    }

    const bannedUntil = resolveBanUntil(duration);
    db.prepare('UPDATE users SET banned_until = ?, ban_reason = ?, banned_at = unixepoch() WHERE id = ?').run(
      bannedUntil,
      banReason,
      targetId
    );

    logAdminAction(
      req.userId,
      'ban',
      targetId,
      `封禁用户「${target.username}」，时长：${BAN_DURATION_LABELS[duration]}，` +
        `解封时间：${bannedUntil === -1 ? '永久封禁' : formatCnTime(bannedUntil)}，原因：${banReason}`
    );

    res.json({
      success: true,
      bannedUntil: bannedUntil === -1 ? null : bannedUntil,
      permanent: bannedUntil === -1,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/users/:id/unban — 提前解封
router.post('/users/:id/unban', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const targetId = parseInt(req.params.id);
    if (isNaN(targetId)) {
      res.status(400).json({ error: '无效的用户ID' });
      return;
    }

    const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetId) as any;
    if (!target) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    db.prepare('UPDATE users SET banned_until = 0, ban_reason = ?, banned_at = 0 WHERE id = ?').run('', targetId);

    logAdminAction(req.userId, 'unban', targetId, `解除用户「${target.username}」的封禁`);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/banned-users — 当前处于封禁中的用户（管理端概览用）
router.get('/banned-users', (_req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, username, role, banned_until, ban_reason, banned_at
         FROM users
         WHERE banned_until != 0 AND (banned_until = -1 OR banned_until > unixepoch())
         ORDER BY banned_at DESC`
      )
      .all();
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 审计日志 ──────────────────────────────────────────────────────────

// GET /admin/audit-logs?limit=100
router.get('/audit-logs', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '100')) || 100, 1), 500);

    const rows = db
      .prepare(
        `SELECT al.id, al.admin_id, al.action, al.target_user_id, al.detail, al.created_at,
                au.username AS admin_name,
                tu.username AS target_username
         FROM admin_audit_logs al
         LEFT JOIN users au ON au.id = al.admin_id
         LEFT JOIN users tu ON tu.id = al.target_user_id
         ORDER BY al.id DESC
         LIMIT ?`
      )
      .all(limit) as any[];

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
