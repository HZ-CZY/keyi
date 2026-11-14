import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getDb } from '../db/database';

const router = Router();
router.use(authMiddleware);

// --- keyword extraction helpers ----------------------------------------------

/**
 * Extract the studied keyword from a card front.
 * The Anki-style markup uses **bold** (sometimes wrapped in <b> HTML):
 *   "不**爱**珍器重宝肥饶之地，以致天下之士。（《过秦论》）"
 *   "<b>**爱**</b>其子，择师而教之"
 * Returns the first bolded word (1-6 chars); empty string if none.
 */
function extractKeyword(raw: string): string {
  if (!raw) return '';
  const bold = raw.match(/\*\*([^*]+)\*\*/g) || [];
  for (const b of bold) {
    const w = b.replace(/\*\*/g, '').trim();
    if (w.length >= 1 && w.length <= 6) return w;
  }
  return '';
}

// --- in-memory cache (10 min TTL) -------------------------------------------

interface CacheEntry { ts: number; data: any }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;

function getCached(key: string): any | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return e.data;
}
function setCached(key: string, data: any) { cache.set(key, { ts: Date.now(), data }); }

export function invalidateWordnetCache(userId: number) {
  for (const k of Array.from(cache.keys())) {
    if (k.startsWith(`${userId}:`)) cache.delete(k);
  }
}

// --- route -------------------------------------------------------------------

/**
 * GET /api/wordnet/graph?limit=30
 *
 * Builds a studied-keyword association graph for the authenticated user.
 *
 * Nodes are the bolded keywords (文言实词 etc.) extracted from card fronts the
 * user reviewed in the last 30 days. Node weight = number of distinct days the
 * keyword appeared. Edge weight = number of days the two keywords co-occurred.
 *
 * Edge strategy:
 *   1. Same-day co-occurrence (>=1 shared day → edge).
 *   2. Fallback: chain remaining nodes in learning-time order when too few
 *      edges survive the top-N node filter.
 */
router.get('/graph', (req: AuthRequest, res) => {
  try {
    const db = getDb();
    const userId = req.userId!;
    const limit = Math.min(parseInt(String(req.query.limit ?? '30')) || 30, 80);

    const cacheKey = `${userId}:${limit}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400;
    const PER_DAY_CAP = 25;

    const rows = db.prepare(`
      SELECT
        date(r.reviewed_at, 'unixepoch', 'localtime') AS d,
        n.fields AS fields
      FROM revlog r
      JOIN cards c ON r.card_id = c.id AND c.user_id = r.user_id
      JOIN notes n ON c.note_id = n.id
      WHERE r.user_id = ? AND r.reviewed_at >= ?
      ORDER BY r.reviewed_at DESC
      LIMIT 5000
    `).all(userId, cutoff) as any[];

    // (day -> Set<keyword>), deduped; dayCount: keyword -> distinct days seen
    const byDay = new Map<string, Set<string>>();
    const dayCount = new Map<string, number>();
    for (const row of rows) {
      let fields: any;
      try { fields = JSON.parse(row.fields || '[]'); } catch { fields = []; }
      if (!Array.isArray(fields) || fields.length === 0) continue;
      const kw = extractKeyword(String(fields[0] || ''));
      if (!kw) continue;
      const s = byDay.get(row.d) || new Set<string>();
      if (!s.has(kw)) {
        s.add(kw);
        dayCount.set(kw, (dayCount.get(kw) || 0) + 1);
        if (s.size <= PER_DAY_CAP) byDay.set(row.d, s);
      } else {
        byDay.set(row.d, s);
      }
    }

    // Co-occurrence per day.
    const edgeMap = new Map<string, number>();
    for (const words of byDay.values()) {
      const ws = Array.from(words);
      for (let i = 0; i < ws.length; i++) {
        for (let j = i + 1; j < ws.length; j++) {
          const [a, b] = ws[i] < ws[j] ? [ws[i], ws[j]] : [ws[j], ws[i]];
          const key = `${a}|||${b}`;
          edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
        }
      }
    }

    const cooccurEdges = Array.from(edgeMap.entries())
      .map(([k, c]) => {
        const [source, target] = k.split('|||');
        return { source, target, weight: c };
      })
      .sort((a, b) => b.weight - a.weight);

    if (dayCount.size === 0) {
      const result = { nodes: [], edges: [] };
      setCached(cacheKey, result);
      return res.json(result);
    }

    // Top nodes by days seen.
    const top = Array.from(dayCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
    const nodes = top.map(([w, c]) => ({ id: w, label: w, weight: c }));
    const topSet = new Set(top.map(([w]) => w));
    let finalEdges = cooccurEdges.filter(e => topSet.has(e.source) && topSet.has(e.target));

    // Fallback: when too few edges survive, chain nodes in learning-time order.
    if (finalEdges.length < Math.max(nodes.length - 1, 2)) {
      const ordered = Array.from(byDay.entries()).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const seq: string[] = [];
      for (const [, words] of ordered) {
        for (const w of Array.from(words).sort()) {
          if (topSet.has(w) && !seq.includes(w)) seq.push(w);
        }
      }
      if (seq.length >= 2) {
        finalEdges = [];
        for (let i = 0; i < seq.length - 1; i++) {
          finalEdges.push({ source: seq[i], target: seq[i + 1], weight: 1 });
        }
      }
    }

    const result = { nodes, edges: finalEdges };
    setCached(cacheKey, result);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

/**
 * GET /api/wordnet/recent?limit=10
 *
 * 首页 3D 词语模型数据源：返回用户「最近学过的 N 个不同重点字」以及词间连线。
 * 按 revlog 时间倒序扫描（上限 400 条），解析卡面 **重点字**，去重保序，取前 limit 个。
 * edges：两词曾在同一天被学习（同日共现）即成边，weight = 共现天数；
 * 若连线太少（< 词数-1）则按最近学习顺序把相邻词连成链兜底，保证图不散。
 */
router.get('/recent', (req: AuthRequest, res) => {
  try {
    const db = getDb();
    const userId = req.userId!;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10')) || 10, 1), 30);
    const rows = db.prepare(`
      SELECT date(r.reviewed_at, 'unixepoch', 'localtime') AS d, n.fields AS fields
      FROM revlog r
      JOIN cards c ON r.card_id = c.id AND c.user_id = r.user_id
      JOIN notes n ON c.note_id = n.id
      WHERE r.user_id = ?
      ORDER BY r.id DESC
      LIMIT 400
    `).all(userId) as any[];

    // 词 → 出现过的天集合（保持首次出现顺序）
    const daysByWord = new Map<string, Set<string>>();
    const wordOrder: string[] = [];
    for (const row of rows) {
      let fields: any;
      try { fields = JSON.parse(row.fields || '[]'); } catch { fields = []; }
      if (!Array.isArray(fields) || !fields[0]) continue;
      const kw = extractKeyword(String(fields[0]));
      if (!kw) continue;
      if (!daysByWord.has(kw)) {
        daysByWord.set(kw, new Set<string>());
        wordOrder.push(kw);
      }
      daysByWord.get(kw)!.add(row.d);
    }

    const words = wordOrder.slice(0, limit);
    const edges: { source: string; target: string; weight: number }[] = [];
    if (words.length >= 2) {
      const wordSet = new Set(words);
      // 同日共现成边
      const pairs: { a: string; b: string; w: number }[] = [];
      for (let i = 0; i < words.length; i++) {
        for (let j = i + 1; j < words.length; j++) {
          const a = words[i], b = words[j];
          const da = daysByWord.get(a)!, db_ = daysByWord.get(b)!;
          let shared = 0;
          for (const d of da) if (db_.has(d)) shared++;
          if (shared > 0) pairs.push({ a, b, w: shared });
        }
      }
      pairs.sort((x, y) => y.w - x.w);
      for (const p of pairs) edges.push({ source: p.a, target: p.b, weight: p.w });
      // 太少 → 按最近学习顺序链兜底
      if (edges.length < words.length - 1) {
        const used = new Set<string>();
        for (let i = 0; i < words.length - 1; i++) {
          const a = words[i], b = words[i + 1];
          const key = `${a}|||${b}`;
          if (used.has(key)) continue;
          used.add(key);
          if (!edges.some(e => (e.source === a && e.target === b) || (e.source === b && e.target === a))) {
            edges.push({ source: a, target: b, weight: 1 });
          }
        }
      }
    }
    res.json({ words, edges });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
