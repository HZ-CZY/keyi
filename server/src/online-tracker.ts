// ── Shared in-memory online user tracking ──
// Used by both admin dashboard and regular user heartbeat

import { getDb } from './db/database';

interface OnlineEntry {
  lastHeartbeat: number;
  ip: string;
  userAgent: string;
  deviceInfo: string;
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

/** Extract a short device info string from a User-Agent header */
export function extractDeviceInfo(userAgent: string): string {
  if (!userAgent) return '';

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

  // OS detection
  let os = 'Unknown';
  if (userAgent.includes('Windows NT')) os = 'Windows';
  else if (userAgent.includes('Mac OS X')) os = 'macOS';
  else if (userAgent.includes('Linux')) os = 'Linux';
  else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) os = 'iOS';
  else if (userAgent.includes('Android')) os = 'Android';

  if (browserVersion) {
    return `${browser} ${browserVersion} on ${os}`;
  }
  return `${browser} on ${os}`;
}

export function recordHeartbeat(userId: number, ip?: string, userAgent?: string): void {
  const deviceInfo = userAgent ? extractDeviceInfo(userAgent) : '';
  activeUsersMap.set(userId, {
    lastHeartbeat: Date.now(),
    ip: ip || '',
    userAgent: userAgent || '',
    deviceInfo,
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
export function getOnlineUserDetails(): { userId: number; username: string; ip: string; userAgent: string; deviceInfo: string; lastActive: number }[] {
  const now = Date.now();
  const db = getDb();
  const ids = getOnlineUserIds();
  const details: { userId: number; username: string; ip: string; userAgent: string; deviceInfo: string; lastActive: number }[] = [];
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
        lastActive: entry.lastHeartbeat,
      });
    }
  }
  return details;
}
