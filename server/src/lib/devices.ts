// 设备追踪 — 2026-09-15
//
// 目标：把「同一台设备」跨登录、跨账号串起来（UA/指纹做不到持久识别）。
// 做法：首次请求时下发第一方 cookie `keyi_device`（UUID，1 年，服务端 Set-Cookie
//       不受 Safari ITP 对 JS 写 cookie 的 7 天限制），同时前端把 id 镜像到
//       localStorage 并用 body.deviceId 回传 —— cookie jar 被清但 LS 还在（或反之）时
//       仍能认成同一台设备。
//
// 注意：iPad 主屏幕 Web Clip 与 Safari 可能是两个独立 cookie/storage jar，
//       同一台 iPad 可能生成 2 个 device_id（无法从网页侧规避，只能人工合并）。

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database';

export const DEVICE_COOKIE = 'keyi_device';
const DEVICE_MAX_AGE = 365 * 24 * 60 * 60 * 1000; // 1 年
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readCookie(header: string | undefined, name: string): string {
  if (!header) return '';
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : '';
}

/** 取本次请求的设备 ID：body.deviceId 优先 → cookie → 新生成；并始终刷新 cookie */
export function resolveDeviceId(req: Request, res: Response): string {
  const fromBody = typeof (req.body as any)?.deviceId === 'string' ? (req.body as any).deviceId.trim() : '';
  const fromCookie = readCookie(req.headers.cookie, DEVICE_COOKIE).trim();
  let deviceId = UUID_RE.test(fromBody) ? fromBody : UUID_RE.test(fromCookie) ? fromCookie : '';
  if (!deviceId) deviceId = uuidv4();
  res.cookie(DEVICE_COOKIE, deviceId, {
    httpOnly: false, // 前端需读回写入 localStorage
    secure: true,
    sameSite: 'lax',
    maxAge: DEVICE_MAX_AGE,
    path: '/',
  });
  return deviceId;
}

/** 设备短号：给后台显示用（完整 UUID 太长） */
export function shortDeviceId(deviceId: string): string {
  return deviceId ? deviceId.replace(/-/g, '').slice(0, 6) : '';
}

interface TouchOptions {
  userId?: number | null;
  username?: string;
  ip?: string;
  userAgent?: string;
  deviceInfo?: string;
  isLogin?: boolean;
}

/** upsert 设备行；带 userId 时同时维护「设备 ↔ 账号」关联表 */
export function touchDevice(deviceId: string, opts: TouchOptions = {}): void {
  if (!deviceId) return;
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  try {
    db.prepare(
      `INSERT INTO devices (device_id, device_info, user_agent, first_seen, last_seen, login_count, last_user_id, last_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET
         device_info = CASE WHEN excluded.device_info != '' THEN excluded.device_info ELSE devices.device_info END,
         user_agent  = CASE WHEN excluded.user_agent  != '' THEN excluded.user_agent  ELSE devices.user_agent  END,
         last_seen   = excluded.last_seen,
         login_count = devices.login_count + excluded.login_count,
         last_user_id = COALESCE(excluded.last_user_id, devices.last_user_id),
         last_ip     = CASE WHEN excluded.last_ip != '' THEN excluded.last_ip ELSE devices.last_ip END`
    ).run(
      deviceId,
      opts.deviceInfo || '',
      opts.userAgent || '',
      now,
      now,
      opts.isLogin ? 1 : 0,
      opts.userId ?? null,
      opts.ip || ''
    );

    if (opts.userId) {
      db.prepare(
        `INSERT INTO device_users (device_id, user_id, username, first_seen, last_seen, login_count)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(device_id, user_id) DO UPDATE SET
           username    = CASE WHEN excluded.username != '' THEN excluded.username ELSE device_users.username END,
           last_seen   = excluded.last_seen,
           login_count = device_users.login_count + excluded.login_count`
      ).run(deviceId, opts.userId, opts.username || '', now, now, opts.isLogin ? 1 : 0);
    }
  } catch {
    // 设备追踪失败不能影响登录/心跳主流程
  }
}
