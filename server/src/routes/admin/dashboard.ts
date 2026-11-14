import { Router, Response } from 'express';
import { getDb } from '../../db/database';
import { adminMiddleware, AuthRequest } from '../../middleware/auth';
import { getOnlineCount, getOnlineUserIds, recordHeartbeat, parseDeviceHint } from '../../online-tracker';

const router = Router();

// ── Admin Dashboard Stats ────────────────────────────────────────────

// Heartbeat — admin calls this to stay marked online
router.post('/heartbeat', (req: AuthRequest, res: Response) => {
  recordHeartbeat(
    req.userId!,
    req.ip || '',
    (req.headers['user-agent'] as string) || '',
    parseDeviceHint(req.body?.device)
  );
  res.json({ success: true });
});

interface DayCount {
  date: string;
  count: number;
}

router.get('/dashboard', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();

    // User stats
    const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users WHERE role = ?').get('user') as any).c;
    const totalAdmins = (db.prepare('SELECT COUNT(*) as c FROM users WHERE role = ?').get('admin') as any).c;

    // Content stats
    const totalDecks = (db.prepare('SELECT COUNT(*) as c FROM decks').get() as any).c;
    const totalCards = (db.prepare('SELECT COUNT(*) as c FROM cards').get() as any).c;
    const totalNotes = (db.prepare('SELECT COUNT(*) as c FROM notes').get() as any).c;

    // Card status breakdown
    const newCards = (db.prepare("SELECT COUNT(*) as c FROM cards WHERE queue = 0").get() as any).c;
    const learningCards = (db.prepare("SELECT COUNT(*) as c FROM cards WHERE queue = 1").get() as any).c;
    const reviewCards = (db.prepare("SELECT COUNT(*) as c FROM cards WHERE queue = 2").get() as any).c;
    const relearnCards = (db.prepare("SELECT COUNT(*) as c FROM cards WHERE queue = 3").get() as any).c;

    // Daily registrations (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const registrations = db.prepare(`
      SELECT date(created_at, 'unixepoch') as date, COUNT(*) as count
      FROM users
      WHERE created_at >= unixepoch('now', '-6 days')
      GROUP BY date(created_at, 'unixepoch')
      ORDER BY date ASC
    `).all() as DayCount[];

    // Fill in missing days
    const dailyRegistrations: DayCount[] = [];
    const regMap = new Map(registrations.map(r => [r.date, r.count]));
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      dailyRegistrations.push({ date: dateStr, count: regMap.get(dateStr) || 0 });
    }

    // Active users in last 7 days (users who reviewed cards)
    const activeUsers = (db.prepare(`
      SELECT COUNT(DISTINCT user_id) as c
      FROM revlog
      WHERE reviewed_at >= unixepoch('now', '-6 days')
    `).get() as any).c;

    // Recent registrations (last 10 users)
    const recentUsers = db.prepare(`
      SELECT id, username, created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 10
    `).all() as any[];

    // Total reviews today
    const reviewsToday = (db.prepare(`
      SELECT COUNT(*) as c FROM revlog
      WHERE date(reviewed_at, 'unixepoch') = date('now')
    `).get() as any).c;

    // Online user list with usernames
    const onlineUserIds = getOnlineUserIds();
    let onlineUserList: { id: number; username: string }[] = [];
    if (onlineUserIds.length > 0) {
      const placeholders = onlineUserIds.map(() => '?').join(',');
      onlineUserList = db.prepare(`
        SELECT id, username FROM users WHERE id IN (${placeholders})
      `).all(...onlineUserIds) as any[];
    }

    res.json({
      totalUsers,
      totalAdmins,
      totalDecks,
      totalCards,
      totalNotes,
      onlineUsers: getOnlineCount(),
      onlineUserList,
      cardBreakdown: {
        new: newCards,
        learning: learningCards,
        review: reviewCards,
        relearn: relearnCards,
      },
      dailyRegistrations,
      activeUsers,
      recentUsers,
      reviewsToday,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helper: relative time string ───────────────────────────────────────
export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() / 1000) - timestamp);
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return Math.floor(seconds / 60) + '分钟前';
  if (seconds < 86400) return Math.floor(seconds / 3600) + '小时前';
  return Math.floor(seconds / 86400) + '天前';
}

export default router;
