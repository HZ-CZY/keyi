import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database';
import { generateToken, authMiddleware, AuthRequest, newSid, tabIdOf, upsertSession } from '../middleware/auth';
import { recordHeartbeat, extractDeviceInfo, parseDeviceHint } from '../online-tracker';
import { isBanned, banPayload, deleteAvatarFile } from '../lib/moderation';
import { resolveDeviceId, touchDevice } from '../lib/devices';
import {
  getDeviceRule,
  resolveDeviceKind,
  isKindAllowed,
  deviceBlockPayload,
  clearRestrictionOnPasswordChange,
} from '../lib/device-rules';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

/**
 * 【2026-09-12 安全修复】登录/注册限流。
 *
 * 本站此前完全没有限流，而 login 用的是 bcrypt.compareSync（同步阻塞事件循环，
 * 实测单次约 96ms）。攻击者并发打 /api/auth/login 即可让单进程 Node 饱和，
 * 造成整站卡死；同时也让在线密码爆破变得可行。
 *
 * 阈值取舍：133 名学生中若有人共用校园网出口 IP，同一 IP 会共享配额，
 * 因此登录放宽到 30 次 / 5 分钟（够用且足以挡住爆破与洪水），
 * 注册收紧到 10 次 / 小时。
 */
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: '登录尝试过于频繁，请稍后再试',
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: '注册过于频繁，请稍后再试',
});

/**
 * 【2026-10-01 安全修复】账号维度登录限流。
 *
 * 为什么需要：上面的 loginLimiter 以 req.ip 为计数维度，注释里说明了取舍
 * （133 名学生共用校园网出口，收紧会误伤）。代价是：同一个出口 IP 共享
 * 30 次 / 5 分钟的配额，单看某个学生账号仍可被试 30 次密码；换手机热点
 * 就是全新的 30 次。配合"用户名可枚举 + 弱口令"，定向爆破是可行的。
 *
 * 维度设计：**IP + 用户名**，而不是只用用户名。原因：
 *   · 只用用户名 → 攻击者拿受害者用户名疯狂失败，就能把受害者本人锁在门外
 *     （账号锁定型 DoS，反而更糟）；
 *   · IP + 用户名 → 攻击者只能锁住"自己这个 IP + 该用户名"的组合，
 *     受害者从自己 IP 登录完全不受影响。攻击者换 IP 可以绕过，
 *     但那已经回到 loginLimiter 的战场（每 IP 30 次），成本没有降低。
 */
const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: '该账号在当前网络下尝试次数过多，请 15 分钟后再试',
  keyOf: (req) => {
    const u = String((req.body as any)?.username || '').trim().toLowerCase().slice(0, 64);
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return `login:${ip}:${u}`;
  },
});

// Session persistence: also write the JWT into a 90-day cookie so the browser
// keeps the user logged in across restarts even if localStorage gets cleared.
const COOKIE_MAX_AGE = 90 * 24 * 60 * 60 * 1000; // matches generateToken '90d'

function setTokenCookie(res: Response, token: string): void {
  res.cookie('keyi_token', token, {
    /* 【2026-10-01 安全修复】由 false 改为 true。
       原先为了让 AuthContext 用 JS 从 document.cookie 恢复登录态，
       cookie 必须是可读的 —— 代价是任何 XSS 都能拿走 90 天有效期的凭证。
       现在服务端 authMiddleware 已支持从 cookie 取 token，前端改为调
       GET /api/auth/me 由服务端判定，因此这里可以安全地设为 httpOnly。 */
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

// Multer config: memory storage, 5MB limit, accept only images
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传图片文件'));
    }
  },
});

// Public: check if registration is enabled
router.get('/registration-status', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('registration_enabled') as any;
    res.json({ enabled: setting ? setting.value === '1' : true });
  } catch {
    res.json({ enabled: true });
  }
});

// Register
router.post('/register', registerLimiter, async (req: Request, res: Response) => {
  try {
    const db = getDb();

    // Check if registration is enabled
    const regSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('registration_enabled') as any;
    if (regSetting && regSetting.value === '0') {
      res.status(403).json({ error: '注册功能已关闭，请联系管理员' });
      return;
    }

    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: '需要用户名和密码' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: '密码至少需要6个字符' });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      res.status(409).json({ error: '用户名已存在' });
      return;
    }

    // 【2026-09-12】异步哈希，避免同步阻塞事件循环
    const passwordHash = await bcrypt.hash(password, 10);
    const result = db.prepare(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)'
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

    const sid = newSid();
    const token = generateToken(userId, sid);
    upsertSession(userId, sid, tabIdOf(req));
    setTokenCookie(res, token);
    const newUser = db.prepare("SELECT id, username, role, avatar_url, COALESCE(is_teacher,0) AS is_teacher, COALESCE(badge_label,'') AS badge_label FROM users WHERE id = ?").get(userId) as any;
    res.status(201).json({ token, userId, username, role: newUser.role, avatar_url: newUser.avatar_url || '', is_teacher: newUser.is_teacher ? 1 : 0, badge_label: newUser.badge_label || '' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Login
router.post('/login', loginLimiter, loginAccountLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body || {};
    // 【2026-09-22】必须是字符串：非字符串（数字/对象）会直接打到 SQLite 绑定层，
    // 抛出 500 + 原始英文报错而不是正常的 400/401。
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      res.status(400).json({ error: '需要用户名和密码' });
      return;
    }

    const db = getDb();
    const user = db.prepare(
      'SELECT id, username, password_hash, role, avatar_url, ' +
        "COALESCE(banned_until, 0) AS banned_until, COALESCE(ban_reason, '') AS ban_reason, " +
        'COALESCE(is_teacher, 0) AS is_teacher, COALESCE(badge_label, \'\') AS badge_label ' +
        'FROM users WHERE username = ?'
    ).get(username) as any;

    const clientIp = req.ip || '';
    const userAgent = req.headers['user-agent'] || '';
    // 客户端上报的设备指纹优先（UA 分不出 iPad / Mac，见 client/src/lib/deviceInfo.ts）
    const deviceInfo = extractDeviceInfo(userAgent, parseDeviceHint(req.body?.device));
    const deviceId = resolveDeviceId(req, res);

    // 【2026-09-12】改用异步 compare：compareSync 同步阻塞事件循环约 96ms，
    // 可被并发洪水利用来卡死整站（详见本文件顶部 loginLimiter 的说明）。
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      if (user) {
        // Record failed login attempt
        db.prepare(
          'INSERT INTO login_logs (user_id, ip, user_agent, device_info, device_id, login_method, success) VALUES (?, ?, ?, ?, ?, ?, 0)'
        ).run(user.id, clientIp, userAgent, deviceInfo, deviceId, 'password');

        // Clean up old logs for this user (keep last 15)
        db.prepare(
          'DELETE FROM login_logs WHERE user_id = ? AND id NOT IN (SELECT id FROM login_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 15)'
        ).run(user.id, user.id);
      } else {
        // 【2026-09-22】用户名不存在时不能写 login_logs：该表 user_id 有 FOREIGN KEY → users(id)，
        // 原来的 `user?.id ?? 0` 会抛 "FOREIGN KEY constraint failed"，
        // 登录接口变成 500 + 原始英文报错（前端原样显示 → 学生以为账号被限制/登不上）。
        // 这里改为只写服务端日志，保留「有人拿未知用户名试着登录」的可见性。
        console.warn(
          `[login] 用户名不存在: "${String(username).slice(0, 40)}" ip=${clientIp} device=${deviceInfo || '-'}`
        );
      }

      res.status(401).json({ error: '用户名或密码错误' });
      return;
    }

    // 封禁用户禁止登录（HTTP 403 + ACCOUNT_BANNED，前端原样展示解封时间/原因）
    if (isBanned(user)) {
      res.status(403).json(banPayload(user));
      return;
    }

    // 登录设备限制 (2026-09-22)：老师可按账号限制「只能在某类设备登录」，
    // 例如 石岩峰 仅允许 iPhone / 电脑。被拦时也写一条失败日志便于追溯。
    const deviceRule = getDeviceRule(user.id);
    if (deviceRule) {
      const deviceKind = resolveDeviceKind(req, deviceId);
      if (!isKindAllowed(deviceRule, deviceKind)) {
        db.prepare(
          'INSERT INTO login_logs (user_id, ip, user_agent, device_info, device_id, login_method, success) VALUES (?, ?, ?, ?, ?, ?, 0)'
        ).run(user.id, clientIp, userAgent, deviceInfo, deviceId, 'device_block');
        res.status(403).json(deviceBlockPayload(deviceRule, deviceKind));
        return;
      }
    }

    db.prepare('UPDATE users SET last_login_at = unixepoch() WHERE id = ?').run(user.id);

    // Record successful login
    db.prepare(
      'INSERT INTO login_logs (user_id, ip, user_agent, device_info, device_id, login_method, success) VALUES (?, ?, ?, ?, ?, ?, 1)'
    ).run(user.id, clientIp, userAgent, deviceInfo, deviceId, 'password');

    // 设备追踪：设备档案 + 「设备 ↔ 账号」关联
    touchDevice(deviceId, {
      userId: user.id,
      username: user.username,
      ip: clientIp,
      userAgent,
      deviceInfo,
      isLogin: true,
    });

    // Clean up old logs for this user (keep last 15)
    db.prepare(
      'DELETE FROM login_logs WHERE user_id = ? AND id NOT IN (SELECT id FROM login_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 15)'
    ).run(user.id, user.id);

    const sid = newSid();
    const token = generateToken(user.id, sid);
    /* 【2026-10-14】登录即接管会话：新登录会顶掉旧页面（见 authMiddleware） */
    upsertSession(user.id, sid, tabIdOf(req));
    setTokenCookie(res, token);
    res.json({
      token,
      userId: user.id,
      username: user.username,
      role: user.role,
      avatar_url: user.avatar_url || '',
      is_teacher: user.is_teacher ? 1 : 0,
      badge_label: user.badge_label || '',
      deviceId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get current user
router.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare(
      'SELECT id, username, role, avatar_url, ' +
        "COALESCE(pending_avatar_url, '') AS pending_avatar_url, " +
        'COALESCE(banned_until, 0) AS banned_until, ' +
        'COALESCE(is_teacher, 0) AS is_teacher, COALESCE(badge_label, \'\') AS badge_label ' +
        'FROM users WHERE id = ?'
    ).get(req.userId) as any;
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    // 最新一条头像审核记录 → 用户端状态徽标（审核中 / 已通过 / 已驳回）
    const review = db
      .prepare('SELECT status, reason FROM avatar_reviews WHERE user_id = ? ORDER BY id DESC LIMIT 1')
      .get(req.userId) as any;
    let avatarReviewStatus = 'none';
    let avatarReviewReason = '';
    if (review) {
      avatarReviewStatus = review.status;
      avatarReviewReason = review.reason || '';
    } else if (user.pending_avatar_url) {
      avatarReviewStatus = 'pending';
    } else if (user.avatar_url) {
      avatarReviewStatus = 'approved';
    }

    res.json({
      ...user,
      avatar_review_status: avatarReviewStatus,
      avatar_review_reason: avatarReviewReason,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Change own password
router.put('/password', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      res.status(400).json({ error: '需要旧密码和新密码' });
      return;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: '新密码至少需要6个字符' });
      return;
    }

    const db = getDb();
    const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.userId) as any;
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    // 【2026-09-12】改异步，避免同步阻塞事件循环（同 login 的修复理由）
    if (!(await bcrypt.compare(oldPassword, user.password_hash))) {
      res.status(403).json({ error: '旧密码不正确' });
      return;
    }

    // 【2026-09-12】异步哈希，避免同步阻塞事件循环
    const passwordHash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, req.userId);

    // 【2026-09-22】密码变更 → 该账号的登录设备限制自动解除（允许在任何设备登录）
    const restrictionCleared = clearRestrictionOnPasswordChange(req.userId as number);

    res.json({
      success: true,
      message: '密码修改成功',
      deviceRestrictionCleared: restrictionCleared,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});



// Get user settings
router.get('/settings', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(req.userId) as any[];
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update user settings (bulk upsert)
router.put('/settings', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const settings: Record<string, string> = req.body;
    const upsert = db.prepare(
      'INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value'
    );
    const tx = db.transaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        let v = String(value);
        /* 【2026-10-19】首页背景遮罩浓度：只接受 0~80 的整数。
           这个值直接拼进 rgba() 渲染，越界会把首页刷成纯白（>100）
           或彻底没有遮罩、文字糊成一片，所以在这里兜一道。 */
        if (key === 'home_bg_mask') {
          const n = Number(v);
          v = String(Number.isFinite(n) ? Math.max(0, Math.min(80, Math.round(n))) : 30);
        }
        upsert.run(req.userId, key, v);
      }
    });
    tx();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Heartbeat — any authenticated user calls this to stay marked online
router.post('/heartbeat', authMiddleware, (req: AuthRequest, res: Response) => {
  const clientIp = req.ip || '';
  const userAgent = req.headers['user-agent'] || '';
  const hint = parseDeviceHint(req.body?.device);
  const deviceId = resolveDeviceId(req, res);
  const me = getDb().prepare('SELECT username FROM users WHERE id = ?').get(req.userId!) as any;
  touchDevice(deviceId, {
    userId: req.userId!,
    username: me?.username || '',
    ip: clientIp,
    userAgent,
    deviceInfo: extractDeviceInfo(userAgent, hint),
    isLogin: false,
  });
  recordHeartbeat(req.userId!, clientIp, userAgent, hint, deviceId);
  res.json({ success: true, deviceId });
});

// Upload / compress avatar
router.post('/avatar', authMiddleware, (req: AuthRequest, res: Response) => {
  upload.single('avatar')(req, res, async (err: any) => {
    try {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({ error: '文件大小不能超过5MB' });
          return;
        }
        res.status(400).json({ error: err.message || '上传失败' });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: '请选择要上传的图片' });
        return;
      }

      const avatarsDir = path.join(__dirname, '..', '..', 'public', 'avatars');
      if (!fs.existsSync(avatarsDir)) {
        fs.mkdirSync(avatarsDir, { recursive: true });
      }

      const ext = path.extname(file.originalname) || '.jpg';
      const filename = `avatar_${req.userId}_${uuidv4()}${ext}`;
      const outputPath = path.join(avatarsDir, filename);

      // Compress with sharp: resize to 256x256 max, JPEG quality 80
      await sharp(file.buffer)
        .resize(256, 256, { fit: 'cover', position: 'center' })
        .jpeg({ quality: 80 })
        .toFile(outputPath);

      const pendingUrl = `/uploads/avatars/${filename}`;

      const db = getDb();
      const me = db
        .prepare("SELECT COALESCE(avatar_url, '') AS avatar_url, COALESCE(pending_avatar_url, '') AS pending_avatar_url FROM users WHERE id = ?")
        .get(req.userId) as any;

      // 同一个用户只保留一条 pending：新的上传覆盖旧待审（旧文件删除，避免垃圾堆积）
      const pending = db
        .prepare("SELECT id, pending_url FROM avatar_reviews WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1")
        .get(req.userId) as any;

      if (pending) {
        if (pending.pending_url && pending.pending_url !== pendingUrl) {
          deleteAvatarFile(pending.pending_url);
        }
        db.prepare('UPDATE avatar_reviews SET pending_url = ?, prev_url = ?, reason = ?, created_at = unixepoch() WHERE id = ?')
          .run(pendingUrl, me ? me.avatar_url : '', '', pending.id);
      } else {
        db.prepare(
          "INSERT INTO avatar_reviews (user_id, pending_url, prev_url, status, created_at) VALUES (?, ?, ?, 'pending', unixepoch())"
        ).run(req.userId, pendingUrl, me ? me.avatar_url : '');
      }

      if (me && me.pending_avatar_url && me.pending_avatar_url !== pendingUrl) {
        deleteAvatarFile(me.pending_avatar_url);
      }

      // 关键：只写待审字段，avatar_url 保持原头像不变（审核通过后才替换）
      db.prepare('UPDATE users SET pending_avatar_url = ? WHERE id = ?').run(pendingUrl, req.userId);

      // 响应字段语义明确：
      //   pendingUrl         —— 待审图（尚未生效，不代表当前头像）
      //   effectiveAvatarUrl —— 当前对外生效的头像（本次上传不会改变它）
      //   effective          —— false 表示待审图未生效
      res.json({
        pendingUrl,
        status: 'pending',
        effective: false,
        effectiveAvatarUrl: me && me.avatar_url ? me.avatar_url : '',
        message: '头像已提交审核，审核通过后自动生效',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || '头像上传失败' });
    }
  });
});

export default router;
