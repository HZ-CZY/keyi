import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { AuthRequest, adminMiddleware } from '../middleware/auth';
import { getDb } from '../db/database';
import { addCoins } from '../lib/coins';

/**
 * 商城 · 管理端 —— 挂载于 /api/admin/shop，全文件 adminMiddleware。
 *
 *  GET    /items                 全部商品（含下架的），带已购数量
 *  PUT    /items/:key            改 价格 / 名称 / 描述 / 上下架 / 排序（改完即时生效，不用重新构建）
 *  GET    /purchases             谁买了（可按商品/用户名过滤）
 *  POST   /purchases/refund      全额退款（退回原价 + 收回功能 + 首页背景回默认）
 *  DELETE /backgrounds/:id       删掉某个用户上传的图片（处理违规图）
 */
const router = Router();
router.use(adminMiddleware);

class ShopError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/* ── 商品 ─────────────────────────────────────────────────── */
router.get('/items', (_req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT i.key, i.name, i.description, i.price, i.kind, i.enabled, i.sort, i.updated_at,
                (SELECT COUNT(*) FROM shop_purchases p WHERE p.item_key = i.key AND p.status = 'active') AS owners
         FROM shop_items i ORDER BY i.sort, i.key`
      )
      .all();
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/items/:key', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const key = String(req.params.key);
    const cur = db.prepare('SELECT key FROM shop_items WHERE key = ?').get(key) as { key: string } | undefined;
    if (!cur) {
      res.status(404).json({ error: '商品不存在' });
      return;
    }
    const sets: string[] = [];
    const args: any[] = [];
    const { name, description, price, enabled, sort } = req.body || {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: '名称不能为空' });
        return;
      }
      sets.push('name = ?');
      args.push(name.trim());
    }
    if (description !== undefined) {
      sets.push('description = ?');
      args.push(String(description));
    }
    if (price !== undefined) {
      const p = Number(price);
      if (!Number.isFinite(p) || p < 0 || !Number.isInteger(p)) {
        res.status(400).json({ error: '价格必须是非负整数' });
        return;
      }
      sets.push('price = ?');
      args.push(p);
    }
    if (enabled !== undefined) {
      sets.push('enabled = ?');
      args.push(enabled ? 1 : 0);
    }
    if (sort !== undefined) {
      sets.push('sort = ?');
      args.push(Number(sort) || 0);
    }
    if (!sets.length) {
      res.status(400).json({ error: '没有要修改的字段' });
      return;
    }
    sets.push('updated_at = unixepoch()');
    db.prepare(`UPDATE shop_items SET ${sets.join(', ')} WHERE key = ?`).run(...args, key);
    const row = db.prepare('SELECT key, name, description, price, kind, enabled, sort FROM shop_items WHERE key = ?').get(key);
    res.json({ success: true, item: row });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── 购买记录 ─────────────────────────────────────────────── */
router.get('/purchases', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const key = typeof req.query.key === 'string' ? req.query.key : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const where: string[] = [];
    const args: any[] = [];
    if (key) {
      where.push('p.item_key = ?');
      args.push(key);
    }
    if (q) {
      where.push('u.username LIKE ?');
      args.push(`%${q}%`);
    }
    const rows = db
      .prepare(
        `SELECT p.user_id, COALESCE(u.username, '（已注销）') AS username, p.item_key, p.price_paid,
                p.status, p.created_at, p.refunded_at
         FROM shop_purchases p LEFT JOIN users u ON u.id = p.user_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY p.created_at DESC LIMIT 500`
      )
      .all(...args);
    const summary = db
      .prepare(
        `SELECT item_key,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
                SUM(CASE WHEN status = 'active' THEN price_paid ELSE 0 END) AS income
         FROM shop_purchases GROUP BY item_key`
      )
      .all();
    res.json({ rows, summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/purchases/refund', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = Number(req.body?.userId);
    const itemKey = typeof req.body?.itemKey === 'string' ? req.body.itemKey : '';
    if (!userId || !itemKey) {
      res.status(400).json({ error: '缺少 userId / itemKey' });
      return;
    }
    const item = db.prepare('SELECT rowid AS rid, name FROM shop_items WHERE key = ?').get(itemKey) as
      | { rid: number; name: string }
      | undefined;
    const purchase = db
      .prepare('SELECT price_paid, status FROM shop_purchases WHERE user_id = ? AND item_key = ?')
      .get(userId, itemKey) as { price_paid: number; status: string } | undefined;
    if (!purchase || purchase.status !== 'active') {
      res.status(400).json({ error: '该用户没有生效中的购买记录' });
      return;
    }

    const tx = db.transaction(() => {
      // 退「当时实付」的金额（即使后来改过价，也按玩家实际花的退）
      addCoins(userId, purchase.price_paid, 'shop_refund', item?.rid ?? null);
      db.prepare(
        `UPDATE shop_purchases SET status = 'refunded', refunded_at = unixepoch(), refunded_by = ?
         WHERE user_id = ? AND item_key = ?`
      ).run(req.userId!, userId, itemKey);
      // 收回功能：首页背景图立即回到默认（图片文件保留，万一重新购买还能用）
      db.prepare('UPDATE user_backgrounds SET active = 0 WHERE user_id = ?').run(userId);
    });
    tx();

    res.json({ success: true, refunded: purchase.price_paid, item: item?.name || itemKey });
  } catch (err: any) {
    if (err instanceof ShopError) {
      res.status(err.code).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err.message || '退款失败' });
  }
});

/* ── 图片清理（违规/占空间） ─────────────────────────────── */
router.delete('/backgrounds/:id', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const row = db.prepare('SELECT user_id, url FROM user_backgrounds WHERE id = ?').get(id) as
      | { user_id: number; url: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: '找不到这张图' });
      return;
    }
    db.prepare('DELETE FROM user_backgrounds WHERE id = ?').run(id);
    try {
      const p = path.join(__dirname, '..', '..', 'public', 'backgrounds', path.basename(row.url));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* 忽略 */
    }
    res.json({ success: true, deleted: id, userId: row.user_id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
