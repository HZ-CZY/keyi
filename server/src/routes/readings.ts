import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { AuthRequest } from '../middleware/auth';

/**
 * 阅读板块 —— 文言文内容库（公开只读）。
 *
 * 【2026-09-28 新增】配合前端 /reading 页面。
 *   - 列表：支持关键词搜索、朝代筛选、排序、分页
 *   - 详情：整篇返回（正文/译文/注释/赏析/创作背景）
 *   - 元信息：朝代聚合，用于渲染筛选器
 *
 * 全部为公开接口（不鉴权），与 announcements 的公开路由同级挂载在 /api 下。
 */
const router = Router();

// 列表：GET /api/readings?q=&dynasty=&page=1&limit=20&sort=default|words|title
router.get('/readings', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const q = String(req.query.q || '').trim();
    const dynasty = String(req.query.dynasty || '').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const sort = String(req.query.sort || 'default');

    const where: string[] = [];
    const params: any[] = [];
    if (q) {
      where.push('(title LIKE ? OR author LIKE ? OR content LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    if (dynasty) {
      where.push('dynasty = ?');
      params.push(dynasty);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    let orderSql = 'ORDER BY sort_order ASC, id ASC';
    if (sort === 'words') orderSql = 'ORDER BY word_count DESC, id ASC';
    else if (sort === 'title') orderSql = 'ORDER BY title ASC';

    const total = (db.prepare(`SELECT COUNT(*) AS c FROM readings ${whereSql}`).get(...params) as any).c;
    const rows = db.prepare(
      `SELECT id, title, author, dynasty, category, word_count,
              substr(content, 1, 80) AS excerpt
       FROM readings ${whereSql} ${orderSql} LIMIT ? OFFSET ?`
    ).all(...params, limit, (page - 1) * limit) as any[];

    res.json({ total, page, limit, items: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 元信息：朝代聚合 —— GET /api/readings/meta
router.get('/readings/meta', (_req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const dynasties = db.prepare(
      `SELECT dynasty, COUNT(*) AS count FROM readings
       WHERE dynasty <> '' GROUP BY dynasty ORDER BY count DESC`
    ).all() as any[];
    const total = (db.prepare('SELECT COUNT(*) AS c FROM readings').get() as any).c;
    res.json({ total, dynasties });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 详情：GET /api/readings/:id
router.get('/readings/:id', (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      res.status(400).json({ error: '无效的 id' });
      return;
    }
    const db = getDb();
    const row = db.prepare('SELECT * FROM readings WHERE id = ?').get(id) as any;
    if (!row) {
      res.status(404).json({ error: '未找到该篇目' });
      return;
    }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
