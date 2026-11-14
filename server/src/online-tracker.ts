// ── Shared in-memory online user tracking ──
// Used by both admin dashboard and regular user heartbeat

import { getDb } from './db/database';

interface OnlineEntry {
  lastHeartbeat: number;
  ip: string;
  userAgent: string;
  deviceInfo: string;
  deviceId: string;
}

const activeUsersMap = new Map<number, OnlineEntry>(); // userId -> OnlineEntry
const ONLINE_TIMEOUT = 15 * 60 * 1000; // 15 minutes

// Cleanup stale entries every minute
setInterval(() => {
  const now = Date.now();
  Array.from(activeUsersMap.entries()).forEach(([userId, entry]) => {
    if (now - entry.lastHeartbeat > ONLINE_TIMEOUT) {
      activeUsersMap.delete(userId);
    }
  });
}, 60 * 1000);

/** 客户端上报的设备指纹（见 client/src/lib/deviceInfo.ts）— UA 无法区分 iPad / Mac，必须由前端补 */
export interface DeviceHint {
  kind?: string;
  os?: string;
  osVersion?: string;
  browser?: string;
  browserVersion?: string;
  model?: string;
  standalone?: boolean;
}

function clean(value: unknown, max = 40): string {
  return typeof value === 'string' ? value.replace(/[\r\n\t]/g, ' ').trim().slice(0, max) : '';
}

/** 校验客户端上报的设备信息，全空则视为未提供 */
export function parseDeviceHint(raw: unknown): DeviceHint | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const hint: DeviceHint = {
    kind: clean(o.kind, 24),
    os: clean(o.os, 24),
    osVersion: clean(o.osVersion, 16),
    browser: clean(o.browser, 24),
    browserVersion: clean(o.browserVersion, 16),
    model: clean(o.model, 40),
    standalone: o.standalone === true,
  };
  if (!hint.kind && !hint.os && !hint.browser) return null;
  return hint;
}

/** 设备指纹 → 展示文案，如「iPad · iPadOS 26.5 · Safari 26」「iPad · iPadOS 26 · 主屏幕App」 */
function composeFromHint(h: DeviceHint): string {
  const parts: string[] = [];
  const kind = h.kind || h.os || '';
  if (kind) {
    parts.push(h.model && !kind.includes(h.model) ? `${kind}（${h.model}）` : kind);
  }
  const osLabel = h.os ? (h.osVersion ? `${h.os} ${h.osVersion}` : h.os) : '';
  // 与类别完全同名时不重复（Windows / Linux）；iPad vs iPadOS、Mac vs macOS 保留
  if (osLabel && osLabel.split(' ')[0].toLowerCase() !== kind.toLowerCase()) parts.push(osLabel);
  if (h.standalone) {
    parts.push('主屏幕App');
  } else {
    const browser = [h.browser, h.browserVersion].filter(Boolean).join(' ');
    if (browser) parts.push(browser);
  }
  return parts.join(' · ');
}

/** Extract a short device info string from a User-Agent header (+ 客户端指纹，优先) */
export function extractDeviceInfo(userAgent: string, hint?: DeviceHint | null): string {
  if (hint) {
    const composed = composeFromHint(hint);
    if (composed) return composed;
  }
  return extractFromUserAgent(userAgent);
}

function extractFromUserAgent(userAgent: string): string {
  if (!userAgent) return '未知设备';

  // Browser detection
  let browser = 'Unknown';
  let browserVersion = '';
  if (userAgent.includes('WeChatMicroMsg')) {
    browser = '微信';
  } else if (userAgent.includes('Edg/') || userAgent.includes('Edge/')) {
    browser = 'Edge';
    const m = userAgent.match(/Edg\/([\d.]+)/);
    if (m) browserVersion = m[1].split('.')[0];
  } else if (userAgent.includes('Chrome') && !userAgent.includes('Chromium')) {
    browser = 'Chrome';
    const m = userAgent.match(/Chrome\/([\d.]+)/);
    if (m) browserVersion = m[1].split('.')[0];
  } else if (userAgent.includes('Firefox/')) {
    browser = 'Firefox';
    const m = userAgent.match(/Firefox\/([\d.]+)/);
    if (m) browserVersion = m[1].split('.')[0];
  } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
    browser = 'Safari';
    const m = userAgent.match(/Version\/([\d.]+)/);
    if (m) browserVersion = m[1].split('.')[0];
  }

  // OS detection — ⚠️ 顺序关键：iPhone/iPad 的 UA 里含 "like Mac OS X"，
  // 若先判 "Mac OS X" 会把 iPad 误判成 macOS（历史 bug，2026-09-15 修）
  let os = 'Unknown';
  if (userAgent.includes('Windows NT')) os = 'Windows';
  else if (userAgent.includes('iPhone') || userAgent.includes('iPod')) os = 'iOS';
  else if (userAgent.includes('iPad')) os = 'iPadOS';
  else if (userAgent.includes('Android')) os = 'Android';
  else if (userAgent.includes('Mac OS X')) os = 'macOS';
  else if (userAgent.includes('Linux')) os = 'Linux';

  const name = browserVersion ? `${browser} ${browserVersion}` : browser;

  // 未上报客户端指纹时，macOS 桌面 UA 与 iPad 的 UA 完全相同（iPadOS 13+ 桌面版 UA），
  // 服务端无法区分 → 如实标注，别谎报成 Mac
  if (os === 'macOS') return `${name} · Mac/iPad（UA 无法区分）`;
  if (os === 'Unknown') return '未知设备';
  return `${name} on ${os}`;
}

export function recordHeartbeat(
  userId: number,
  ip?: string,
  userAgent?: string,
  hint?: DeviceHint | null,
  deviceId?: string
): void {
  const deviceInfo = extractDeviceInfo(userAgent || '', hint);
  activeUsersMap.set(userId, {
    lastHeartbeat: Date.now(),
    ip: ip || '',
    userAgent: userAgent || '',
    deviceInfo,
    deviceId: deviceId || '',
  });
}

export function getOnlineCount(): number {
  const now = Date.now();
  let count = 0;
  Array.from(activeUsersMap.entries()).forEach(([userId, entry]) => {
    if (now - entry.lastHeartbeat <= ONLINE_TIMEOUT) {
      count++;
    } else {
      activeUsersMap.delete(userId);
    }
  });
  return count;
}

/** Returns user IDs that are currently online (not timed out) */
export function getOnlineUserIds(): number[] {
  const now = Date.now();
  const ids: number[] = [];
  Array.from(activeUsersMap.entries()).forEach(([userId, entry]) => {
    if (now - entry.lastHeartbeat <= ONLINE_TIMEOUT) {
      ids.push(userId);
    } else {
      activeUsersMap.delete(userId);
    }
  });
  return ids;
}

/** Returns detailed info for all currently online users */
export function getOnlineUserDetails(): { userId: number; username: string; ip: string; userAgent: string; deviceInfo: string; deviceId: string; lastActive: number }[] {
  const now = Date.now();
  const db = getDb();
  const ids = getOnlineUserIds();
  const details: { userId: number; username: string; ip: string; userAgent: string; deviceInfo: string; deviceId: string; lastActive: number }[] = [];
  for (const userId of ids) {
    const entry = activeUsersMap.get(userId);
    if (!entry) continue;
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as any;
    if (user) {
      details.push({
        userId,
        username: user.username,
        ip: entry.ip,
        userAgent: entry.userAgent,
        deviceInfo: entry.deviceInfo,
        deviceId: entry.deviceId || '',
        lastActive: entry.lastHeartbeat,
      });
    }
  }
  return details;
}
