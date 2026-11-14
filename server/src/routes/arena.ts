import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { AuthRequest } from '../middleware/auth';
import { addCoins, getCoins, isUnlimitedCoins, ARENA_DAILY_COIN_CAP, arenaEarnedToday, arenaRemainingToday } from '../lib/coins';

/**
 * 竞技场 · 单人训练（P2 深度服务端化）
 *
 * 设计要点：
 *  - 5 题型（s2m/m2s/cloze/judge/couplet）出题与判分全部在服务端完成，
 *    复刻 TrainingPageV2 的 buildQuestion / makeCloze / splitVerse 逻辑（移植到 server）。
 *  - 出题时把每题「正确答案 + 选项」算好存进 arena_sessions.question_data，
 *    但 start 接口返回给前端的题目不含 answer；answer 接口才揭晓正确答案。
 *  - 经济：入场 -3（arena_entry），逐题判分不立即发币，finish/abandon 统一结算
 *    按 correct_count 发 arena_correct（封顶 = 题量，天然防刷）。
 *  - 所有接口经 authMiddleware 鉴权；start 失败（余额不足/出题失败）不落 session、不扣费。
 */

const router = Router();

/** 单人入场费（2026-10-19 按需求 6 → 3） */
const ENTRY_FEE = 3;
const ALLOWED_MODES = ['s2m', 'm2s', 'cloze', 'judge', 'couplet'];
const ALLOWED_COUNTS = [5, 10, 15];

/** 孤儿局清扫阈值：一题未答满 15 分钟 → 全额退入场费（未消费） */
const SWEEP_REFUND_IDLE_SEC = 15 * 60;
/** 已答过题满 45 分钟 → 按已答对结算，入场费不退（已消费） */
const SWEEP_ABANDON_IDLE_SEC = 45 * 60;
/** 定时清扫间隔 10 分钟 */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
/** 惰性清扫最小间隔：避免 /home 每次请求都扫库 */
const SWEEP_LAZY_MIN_GAP_MS = 60 * 1000;

/** 当前 Unix 秒 */
function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/* ═══════════════════════════ 文本工具（移植自 TrainingPageV2） ═══════════════════════════ */

/** 去掉 markup / 加粗 / 高亮，得到纯文本 */
function plainText(s: string): string {
  return (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/==(.+?)==/g, '$1')
    .trim();
}

/** 随机打乱（不修改原数组） */
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
const PUNC_RE = /[\s，。、；：？！“”‘’（）《》「」『』【】·—…~`"'_,.!?:;()[\]{}<>/\\|-]/g;
function norm(s: string): string {
  return (s || '').replace(PUNC_RE, '').trim().toLowerCase();
}

/** 提取考点字（**加粗** 的重点字词）；取不到返回 null */
function extractKeyword(f0: string): string | null {
  const raw = String(f0 || '');
  const strip = (s: string) => s.replace(/<[^>]+>/g, '').trim();
  const m1 = raw.match(/\*\*([^*]+)\*\*/);
  if (m1) {
    const kw = strip(m1[1]).replace(/\*\*/g, '');
    if (kw && kw.length >= 1 && kw.length <= 6) return kw;
  }
  const m2 = raw.match(/中的[“"]([^”"]{1,6})[”"]/);
  if (m2) return m2[1];
  const m3 = raw.match(/[“"]([^”"]{1,8})[”"]/);
  if (m3) return m3[1];
  return null;
}

/** 把例句中的考点字挖成 `____`，得到默写题干；失败返回 null */
function makeCloze(card: SCard): string | null {
  if (!card.kw) return null;
  let base = plainText(card.f0);
  if (/是什么意思|意思是/.test(base)) {
    const q = base.match(/[“"]([^”"]{2,80})[”"]/);
    if (!q) return null;
    base = q[1];
  }
  base = base.trim();
  if (!base.includes(card.kw)) return null;
  return base.split(card.kw).join('____');
}

/** 名句切分：返回「上句 / 下句 / 出处」，切不出返回 null */
function splitVerse(f0: string): { head: string; tail: string; source: string } | null {
  let s = plainText(f0).trim();
  if (/是什么意思|意思是/.test(s)) return null;
  let source = '';
  const sm = s.match(/[（(]?《([^》]{1,20})》[）)]?/);
  if (sm) {
    source = `《${sm[1]}》`;
    s = s.replace(sm[0], '').trim();
  }
  const parts = s.split(/[，。、；？！]/).map((x) => x.trim()).filter((x) => x.length >= 3);
  if (parts.length < 2) return null;
  const head = parts[0];
  const tail = parts.slice(1).join('，');
  if (head.length < 3 || tail.length < 3 || head.length > 40 || tail.length > 40) return null;
  return { head, tail, source };
}

/** 是否是「……是什么意思？」问句式 */
function isQuestionForm(s: string): boolean {
  return /是什么意思|意思是/.test(String(s || ''));
}

/** 判断更像文言句子还是义项释义 */
function looksLikeSentence(s: string): boolean {
  const t = (s || '').trim();
  if (!t) return false;
  if (/《|》/.test(t)) return true;
  if (/[，。；？！、]/.test(t)) return true;
  return t.length >= 9;
}

function pushUnique(arr: string[], v: string): void {
  if (v && !arr.includes(v)) arr.push(v);
}

/** 从例句中提取《书名》出处 */
function extractBookSource(text: string): string {
  const m = (text || '').match(/《([^》]{1,20})》/);
  return m ? `《${m[1]}》` : '';
}

/* ═══════════════════════════ 卡片模型 ═══════════════════════════ */

interface SCard {
  id: number;
  /** 原始 f0（保留 markup） */
  f0: string;
  /** 原始 f1（义项） */
  f1: string;
  /** 原始 f2（译文） */
  f2: string;
  /** 考点字 */
  kw: string | null;
}

interface Pools {
  meanings: string[];
  sentences: string[];
  /** 【2026-11-06 题库扩充】按字索引的全局义项池。
   *  学生自己的卡少时，干扰项只从他这几十条里挑，排掉两个就只剩一个答案，
   *  题目等于白送。这里补一个「同字不同义」的池子——同一个字的其他意思
   *  才是真会混的干扰项，比随便挑一条不相干的义项有效得多。 */
  byChar: Map<string, string[]>;
}

/** 从全局题库 arena_bank 取「同字不同义」，按需惰性加载并缓存 */
let bankCache: Map<string, string[]> | null = null;
function getBank(): Map<string, string[]> {
  if (bankCache) return bankCache;
  bankCache = new Map();
  try {
    const db = getDb();
    const rows = db
      .prepare('SELECT char, def FROM arena_bank WHERE def_len BETWEEN 2 AND 30')
      .all() as { char: string; def: string }[];
    for (const r of rows) {
      if (!bankCache.has(r.char)) bankCache.set(r.char, []);
      pushUnique(bankCache.get(r.char)!, r.def);
    }
  } catch {
    /* 表还没建（脚本没跑过）就退化成只用本卡组，不影响出题 */
  }
  return bankCache;
}

/** 构建干扰项池：本卡组义项 + 本卡组例句 + 全局同字义项 */
function buildPools(cards: SCard[]): Pools {
  const meanings: string[] = [];
  const sentences: string[] = [];
  const byChar = new Map<string, string[]>();
  for (const c of cards) {
    const m = plainText(c.f1);
    if (m.length <= 30) pushUnique(meanings, m);
  }
  for (const c of cards) {
    const s = plainText(c.f0);
    if (s.length <= 42 && !isQuestionForm(s)) pushUnique(sentences, s);
  }
  /* 本卡组里已经出现的字，先把它自己的义项攒起来 */
  for (const c of cards) {
    if (!c.kw) continue;
    const m = plainText(c.f1);
    if (m.length > 30) continue;
    if (!byChar.has(c.kw)) byChar.set(c.kw, []);
    pushUnique(byChar.get(c.kw)!, m);
  }
  return { meanings, sentences, byChar };
}

/** 挑 n 个干扰项：优先同组候选，不足时退回 fallback 池 */
function pickDistractors(correct: string, preferred: string[], fallback: string[], n: number): string[] {
  const seen = new Set<string>([norm(correct)]);
  const out: string[] = [];
  const take = (pool: string[]) => {
    for (const s of shuffle(pool)) {
      if (out.length >= n) return;
      const t = String(s || '').trim();
      if (!t || t.length > 60) continue;
      const k = norm(t);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  };
  take(preferred);
  take(fallback);
  return out;
}

/** 该模式下哪些卡片可用（与前端 TrainingPageV2 一致） */
function eligibleCards(mode: string, cards: SCard[], pools: Pools): SCard[] {
  const base = cards.filter((c) => plainText(c.f0) && plainText(c.f1));
  switch (mode) {
    case 's2m':
      return base;
    case 'm2s':
      return base.length >= 2 ? base.filter((c) => !isQuestionForm(plainText(c.f0))) : [];
    case 'cloze':
      return base.filter((c) => makeCloze(c) !== null);
    case 'judge':
      return pools.meanings.length >= 2 ? base : [];
    case 'couplet':
      return base.filter((c) => splitVerse(c.f0) !== null);
    default:
      return [];
  }
}

/** 单题结构（服务端内部 + 存储用） */
interface BuiltQuestion {
  type: 'choice' | 'bool' | 'input';
  stem: string;
  stemPlain: string;
  keyword: string;
  source: string;
  meaning: string;
  options?: string[];
  hint?: string;
  reveal?: string;
  /** 正确答案（仅服务端存，不下发前端） */
  answer: string;
}

/** 构造单题；构造不出返回 null */
function buildQuestion(mode: string, card: SCard, cards: SCard[], pools: Pools): BuiltQuestion | null {
  const sentence = plainText(card.f0);
  const meaning = plainText(card.f1);
  const translation = plainText(card.f2);
  if (!sentence || !meaning) return null;
  const reveal = translation ? `译文：${translation}` : undefined;

  if (mode === 's2m') {
    // 看例句 → 选义项
    /* 干扰项优先级：本卡组义项 → 同字其他义项（全局题库）→ 全局义项池。
       同字的优先级高于全局，因为「这个字的另一个意思」才最容易选错。 */
    const preferred = cards.map((c) => plainText(c.f1));
    const sameChar = card.kw ? getBank().get(card.kw) || [] : [];
    const ds = pickDistractors(meaning, preferred, sameChar.concat(pools.meanings), 3);
    if (ds.length < 1) return null;
    const options = shuffle([meaning, ...ds]);
    return {
      type: 'choice',
      stem: card.f0,
      stemPlain: sentence,
      keyword: card.kw || '',
      source: extractBookSource(card.f0),
      meaning,
      options,
      reveal,
      answer: meaning,
    };
  }

  if (mode === 'm2s') {
    // 看义项 → 选例句
    if (isQuestionForm(sentence)) return null;
    const preferred = cards
      .filter((c) => c.id !== card.id && !isQuestionForm(plainText(c.f0)))
      .map((c) => plainText(c.f0));
    const fallback = pools.sentences.concat(pools.meanings);
    const ds = pickDistractors(sentence, preferred, fallback, 3);
    if (ds.length < 1) return null;
    const options = shuffle([sentence, ...ds]);
    return {
      type: 'choice',
      stem: card.f1,
      stemPlain: meaning,
      keyword: card.kw || '',
      source: '',
      meaning,
      options,
      reveal,
      answer: sentence,
    };
  }

  if (mode === 'cloze') {
    // 挖空 → 默写重点字词
    const masked = makeCloze(card);
    if (!masked || !card.kw) return null;
    return {
      type: 'input',
      stem: masked,
      stemPlain: masked,
      keyword: card.kw,
      source: extractBookSource(card.f0),
      meaning,
      hint: meaning.length > 60 ? `${meaning.slice(0, 57)}…` : meaning,
      reveal,
      answer: card.kw,
    };
  }

  if (mode === 'judge') {
    // 判断给出的义项对不对
    const wrongPool = cards
      .filter((c) => c.id !== card.id)
      .map((c) => plainText(c.f1))
      .concat(card.kw ? getBank().get(card.kw) || [] : [])
      .concat(pools.meanings)
      .filter((m) => norm(m) !== norm(meaning) && m.length <= 60);
    if (wrongPool.length < 1) return null;
    const truth = Math.random() < 0.5;
    const shown = truth ? meaning : wrongPool[Math.floor(Math.random() * wrongPool.length)];
    return {
      type: 'bool',
      stem: card.f0,
      stemPlain: sentence,
      keyword: card.kw || '',
      source: extractBookSource(card.f0),
      meaning,
      hint: shown,
      answer: truth ? 'true' : 'false',
      reveal: reveal ? `${reveal}\n正确释义：${meaning}` : `正确释义：${meaning}`,
    };
  }

  if (mode === 'couplet') {
    // 名句接龙
    const v = splitVerse(card.f0);
    if (!v) return null;
    return {
      type: 'input',
      stem: v.head,
      stemPlain: v.head,
      keyword: card.kw || '',
      source: v.source,
      meaning,
      hint: v.source ? `出处 ${v.source}` : undefined,
      reveal,
      answer: v.tail,
    };
  }

  return null;
}

/** 生成一组题（不重复用卡），构造不出返回空数组 */
function buildRound(mode: string, cards: SCard[], pools: Pools, size: number): BuiltQuestion[] {
  const pool = shuffle(eligibleCards(mode, cards, pools));
  const out: BuiltQuestion[] = [];
  const used = new Set<number>();
  for (const card of pool) {
    if (out.length >= size) break;
    if (used.has(card.id)) continue;
    const q = buildQuestion(mode, card, cards, pools);
    if (!q) continue;
    used.add(card.id);
    out.push(q);
  }
  return out;
}

/** 从 cards / notes 表取该用户的卡片（可选按 deck 过滤），解析成 SCard */
function loadCards(userId: number, deckId: number): SCard[] {
  const db = getDb();
  const rows = (
    deckId > 0
      ? db
          .prepare(
            `SELECT c.id AS id, n.fields AS fields
             FROM cards c JOIN notes n ON n.id = c.note_id
             WHERE c.user_id = ? AND c.deck_id = ?`
          )
          .all(userId, deckId)
      : db
          .prepare(
            `SELECT c.id AS id, n.fields AS fields
             FROM cards c JOIN notes n ON n.id = c.note_id
             WHERE c.user_id = ?`
          )
          .all(userId)
  ) as { id: number; fields: string }[];

  const cards: SCard[] = [];
  for (const row of rows) {
    let fields: string[] = [];
    try {
      fields = JSON.parse(row.fields || '[]');
    } catch {
      continue;
    }
    if (!Array.isArray(fields)) continue;
    const f0 = String(fields[0] ?? '');
    const f1 = String(fields[1] ?? '');
    if (!plainText(f0) || !plainText(f1)) continue;
    cards.push({
      id: Number(row.id),
      f0,
      f1,
      f2: String(fields[2] ?? ''),
      kw: extractKeyword(f0),
    });
  }
  return cards;
}

/* ═══════════════════════════ 孤儿局超时清扫 ═══════════════════════════ */

/**
 * 该 session 是否已有某类铜板流水（防重复退费/发奖的第二道闸）。
 * 状态守卫已能保证只处理一次，这里再按 coins_ledger.ref_id 兜一层，
 * 即使有人手工把 status 改回 open，也不会重复给钱。
 */
function hasLedger(sessionId: number, source: string): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT 1 AS x FROM coins_ledger WHERE source = ? AND ref_id = ? LIMIT 1')
    .get(source, sessionId) as { x: number } | undefined;
  return !!row;
}

/** 清扫单条记录 */
export interface SweepEntry {
  sessionId: number;
  userId: number;
  /** 本次实际发生的铜板变动（退费为 +entry_fee，结算为 +correct_count） */
  delta: number;
}

export interface SweepResult {
  /** 未作答 → 全额退入场费 */
  refunded: SweepEntry[];
  /** 已作答 → 按已答对结算 */
  abandoned: SweepEntry[];
  /** 被守卫拦下（状态已变/已给过钱）的条数 */
  skipped: number;
  /** 处理失败的条数 */
  failed: number;
}

/**
 * 清扫「钱扣了、局没结」的孤儿局。两类规则：
 *  1. status='open' && answered_count=0 且超过 refundIdleSec → 退回入场费（arena_refund）
 *     并标 status='refunded'（未消费 = 全额退）。
 *  2. status='open' && answered_count>0 且超过 abandonIdleSec → 按 correct_count 发奖
 *     （arena_correct，封顶题量）并标 status='abandoned'（已消费 = 按已答对结算，入场费不退）。
 *
 * 幂等：逐条独立事务，事务内二次校验 status='open' + 校验无同类流水；
 * UPDATE 也带 `AND status='open'` 条件，重复执行不会重复加钱。
 * 单条失败只记 failed 并继续，不影响其余记录与主流程。
 */
export function sweepOpenSessions(opts?: {
  refundIdleSec?: number;
  abandonIdleSec?: number;
}): SweepResult {
  const refundIdle = opts?.refundIdleSec ?? SWEEP_REFUND_IDLE_SEC;
  const abandonIdle = opts?.abandonIdleSec ?? SWEEP_ABANDON_IDLE_SEC;
  const out: SweepResult = { refunded: [], abandoned: [], skipped: 0, failed: 0 };
  const db = getDb();
  const now = nowSec();
  // 同一用户本批可能有多局，逐条累加当日已发额度，避免一次清扫把上限冲破
  const earnedToday = new Map<number, number>();

  const rows = db
    .prepare(
      `SELECT id, user_id, entry_fee, answered_count, correct_count, total_questions, created_at
       FROM arena_sessions
       WHERE status = 'open'
         AND ((answered_count = 0 AND created_at < ?) OR (answered_count > 0 AND created_at < ?))
       ORDER BY id`
    )
    .all(now - refundIdle, now - abandonIdle) as {
    id: number;
    user_id: number;
    entry_fee: number;
    answered_count: number;
    correct_count: number;
    total_questions: number;
    created_at: number;
  }[];

  for (const r of rows) {
    const sessionId = Number(r.id);
    const userId = Number(r.user_id);
    const duration = now - Number(r.created_at);
    const untouched = Number(r.answered_count) === 0;
    try {
      if (untouched) {
        // 一题未答 = 没消费掉任何题目 → 全额退入场费
        const fee = Number(r.entry_fee) || ENTRY_FEE;
        const ok = db.transaction((): boolean => {
          const cur = db.prepare('SELECT status FROM arena_sessions WHERE id = ?').get(sessionId) as
            | { status: string }
            | undefined;
          if (!cur || cur.status !== 'open') return false;
          if (hasLedger(sessionId, 'arena_refund')) return false;
          if (fee > 0) addCoins(userId, fee, 'arena_refund', sessionId);
          db.prepare(
            `UPDATE arena_sessions
             SET status = 'refunded', result_key = 'timeout_refund', reward = 0, duration_s = ?
             WHERE id = ? AND status = 'open'`
          ).run(duration, sessionId);
          return true;
        })();
        if (ok) out.refunded.push({ sessionId, userId, delta: fee });
        else out.skipped++;
      } else {
        // 答过题 = 已消费 → 按已答对发奖（封顶题量 + 每日上限），入场费不退
        const want = Math.min(Number(r.correct_count), Number(r.total_questions));
        const used = earnedToday.get(userId) ?? arenaEarnedToday(userId);
        // 管理员铜板无限，不受上限约束（否则后台自测会看到 reward 被截断）
        const reward = isUnlimitedCoins(userId) ? want : Math.min(want, Math.max(0, ARENA_DAILY_COIN_CAP - used));
        const ok = db.transaction((): boolean => {
          const cur = db.prepare('SELECT status FROM arena_sessions WHERE id = ?').get(sessionId) as
            | { status: string }
            | undefined;
          if (!cur || cur.status !== 'open') return false;
          if (hasLedger(sessionId, 'arena_correct')) return false;
          if (reward > 0) addCoins(userId, reward, 'arena_correct', sessionId);
          db.prepare(
            `UPDATE arena_sessions
             SET status = 'abandoned', result_key = 'timeout_abandon', reward = ?, score = ?, duration_s = ?
             WHERE id = ? AND status = 'open'`
          ).run(reward, Number(r.correct_count), duration, sessionId);
          return true;
        })();
        if (ok) {
          earnedToday.set(userId, used + reward);
          out.abandoned.push({ sessionId, userId, delta: reward });
        }
        else out.skipped++;
      }
    } catch (err: any) {
      out.failed++;
      console.error(`[arena.sweep] session ${sessionId} 处理失败:`, err?.message || err);
    }
  }
  return out;
}

/** 上次清扫时间（惰性触发限流用） */
let lastSweepAt = 0;

/** 包一层 try/catch：清扫永远不能影响主流程 */
function runSweepSafely(tag: string): void {
  lastSweepAt = Date.now();
  try {
    const r = sweepOpenSessions();
    if (r.refunded.length || r.abandoned.length || r.failed) {
      console.log(
        `[arena.sweep:${tag}] 退费 ${r.refunded.length} 笔 / 结算 ${r.abandoned.length} 笔 / 跳过 ${r.skipped} / 失败 ${r.failed}`
      );
    }
  } catch (err: any) {
    console.error(`[arena.sweep:${tag}] 清扫失败（已忽略，不影响主流程）:`, err?.message || err);
  }
}

// 定时清扫：每 10 分钟一次。
// unref() 让这个定时器不阻塞进程退出（systemd restart 时不会拖住关停）；
// 另在 exit 时 clearInterval。这里故意不监听 SIGTERM/SIGINT——一旦注册监听器就会
// 覆盖 Node 默认的信号退出行为，反而导致 systemctl restart 卡到超时被 SIGKILL。
const sweepTimer = setInterval(() => runSweepSafely('timer'), SWEEP_INTERVAL_MS);
sweepTimer.unref();
process.once('exit', () => clearInterval(sweepTimer));

/* ═══════════════════════════ 接口 ═══════════════════════════ */

/**
 * POST /start — 校验余额 ≥ 6 → 扣 6 → 出题（存 session）→ 返回不含 answer 的题目。
 * 余额不足 / 出题失败 → 不落 session、不扣费。
 */
router.post('/start', (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const mode =
      typeof req.body?.mode === 'string' && ALLOWED_MODES.includes(req.body.mode)
        ? req.body.mode
        : 's2m';
    const deckId = Number(req.body?.deckId) || 0;
    let count = Number(req.body?.count) || 10;
    if (!ALLOWED_COUNTS.includes(count)) count = 10;

    const db = getDb();
    if (getCoins(userId) < ENTRY_FEE) {
      res.status(400).json({ error: '铜板不足' });
      return;
    }

    const cards = loadCards(userId, deckId);
    const pools = buildPools(cards);
    const eligible = eligibleCards(mode, cards, pools);
    if (eligible.length < 1) {
      res.status(400).json({ error: '该范围暂无可练内容，换个卡组或先去学习新词' });
      return;
    }

    // 先出题（只读），失败则不扣费、不落库
    const questions = buildRound(mode, cards, pools, count);
    if (questions.length < 1) {
      res.status(400).json({ error: '题目生成失败，换个卡组或范围试试' });
      return;
    }
    const total = questions.length;

    // 落库 + 扣费（事务内原子，扣费失败自动回滚）
    const run = db.transaction((): { sessionId: number; balance: number } => {
      const info = db
        .prepare(
          `INSERT INTO arena_sessions
             (user_id, opponent_type, mode, deck_id, total_questions, entry_fee, status)
           VALUES (?, 'none', ?, ?, ?, ?, 'open')`
        )
        .run(userId, mode, deckId, total, ENTRY_FEE);
      const sessionId = Number(info.lastInsertRowid);
      // 扣入场费（余额不足会抛错，由事务回滚整段）
      addCoins(userId, -ENTRY_FEE, 'arena_entry', sessionId);
      // 存储题目（含正确答案，前端不接收）
      const stored = questions.map((q, i) => ({
        index: i,
        type: q.type,
        options: q.options,
        answer: q.answer,
      }));
      db.prepare('UPDATE arena_sessions SET question_data = ? WHERE id = ?').run(
        JSON.stringify(stored),
        sessionId
      );
      return { sessionId, balance: getCoins(userId) };
    });

    const out = run();
    // 下发前端的题目（去掉 answer 与内部字段）
    const publicQs = questions.map((q, i) => ({
      index: i,
      mode,
      type: q.type,
      stem: q.stem,
      stemPlain: q.stemPlain,
      keyword: q.keyword,
      source: q.source,
      meaning: q.meaning,
      ...(q.options ? { options: q.options } : {}),
      ...(q.hint !== undefined ? { hint: q.hint } : {}),
      ...(q.reveal !== undefined ? { reveal: q.reveal } : {}),
    }));
    res.json({ sessionId: out.sessionId, balance: out.balance, questions: publicQs });
  } catch (err: any) {
    const msg = err?.message || '开局失败';
    res.status(400).json({ error: msg });
  }
});

/**
 * POST /answer — 逐题判分（与 session 内存的正确答案比对）。
 * 顺序作答：index 必须等于已答题数；不立即发币，发币在 finish/abandon 统一结算。
 */
router.post('/answer', (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const sessionId = Number(req.body?.sessionId);
    const index = Number(req.body?.index);
    if (!Number.isInteger(sessionId) || !Number.isInteger(index) || index < 0) {
      res.status(400).json({ error: '参数不合法' });
      return;
    }

    const db = getDb();
    const session = db
      .prepare('SELECT * FROM arena_sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId) as any;
    if (!session) {
      res.status(404).json({ error: '对局不存在' });
      return;
    }
    if (session.status !== 'open') {
      res.status(400).json({ error: '本局已结束' });
      return;
    }
    if (index !== Number(session.answered_count)) {
      res.status(400).json({ error: '答题顺序不正确' });
      return;
    }

    let stored: { index: number; type: string; options?: string[]; answer: string }[] = [];
    try {
      stored = JSON.parse(session.question_data || '[]');
    } catch {
      stored = [];
    }
    const q = stored[index];
    if (!q) {
      res.status(404).json({ error: '题目不存在' });
      return;
    }

    const skip = req.body?.choice === undefined && req.body?.text === undefined;
    let correct = false;
    if (q.type === 'choice') {
      if (!skip) {
        const choice = Number(req.body?.choice);
        correct =
          Array.isArray(q.options) &&
          typeof q.options[choice] === 'string' &&
          norm(q.options[choice]) === norm(q.answer);
      }
    } else if (q.type === 'bool') {
      if (!skip) {
        const picked = Number(req.body?.choice) === 1 ? 'true' : 'false';
        correct = picked === q.answer;
      }
    } else {
      // input（cloze / couplet）
      if (!skip) {
        const text = String(req.body?.text ?? '').trim();
        correct = norm(text) === norm(q.answer);
      }
    }

    /* 【2026-10-22】看过「解析」的题不计入 correct_count。
       结算按 correct_count 发铜板（arena_correct），原来的做法等于允许
       点开解析抄答案再作答，奖励可以刷。前端把 hinted 一起传上来，
       这里只拒绝计分，仍然返回真实对错供学生查看。 */
    const hinted = req.body?.hinted === true;
    const counted = correct && !hinted;

    const newAnswered = Number(session.answered_count) + 1;
    const newCorrect = Number(session.correct_count) + (counted ? 1 : 0);
    db.prepare('UPDATE arena_sessions SET answered_count = ?, correct_count = ? WHERE id = ?').run(
      newAnswered,
      newCorrect,
      sessionId
    );

    res.json({
      correct,
      counted,
      correctAnswer: q.answer,
      index,
      answered: newAnswered,
      correctCount: newCorrect,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '判分失败' });
  }
});

/**
 * POST /abandon — 单人中途退出 / 离开页面兜底结算。两类语义（与 sweepOpenSessions 一致）：
 *  - answered_count = 0（一题未答，入场费未消费）→ 全额退还入场费（arena_refund，
 *    备注「练习未作答退费」；coins_ledger 无备注列，语义由 source + result_key 承载），
 *    status='refunded'、result_key='abandon_refund'。
 *  - answered_count > 0（已消费）→ 按 correct_count 发奖（arena_correct，封顶题量），
 *    入场费不退，status='abandoned'、result_key='abandon'。
 * 幂等：只有 status='open' 才结算；已 done/abandoned/refunded 一律回显既有结果、不重复发币；
 * 另按 coins_ledger.ref_id 再兜一层（hasLedger），UPDATE 也带 AND status='open'。
 */
router.post('/abandon', (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const sessionId = Number(req.body?.sessionId);
    if (!Number.isInteger(sessionId)) {
      res.status(400).json({ error: '参数不合法' });
      return;
    }
    const db = getDb();
    const run = db.transaction(() => {
      const session = db
        .prepare('SELECT * FROM arena_sessions WHERE id = ? AND user_id = ?')
        .get(sessionId, userId) as any;
      if (!session) return { notFound: true as const };
      // 状态守卫：非 open（done/abandoned/refunded/…）直接回显既有结果，绝不二次发奖
      if (session.status !== 'open') {
        return {
          closed: true as const,
          status: String(session.status),
          reward: Number(session.reward),
          correctCount: Number(session.correct_count),
        };
      }
      const duration = nowSec() - Number(session.created_at);
      // 一题未答 = 入场费一分没消费 → 全额退费（同清扫的「15 分钟未答退 6」语义）
      if (Number(session.answered_count) === 0) {
        const fee = Number(session.entry_fee) || ENTRY_FEE;
        if (fee > 0 && !hasLedger(sessionId, 'arena_refund')) {
          addCoins(userId, fee, 'arena_refund', sessionId);
        }
        db.prepare(
          `UPDATE arena_sessions
           SET status = 'refunded', result_key = 'abandon_refund', reward = 0, score = 0, duration_s = ?
           WHERE id = ? AND status = 'open'`
        ).run(duration, sessionId);
        return { refund: fee, reward: 0, want: 0, capped: false, correctCount: 0 };
      }
      // 答过题 = 已消费 → 按已答对发奖（封顶题量 + 每日上限），入场费不退
      const want = Math.min(Number(session.correct_count), Number(session.total_questions));
      const reward = isUnlimitedCoins(userId) ? want : Math.min(want, arenaRemainingToday(userId));
      if (reward > 0 && !hasLedger(sessionId, 'arena_correct')) {
        addCoins(userId, reward, 'arena_correct', sessionId);
      }
      db.prepare(
        `UPDATE arena_sessions
         SET status = 'abandoned', result_key = 'abandon', reward = ?, score = ?, duration_s = ?
         WHERE id = ? AND status = 'open'`
      ).run(reward, Number(session.correct_count), duration, sessionId);
      return {
        refund: 0,
        reward,
        want,
        capped: reward < want,
        dailyCap: ARENA_DAILY_COIN_CAP,
        correctCount: Number(session.correct_count),
      };
    });

    const out = run();
    if ('notFound' in out) {
      res.status(404).json({ error: '对局不存在' });
      return;
    }
    if ('closed' in out) {
      res.json({
        reward: out.reward,
        correctCount: out.correctCount,
        refund: 0,
        closed: true,
        status: out.status,
        message: '本局已结束',
      });
      return;
    }
    res.json({
      reward: out.reward,
      want: (out as any).want ?? out.reward,
      capped: !!(out as any).capped,
      dailyCap: ARENA_DAILY_COIN_CAP,
      correctCount: out.correctCount,
      refund: out.refund,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '放弃失败' });
  }
});

/**
 * POST /finish — 结算。按 correct_count 发 arena_correct（封顶题量），写 arena_sessions。
 * 幂等：只有 status='open' 才结算；已 done/abandoned/refunded 一律回显既有结果、不重复发币。
 */
router.post('/finish', (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const sessionId = Number(req.body?.sessionId);
    if (!Number.isInteger(sessionId)) {
      res.status(400).json({ error: '参数不合法' });
      return;
    }
    const db = getDb();
    const run = db.transaction(() => {
      const session = db
        .prepare('SELECT * FROM arena_sessions WHERE id = ? AND user_id = ?')
        .get(sessionId, userId) as any;
      if (!session) return { notFound: true as const };
      // 状态守卫：非 open（done/abandoned/refunded/…）直接回显既有结果，绝不二次发奖
      if (session.status !== 'open') {
        return {
          closed: true as const,
          status: String(session.status),
          reward: Number(session.reward),
          correctCount: Number(session.correct_count),
          total: Number(session.total_questions),
        };
      }
      // 每日上限：训练场每天最多 300 铜板，超出部分不再发放
      const want = Math.min(Number(session.correct_count), Number(session.total_questions));
      const reward = isUnlimitedCoins(userId) ? want : Math.min(want, arenaRemainingToday(userId));
      if (reward > 0) addCoins(userId, reward, 'arena_correct', sessionId);
      const duration = nowSec() - Number(session.created_at);
      db.prepare(
        `UPDATE arena_sessions
         SET status = 'done', result_key = 'finish', reward = ?, score = ?, duration_s = ?,
             answered_count = total_questions
         WHERE id = ?`
      ).run(reward, Number(session.correct_count), duration, sessionId);
      return {
        reward,
        want,
        capped: reward < want,
        dailyCap: ARENA_DAILY_COIN_CAP,
        correctCount: Number(session.correct_count),
        total: Number(session.total_questions),
      };
    });

    const out = run();
    if ('notFound' in out) {
      res.status(404).json({ error: '对局不存在' });
      return;
    }
    if ('closed' in out) {
      res.json({
        reward: out.reward,
        correctCount: out.correctCount,
        total: out.total,
        closed: true,
        status: out.status,
        message: '本局已结束',
      });
      return;
    }
    res.json({
      reward: out.reward,
      want: (out as any).want ?? out.reward,
      capped: !!(out as any).capped,
      dailyCap: ARENA_DAILY_COIN_CAP,
      correctCount: out.correctCount,
      total: out.total,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '结算失败' });
  }
});

/**
 * GET /home — 余额、今日单人题量/正确率、决斗战绩、段位。严禁返回假数据。
 */
router.get('/home', (req: AuthRequest, res: Response) => {
  try {
    // 惰性清扫：低频访问的站点也能及时清掉孤儿局（限流 1 分钟，内部已 try/catch）
    if (Date.now() - lastSweepAt >= SWEEP_LAZY_MIN_GAP_MS) runSweepSafely('home');

    const userId = req.userId!;
    const db = getDb();
    const balance = getCoins(userId);

    // 今日 0 点（北京时间）unix 秒
    const now = Math.floor(Date.now() / 1000);
    const bj = now + 8 * 3600;
    const dayStart = bj - (bj % 86400) - 8 * 3600;

    const agg = db
      .prepare(
        `SELECT COALESCE(SUM(total_questions), 0) AS tq, COALESCE(SUM(correct_count), 0) AS cc
         FROM arena_sessions
         WHERE user_id = ? AND opponent_type = 'none' AND created_at >= ?`
      )
      .get(userId, dayStart) as { tq: number; cc: number };
    const todayQuestions = Number(agg.tq) || 0;
    const todayCorrect = Number(agg.cc) || 0;
    const accuracy = todayQuestions > 0 ? Math.round((todayCorrect / todayQuestions) * 100) : 0;

    // 决斗战绩（复用 battles 表，按得分判定胜负）
    const rows = db
      .prepare(
        `SELECT player1_id, p1_answered, p1_correct, p2_answered, p2_correct
         FROM battles WHERE (player1_id = ? OR player2_id = ?) AND status = 'finished'`
      )
      .all(userId, userId) as {
      player1_id: number;
      p1_answered: number;
      p1_correct: number;
      p2_answered: number;
      p2_correct: number;
    }[];
    const calcScore = (answered: number, correct: number): number =>
      !answered || answered <= 0 ? 0 : Math.round(correct + (correct * correct) / answered);
    let wins = 0;
    let losses = 0;
    let draws = 0;
    for (const r of rows) {
      const s1 = calcScore(r.p1_answered, r.p1_correct);
      const s2 = calcScore(r.p2_answered, r.p2_correct);
      const my = r.player1_id === userId ? s1 : s2;
      const op = r.player1_id === userId ? s2 : s1;
      if (my > op) wins++;
      else if (my < op) losses++;
      else draws++;
    }

    // 段位只看真人胜场（沿用前端同款映射）
    const tierKey = wins >= 10 ? 'diamond' : wins >= 6 ? 'gold' : wins >= 3 ? 'silver' : 'bronze';
    const tierName = tierKey === 'diamond' ? '钻石' : tierKey === 'gold' ? '黄金' : tierKey === 'silver' ? '白银' : '青铜';
    const tierColor =
      tierKey === 'diamond' ? '#3b82f6' : tierKey === 'gold' ? '#f59e0b' : tierKey === 'silver' ? '#94a3b8' : '#b45309';

    res.json({
      balance,
      today: { questions: todayQuestions, correct: todayCorrect, accuracy },
      battle: { total: rows.length, wins, losses, draws },
      rank: { key: tierKey, name: tierName, color: tierColor },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '获取首页数据失败' });
  }
});

export default router;
