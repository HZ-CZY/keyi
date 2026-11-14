import { Router, Response } from 'express';
import { getDb } from '../../db/database';
import { adminMiddleware, AuthRequest } from '../../middleware/auth';
import {
  getDeviceRule,
  upsertDeviceRule,
  deleteDeviceRule,
  listDeviceRules,
  describeAllowed,
} from '../../lib/device-rules';

const router = Router();

// ── 账号登录设备限制 (2026-09-22) ────────────────────────────────────────
// 把某账号限制为「只能在指定类别的设备上登录」（如 iPhone / 电脑）。
// PUT 默认会把 enforced_at 重置为当前时间 → 该账号所有旧会话立刻下线，必须重新登录。
// 账号密码一旦变更（学生自助改或管理员重置），限制自动解除。

/** 规则 → 对外 JSON */
function ruleToJson(rule: any) {
  if (!rule) return null;
  return {
    userId: rule.userId,
    allowed: rule.allowedTokens,
    allowedKinds: rule.allowedKinds,
    unlockOnPasswordChange: rule.unlockOnPasswordChange,
    enforcedAt: rule.enforcedAt,
    note: rule.note,
  };
}

// 列出全部限制
router.get('/device-rules', (_req: AuthRequest, res: Response) => {
  try {
    res.json(listDeviceRules().map(ruleToJson));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 查某账号的限制
router.get('/users/:id/device-rule', (req: AuthRequest, res: Response) => {
  try {
    res.json({ rule: ruleToJson(getDeviceRule(Number(req.params.id))) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 设置/更新某账号的限制
router.put('/users/:id/device-rule', (req: AuthRequest, res: Response) => {
  try {
    const userId = Number(req.params.id);
    const db = getDb();
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    const raw = (req.body?.allowed ?? req.body?.allowed_kinds ?? '') as string[] | string;
    const tokens = (Array.isArray(raw) ? raw : String(raw).split(','))
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    if (tokens.length === 0) {
      res.status(400).json({ error: '请至少指定一种允许的设备类别，例如 ["iPhone", "电脑"]' });
      return;
    }

    const unlock = req.body?.unlockOnPasswordChange !== false;
    const kickExisting = req.body?.kickExistingSessions !== false;
    const note = String(req.body?.note || '');
    const rule = upsertDeviceRule(userId, tokens, unlock, note, kickExisting);

    res.json({
      success: true,
      rule: ruleToJson(rule),
      message:
        `已限制「${user.username}」只能在这些设备登录：${describeAllowed(tokens)}` +
        (kickExisting ? '；该账号已登录的其他设备已全部下线。' : '；已登录的旧会话保持不变。'),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 解除某账号的限制
router.delete('/users/:id/device-rule', (req: AuthRequest, res: Response) => {
  try {
    const removed = deleteDeviceRule(Number(req.params.id));
    res.json({ success: true, removed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
