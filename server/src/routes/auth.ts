import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database';
import { generateToken, authMiddleware, AuthRequest } from '../middleware/auth';
import { recordHeartbeat, extractDeviceInfo } from '../online-tracker';

const router = Router();

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
router.post('/register', (req: Request, res: Response) => {
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

    const passwordHash = bcrypt.hashSync(password, 10);
    const result = db.prepare(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)'
    ).run(username, passwordHash);

    const userId = result.lastInsertRowid as number;

    // Create default deck
    db.prepare(
      'INSERT INTO decks (user_id, name, description) VALUES (?, ?, ?)'
    ).run(userId, '默认', '默认牌组');

    // Create default notetype
    db.prepare(
      `INSERT INTO notetypes (user_id, name, css, kind, field_names, template_q_format, template_a_format) VALUES (?, 'Basic', ?, 'normal', '["Front","Back"]', '{{Front}}', '{{FrontSide}}<hr>{{Back}}')`
    ).run(userId, '.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }');

    // Create MCQ notetype
    db.prepare(
      `INSERT INTO notetypes (user_id, name, css, kind, field_names, template_q_format, template_a_format) VALUES (?, '选择题', ?, 'normal', '["题目","选项A","选项B","选项C","选项D","答案","解析"]', '<div class=mcq>{{题目}}</div><div class=options><p><span class=opt>A.</span> {{选项A}}</p><p><span class=opt>B.</span> {{选项B}}</p><p><span class=opt>C.</span> {{选项C}}</p><p><span class=opt>D.</span> {{选项D}}</p></div>', '<div class=mcq>{{题目}}</div><div class=options><p><span class=opt>A.</span> {{选项A}}</p><p><span class=opt>B.</span> {{选项B}}</p><p><span class=opt>C.</span> {{选项C}}</p><p><span class=opt>D.</span> {{选项D}}</p></div><hr><div class=answer>正确答案：{{答案}}</div><div class=explanation>{{解析}}</div>')`
    ).run(userId, '.card{font-family:arial;font-size:18px;line-height:1.6}.mcq{font-size:20px;font-weight:bold;margin-bottom:16px}.options p{margin:8px 0;padding:10px 14px;border:1px solid #e5e7eb;border-radius:10px}.opt{display:inline-block;width:24px;font-weight:bold;color:#6366f1}.answer{font-size:18px;color:#16a34a;font-weight:bold;margin-top:12px}.explanation{margin-top:8px;color:#6b7280;font-size:15px}');

    const token = generateToken(userId);
    const newUser = db.prepare('SELECT id, username, role, avatar_url FROM users WHERE id = ?').get(userId) as any;
    res.status(201).json({ token, userId, username, role: newUser.role, avatar_url: newUser.avatar_url || '' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Login
router.post('/login', (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: '需要用户名和密码' });
      return;
    }

    const db = getDb();
    const user = db.prepare(
      'SELECT id, username, password_hash, role, avatar_url FROM users WHERE username = ?'
    ).get(username) as any;

    const clientIp = req.ip || '';
    const userAgent = req.headers['user-agent'] || '';
    const deviceInfo = extractDeviceInfo(userAgent);

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      // Record failed login attempt
      db.prepare(
        'INSERT INTO login_logs (user_id, ip, user_agent, device_info, login_method, success) VALUES (?, ?, ?, ?, ?, 0)'
      ).run(user?.id ?? 0, clientIp, userAgent, deviceInfo, 'password', 0);

      // Clean up old logs for this user (keep last 15)
      if (user) {
        db.prepare(
          'DELETE FROM login_logs WHERE user_id = ? AND id NOT IN (SELECT id FROM login_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 15)'
        ).run(user.id, user.id);
      }

      res.status(401).json({ error: '用户名或密码错误' });
      return;
    }

    db.prepare('UPDATE users SET last_login_at = unixepoch() WHERE id = ?').run(user.id);

    // Record successful login
    db.prepare(
      'INSERT INTO login_logs (user_id, ip, user_agent, device_info, login_method, success) VALUES (?, ?, ?, ?, ?, 1)'
    ).run(user.id, clientIp, userAgent, deviceInfo, 'password');

    // Clean up old logs for this user (keep last 15)
    db.prepare(
      'DELETE FROM login_logs WHERE user_id = ? AND id NOT IN (SELECT id FROM login_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 15)'
    ).run(user.id, user.id);

    const token = generateToken(user.id);
    res.json({ token, userId: user.id, username: user.username, role: user.role, avatar_url: user.avatar_url || '' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get current user
router.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT id, username, role, avatar_url FROM users WHERE id = ?').get(req.userId) as any;
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }
    res.json(user);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Change own password
router.put('/password', authMiddleware, (req: AuthRequest, res: Response) => {
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

    if (!bcrypt.compareSync(oldPassword, user.password_hash)) {
      res.status(403).json({ error: '旧密码不正确' });
      return;
    }

    const passwordHash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, req.userId);
    res.json({ success: true, message: '密码修改成功' });
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
        upsert.run(req.userId, key, String(value));
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
  recordHeartbeat(req.userId!, clientIp, userAgent);
  res.json({ success: true });
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

      const avatarUrl = `/uploads/avatars/${filename}`;

      const db = getDb();
      db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, req.userId);

      res.json({ avatarUrl });
    } catch (err: any) {
      res.status(500).json({ error: err.message || '头像上传失败' });
    }
  });
});

export default router;
