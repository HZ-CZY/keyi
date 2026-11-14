import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { getDb } from '../db/database';
import { isBanned, banPayload } from '../lib/moderation';
import { getDeviceRule } from '../lib/device-rules';

/**
 * 【2026-09-12 安全修复】JWT 签名密钥 —— 全项目唯一来源。
 *
 * 原先此处（以及 routes/announcements.ts、index.ts）各自回退到硬编码默认值，
 * 而且 index.ts 用的默认值还与之不同。由于该默认值随源码公开，任何人可离线
 * 自签任意 userId（含 admin）的 JWT，构成本项目最严重的认证绕过漏洞。
 *
 * 现策略：只从环境变量读取；缺失或过短直接抛错，拒绝以弱密钥启动。
 * 密钥由 systemd 的 EnvironmentFile 注入：
 *   /etc/systemd/system/keyi.service.d/10-env.conf
 *     → EnvironmentFile=-/root/project-backup/server/.env
 */
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 16) {
  throw new Error(
    '[auth] 环境变量 JWT_SECRET 未配置或过短，拒绝启动。' +
      '请检查 systemd 单元是否通过 EnvironmentFile 注入了该变量。'
  );
}
export const JWT_SECRET: string = jwtSecret;

export interface AuthRequest extends Request {
  userId?: number;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  /* ── 取 token：优先 Authorization 头，回退到 90 天 cookie ────────────
     【2026-10-01 安全修复】原先只认 `Bearer ` 头。前端 AuthContext 在
     localStorage 被清空时会**用 JS 读取** keyi_token cookie 来恢复登录态，
     因此那个 cookie 一直被迫设成 httpOnly:false —— 等于把 90 天有效期的
     凭证暴露给任何 XSS。

     现在服务端自己支持 cookie 鉴权，cookie 改成 httpOnly:true（JS 读不到），
     前端不再需要也不应该去读它，改为调 GET /api/auth/me 由服务端判定。
     攻击面因此收窄：即使页面被注入脚本，也拿不到长期凭证。 */
  const authHeader = req.headers.authorization;
  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    // 解析 Cookie 头里的 keyi_token（不引 cookie-parser，逻辑很简单）
    const cookieHeader = req.headers.cookie || '';
    const m = /(?:^|;\s*)keyi_token=([^;]*)/.exec(cookieHeader);
    if (m && m[1]) token = decodeURIComponent(m[1]);
  }
  if (!token) {
    res.status(401).json({ error: '需要身份验证' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; iat?: number };
    req.userId = decoded.userId;

    // 封号拦截：登录后又中途被封的用户，任何带 token 的请求一律 403 ACCOUNT_BANNED
    try {
      const db = getDb();
      const row = db.prepare('SELECT banned_until, ban_reason FROM users WHERE id = ?').get(req.userId) as any;
      if (row && isBanned(row)) {
        res.status(403).json(banPayload(row));
        return;
      }
    } catch {
      // 查询失败时不阻断请求，交由下游逻辑处理
    }

    // 登录设备限制 (2026-09-22)：规则生效时刻之前签发的 token 一律失效 →
    // 设置限制时所有旧会话（含 90 天 cookie 的 iPad）立刻被踢下线，必须重新登录。
    try {
      const rule = getDeviceRule(req.userId as number);
      const issuedAt = typeof decoded.iat === 'number' ? decoded.iat : 0;
      if (rule && issuedAt < rule.enforcedAt) {
        res.status(401).json({
          error: '该账号的登录设备限制已生效，请在允许的设备上重新登录',
          code: 'SESSION_REVOKED',
        });
        return;
      }
    } catch {
      // 查询失败时不阻断请求
    }

    /* ── 【2026-10-14 按需求】一个账号只能在一个浏览器页面里用 ──────────
       规则见 checkSingleSession：sid 不符 = 账号在别处登录过；tabId 进了
       接管名单 = 本页被新页面顶掉。两种情况都返回 401 SESSION_REPLACED，
       前端据此清会话并提示（与 ACCOUNT_BANNED 走同一条链路）。
       管理员豁免 —— 后台与多设备调试需要同时在多处登录。 */
    try {
      const db = getDb();
      const sess = checkSingleSession(db, req.userId as number, decoded, req.headers['x-keyi-tab']);
      if (!sess.ok) {
        res.status(401).json({ error: sess.message, code: 'SESSION_REPLACED' });
        return;
      }
    } catch {
      // 查询失败时不阻断请求（宁可放行，也不要因为一次抖动把所有人踢掉）
    }

    next();
  } catch {
    res.status(401).json({ error: '令牌无效或已过期' });
  }
}

export function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  authMiddleware(req, res, () => {
    try {
      const db = getDb();
      const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.userId) as any;
      if (!user || user.role !== 'admin') {
        res.status(403).json({ error: '需要管理员权限' });
        return;
      }
      next();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

/**
 * 生成一个会话标识（sid）。每次登录/注册都换新的 ——
 * 它就是「这次登录」的身份，写进 JWT 也写进 user_sessions，
 * 两者不一致就说明账号在别处重新登录过。
 */
export function newSid(): string {
  return randomBytes(16).toString('hex');
}

export function generateToken(userId: number, sid?: string): string {
  return jwt.sign({ userId, sid: sid || newSid() }, JWT_SECRET, { expiresIn: '90d' });
}

/** 取请求头里的标签页标识（前端 sessionStorage 里的随机串，最长 64 字符） */
export function tabIdOf(req: Request): string {
  const raw = req.headers['x-keyi-tab'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' ? v.slice(0, 64) : '';
}

/**
 * 登录/注册成功后写入会话记录：sid 与 tab 直接接管。
 *
 * 为什么必须在这里写（而不是等下一次请求由中间件补建）：
 * 中间件的规则是「sid 与记录不一致就踢」—— 若不在登录时更新记录，
 * 新登录的这个人会因为记录里还是旧 sid 而被自己踢掉。
 * kicked_tabs 一并清空：重新登录等于开新局，之前的接管名单不再适用。
 */
export function upsertSession(userId: number, sid: string, tab: string): void {
  try {
    const db = getDb();
    /* 管理员完全不参与这套机制（连记录都不写）。
       校验那边本来就放行，但表里留一行会被后来维护的人误读成
       「这个账号受单会话限制」—— 干脆不写。 */
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any;
    if (u && u.role === 'admin') return;
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO user_sessions (user_id, sid, tab_id, kicked_tabs, created_at, seen_at)
       VALUES (?, ?, ?, '[]', ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         sid = excluded.sid, tab_id = excluded.tab_id, kicked_tabs = '[]',
         created_at = excluded.created_at, seen_at = excluded.seen_at`
    ).run(userId, sid, tab, now, now);
  } catch {
    /* 写失败不影响登录本身：下一次请求时中间件会按「无记录」补建 */
  }
}

/** 释放某个用户的会话记录（登出时调用，让下次登录不必先踢自己） */
export function dropSession(userId: number): void {
  try {
    getDb().prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
  } catch {
    /* 忽略 */
  }
}

/**
 * 单标签页会话校验（供 authMiddleware 调用，导出是为了能单独测）。
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
/**
 * 【2026-10-14 按需求】强制重新登录的时刻线：在此之前签发的 token 一律失效。
 *
 * ⚠️ 存 settings 表（key = force_relogin_at）而不是写死在代码里，两个原因：
 *   · 写死的时间戳要人手判断「比部署早还是晚」，实测很容易算错 —— 一旦设成
 *     未来时刻，部署后一段时间里连新登录的 token 都会被误判成旧会话；
 *   · 以后再想「清一次场」，改一行数据即可，不用重新发版。
 * 带 60 秒内存缓存：没必要每个请求都查，而 60 秒的滞后无感。
 * 值为 0 或读不到 = 不启用这项检查。
 */
let _forceReloginAt = -1;
let _forceReloginReadAt = 0;
function forceReloginAt(db: any): number {
  const now = Math.floor(Date.now() / 1000);
  if (_forceReloginAt < 0 || now - _forceReloginReadAt > 60) {
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'force_relogin_at'").get() as any;
      _forceReloginAt = Number(row && row.value) || 0;
    } catch {
      _forceReloginAt = 0;
    }
    _forceReloginReadAt = now;
  }
  return _forceReloginAt;
}

export function checkSingleSession(
  db: any,
  userId: number,
  decoded: any,
  rawTab: unknown
): { ok: boolean; message?: string } {
  /* 强制重登优先于一切，含管理员豁免 —— 这是一次性的「清场」，
     与「管理员可以多设备并存」不是一回事：管理员也重登一次，
     重登之后新 token 才轮到下面的豁免逻辑。 */
  const iat = typeof decoded?.iat === 'number' ? decoded.iat : 0;
  const forceAt = forceReloginAt(db);
  if (forceAt > 0 && iat < forceAt) {
    return { ok: false, message: '系统已升级，请重新登录' };
  }

  /* 管理员豁免：后台/多设备调试需要同时在多处登录 */
  const u = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any;
  if (u && u.role === 'admin') return { ok: true };

  /* 老 token 没有 sid → 'legacy'：只要没有新 token 登录过，就不打扰 */
  const sid = typeof decoded?.sid === 'string' && decoded.sid ? decoded.sid : 'legacy';
  const t = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const tab = typeof t === 'string' ? t.slice(0, 64) : '';
  const now = Math.floor(Date.now() / 1000);

  const row = db
    .prepare('SELECT sid, tab_id, kicked_tabs, seen_at FROM user_sessions WHERE user_id = ?')
    .get(userId) as any;

  if (!row) {
    db.prepare(
      `INSERT OR REPLACE INTO user_sessions (user_id, sid, tab_id, kicked_tabs, created_at, seen_at)
       VALUES (?, ?, ?, '[]', ?, ?)`
    ).run(userId, sid, tab, now, now);
    return { ok: true };
  }

  if (row.sid !== sid) {
    return { ok: false, message: '这个账号已在别处登录，本页已退出' };
  }

  /* 不带标签页标识（老客户端/第三方工具/未升级的页面）：只认 sid，不做页面级判定 */
  if (!tab) return { ok: true };

  let kicked: string[] = [];
  try {
    const parsed = JSON.parse(row.kicked_tabs);
    if (Array.isArray(parsed)) kicked = parsed.filter((x: unknown) => typeof x === 'string');
  } catch { /* 坏数据按空名单处理 */ }

  if (kicked.indexOf(tab) >= 0) {
    return { ok: false, message: '这个页面已被新打开的页面接管，请重新登录' };
  }

  if (row.tab_id !== tab) {
    /* 新页面接管：把旧 tab 记入名单（保留最近 8 个），
       否则旧页面下一次请求又会把它抢回去 —— 两个页面来回拉锯。 */
    const next = [row.tab_id, ...kicked.filter((x) => x && x !== row.tab_id)].slice(0, 8);
    db.prepare('UPDATE user_sessions SET tab_id = ?, kicked_tabs = ?, seen_at = ? WHERE user_id = ?')
      .run(tab, JSON.stringify(next), now, userId);
    return { ok: true };
  }

  /* 同一页面：节流更新心跳时间（60 秒写一次库足够了） */
  if (now - (Number(row.seen_at) || 0) > 60) {
    db.prepare('UPDATE user_sessions SET seen_at = ? WHERE user_id = ?').run(now, userId);
  }
  return { ok: true };
}
