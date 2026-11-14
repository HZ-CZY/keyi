// 封号 / 头像审核 公共逻辑（2026-09-09）
// 供 middleware/auth.ts、routes/auth.ts、routes/admin-moderation.ts 共用，
// 避免相互 import 造成循环依赖。

import fs from 'fs';
import path from 'path';
import { getDb } from '../db/database';

/** 管理员可选的封禁时长档位（秒）；null 表示永久封禁 */
export type BanDurationKey = '1d' | '7d' | '30d' | 'perm';

export const BAN_DURATIONS: Record<BanDurationKey, number | null> = {
  '1d': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,
  perm: null,
};

export const BAN_DURATION_LABELS: Record<BanDurationKey, string> = {
  '1d': '1 天',
  '7d': '7 天',
  '30d': '30 天',
  perm: '永久',
};

/** 判断入参是否是合法的封禁时长档位 */
export function isBanDurationKey(value: unknown): value is BanDurationKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BAN_DURATIONS, value);
}

/** 当前 unix 秒 */
export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** 计算解封时间戳：-1 表示永久封禁 */
export function resolveBanUntil(duration: BanDurationKey, now: number = nowUnix()): number {
  const seconds = BAN_DURATIONS[duration];
  return seconds === null ? -1 : now + seconds;
}

export interface BanState {
  banned_until?: number | null;
  ban_reason?: string | null;
}

/** 账号是否处于封禁中（0=正常，-1=永久，其他=解封时间戳） */
export function isBanned(user: BanState | null | undefined): boolean {
  if (!user) return false;
  const until = Number(user.banned_until || 0);
  if (until === 0) return false;
  if (until === -1) return true;
  return until > nowUnix();
}

/** 过期封禁视为已解封，返回当前生效的封禁时间戳（0 表示未封禁） */
export function activeBanUntil(user: BanState | null | undefined): number {
  if (!user) return 0;
  const until = Number(user.banned_until || 0);
  if (until === 0) return 0;
  if (until === -1) return -1;
  return until > nowUnix() ? until : 0;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 按北京时间格式化 unix 秒 → YYYY-MM-DD HH:mm */
export function formatCnTime(unix: number): string {
  const d = new Date((unix + 8 * 3600) * 1000);
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
  );
}

export interface BanPayload {
  error: string;
  code: 'ACCOUNT_BANNED';
  bannedUntil: number | null;
  reason: string;
}

/** 统一的封禁错误响应体：{ error, code, bannedUntil, reason } */
export function banPayload(user: BanState): BanPayload {
  const until = Number(user.banned_until || 0);
  const reason = String(user.ban_reason || '').trim();
  const permanent = until === -1;
  const error = permanent
    ? `账号已被永久封禁${reason ? `，原因：${reason}` : ''}`
    : `账号已被封禁，解封时间：${formatCnTime(until)}${reason ? `，原因：${reason}` : ''}`;
  return {
    error,
    code: 'ACCOUNT_BANNED',
    bannedUntil: permanent ? null : until,
    reason,
  };
}

/** 头像 URL(/uploads/avatars/xxx.png) → 服务器磁盘绝对路径 */
export function urlToAvatarPath(url?: string | null): string | null {
  if (!url) return null;
  const match = /^\/uploads\/avatars\/([A-Za-z0-9._-]+)$/.exec(url);
  if (!match) return null;
  return path.join(__dirname, '..', '..', 'public', 'avatars', match[1]);
}

/** 删除头像文件（失败静默，绝不因为清理文件影响主流程） */
export function deleteAvatarFile(url?: string | null): void {
  try {
    const filePath = urlToAvatarPath(url);
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore cleanup errors
  }
}

/** 是否为系统生成的头像 URL：/uploads/avatars/avatar_<uid>_<uuid>.<ext> */
export function isSystemAvatarUrl(url?: string | null): boolean {
  if (!url) return false;
  return /^\/uploads\/avatars\/avatar_\d+_[A-Za-z0-9._-]+\.[A-Za-z0-9]{1,8}$/.test(url);
}

/**
 * 安全清理「孤儿」头像文件：
 * 仅当 URL 是系统生成格式、且不再被任何用户的 avatar_url / pending_avatar_url
 * 或任何待审记录引用时才删除磁盘文件。默认头像、外部 URL、格式不匹配的一律跳过。
 * 删除失败只记录日志，不影响主流程。
 */
export function deleteOrphanAvatarFile(url?: string | null, excludeReviewId?: number | null): boolean {
  if (!isSystemAvatarUrl(url)) return false;
  try {
    const db = getDb();
    const stillUsed = db
      .prepare('SELECT COUNT(*) AS c FROM users WHERE avatar_url = ? OR pending_avatar_url = ?')
      .get(url, url) as any;
    if (stillUsed && Number(stillUsed.c) > 0) return false;

    const pendingRef = excludeReviewId
      ? (db
          .prepare("SELECT COUNT(*) AS c FROM avatar_reviews WHERE pending_url = ? AND id != ? AND status = 'pending'")
          .get(url, excludeReviewId) as any)
      : (db
          .prepare("SELECT COUNT(*) AS c FROM avatar_reviews WHERE pending_url = ? AND status = 'pending'")
          .get(url) as any);
    if (pendingRef && Number(pendingRef.c) > 0) return false;

    const filePath = urlToAvatarPath(url);
    if (!filePath || !fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  } catch (err: any) {
    console.error('[moderation] 清理孤儿头像文件失败，已忽略 url=%s error=%s', url, (err && err.message) || err);
    return false;
  }
}

/** 写管理端审计日志：谁、何时、对谁、做了什么、原因 */
export function logAdminAction(
  adminId: number | null | undefined,
  action: string,
  targetUserId: number | null | undefined,
  detail: string
): void {
  try {
    getDb()
      .prepare(
        'INSERT INTO admin_audit_logs (admin_id, action, target_user_id, detail, created_at) VALUES (?, ?, ?, ?, unixepoch())'
      )
      .run(adminId ?? null, action, targetUserId ?? null, detail);
  } catch (err: any) {
    // 审计是旁路：写入失败只记录上下文日志，绝不中断/回滚业务操作
    console.error(
      '[moderation] 审计日志写入失败（旁路，不影响业务操作）action=%s adminId=%s targetUserId=%s detail=%s error=%s',
      action,
      adminId ?? null,
      targetUserId ?? null,
      detail,
      (err && err.message) || err
    );
  }
}
