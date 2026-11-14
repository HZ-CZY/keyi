import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/database';
import { AuthRequest } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';

/**
 * 课程板块（/learning 学习中心）解锁路由，挂载于 /api/course（公开）。
 *
 * POST /api/course/unlock  body: { password }
 *  - 校验「课程解锁口令」，通过返回 { ok:true }
 *  - 不改变登录态、不签发 token——只用于前端课程页的本地解锁判断
 *
 * 【2026-09-12 安全修复】
 *  1. 限流：本端点原先无任何限流，现限制为每 IP 20 次 / 5 分钟。
 *  2. 改异步：原先用 bcrypt.compareSync（实测单次阻塞事件循环约 96ms，
 *     洪水请求可让单进程 Node 卡死）。改用 await bcrypt.compare。
 *
 * 【2026-10-01 安全修复 · 口令与管理密码解耦】
 *  原实现直接校验 **users 表里 role='admin' 的登录密码**。这意味着：
 *    · 这是一个**未认证**接口，却在校验管理员登录密码 —— 等于公开一个
 *      可反复尝试的密码预言机；
 *    · 同一密码也用于 /api/auth/login，猜中即拿 admin token → 后台 +
 *      WebSocket 终端（以 root 运行）；
 *    · 管理员为了安全改登录密码，会把所有学生的课程入口一起弄失效。
 *
 *  现在拆成两把独立的锁：
 *    · 口令哈希存在 settings 表的 `course_unlock_hash`（bcrypt），与登录无关；
 *    · 首次调用时若该记录不存在，**自动**把当前管理员密码的哈希复制过去 ——
 *      管理员零操作，学生的既有口令立刻继续可用；但从这一刻起两者独立，
 *      改登录密码不再影响课程口令，泄漏课程口令也不再危及后台。
 *
 *  后续建议（需产品决策）：口令既已独立，可考虑在后台加一个
 *  「修改课程解锁口令」的入口；目前改口令需手动更新 settings.course_unlock_hash。
 */
const router = Router();

const unlockLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: '尝试过于频繁，请 5 分钟后再试',
});

/** settings 表里存课程解锁口令哈希的 key */
const COURSE_HASH_KEY = 'course_unlock_hash';

/**
 * 取（必要时初始化）课程解锁口令哈希。
 *
 * 初始化来源：当前管理员的登录密码哈希。这是一次性的「平滑过渡」——
 * 让已有部署不必人工设置口令，且学生手上的旧口令继续有效。
 * 初始化后立刻脱离管理员账号，之后互不影响。
 */
function getOrInitCourseHash(): string | null {
  const db = getDb();
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(COURSE_HASH_KEY) as { value?: string } | undefined;
  if (row && row.value) return row.value;

  // 尚未初始化 → 用管理员密码哈希做种子
  const admin = db
    .prepare("SELECT password_hash FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
    .get() as { password_hash?: string } | undefined;
  if (!admin || !admin.password_hash) return null;

  // INSERT OR IGNORE：并发首调时只有一个能写进去，之后都读同一份
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(
    COURSE_HASH_KEY,
    admin.password_hash
  );
  const fresh = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(COURSE_HASH_KEY) as { value?: string } | undefined;
  if (fresh?.value) {
    console.log(
      '[course] 课程解锁口令已与管理员密码解耦：已用当前管理员密码初始化独立口令（两者此后互不影响）'
    );
    return fresh.value;
  }
  return admin.password_hash;
}

router.post('/unlock', unlockLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password) {
      res.status(400).json({ error: '请输入密码' });
      return;
    }
    // 超长输入直接拒绝：bcrypt 只看前 72 字节，但没必要为 10KB 字符串做哈希
    if (password.length > 128) {
      res.status(400).json({ error: '密码过长' });
      return;
    }
    const hash = getOrInitCourseHash();
    if (!hash || !(await bcrypt.compare(password, hash))) {
      res.status(401).json({ error: '密码错误' });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '解锁失败' });
  }
});

export default router;
