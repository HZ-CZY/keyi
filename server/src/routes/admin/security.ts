import { Router, Response } from 'express';
import { getDb } from '../../db/database';
import { adminMiddleware, AuthRequest } from '../../middleware/auth';
import { getOnlineUserDetails } from '../../online-tracker';
import { shortDeviceId } from '../../lib/devices';
import { timeAgo } from './dashboard';

const router = Router();

// ── Security routes ────────────────────────────────────────────────────

// GET /admin/security/login-logs
router.get('/security/login-logs', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = req.query.user_id ? parseInt(req.query.user_id as string) : null;
    const page = req.query.page ? parseInt(req.query.page as string) : 1;
    const limit = Math.min(req.query.limit ? parseInt(req.query.limit as string) : 100, 100);
    const offset = (page - 1) * limit;

    if (userId && isNaN(userId)) {
      res.status(400).json({ error: '无效的用户ID' });
      return;
    }
    if (page < 1) {
      res.status(400).json({ error: '页码必须 >= 1' });
      return;
    }

    let logs: any[];
    let totalCount: number;

    if (userId) {
      logs = db.prepare(`
        SELECT ll.user_id, u.username, ll.ip, ll.user_agent, ll.device_info, ll.device_id,
               (SELECT COUNT(*) FROM device_users du WHERE du.device_id = ll.device_id) AS device_user_count,
               ll.login_method, ll.success, ll.created_at
        FROM login_logs ll
        LEFT JOIN users u ON u.id = ll.user_id
        WHERE ll.user_id = ?
        ORDER BY ll.created_at DESC
        LIMIT ? OFFSET ?
      `).all(userId, limit, offset);

      const countRow = db.prepare(
        'SELECT COUNT(*) as total FROM login_logs WHERE user_id = ?'
      ).get(userId) as any;
      totalCount = countRow.total;
    } else {
      logs = db.prepare(`
        SELECT ll.user_id, u.username, ll.ip, ll.user_agent, ll.device_info, ll.device_id,
               (SELECT COUNT(*) FROM device_users du WHERE du.device_id = ll.device_id) AS device_user_count,
               ll.login_method, ll.success, ll.created_at
        FROM login_logs ll
        LEFT JOIN users u ON u.id = ll.user_id
        ORDER BY ll.created_at DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset);

      const countRow = db.prepare('SELECT COUNT(*) as total FROM login_logs').get() as any;
      totalCount = countRow.total;
    }

    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/security/online-users
router.get('/security/online-users', (req: AuthRequest, res: Response) => {
  try {
    const details = getOnlineUserDetails();
    const result = details.map((d) => ({
      userId: d.userId,
      username: d.username,
      ip: d.ip,
      userAgent: d.userAgent,
      deviceInfo: d.deviceInfo,
      deviceId: d.deviceId,
      deviceShort: shortDeviceId(d.deviceId),
      lastActive: timeAgo(d.lastActive / 1000),
    }));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/security/devices — 设备档案（同一台设备被哪些账号用过）
router.get('/security/devices', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(req.query.limit ? parseInt(req.query.limit as string) : 200, 500);
    const rows = db.prepare(`
      SELECT d.device_id, d.device_info, d.first_seen, d.last_seen, d.login_count, d.last_ip,
             (SELECT COUNT(*) FROM device_users du WHERE du.device_id = d.device_id) AS user_count
      FROM devices d
      ORDER BY d.last_seen DESC
      LIMIT ?
    `).all(limit) as any[];

    const usersStmt = db.prepare(`
      SELECT du.user_id, du.username, du.first_seen, du.last_seen, du.login_count
      FROM device_users du
      WHERE du.device_id = ?
      ORDER BY du.last_seen DESC
      LIMIT 20
    `);

    const result = rows.map((d) => ({
      deviceId: d.device_id,
      deviceShort: shortDeviceId(d.device_id),
      deviceInfo: d.device_info,
      firstSeen: d.first_seen,
      lastSeen: d.last_seen,
      loginCount: d.login_count,
      lastIp: d.last_ip,
      userCount: d.user_count,
      users: (usersStmt.all(d.device_id) as any[]).map((u) => ({
        userId: u.user_id,
        username: u.username,
        firstSeen: u.first_seen,
        lastSeen: u.last_seen,
        loginCount: u.login_count,
      })),
    }));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/security/user-login-history/:userId
router.get('/security/user-login-history/:userId', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) {
      res.status(400).json({ error: '无效的用户ID' });
      return;
    }

    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    const logs = db.prepare(`
      SELECT ll.user_id, u.username, ll.ip, ll.user_agent, ll.device_info,
             ll.login_method, ll.success, ll.created_at
      FROM login_logs ll
      LEFT JOIN users u ON u.id = ll.user_id
      WHERE ll.user_id = ?
      ORDER BY ll.created_at DESC
      LIMIT 15
    `).all(userId) as any[];

    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
