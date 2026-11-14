import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../../db/database';
import { adminMiddleware, AuthRequest } from '../../middleware/auth';
import { cnDateStr, CN_SQL_MODIFIER } from '../../lib/dates';
import { clearRestrictionOnPasswordChange } from '../../lib/device-rules';

const router = Router();

// Get all users
router.get('/users', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const users = db.prepare(`
      SELECT u.id, u.username, u.role, u.created_at, u.last_login_at,
        COALESCE(u.avatar_url, '') as avatar_url,
        COALESCE(u.pending_avatar_url, '') as pending_avatar_url,
        COALESCE(u.banned_until, 0) as banned_until,
        COALESCE(u.ban_reason, '') as ban_reason,
        COALESCE(u.banned_at, 0) as banned_at,
        COALESCE(u.is_teacher, 0) as is_teacher,
        COALESCE(u.badge_label, '') as badge_label,
        (SELECT COUNT(*) FROM cards c WHERE c.user_id = u.id) as card_count,
        (SELECT COUNT(*) FROM decks d WHERE d.user_id = u.id) as deck_count
      FROM users u
      ORDER BY u.created_at DESC
    `).all();
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create a user (admin)
router.post('/users', (req: AuthRequest, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: '需要用户名和密码' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: '密码至少需要6个字符' });
      return;
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      res.status(409).json({ error: '用户名已存在' });
      return;
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const result = db.prepare(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'user')"
    ).run(username, passwordHash);

    const userId = result.lastInsertRowid as number;

    // 【2026-09-17】不再自动创建「默认」空牌组：卡组统一由后台推送或在书架上自助添加。
    // （历史上自动生成的「默认」牌组已于 2026-09-17 全站清理完毕）

    // Create default notetype
    db.prepare(
      `INSERT INTO notetypes (user_id, name, css, kind, field_names, template_q_format, template_a_format) VALUES (?, 'Basic', ?, 'normal', '["Front","Back"]', '{{Front}}', '{{FrontSide}}<hr>{{Back}}')`
    ).run(userId, '.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }');

    // Create MCQ notetype
    db.prepare(
      `INSERT INTO notetypes (user_id, name, css, kind, field_names, template_q_format, template_a_format) VALUES (?, '选择题', ?, 'normal', '["题目","选项A","选项B","选项C","选项D","答案","解析"]', '<div class=mcq>{{题目}}</div><div class=options><p><span class=opt>A.</span> {{选项A}}</p><p><span class=opt>B.</span> {{选项B}}</p><p><span class=opt>C.</span> {{选项C}}</p><p><span class=opt>D.</span> {{选项D}}</p></div>', '<div class=mcq>{{题目}}</div><div class=options><p><span class=opt>A.</span> {{选项A}}</p><p><span class=opt>B.</span> {{选项B}}</p><p><span class=opt>C.</span> {{选项C}}</p><p><span class=opt>D.</span> {{选项D}}</p></div><hr><div class=answer>正确答案：{{答案}}</div><div class=explanation>{{解析}}</div>')`
    ).run(userId, '.card{font-family:arial;font-size:18px;line-height:1.6}.mcq{font-size:20px;font-weight:bold;margin-bottom:16px}.options p{margin:8px 0;padding:10px 14px;border:1px solid #e5e7eb;border-radius:10px}.opt{display:inline-block;width:24px;font-weight:bold;color:#6366f1}.answer{font-size:18px;color:#16a34a;font-weight:bold;margin-top:12px}.explanation{margin-top:8px;color:#6b7280;font-size:15px}');

    res.status(201).json({ id: userId, username, role: 'user' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a user
router.delete('/users/:id', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const targetId = parseInt(req.params.id);

    // Can't delete yourself
    if (targetId === req.userId) {
      res.status(400).json({ error: '不能删除自己的账号' });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
    if (!existing) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Reset user password
router.put('/users/:id/password', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { password } = req.body;
    if (!password || password.length < 6) {
      res.status(400).json({ error: '密码至少需要6个字符' });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!existing) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, req.params.id);
    // 【2026-09-22】管理员重置密码 → 该账号的登录设备限制自动解除
    const restrictionCleared = clearRestrictionOnPasswordChange(Number(req.params.id));
    res.json({ success: true, deviceRestrictionCleared: restrictionCleared });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 账号徽标 (2026-09-22) ───────────────────────────────────────────────
// badge_label 非空 → 该账号头像在所有出现头像的地方显示金色头像框 + 该文字
// （「老师」「管理员」……想加别的也行）。纯展示标记，不授予任何后台权限（后台看 role='admin'）。
router.put('/users/:id/badge', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = Number(req.params.id);
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }
    // 传空字符串 = 取消徽标
    const label = String(req.body?.label ?? req.body?.badge_label ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 12);
    db.prepare('UPDATE users SET badge_label = ? WHERE id = ?').run(label, userId);
    res.json({
      success: true,
      badge_label: label,
      message: label
        ? `已给「${user.username}」打上「${label}」金标（头像显示金环 + 标签）`
        : `已取消「${user.username}」的头像金标`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 旧的「老师」专用接口保留为别名（等价于 label=老师 / 空）
router.put('/users/:id/teacher', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = Number(req.params.id);
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }
    const on = !(req.body?.is_teacher === false || req.body?.is_teacher === 0);
    const label = on ? '老师' : '';
    db.prepare('UPDATE users SET badge_label = ? WHERE id = ?').run(label, userId);
    res.json({
      success: true,
      badge_label: label,
      message: on
        ? `已把「${user.username}」标记为老师（头像显示金环 + 「老师」标签）`
        : `已取消「${user.username}」的老师标记`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin update username for a user
router.put('/users/:id/username', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { username } = req.body;
    if (!username || username.trim().length < 1) {
      res.status(400).json({ error: '用户名不能为空' });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!existing) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    // Check if username already taken by another user
    const conflict = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username.trim(), parseInt(req.params.id));
    if (conflict) {
      res.status(409).json({ error: '用户名已被使用' });
      return;
    }

    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username.trim(), req.params.id);
    res.json({ success: true, username: username.trim() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get user decks with card stats
router.get('/users/:id/decks', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const targetId = parseInt(req.params.id);

    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetId) as any;
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    const decks = db.prepare(`
      SELECT d.*,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.user_id = d.user_id) as card_count,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.user_id = d.user_id AND c.reps > 0) as reviewed_count,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.user_id = d.user_id
          AND ((c.queue IN (1,3) AND c.due <= unixepoch()) OR (c.queue = 2 AND c.due <= unixepoch()))) as due_count
      FROM decks d
      WHERE d.user_id = ?
      ORDER BY d.name
    `).all(targetId);

    res.json({ username: user.username, decks });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get user learning stats
router.get('/users/:id/stats', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const targetId = parseInt(req.params.id);

    const user = db.prepare('SELECT id, username, created_at, last_login_at FROM users WHERE id = ?').get(targetId) as any;
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    const totalCards = db.prepare('SELECT COUNT(*) as c FROM cards WHERE user_id = ?').get(targetId) as any;
    const dueToday = db.prepare(`
      SELECT COUNT(*) as c FROM cards WHERE user_id = ?
      AND ((queue IN (1,3) AND due <= unixepoch()) OR (queue = 2 AND due <= unixepoch()))
    `).get(targetId) as any;
    const newCards = db.prepare('SELECT COUNT(*) as c FROM cards WHERE user_id = ? AND queue = 0').get(targetId) as any;
    const reviewedCards = db.prepare('SELECT COUNT(*) as c FROM cards WHERE user_id = ? AND reps > 0').get(targetId) as any;
    const todayReviews = db.prepare(`
      SELECT COUNT(*) as c FROM revlog WHERE user_id = ? AND date(reviewed_at, 'unixepoch', '${CN_SQL_MODIFIER}') = date('now', '${CN_SQL_MODIFIER}')
    `).get(targetId) as any;

    // Deck count
    const deckCount = db.prepare('SELECT COUNT(*) as c FROM decks WHERE user_id = ?').get(targetId) as any;

    // Calculate streak
    const rows = db.prepare(`
      SELECT DISTINCT date(reviewed_at, 'unixepoch', '${CN_SQL_MODIFIER}') as review_date
      FROM revlog WHERE user_id = ? ORDER BY review_date DESC LIMIT 365
    `).all(targetId) as any[];

    let streak = 0;
    if (rows.length > 0) {
      const today = cnDateStr();
      let checkDate = new Date(today + 'T00:00:00+08:00');
      const dates = new Set(rows.map(r => r.review_date));
      if (!dates.has(today)) {
        checkDate.setDate(checkDate.getDate() - 1);
      }
      for (let i = 0; i < 365; i++) {
        const dateStr = cnDateStr(checkDate);
        if (dates.has(dateStr)) { streak++; checkDate.setDate(checkDate.getDate() - 1); }
        else break;
      }
    }

    // Practice history
    const practiceStats = db.prepare(`
      SELECT COUNT(*) as sessions, COALESCE(SUM(total_questions),0) as total, COALESCE(SUM(correct_count),0) as correct
      FROM practice_log WHERE user_id = ?
    `).get(targetId) as any;

    res.json({
      username: user.username,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      totalCards: totalCards.c,
      dueToday: dueToday.c,
      newCards: newCards.c,
      reviewedCards: reviewedCards.c,
      todayReviews: todayReviews.c,
      deckCount: deckCount.c,
      streak,
      practiceAccuracy: practiceStats.total > 0 ? Math.round((practiceStats.correct / practiceStats.total) * 100) : 0,
      practiceSessions: practiceStats.sessions,
      practiceTotal: practiceStats.total,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get registration setting
router.get('/settings/registration', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('registration_enabled') as any;
    res.json({ enabled: setting ? setting.value === '1' : true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle registration
router.put('/settings/registration', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled 必须是布尔值' });
      return;
    }
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('registration_enabled', enabled ? '1' : '0');
    res.json({ success: true, enabled });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Clear User Data ──────────────────────────────────────────────────

// Clear all decks, cards, notes for a specific user
router.delete('/users/:id/clear', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const targetId = parseInt(req.params.id);
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetId) as any;
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }
    if (targetId === req.userId) {
      res.status(400).json({ error: '不能清除自己的数据' });
      return;
    }

    db.transaction(() => {
      db.prepare('DELETE FROM revlog WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM cards WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM notes WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM deck_config WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM decks WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM notetypes WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM practice_log WHERE user_id = ?').run(targetId);
    })();

    res.json({ success: true, message: `已清除用户「${user.username}」的所有数据` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Clear all non-admin users' data
router.post('/clear-all', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const nonAdminUsers = db.prepare('SELECT id, username FROM users WHERE role = ?').all('user') as any[];

    if (nonAdminUsers.length === 0) {
      res.json({ success: true, message: '没有普通用户需要清除' });
      return;
    }

    const userIds = nonAdminUsers.map(u => u.id);
    const placeholders = userIds.map(() => '?').join(',');

    db.transaction(() => {
      db.prepare(`DELETE FROM revlog WHERE user_id IN (${placeholders})`).run(...userIds);
      db.prepare(`DELETE FROM cards WHERE user_id IN (${placeholders})`).run(...userIds);
      db.prepare(`DELETE FROM notes WHERE user_id IN (${placeholders})`).run(...userIds);
      db.prepare(`DELETE FROM deck_config WHERE user_id IN (${placeholders})`).run(...userIds);
      db.prepare(`DELETE FROM decks WHERE user_id IN (${placeholders})`).run(...userIds);
      db.prepare(`DELETE FROM notetypes WHERE user_id IN (${placeholders})`).run(...userIds);
      db.prepare(`DELETE FROM practice_log WHERE user_id IN (${placeholders})`).run(...userIds);
    })();

    res.json({ success: true, message: `已清除全部 ${nonAdminUsers.length} 个用户的数据` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
