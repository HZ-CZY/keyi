import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { AuthRequest } from '../middleware/auth';
import { addCoins, todayCn } from '../lib/coins';

/**
 * 实词大赛（一站到底玩法）
 * ─────────────────────────────────────────────────────────
 * 规则：从用户的「文言实词」牌组连续抽选择题（看例句中的实词 → 选正确释义），
 *       答对继续、答错或超时即结束。成绩 = 本次连续答对题数，排行榜记「历史最高答题数」。
 * 判分：题目与正确答案全部存在服务端（contest_runs.question_data），前端拿不到答案，
 *       逐题 POST /answer 由服务端判分，无法本地改分。
 */

const router = Router();

/** 每题限时（秒）——超时按答错处理 */
const PER_QUESTION_SEC = 15;
/** 单局最多出题数（词库 869 张，够用） */
/* 【2026-10-11】解除 150 题封顶。
   原先前端写死 start(150)、这里默认也是 150，答满 150 题后【没题了】就结束
   （contest_runs 里最高纪录正好停在 150，9994 局都是 150 题）。
   题库「文言文150实词2.1」实有 869 张，现改为默认出满题库全量。
   实际取题数 = min(want, 题库大小)（见 buildQuestions 的 Math.min），
   所以这里给 869 只是上限；题库将来扩充时把这个数一起调大即可。 */
const MAX_QUESTIONS = 869;
const DEFAULT_QUESTIONS = 869;

/* ───────────── 文本工具 ───────────── */

function plainText(s: string): string {
  return (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/==(.+?)==/g, '$1')
    .trim();
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/** 答案比对用的归一化：忽略大小写、空白与中英文标点 */
const PUNC_RE = /[\s，。、；：？！“”‘’（）《》「」『』【】·—…~`"',.!?:;()[\]{}<>/\\|-]/g;
function norm(s: string): string {
  return (s || '').replace(PUNC_RE, '').trim().toLowerCase();
}

/** 提取考点字（**加粗** 的重点字词）；取不到返回空串 */
function extractKeyword(f0: string): string {
  const raw = String(f0 || '');
  const strip = (s: string) => s.replace(/<[^>]+>/g, '').trim();
  const m1 = raw.match(/\*\*([^*]+)\*\*/);
  if (m1) {
    const kw = strip(m1[1]).replace(/\*\*/g, '');
    if (kw && kw.length >= 1 && kw.length <= 6) return kw;
  }
  const m2 = raw.match(/[“"]([^”"]{1,8})[”"]/);
  if (m2) return m2[1];
  return '';
}

/* ───────────── 题目构建 ───────────── */

interface StoredQuestion {
  /** 带 markup 的例句（前端渲染重点字高亮） */
  stem: string;
  /** 重点字 */
  keyword: string;
  options: { label: string; text: string }[];
  /** 正确选项标签 A/B/C/D */
  correctLabel: string;
  /** 正确释义（判分后回传前端展示） */
  meaning: string;
  /** 出处《书名》，可选 */
  source: string;
}

const LABELS = ['A', 'B', 'C', 'D'];

/**
 * 连对数 → 每题限时（秒）：答得越多，时间越紧。
 *   0~19 题 15s ／ 20~49 题 10s ／ 50~99 题 6s ／ 100 题起 5s
 */
export function timeLimitForStreak(streak: number): number {
  /* 【2026-10-11】新增 150 / 200 两档：解封到题库全量后，高分段需要更紧的节奏。
     连对 100~149 题 5s ／ 150~199 题 3.5s ／ 200 题起 2.5s */
  if (streak >= 200) return 2.5;
  if (streak >= 150) return 3.5;
  if (streak >= 100) return 5;
  if (streak >= 50) return 6;
  if (streak >= 20) return 10;
  return 15;
}

/** 提速阶梯（下发给前端展示） */
export const TIME_LADDER = [
  { from: 0, sec: 15, label: '开局' },
  { from: 20, sec: 10, label: '答对 20 题' },
  { from: 50, sec: 6, label: '答对 50 题' },
  { from: 100, sec: 5, label: '答对 100 题' },
  { from: 150, sec: 3.5, label: '答对 150 题' },
  { from: 200, sec: 2.5, label: '答对 200 题' },
];

/** 解析用户的「文言实词」牌组：名字含「实词」、卡片最多的那个 */
function resolveContestDeckId(userId: number): number | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT d.id AS id, (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS cnt
       FROM decks d
       WHERE d.user_id = ? AND d.name LIKE '%实词%'
       ORDER BY cnt DESC, d.id ASC LIMIT 1`
    )
    .get(userId) as { id: number; cnt: number } | undefined;
  return row && Number(row.cnt) > 0 ? Number(row.id) : null;
}

/**
 * 生成题目：看例句 → 选释义（4 选项，1 正确 + 3 干扰）。
 * **干扰项优先取「同一个字（重点字）」的其它义项**，不足 3 个再从该牌组整体释义池补；
 * 释义不足 3 个的卡片跳过。
 */
function buildQuestions(userId: number, deckId: number, want: number): StoredQuestion[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.id AS id, n.fields AS fields
       FROM cards c JOIN notes n ON n.id = c.note_id
       WHERE c.user_id = ? AND c.deck_id = ?`
    )
    .all(userId, deckId) as { id: number; fields: string }[];

  const cards: { id: number; f0: string; meaning: string; kw: string }[] = [];
  for (const r of rows) {
    let fields: string[] = [];
    try {
      fields = JSON.parse(r.fields || '[]');
    } catch {
      continue;
    }
    if (!Array.isArray(fields)) continue;
    const f0 = String(fields[0] ?? '');
    const meaning = plainText(fields[1] ?? '');
    if (!plainText(f0) || !meaning) continue;
    cards.push({ id: Number(r.id), f0, meaning, kw: extractKeyword(f0) });
  }
  if (cards.length < 4) return [];

  // 全牌组释义池（兜底干扰项来源）：去重、限长
  const meaningPool: string[] = [];
  for (const c of cards) {
    if (c.meaning.length <= 40 && !meaningPool.some((x) => norm(x) === norm(c.meaning))) {
      meaningPool.push(c.meaning);
    }
  }

  // 同字释义池：同一个重点字（**X**）的各个义项 —— 干扰项优先从这里取
  const keywordPools = new Map<string, string[]>();
  for (const c of cards) {
    if (!c.kw) continue;
    if (!keywordPools.has(c.kw)) keywordPools.set(c.kw, []);
    const arr = keywordPools.get(c.kw)!;
    if (c.meaning.length <= 40 && !arr.some((x) => norm(x) === norm(c.meaning))) arr.push(c.meaning);
  }

  const picked = shuffle(cards).slice(0, Math.min(want, cards.length));
  const questions: StoredQuestion[] = [];
  for (const c of picked) {
    // 干扰项：先「同一个字」的其它义项，不足再从整牌组释义池补
    const ds: string[] = [];
    const sameChar = c.kw ? keywordPools.get(c.kw) || [] : [];
    for (const pool of [sameChar, meaningPool]) {
      for (const m of shuffle(pool)) {
        if (ds.length >= 3) break;
        if (norm(m) === norm(c.meaning)) continue;
        if (ds.some((d) => norm(d) === norm(m))) continue;
        ds.push(m);
      }
      if (ds.length >= 3) break;
    }
    if (ds.length < 3) continue;

    const opts = shuffle([c.meaning, ...ds]);
    const correctIdx = opts.findIndex((o) => o === c.meaning);
    if (correctIdx < 0) continue;
    const srcMatch = c.f0.match(/《([^》]{1,20})》/);
    questions.push({
      stem: c.f0,
      keyword: c.kw,
      options: opts.map((text, i) => ({ label: LABELS[i], text })),
      correctLabel: LABELS[correctIdx],
      meaning: c.meaning,
      source: srcMatch ? `《${srcMatch[1]}》` : '',
    });
  }
  return questions;
}

/* ───────────── 结算 ───────────── */

interface FinalizeResult {
  best: number;
  newRecord: boolean;
}

/** 结束一局：写入 best_score（取历史最高），plays+1。事务内完成。 */
function finalizeRun(
  db: ReturnType<typeof getDb>,
  runId: number,
  userId: number,
  score: number
): FinalizeResult {
  const now = Math.floor(Date.now() / 1000);
  return db.transaction((): FinalizeResult => {
    db.prepare(`UPDATE contest_runs SET status = 'over' WHERE id = ? AND status = 'open'`).run(runId);
    const cur = db.prepare('SELECT best_score FROM contest_scores WHERE user_id = ?').get(userId) as
      | { best_score: number }
      | undefined;
    const prevBest = cur ? Number(cur.best_score) : 0;
    const newRecord = score > prevBest;
    if (cur) {
      if (newRecord) {
        db.prepare(
          'UPDATE contest_scores SET best_score = ?, best_at = ?, plays = plays + 1, updated_at = ? WHERE user_id = ?'
        ).run(score, now, now, userId);
      } else {
        db.prepare('UPDATE contest_scores SET plays = plays + 1, updated_at = ? WHERE user_id = ?').run(
          now,
          userId
        );
      }
    } else {
      db.prepare(
        'INSERT INTO contest_scores (user_id, best_score, plays, best_at, updated_at) VALUES (?, ?, 1, ?, ?)'
      ).run(userId, score, now, now);
    }
    return { best: Math.max(prevBest, score), newRecord };
  })();
}

/* ───────────── 奖励结算（2026-10-24） ───────────── */

/** 结算日（北京时间 YYYY-MM-DD）：当天 00:00 起触发一次性结算 */
const PRIZE_SETTLE_DATE = '2026-10-24';
/** 参与奖励的名次数 */
const PRIZE_TOP_N = 20;
/** 参与奖：答对 ≥1 题即可获得（与名次奖叠加） */
const PRIZE_PARTICIPATION = 100;
/** 奖池展示金额（对外文案「瓜分 N 铜板」） */
const PRIZE_POOL = 30000;

/** 名次 → 铜板奖励 */
export function prizeForRank(rank: number): number {
  if (rank === 1) return 3666;
  if (rank === 2) return 2222;
  if (rank === 3) return 1666;
  if (rank <= 10) return 1111;
  if (rank <= PRIZE_TOP_N) return 666;
  return 0;
}

/** 奖励档位（下发给前端展示） */
export const PRIZE_TIERS = [
  { label: '第 1 名', amount: 3666 },
  { label: '第 2 名', amount: 2222 },
  { label: '第 3 名', amount: 1666 },
  { label: '第 4 ~ 10 名', amount: 1111 },
  { label: '第 11 ~ 20 名', amount: 666 },
];

/**
 * 预计奖励 = 名次奖 + 参与奖。
 * 参与奖门槛：答对 ≥1 题（bestScore >= 1）；名次奖仅前 20 名。
 */
function projectedPrize(bestScore: number, rank: number | null): number {
  if (bestScore < 1) return 0;
  const tier = rank && rank <= PRIZE_TOP_N ? prizeForRank(rank) : 0;
  return tier + PRIZE_PARTICIPATION;
}

/**
 * 到期且未结算 → 按当前排行榜前 20 名发铜板并写入 contest_prizes。
 * 幂等：contest_prizes 存在任意行即视为已结算；写入与发币在同一事务内。
 * @returns 本次是否真正完成了结算
 */
export function settleContestPrizes(force = false): boolean {
  try {
    const db = getDb();
    if (!force && todayCn() < PRIZE_SETTLE_DATE) return false;
    const done = db.prepare('SELECT COUNT(*) AS c FROM contest_prizes').get() as { c: number };
    if (Number(done.c) > 0) return false;

    // 参赛者 = 答对过至少 1 题；前 20 名额外拿名次奖，其余只拿参与奖
    const players = db
      .prepare(
        `SELECT cs.user_id AS user_id, cs.best_score AS best_score
         FROM contest_scores cs JOIN users u ON u.id = cs.user_id
         WHERE cs.best_score >= 1 AND u.id <> 1
         ORDER BY cs.best_score DESC, cs.best_at ASC, cs.user_id ASC`
      )
      .all() as { user_id: number; best_score: number }[];
    if (players.length === 0) return false;

    const now = Math.floor(Date.now() / 1000);
    let paidCount = 0;
    let paidTotal = 0;
    db.transaction(() => {
      // 并发二次校验：已有行则直接跳过，保证只结算一次
      const again = db.prepare('SELECT COUNT(*) AS c FROM contest_prizes').get() as { c: number };
      if (Number(again.c) > 0) return;
      /* 【2026-10-11 并列名次 / 并列同奖】同一 best_score 取同一名次档位。
         例：151,150,150,150,150,98 → 名次 1,2,2,2,2,6，
         前 5 名都按「第 2 名」档发 2222，而不是被拆成 2/3/4/5/6 名档。
         rank = 0 表示「仅参与奖」（并列名次本身已超出前 PRIZE_TOP_N）。 */
      let _sLast: number | null = null;
      let _sRank = 0;
      players.forEach((p, i) => {
        const _sc = Number(p.best_score);
        if (_sc !== _sLast) {
          _sRank = i + 1;
          _sLast = _sc;
        }
        const rank = _sRank <= PRIZE_TOP_N ? _sRank : 0; // 0 = 仅参与奖
        const amount = (rank > 0 ? prizeForRank(rank) : 0) + PRIZE_PARTICIPATION;
        db.prepare(
          'INSERT INTO contest_prizes (user_id, rank, amount, best_score, settled_at) VALUES (?, ?, ?, ?, ?)'
        ).run(Number(p.user_id), rank, amount, Number(p.best_score), now);
        addCoins(Number(p.user_id), amount, 'contest_prize', rank || null);
        paidCount += 1;
        paidTotal += amount;
      });
    })();
    console.log(`[contest] 奖励已结算：${paidCount} 人 / ${paidTotal} 铜板（${PRIZE_SETTLE_DATE}）`);
    return true;
  } catch (e: any) {
    console.error('[contest] 奖励结算失败：', e?.message || e);
    return false;
  }
}

/** 惰性结算检查限流：同一进程 60s 最多检查一次 */
let lastSettleCheck = 0;
const SETTLE_CHECK_GAP_MS = 60 * 1000;

/* ───────────── 路由 ───────────── */

/** POST /start — 开一局，返回 runId + 题目（不含答案） */
router.post('/start', (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const db = getDb();
    const deckId = resolveContestDeckId(userId);
    if (!deckId) {
      res.status(400).json({ error: '还没有「文言实词」词库，先去学习吧' });
      return;
    }

    let want = Number(req.body?.limit) || DEFAULT_QUESTIONS;
    if (!Number.isFinite(want)) want = DEFAULT_QUESTIONS;
    want = Math.max(10, Math.min(Math.floor(want), MAX_QUESTIONS));

    const questions = buildQuestions(userId, deckId, want);
    if (questions.length < 4) {
      res.status(400).json({ error: '题目生成失败：词库内容不足' });
      return;
    }

    const info = db
      .prepare('INSERT INTO contest_runs (user_id, question_data) VALUES (?, ?)')
      .run(userId, JSON.stringify(questions));
    const runId = Number(info.lastInsertRowid);

    const publicQs = questions.map((q, i) => ({
      index: i,
      stem: q.stem,
      keyword: q.keyword,
      source: q.source,
      options: q.options,
      /** 本题限时：按当前连对数从快慢阶梯取值（前端倒计时用它） */
      timeLimit: timeLimitForStreak(i),
    }));
    res.json({
      runId,
      perQuestionSec: PER_QUESTION_SEC,
      timeLadder: TIME_LADDER,
      total: questions.length,
      questions: publicQs,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '开局失败' });
  }
});

/** POST /answer — 逐题判分。顺序作答：index 必须等于已答对题数。 */
router.post('/answer', (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const db = getDb();
    const runId = Number(req.body?.runId);
    const index = Number(req.body?.index);
    const label = typeof req.body?.label === 'string' ? req.body.label : '';
    const timeout = !!req.body?.timeout;

    if (!Number.isInteger(runId) || !Number.isInteger(index) || index < 0) {
      res.status(400).json({ error: '参数不合法' });
      return;
    }

    const run = db
      .prepare('SELECT id, user_id, question_data, answered_count, status FROM contest_runs WHERE id = ? AND user_id = ?')
      .get(runId, userId) as
      | { id: number; user_id: number; question_data: string; answered_count: number; status: string }
      | undefined;
    if (!run) {
      res.status(404).json({ error: '对局不存在' });
      return;
    }
    if (run.status !== 'open') {
      res.status(409).json({ error: '对局已结束' });
      return;
    }
    if (index !== Number(run.answered_count)) {
      res.status(409).json({ error: '答题顺序错误' });
      return;
    }

    let questions: StoredQuestion[] = [];
    try {
      questions = JSON.parse(run.question_data || '[]');
    } catch {
      questions = [];
    }
    const q = questions[index];

    // 题目答完（全部答对）→ 通关，结算
    if (!q) {
      const fin = finalizeRun(db, runId, userId, Number(run.answered_count));
      res.json({
        correct: false,
        cleared: true,
        finished: true,
        correctLabel: '',
        correctMeaning: '',
        score: Number(run.answered_count),
        best: fin.best,
        newRecord: fin.newRecord,
      });
      return;
    }

    const correct = !timeout && label === q.correctLabel;
    if (correct) {
      const next = Number(run.answered_count) + 1;
      db.prepare('UPDATE contest_runs SET answered_count = ? WHERE id = ?').run(next, runId);
      res.json({
        correct: true,
        correctLabel: q.correctLabel,
        correctMeaning: q.meaning,
        score: next,
        nextIndex: next,
      });
      return;
    }

    // 答错 / 超时 → 结束
    const fin = finalizeRun(db, runId, userId, Number(run.answered_count));
    res.json({
      correct: false,
      finished: true,
      correctLabel: q.correctLabel,
      correctMeaning: q.meaning,
      chosenLabel: label,
      timedOut: timeout,
      score: Number(run.answered_count),
      best: fin.best,
      newRecord: fin.newRecord,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '判分失败' });
  }
});

/** POST /abandon — 主动结束（中途退出），按当前连对数结算 */
router.post('/abandon', (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const db = getDb();
    const runId = Number(req.body?.runId);
    if (!Number.isInteger(runId)) {
      res.status(400).json({ error: '参数不合法' });
      return;
    }
    const run = db
      .prepare('SELECT id, answered_count, status FROM contest_runs WHERE id = ? AND user_id = ?')
      .get(runId, userId) as { id: number; answered_count: number; status: string } | undefined;
    if (!run) {
      res.status(404).json({ error: '对局不存在' });
      return;
    }
    if (run.status !== 'open') {
      res.json({ score: Number(run.answered_count), best: null, newRecord: false, alreadyOver: true });
      return;
    }
    const score = Number(run.answered_count);
    const fin = finalizeRun(db, runId, userId, score);
    res.json({ score, best: fin.best, newRecord: fin.newRecord });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '结束失败' });
  }
});

/** GET /leaderboard — 按历史最高答题数排名（TOP20 + 我）+ 奖励信息 */
router.get('/leaderboard', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();

    // 到期惰性结算（限流检查）：2026-10-24 起首次访问即完成一次性发奖
    const nowMs = Date.now();
    if (nowMs - lastSettleCheck > SETTLE_CHECK_GAP_MS) {
      lastSettleCheck = nowMs;
      settleContestPrizes();
    }

    const rows = db
      .prepare(
        `SELECT u.id AS id, u.username AS username, u.avatar_url AS avatar_url,
                COALESCE(u.is_teacher, 0) AS is_teacher,
                COALESCE(u.badge_label, '') AS badge_label,
                cs.best_score AS best_score
         FROM contest_scores cs
         JOIN users u ON u.id = cs.user_id
         WHERE cs.best_score > 0 AND u.id <> 1
         ORDER BY cs.best_score DESC, cs.best_at ASC, u.id ASC
         LIMIT 20`
      )
      .all() as any[];

    // 已结算 → 展示实际发放额；未结算 → 展示按当前名次的预计奖励
    const prizeRows = db
      .prepare('SELECT user_id, amount, settled_at FROM contest_prizes')
      .all() as { user_id: number; amount: number; settled_at: number }[];
    const settled = prizeRows.length > 0;
    const prizeMap = new Map<number, number>();
    let settledAt: number | null = null;
    for (const p of prizeRows) {
      prizeMap.set(Number(p.user_id), Number(p.amount));
      settledAt = Number(p.settled_at);
    }

    /* 【2026-10-11 并列名次】同一 best_score 视为并列（标准竞赛排名 1,2,2,2,5）。
       rows 已按 best_score DESC 排好，所以「名次 = 上一个不同分数的下标 + 1」，
       等价于「比它高的人数 + 1」—— 与下方 me.rank 的算法口径一致。
       原实现是裸的 i+1（不并列），会出现 5 个 150 题被强行排出 2/3/4/5/6 名。 */
    let _lastScore: number | null = null;
    let _lastRank = 0;
    const list = rows.map((r, i) => {
      const _sc = Number(r.best_score);
      if (_sc !== _lastScore) {
        _lastRank = i + 1;
        _lastScore = _sc;
      }
      const rank = _lastRank;
      return {
        rank,
        id: r.id,
        username: r.username,
        avatar_url: r.avatar_url || '',
        is_teacher: !!r.is_teacher,
        badge_label: r.badge_label || '',
        count: Number(r.best_score),
        prize: settled ? prizeMap.get(Number(r.id)) || 0 : projectedPrize(Number(r.best_score), rank),
      };
    });

    const mine = db
      .prepare('SELECT best_score, plays FROM contest_scores WHERE user_id = ?')
      .get(req.userId) as { best_score: number; plays: number } | undefined;
    const myBest = mine ? Number(mine.best_score) : 0;
    let rank: number | null = null;
    if (myBest > 0) {
      const r = db
        .prepare(
          `SELECT COUNT(*) + 1 AS rank
           FROM contest_scores cs JOIN users u ON u.id = cs.user_id
           WHERE cs.best_score > ? AND u.id <> 1`
        )
        .get(myBest) as { rank: number } | undefined;
      rank = r ? Number(r.rank) : null;
    }

    res.json({
      list,
      me: {
        rank,
        best: myBest,
        plays: mine ? Number(mine.plays) : 0,
        prize: settled ? prizeMap.get(req.userId!) || 0 : projectedPrize(myBest, rank),
      },
      prize: {
        settleDate: PRIZE_SETTLE_DATE,
        topN: PRIZE_TOP_N,
        tiers: PRIZE_TIERS,
        participation: PRIZE_PARTICIPATION,
        pool: PRIZE_POOL,
        participationNote: `答对 ≥1 题即可获参与奖 ${PRIZE_PARTICIPATION} 铜板，可与名次奖叠加`,
        settled,
        settledAt,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '排行榜读取失败' });
  }
});

export default router;
