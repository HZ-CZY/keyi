import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { AuthRequest, authMiddleware } from '../middleware/auth';

/**
 * 单词本 + 错题本
 * ─────────────────────────────────────────────────────────
 * word_favorites：学生在答题/学习时收藏的字词（按卡片记录，可去重）
 * wrong_book    ：答错的字词；重复答错累计 wrong_count，掌握后 resolved=1
 * 两张表均懒创建，避免依赖启动迁移顺序。
 *   POST   /api/wordbook/favorites           收藏字词
 *   DELETE /api/wordbook/favorites/:cardId   取消收藏
 *   GET    /api/wordbook/favorites           单词本列表
 *   GET    /api/wordbook/favorites/:cardId   是否已收藏
 *   POST   /api/wordbook/wrong               记录一次答错
 *   GET    /api/wordbook/wrong               错题本列表
 *   POST   /api/wordbook/wrong/:cardId/resolve  标记已掌握
 *   DELETE /api/wordbook/wrong/:cardId       从错题本移除
 */
const router = Router();

function ensureTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS word_favorites (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      card_id     INTEGER NOT NULL,
      deck_id     INTEGER,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, card_id)
    );
    CREATE INDEX IF NOT EXISTS idx_word_favorites_user ON word_favorites(user_id);

    CREATE TABLE IF NOT EXISTS wrong_book (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      card_id       INTEGER NOT NULL,
      deck_id       INTEGER,
      wrong_count   INTEGER NOT NULL DEFAULT 1,
      resolved      INTEGER NOT NULL DEFAULT 0,
      last_wrong_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, card_id)
    );
    CREATE INDEX IF NOT EXISTS idx_wrong_book_user ON wrong_book(user_id);
  `);
}

/** 把 notes.fields（JSON 数组）拆成 front/back/extra */
function parseFields(raw: string | null): { front: string; back: string; extra: string } {
  try {
    const arr = JSON.parse(raw || '[]');
    return {
      front: String(arr?.[0] ?? ''),
      back: String(arr?.[1] ?? ''),
      extra: String(arr?.[2] ?? ''),
    };
  } catch {
    return { front: '', back: '', extra: '' };
  }
}

/** 校验卡片属于当前用户，返回 deck_id */
function ownCard(userId: number | undefined, cardId: number): { deck_id: number | null } | null {
  const row = getDb()
    .prepare('SELECT deck_id FROM cards WHERE id = ? AND user_id = ?')
    .get(cardId, userId) as { deck_id: number | null } | undefined;
  return row ?? null;
}

/* ───────────── 单词本 ───────────── */

router.post('/favorites', authMiddleware, (req: AuthRequest, res: Response) => {
  ensureTable();
  const cardId = Number((req.body as any)?.cardId);
  if (!cardId) {
    res.status(400).json({ error: '缺少 cardId' });
    return;
  }
  const card = ownCard(req.userId, cardId);
  if (!card) {
    res.status(404).json({ error: '卡片不存在' });
    return;
  }
  getDb()
    .prepare('INSERT OR IGNORE INTO word_favorites (user_id, card_id, deck_id) VALUES (?, ?, ?)')
    .run(req.userId, cardId, card.deck_id ?? null);
  res.json({ ok: true, favorited: true });
});

router.delete('/favorites/:cardId', authMiddleware, (req: AuthRequest, res: Response) => {
  ensureTable();
  getDb()
    .prepare('DELETE FROM word_favorites WHERE user_id = ? AND card_id = ?')
    .run(req.userId, Number(req.params.cardId));
  res.json({ ok: true, favorited: false });
});

router.get('/favorites/:cardId', authMiddleware, (req: AuthRequest, res: Response) => {
  ensureTable();
  const row = getDb()
    .prepare('SELECT 1 FROM word_favorites WHERE user_id = ? AND card_id = ?')
    .get(req.userId, Number(req.params.cardId));
  res.json({ favorited: !!row });
});

router.get('/favorites', authMiddleware, (req: AuthRequest, res: Response) => {
  ensureTable();
  const rows = getDb()
    .prepare(`
      SELECT f.id, f.card_id, f.deck_id, f.created_at, d.name AS deck_name, n.fields
      FROM word_favorites f
      LEFT JOIN cards c ON c.id = f.card_id
      LEFT JOIN notes n ON n.id = c.note_id
      LEFT JOIN decks d ON d.id = f.deck_id
      WHERE f.user_id = ?
      ORDER BY f.id DESC
      LIMIT 500
    `)
    .all(req.userId) as any[];
  res.json(
    rows.map((r) => ({
      id: r.id,
      cardId: r.card_id,
      deckId: r.deck_id,
      deckName: r.deck_name || '',
      ...parseFields(r.fields),
      createdAt: r.created_at,
    }))
  );
});

/* ───────────── 错题本 ───────────── */

router.post('/wrong', authMiddleware, (req: AuthRequest, res: Response) => {
  ensureTable();
  const cardId = Number((req.body as any)?.cardId);
  if (!cardId) {
    res.status(400).json({ error: '缺少 cardId' });
    return;
  }
  const card = ownCard(req.userId, cardId);
  if (!card) {
    res.status(404).json({ error: '卡片不存在' });
    return;
  }
  getDb()
    .prepare(`
      INSERT INTO wrong_book (user_id, card_id, deck_id, wrong_count, resolved, last_wrong_at)
      VALUES (?, ?, ?, 1, 0, unixepoch())
      ON CONFLICT(user_id, card_id) DO UPDATE SET
        wrong_count = wrong_count + 1,
        resolved = 0,
        last_wrong_at = unixepoch()
    `)
    .run(req.userId, cardId, card.deck_id ?? null);
  res.json({ ok: true });
});

router.get('/wrong', authMiddleware, (req: AuthRequest, res: Response) => {
  ensureTable();
  const rows = getDb()
    .prepare(`
      SELECT w.id, w.card_id, w.deck_id, w.wrong_count, w.resolved, w.last_wrong_at,
             d.name AS deck_name, n.fields
      FROM wrong_book w
      LEFT JOIN cards c ON c.id = w.card_id
      LEFT JOIN notes n ON n.id = c.note_id
      LEFT JOIN decks d ON d.id = w.deck_id
      WHERE w.user_id = ? AND w.resolved = 0
      ORDER BY w.last_wrong_at DESC
      LIMIT 500
    `)
    .all(req.userId) as any[];
  res.json(
    rows.map((r) => ({
      id: r.id,
      cardId: r.card_id,
      deckId: r.deck_id,
      deckName: r.deck_name || '',
      wrongCount: r.wrong_count,
      lastWrongAt: r.last_wrong_at,
      ...parseFields(r.fields),
    }))
  );
});

/**
 * 举一反三（2026-11-06）
 * ─────────────────────────────────────────────────────────
 * GET /api/wordbook/insight          → 我错得最多的那几个字，各自亏在哪几条义项上
 * GET /api/wordbook/insight/:char    → 单个字的完整拆解（全部义项例句 + 已掌握/未掌握）
 *
 * 数据来自 wrong_insight 表，由 scripts/wrong_insight.js 每日从 wrong_book 反算：
 *   · wrong_defs 他已经栽过的那几条义项（错的）
 *   · lines      这个字全部义项的例句，missed=1 表示这一条还没拿下
 *   · confused   最易混的两条义项，一句话说清区别
 * 错题本只告诉学生「这个字我错了 67 次」，这里告诉他「你错了 67 次，但 12 条义项
 * 你只碰过 5 条，剩下 7 条一次都没考过」——后者才是有用的信息。
 */
function ensureInsightTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS wrong_insight (
      user_id    INTEGER NOT NULL,
      char       TEXT NOT NULL,
      wrong_n    INTEGER NOT NULL DEFAULT 0,
      wrong_defs TEXT NOT NULL DEFAULT '[]',
      total_defs INTEGER NOT NULL DEFAULT 0,
      coverage   REAL NOT NULL DEFAULT 0,
      lines      TEXT NOT NULL DEFAULT '[]',
      confused   TEXT NOT NULL DEFAULT '',
      tip        TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, char)
    );
  `);
}

function j<T>(s: string, d: T): T {
  try { return JSON.parse(s) as T; } catch { return d; }
}

router.get('/insight', authMiddleware, (req: AuthRequest, res: Response) => {
  ensureInsightTable();
  const rows = getDb()
    .prepare(`SELECT char, wrong_n, wrong_defs, total_defs, coverage, lines, confused, tip
                FROM wrong_insight WHERE user_id = ? ORDER BY wrong_n DESC LIMIT 60`)
    .all(req.userId) as any[];
  res.json(
    rows.map((r) => {
      const lines = j<any[]>(r.lines, []);
      return {
        char: r.char,
        wrongN: r.wrong_n,
        wrongDefs: j<string[]>(r.wrong_defs, []),
        totalDefs: r.total_defs,
        coverage: r.coverage,
        /* 还没拿下几条 —— 前端就靠这个数字告诉学生「还剩几条」
           分母必须是 lines.length 而不是 total_defs：lines 只收有例句的义项，
           拿 total_defs 当分母会和 missedN 对不上，进度条看着自相矛盾。 */
        missedN: lines.filter((x) => x.missed).length,
        lineTotal: lines.length,
        sample: lines.filter((x) => x.missed).slice(0, 2).map((x) => ({ def: x.def, sent: x.sent })),
        confused: r.confused,
        tip: r.tip,
      };
    })
  );
});

router.get('/insight/:char', authMiddleware, (req: AuthRequest, res: Response) => {
  ensureInsightTable();
  const r = getDb()
    .prepare(`SELECT char, wrong_n, wrong_defs, total_defs, coverage, lines, confused, tip
                FROM wrong_insight WHERE user_id = ? AND char = ?`)
    .get(req.userId, String(req.params.char)) as any;
  if (!r) {
    res.status(404).json({ error: '这个字还没有错误记录' });
    return;
  }
  res.json({
    char: r.char,
    wrongN: r.wrong_n,
    wrongDefs: j<string[]>(r.wrong_defs, []),
    totalDefs: r.total_defs,
    coverage: r.coverage,
    lines: j<any[]>(r.lines, []),
    confused: r.confused,
    tip: r.tip,
  });
});

router.post('/wrong/:cardId/resolve', authMiddleware, (req: AuthRequest, res: Response) => {
  ensureTable();
  getDb()
    .prepare('UPDATE wrong_book SET resolved = 1 WHERE user_id = ? AND card_id = ?')
    .run(req.userId, Number(req.params.cardId));
  res.json({ ok: true });
});

router.delete('/wrong/:cardId', authMiddleware, (req: AuthRequest, res: Response) => {
  ensureTable();
  getDb()
    .prepare('DELETE FROM wrong_book WHERE user_id = ? AND card_id = ?')
    .run(req.userId, Number(req.params.cardId));
  res.json({ ok: true });
});

export default router;
