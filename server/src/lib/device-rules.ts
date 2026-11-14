// 账号登录设备限制 (2026-09-22)
//
// 背景：老师发现个别账号被大量设备共用（石岩峰 9032 一天内在 7 台 iPad 上登录）。
// 需求（用户确认）：
//   1) 把账号限制为「只能在指定类别的设备上登录」，例如「仅 iPhone 或 电脑」；
//   2) 设置后**立刻踢下线**所有已登录的旧会话（哪怕 token 还有 90 天）；
//   3) 账号密码一旦被修改（学生自己在设置里改，或管理员在后台重置），限制**自动解除**。
//
// 判定依据：客户端上报的设备指纹（client/src/lib/deviceInfo.ts —— iPadOS 13+ 的 iPad
//   UA 与 Mac 逐字符相同，服务端只看 UA 无法区分，必须靠前端 navigator.maxTouchPoints），
//   并用 UA 做一致性校验（防止直接把 hint 改成 "iPhone" 绕过）。
//
// ⚠️ 局限：这是「设备**类别**」限制，不是设备指纹绑定。有电脑且会自己改请求头的人
//   仍可伪造 UA + hint 冒充 iPhone。要绝对封死需要改成 device_id 绑定（另一套机制）。

import { Request } from 'express';
import { getDb } from '../db/database';
import { parseDeviceHint } from '../online-tracker';

export interface DeviceRule {
  userId: number;
  /** 原始配置（如 ['iPhone', '电脑']），用于后台回显 */
  allowedTokens: string[];
  /** 展开成具体类别后的集合（如 ['iPhone', 'Mac', 'Windows', 'Linux']） */
  allowedKinds: string[];
  unlockOnPasswordChange: boolean;
  /** 生效时刻（秒）。比它更早签发的 JWT 一律失效 → 旧会话被踢下线 */
  enforcedAt: number;
  note: string;
}

export const COMPUTER_KINDS = ['Mac', 'Windows', 'Linux'];
export const PHONE_KINDS = ['iPhone', 'Android 手机'];
export const TABLET_KINDS = ['iPad', 'Android 平板'];

/** 分组别名 → 具体类别（键统一小写比对） */
const GROUPS: Record<string, string[]> = {
  电脑: COMPUTER_KINDS,
  电脑端: COMPUTER_KINDS,
  桌面: COMPUTER_KINDS,
  pc: COMPUTER_KINDS,
  computer: COMPUTER_KINDS,
  手机: PHONE_KINDS,
  手机端: PHONE_KINDS,
  平板: TABLET_KINDS,
  iphone: ['iPhone'],
  ios: ['iPhone'],
  ipad: ['iPad'],
  ipados: ['iPad'],
  mac: ['Mac'],
  macos: ['Mac'],
  windows: ['Windows'],
  win: ['Windows'],
  linux: ['Linux'],
  android: ['Android 手机', 'Android 平板'],
};

/** 把配置里的 token 展开成具体设备类别（大小写不敏感；未知 token 原样保留） */
export function expandAllowedKinds(tokens: string[]): string[] {
  const out = new Set<string>();
  for (const raw of tokens) {
    const token = String(raw || '').trim();
    if (!token) continue;
    const grouped = GROUPS[token.toLowerCase()];
    if (grouped) {
      grouped.forEach((k) => out.add(k));
    } else {
      out.add(token);
    }
  }
  return Array.from(out);
}

/** 给用户看的中文描述，如 ['iPhone','电脑'] → "iPhone 或 电脑" */
export function describeAllowed(tokens: string[]): string {
  const list = tokens.map((t) => String(t || '').trim()).filter(Boolean);
  if (list.length === 0) return '';
  return list.join(' 或 ');
}

export function isKindAllowed(rule: DeviceRule, kind: string): boolean {
  return rule.allowedKinds.some((k) => k.toLowerCase() === kind.toLowerCase());
}

// ── 设备类别判定 ──────────────────────────────────────────────

/** 仅凭 UA 判断设备类别（Mac UA 无法区分 Mac / iPad → 返回 ''） */
function kindFromUserAgent(ua: string): string {
  if (!ua) return '';
  if (/iPhone|iPod/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android 手机' : 'Android 平板';
  if (/Windows NT/i.test(ua)) return 'Windows';
  if (/Mac OS X/i.test(ua)) return ''; // 歧义：Mac 或 iPad（iPadOS 13+ 桌面 UA）
  if (/Linux/i.test(ua)) return 'Linux';
  return '';
}

/** UA 允许出现哪些 hint 类别（防伪造：hint 必须与 UA 自洽） */
function kindsAllowedByUa(ua: string): string[] {
  if (!ua) return [];
  if (/iPhone|iPod/i.test(ua)) return ['iPhone'];
  if (/iPad/i.test(ua)) return ['iPad'];
  if (/Android/i.test(ua)) return ['Android 手机', 'Android 平板'];
  if (/Windows NT/i.test(ua)) return ['Windows'];
  if (/Mac OS X/i.test(ua)) return ['Mac', 'iPad']; // iPad 桌面 UA ≈ Mac UA
  if (/Linux/i.test(ua)) return ['Linux'];
  return [];
}

/** 兜底：查这台设备上次上报时记录下来的设备信息（devices.device_info 前缀） */
function kindFromStoredDevice(deviceId: string): string {
  if (!deviceId) return '';
  try {
    const db = getDb();
    const row = db
      .prepare('SELECT device_info FROM devices WHERE device_id = ?')
      .get(deviceId) as any;
    const info = String(row?.device_info || '');
    if (info.startsWith('iPhone')) return 'iPhone';
    if (info.startsWith('iPad')) return 'iPad';
    if (info.startsWith('Mac')) return 'Mac';
    if (info.startsWith('Windows')) return 'Windows';
    if (info.startsWith('Android 手机')) return 'Android 手机';
    if (info.startsWith('Android 平板')) return 'Android 平板';
    if (info.startsWith('Linux')) return 'Linux';
  } catch {
    // 查询失败按未知设备处理
  }
  return '';
}

/**
 * 判定本次登录请求来自哪类设备。
 * 优先客户端指纹（能区分 iPad / Mac），并用 UA 校验；无指纹时退回 UA，
 * Mac 这类歧义 UA 再用 devices 表里这台设备的历史记录兜底。
 */
export function resolveDeviceKind(req: Request, deviceId = ''): string {
  const ua = String(req.headers['user-agent'] || '');
  const hint = parseDeviceHint((req.body as any)?.device);
  const hintKind = hint?.kind ? String(hint.kind).trim() : '';

  if (hintKind) {
    const allowedByUa = kindsAllowedByUa(ua);
    const consistent = allowedByUa.some((k) => k.toLowerCase() === hintKind.toLowerCase());
    if (consistent) return hintKind;
    // hint 与 UA 不符（伪造 / 旧包）→ 视为无法识别
    return '未知设备';
  }

  const fromUa = kindFromUserAgent(ua);
  if (fromUa) return fromUa;

  const stored = kindFromStoredDevice(deviceId);
  if (stored) return stored;

  return '未知设备';
}

// ── 规则读写（进程内缓存；任何写操作立即失效缓存）────────────────

interface RuleRow {
  user_id: number;
  allowed_kinds: string;
  unlock_on_password_change: number;
  enforced_at: number;
  note: string;
}

let cache: Map<number, DeviceRule> | null = null;

function toRule(row: RuleRow): DeviceRule {
  const tokens = String(row.allowed_kinds || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    userId: row.user_id,
    allowedTokens: tokens,
    allowedKinds: expandAllowedKinds(tokens),
    unlockOnPasswordChange: row.unlock_on_password_change !== 0,
    enforcedAt: Number(row.enforced_at) || 0,
    note: String(row.note || ''),
  };
}

function loadRules(): Map<number, DeviceRule> {
  if (cache) return cache;
  const map = new Map<number, DeviceRule>();
  try {
    const rows = getDb().prepare('SELECT * FROM login_device_rules').all() as RuleRow[];
    rows.forEach((r) => map.set(r.user_id, toRule(r)));
  } catch {
    // 表不存在等异常时按「无限制」处理，绝不阻断登录
  }
  cache = map;
  return map;
}

export function refreshRuleCache(): void {
  cache = null;
}

/** 取某账号的限制规则；无规则（= 不限制）返回 null */
export function getDeviceRule(userId: number): DeviceRule | null {
  return loadRules().get(userId) || null;
}

export function listDeviceRules(): DeviceRule[] {
  return Array.from(loadRules().values());
}

/**
 * 写入/更新限制规则。enforcedAt 取当前时间 → 所有旧 token 立即失效（踢下线）。
 * 传 resetEnforcedAt=false 可保留原生效时间（纯改配置时不重复踢）。
 */
export function upsertDeviceRule(
  userId: number,
  allowedTokens: string[],
  unlockOnPasswordChange = true,
  note = '',
  resetEnforcedAt = true
): DeviceRule {
  const db = getDb();
  const tokens = allowedTokens.map((t) => String(t || '').trim()).filter(Boolean);
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO login_device_rules (user_id, allowed_kinds, unlock_on_password_change, enforced_at, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       allowed_kinds = excluded.allowed_kinds,
       unlock_on_password_change = excluded.unlock_on_password_change,
       enforced_at = CASE WHEN ? THEN excluded.enforced_at ELSE login_device_rules.enforced_at END,
       note = excluded.note,
       updated_at = excluded.updated_at`
  ).run(
    userId,
    tokens.join(','),
    unlockOnPasswordChange ? 1 : 0,
    now,
    note,
    now,
    resetEnforcedAt ? 1 : 0
  );
  refreshRuleCache();
  return getDeviceRule(userId)!;
}

/** 删除限制规则（解除限制） */
export function deleteDeviceRule(userId: number): boolean {
  const info = getDb().prepare('DELETE FROM login_device_rules WHERE user_id = ?').run(userId);
  refreshRuleCache();
  return info.changes > 0;
}

/**
 * 密码被修改（学生自助改 / 管理员重置）→ 按规则解除限制。
 * 返回是否真的解除了限制。
 */
export function clearRestrictionOnPasswordChange(userId: number): boolean {
  const rule = getDeviceRule(userId);
  if (!rule || !rule.unlockOnPasswordChange) return false;
  deleteDeviceRule(userId);
  console.log(
    `[device-rule] 限制已解除 user=${userId}（密码变更；原限制: ${describeAllowed(rule.allowedTokens) || '—'}）`
  );
  return true;
}

/** 被拦截时的响应体（前端直接展示 error 文案） */
export function deviceBlockPayload(rule: DeviceRule, deviceKind: string) {
  const label = describeAllowed(rule.allowedTokens) || '指定设备';
  const unlockTip = rule.unlockOnPasswordChange
    ? '如需在这台设备上使用，请先修改密码（改密码后限制自动解除）。'
    : '如需在这台设备上使用，请联系老师处理。';
  return {
    code: 'DEVICE_RESTRICTED',
    error: `该账号已限制登录设备：只允许「${label}」登录。本次识别到的设备是「${deviceKind}」。${unlockTip}`,
    allowed: rule.allowedTokens,
    deviceKind,
  };
}
