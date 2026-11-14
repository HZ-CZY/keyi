import { Router, Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { getDb } from '../db/database';
import { addCoins, getCoins } from '../lib/coins';

/**
 * 商城（学生端）—— 挂载于 /api/shop，全文件 authMiddleware。
 *
 *  GET    /items                    商品目录（含「我是否已拥有」+ 我的铜板余额）
 *  POST   /buy { key }              购买（服务端定价 + 原子扣费，主键防重复购买）
 *  GET    /backgrounds              我上传的背景图 + 配额
 *  POST   /backgrounds              上传背景图（需先拥有 home_bg 解锁；sharp 压缩后落盘）
 *  POST   /backgrounds/:id/active   选用某张
 *  DELETE /backgrounds/:id          删除某张（当前生效的删掉后回到默认背景）
 *
 * 设计要点：
 *  - 价格一律读库（shop_items），不信客户端传来的数字 —— 否则改前端就能 0 元购。
 *  - 扣费与写入放在同一个事务里：任一步失败整体回滚，不会出现「扣了钱没解锁」。
 *  - (user_id, item_key) 是主键，同一个商品第二次购买会被唯一约束挡下（并发也挡得住）。
 *  - 背景图只有本人首页可见，所以不做人工审核；防滥用靠：必须先付费解锁 + 张数配额 + 体积上限 + 上传频率。
 */
const router = Router();
router.use(authMiddleware);

/** 每人最多留几张背景图（想换新的要先删旧的） */
const MAX_BACKGROUNDS = 5;
/** 上传冷却：同一用户两次上传至少间隔（毫秒），防脚本刷盘 */
const UPLOAD_COOLDOWN_MS = 8_000;
/** 部落保护卡：单张 3 天 */
const SHIELD_SECONDS_PER_CARD = 3 * 86400;
/** 保护时长上限：防止手滑连买一叠，堆到几个月 */
const SHIELD_MAX_DAYS = 30;
const lastUploadAt = new Map<number, number>();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('只允许上传图片文件'));
  },
});

class ShopError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

interface ItemRow {
  key: string;
  name: string;
  description: string;
  price: number;
  kind: string;
  enabled: number;
  sort: number;
}

function backgroundsDir(): string {
  const dir = path.join(__dirname, '..', '..', 'public', 'backgrounds');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 该用户是否真正拥有这个商品（退款后即失效） */
export function isOwned(userId: number, itemKey: string): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT status FROM shop_purchases WHERE user_id = ? AND item_key = ?")
    .get(userId, itemKey) as { status: string } | undefined;
  return !!row && row.status === 'active';
}

/* ── 商品目录 ─────────────────────────────────────────────── */
router.get('/items', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const items = db
      .prepare('SELECT key, name, description, price, kind, enabled, sort FROM shop_items ORDER BY sort, key')
      .all() as ItemRow[];
    const owned = new Set(
      (
        db
          .prepare("SELECT item_key FROM shop_purchases WHERE user_id = ? AND status = 'active'")
          .all(req.userId) as { item_key: string }[]
      ).map((r) => r.item_key)
    );
    /* 消耗品没有「已拥有」概念，改为把当前生效状态带回前端：
       部落保护卡 → 护盾到期时间（未生效为 0）。 */
    const shieldUntil = Number(
      (
        db
          .prepare('SELECT shield_until FROM village_profiles WHERE user_id = ?')
          .get(req.userId) as { shield_until: number } | undefined
      )?.shield_until || 0
    );
    res.json({
      balance: getCoins(req.userId!),
      items: items.map((i) => ({
        key: i.key,
        name: i.name,
        description: i.description,
        price: i.price,
        kind: i.kind,
        enabled: !!i.enabled,
        owned: owned.has(i.key),
        shieldUntil: i.key === 'village_shield_3d' ? shieldUntil : undefined,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── 购买 ─────────────────────────────────────────────────── */
router.post('/buy', (req: AuthRequest, res: Response) => {
  const key = typeof req.body?.key === 'string' ? req.body.key : '';
  if (!key) {
    res.status(400).json({ error: '缺少商品参数' });
    return;
  }
  try {
    const db = getDb();
    const item = db
      .prepare('SELECT rowid AS rid, key, name, price, enabled, kind FROM shop_items WHERE key = ?')
      .get(key) as (ItemRow & { rid: number }) | undefined;
    if (!item) {
      res.status(404).json({ error: '商品不存在' });
      return;
    }
    if (!item.enabled) {
      res.status(400).json({ error: '该商品已下架' });
      return;
    }

    const userId = req.userId!;
    /* 消耗品（保护卡）：可以重复购买，不写 shop_purchases ——
       否则「(user_id, item_key) 主键 + 已拥有校验」会把第二次购买挡死。 */
    const isConsumable = item.kind === 'consumable';
    let shieldUntil: number | null = null;

    const tx = db.transaction(() => {
      if (!isConsumable) {
        const mine = db
          .prepare('SELECT status FROM shop_purchases WHERE user_id = ? AND item_key = ?')
          .get(userId, key) as { status: string } | undefined;
        if (mine && mine.status === 'active') {
          throw new ShopError(409, '你已经拥有这个商品了');
        }
      }
      const balance = getCoins(userId);
      if (balance < item.price) {
        throw new ShopError(400, `铜板不足：需要 ${item.price}，你现在有 ${balance}`);
      }
      // 扣费（余额不足会抛错 → 整个事务回滚）
      addCoins(userId, -item.price, 'shop_purchase', item.rid);

      if (isConsumable) {
        if (item.key === 'village_shield_3d') {
          const now = Math.floor(Date.now() / 1000);
          const row = db
            .prepare('SELECT shield_until FROM village_profiles WHERE user_id = ?')
            .get(userId) as { shield_until: number } | undefined;
          // 从「现在」和「现有到期时间」里取较晚的作为基准，实现叠加
          const base = Math.max(now, Number(row?.shield_until) || 0);
          const next = base + SHIELD_SECONDS_PER_CARD;
          if (next - now > SHIELD_MAX_DAYS * 86400) {
            throw new ShopError(400, `保护时长最多 ${SHIELD_MAX_DAYS} 天，等用掉一些再买`);
          }
          db.prepare(
            `INSERT INTO village_profiles (user_id, shield_until, updated_at) VALUES (?, ?, unixepoch())
             ON CONFLICT(user_id) DO UPDATE SET
               shield_until = excluded.shield_until,
               updated_at = unixepoch()`
          ).run(userId, next);
          shieldUntil = next;
        } else {
          throw new ShopError(400, '该消耗品暂未接入效果');
        }
        return;
      }

      // 记拥有关系：退款后再次购买会把同一行改回 active
      db.prepare(
        `INSERT INTO shop_purchases (user_id, item_key, price_paid, status, created_at, refunded_at, refunded_by)
         VALUES (?, ?, ?, 'active', unixepoch(), NULL, NULL)
         ON CONFLICT(user_id, item_key) DO UPDATE SET
           price_paid = excluded.price_paid,
           status = 'active',
           created_at = excluded.created_at,
           refunded_at = NULL,
           refunded_by = NULL`
      ).run(userId, key, item.price);

      /* 称号类商品：购买后直接戴上（badge_label 在排行榜昵称旁展示）。
         已拥有的称号可以在商城页随时免费切换（见 /title/activate）。 */
      if (item.kind === 'title') {
        db.prepare('UPDATE users SET badge_label = ? WHERE id = ?').run(item.name, userId);
      }
    });
    tx();

    res.json({
      success: true,
      key,
      name: item.name,
      spent: item.price,
      balance: getCoins(userId),
      ...(shieldUntil != null ? { shieldUntil } : {}),
    });
  } catch (err: any) {
    if (err instanceof ShopError) {
      res.status(err.code).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err.message || '购买失败' });
  }
});

/* ── 切换已拥有的称号 ──────────────────────────────────────
   称号是「买断 + 可切换」：购买时自动戴上，之后可以在已拥有的称号之间免费来回切。
   不这样做的话，戴过 A 再买 B 就回不去 A 了（重复购买会被 409 挡掉）。 */
router.post('/title/activate', (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const key = typeof req.body?.key === 'string' ? req.body.key : '';
    if (!key) {
      res.status(400).json({ error: '缺少商品参数' });
      return;
    }
    const db = getDb();
    const item = db
      .prepare("SELECT name FROM shop_items WHERE key = ? AND kind = 'title'")
      .get(key) as { name: string } | undefined;
    if (!item) {
      res.status(404).json({ error: '称号不存在' });
      return;
    }
    if (!isOwned(userId, key)) {
      res.status(400).json({ error: '你还没有拥有这个称号' });
      return;
    }
    db.prepare('UPDATE users SET badge_label = ? WHERE id = ?').run(item.name, userId);
    res.json({ success: true, badge: item.name });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── 我的背景图 ───────────────────────────────────────────── */
router.get('/backgrounds', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const rows = db
      .prepare('SELECT id, url, bytes, active, created_at FROM user_backgrounds WHERE user_id = ? ORDER BY created_at DESC, id DESC')
      .all(req.userId) as { id: number; url: string; bytes: number; active: number; created_at: number }[];
    res.json({
      owned: isOwned(req.userId!, 'home_bg'),
      max: MAX_BACKGROUNDS,
      activeId: rows.find((r) => r.active)?.id ?? null,
      items: rows.map((r) => ({ id: r.id, url: r.url, bytes: r.bytes, active: !!r.active, createdAt: r.created_at })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/backgrounds', (req: AuthRequest, res: Response) => {
  upload.single('image')(req, res, async (err: any) => {
    try {
      const userId = req.userId!;
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({ error: '图片不能超过 5MB' });
          return;
        }
        res.status(400).json({ error: err.message || '上传失败' });
        return;
      }
      // 必须先拥有解锁商品，否则这个接口就是开放的免费图床
      if (!isOwned(userId, 'home_bg')) {
        res.status(403).json({ error: '还未解锁「更换首页背景图片」' });
        return;
      }
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: '请选择要上传的图片' });
        return;
      }
      const now = Date.now();
      const last = lastUploadAt.get(userId) || 0;
      if (now - last < UPLOAD_COOLDOWN_MS) {
        res.status(429).json({ error: '上传太频繁了，请稍后再试' });
        return;
      }

      const db = getDb();
      const cnt = (
        db.prepare('SELECT COUNT(*) AS c FROM user_backgrounds WHERE user_id = ?').get(userId) as { c: number }
      ).c;
      if (cnt >= MAX_BACKGROUNDS) {
        res.status(400).json({ error: `最多保存 ${MAX_BACKGROUNDS} 张，请先删掉一张再上传` });
        return;
      }

      const filename = `bg_${userId}_${uuidv4()}.jpg`;
      const outputPath = path.join(backgroundsDir(), filename);
      // 压缩：手机拍的原图常有 4000px/5MB，统一压到宽 1600 的 JPEG，落盘通常 200~400KB。
      // rotate() 不带参数 = 按 EXIF 把方向摆正，否则竖拍的图在网页上是躺着的。
      await sharp(file.buffer)
        .rotate()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(outputPath);

      const bytes = fs.statSync(outputPath).size;
      const first = cnt === 0;
      const info = db
        .prepare('INSERT INTO user_backgrounds (user_id, url, bytes, active, created_at) VALUES (?, ?, ?, ?, unixepoch())')
        .run(userId, `/uploads/backgrounds/${filename}`, bytes, first ? 1 : 0);
      lastUploadAt.set(userId, now);

      res.json({
        success: true,
        id: Number(info.lastInsertRowid),
        url: `/uploads/backgrounds/${filename}`,
        bytes,
        active: first,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message || '上传失败' });
    }
  });
});

router.post('/backgrounds/:id/active', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    // id=0 = 恢复默认背景（全部取消生效）
    if (id === 0) {
      db.prepare('UPDATE user_backgrounds SET active = 0 WHERE user_id = ?').run(req.userId);
      res.json({ success: true, activeId: null });
      return;
    }
    const row = db
      .prepare('SELECT id FROM user_backgrounds WHERE id = ? AND user_id = ?')
      .get(id, req.userId) as { id: number } | undefined;
    if (!row) {
      res.status(404).json({ error: '找不到这张背景图' });
      return;
    }
    const tx = db.transaction(() => {
      db.prepare('UPDATE user_backgrounds SET active = 0 WHERE user_id = ?').run(req.userId);
      db.prepare('UPDATE user_backgrounds SET active = 1 WHERE id = ? AND user_id = ?').run(id, req.userId);
    });
    tx();
    res.json({ success: true, activeId: id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/backgrounds/:id', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const row = db
      .prepare('SELECT url, active FROM user_backgrounds WHERE id = ? AND user_id = ?')
      .get(id, req.userId) as { url: string; active: number } | undefined;
    if (!row) {
      res.status(404).json({ error: '找不到这张背景图' });
      return;
    }
    db.prepare('DELETE FROM user_backgrounds WHERE id = ? AND user_id = ?').run(id, req.userId);
    try {
      const p = path.join(backgroundsDir(), path.basename(row.url));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* 文件删不掉不影响主流程，留个孤儿文件而已 */
    }
    res.json({ success: true, deleted: id, wasActive: !!row.active });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
