import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { AuthRequest } from '../middleware/auth';
import { addCoins, getCoins } from '../lib/coins';
import {
  applyDuelResult,
  duelProfile,
  ensureDuelTable,
  getDuelRating,
  myRank,
} from '../lib/duel-rating';

/**
 * 决斗场（Battle）—— 仿百词斩「抢词」的在线真人匹配 PK 对战。
 *
 * 设计要点（铜板经济版）：
 *  - 对局数据全部落在 battles 表，题目在开局时一次性生成并存入 question_data（JSON）。
 *  - 匹配真人：入场费 50 铜板。命中已有 waiting 局则扣费撮合（playing）；
 *    否则自建 waiting 局（fee_paid1=1）。
 *  - 1 分钟（MATCH_TIMEOUT_SECONDS）无真人加入 → 对局过期（expired），退还发起人 50；
 *    前端据此展示「匹配失败」。
 *  - 对局开始后 5 分钟（MATCH_FORCE_FINISH_SECONDS）未分出胜负 → 强结兜底：
 *    未完成一方按当前已答得分结算，防对手中途离场悬挂。
 *  - 结算：分高者赢 +100；平局双方各退已付入场费；败方不退费。
 *  - better-sqlite3 是同步 API；所有「扣款 + 状态变更」都包在 db.transaction 内保证原子。
 */

const router = Router();

/** 每局题量（新真人 PK 赛制：5 题） */
const TOTAL_QUESTIONS = 5;
/** 决斗场入场费（铜板） */
const ENTRY_FEE = 50;
/** 胜者奖励（铜板） */
const WIN_REWARD = 100;
/** 匹配等待秒数：超过即对局过期并退还入场费 */
const MATCH_TIMEOUT_SECONDS = 60;
/** 私房有效期：开房后 10 分钟内有效（等人、发码、对方登录都要时间） */
const ROOM_TIMEOUT_SECONDS = 600;
/** 对局开始后强结秒数（5 分钟） */
const MATCH_FORCE_FINISH_SECONDS = 300;
/** 单题限时（秒）：超时按答错记，服务端自动过题，避免一方挂机拖死对局 */
const QUESTION_TIME_SECONDS = 25;
/** 单题超时宽限（秒）：容忍轮询间隔（POLL_MS=2s）与网络抖动，防止 25.0s 边界误判 */
const QUESTION_GRACE_SECONDS = 2;
/** 过期 waiting 局定时清扫间隔（毫秒）：用户取消/掉线遗留的局最多卡 ~60s 即自动退款 */
const SWEEP_INTERVAL_MS = 30 * 1000;

/* ── 嘲讽（2026-10-19）────────────────────────────────────────
   商城商品 battle_taunt 解锁；文案全部写在服务端，客户端只传下标：
   既避免自由输入出现辱骂，也方便以后改文案不用发客户端版本。 */
const TAUNTS = [
  '这题我闭眼都会',
  '手速有点慢哦',
  '稳住，别慌',
  '这波我先走一步',
  '承让承让',
  '再来一局？',
];
/** 每局最多发几条（防刷屏） */
const TAUNT_MAX_PER_BATTLE = 3;
/** 两条之间的最小间隔（秒） */
const TAUNT_COOLDOWN_SECONDS = 8;

/** 是否已解锁「决斗嘲讽包」 */
function ownsTauntPack(userId: number): boolean {
  const db = getDb();
  return !!db
    .prepare(
      "SELECT 1 FROM shop_purchases WHERE user_id = ? AND item_key = 'battle_taunt' AND status = 'active' LIMIT 1"
    )
    .get(userId);
}

/** 单题结构（存入 question_data） */
interface BattleQuestion {
  stem: string;
  source: string;
  keyword: string;
  options: string[];
  answerIndex: number;
}

/** battles 表行结构 */
interface BattleRow {
  id: number;
  player1_id: number;
  player2_id: number | null;
  player2_is_bot: number;
  status: string;
  question_data: string;
  bot_results: string;
  bot_answer_ms: number;
  total_questions: number;
  p1_answered: number;
  p1_correct: number;
  p2_answered: number;
  p2_correct: number;
  p1_finished: number;
  p2_finished: number;
  fee_paid1: number;
  fee_paid2: number;
  started_at: number | null;
  finished_at: number | null;
  expired_at: number | null;
  winner_id: number | null;
  created_at: number;
  /** 玩家各自的完成时刻（Unix 秒）；用于「同分按用时更短者胜」判负；未完成为 NULL */
  p1_finish_at: number | null;
  p2_finish_at: number | null;
  /** 玩家每人逐题作答记录 JSON：[{ i:number, correct:boolean, ts:number }]；新赛制计分依据；旧局为 NULL */
  p1_answers: string | null;
  p2_answers: string | null;
  /** 每人逐题「开始作答时刻」JSON（ms 数组，下标=题号）；单题限时用；旧局为 NULL */
  p1_q_start?: string | null;
  p2_q_start?: string | null;
  /** 私房邀请码（6 位）；随机匹配的公开局为 NULL */
  room_code?: string | null;
  /** 1 = 私房，不参与随机匹配 */
  is_private?: number;
}

/* ── 工具函数 ────────────────────────────────────────────────── */

/** 当前 Unix 秒 */
function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * 幂等补记「每人完成时刻」列（P3 同分按时间判负用）。
 * battles 表原本不记录 duration，这里在不改动任何费用常量的前提下，
 * 用 ALTER TABLE 补两列（已存在则静默忽略）。模块内只跑一次。
 */
let battleColsEnsured = false;
function ensureBattleColumns(): void {
  if (battleColsEnsured) return;
  const db = getDb();
  try {
    db.prepare('ALTER TABLE battles ADD COLUMN p1_finish_at INTEGER').run();
  } catch {
    /* 列已存在则忽略 */
  }
  try {
    db.prepare('ALTER TABLE battles ADD COLUMN p2_finish_at INTEGER').run();
  } catch {
    /* 列已存在则忽略 */
  }
  try {
    db.prepare('ALTER TABLE battles ADD COLUMN p1_answers TEXT').run();
  } catch {
    /* 列已存在则忽略 */
  }
  try {
    db.prepare('ALTER TABLE battles ADD COLUMN p2_answers TEXT').run();
  } catch {
    /* 列已存在则忽略 */
  }
  // 单题限时用：每人逐题「开始作答时刻」（JSON 数组，ms 时间戳，下标=题号）
  try {
    db.prepare('ALTER TABLE battles ADD COLUMN p1_q_start TEXT').run();
  } catch {
    /* 列已存在则忽略 */
  }
  try {
    db.prepare('ALTER TABLE battles ADD COLUMN p2_q_start TEXT').run();
  } catch {
    /* 列已存在则忽略 */
  }
  /* 2026-11-06 好友开房间（反馈 #21/#70/#71/#72/#95/#155）
     room_code = 6 位邀请码；is_private = 1 表示不接受随机匹配，只能凭码加入。
     随机匹配的 SQL 里必须带 `room_code IS NULL`，否则私房会被陌生人撞进来。 */
  try {
    db.prepare('ALTER TABLE battles ADD COLUMN room_code TEXT').run();
  } catch {
    /* 列已存在则忽略 */
  }
  try {
    db.prepare('ALTER TABLE battles ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0').run();
  } catch {
    /* 列已存在则忽略 */
  }
  try {
    db.prepare('CREATE INDEX IF NOT EXISTS idx_battles_room_code ON battles(room_code)').run();
  } catch {
    /* 忽略 */
  }
  battleColsEnsured = true;
}

/** 解析逐题「开始作答时刻」JSON（容错：空/非法 → 空数组） */
function parseQStart(raw: string | null | undefined): (number | null)[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
  } catch {
    return [];
  }
}

/**
 * 给某人的第 index 题「开始计时」（幂等：已有开始时刻不覆盖）。
 * 在取题接口与轮询状态里都会调用，保证两端都能把时钟打上。
 */
function stampQuestionStart(battle: BattleRow, isP1: boolean, index: number): void {
  const db = getDb();
  const col = isP1 ? 'p1_q_start' : 'p2_q_start';
  const raw = isP1 ? battle.p1_q_start : battle.p2_q_start;
  const arr = parseQStart(raw);
  while (arr.length <= index) arr.push(null);
  if (arr[index] != null) return;
  arr[index] = Date.now();
  db.prepare(`UPDATE battles SET ${col} = ? WHERE id = ?`).run(JSON.stringify(arr), battle.id);
  if (isP1) battle.p1_q_start = JSON.stringify(arr);
  else battle.p2_q_start = JSON.stringify(arr);
}

/** 计算某人当前题的截止时刻（ms）；没开始计时返回 null */
function questionDeadlineMs(battle: BattleRow, isP1: boolean): number | null {
  const answered = isP1 ? battle.p1_answered : battle.p2_answered;
  const total = battle.total_questions || TOTAL_QUESTIONS;
  if (answered >= total) return null;
  const arr = parseQStart(isP1 ? battle.p1_q_start : battle.p2_q_start);
  const start = arr[answered];
  return start == null ? null : start + QUESTION_TIME_SECONDS * 1000;
}

/**
 * 单题超时处理（幂等）：某人当前题已超时且仍未作答 → 补记一条「答错」记录并推进。
 * 由 GET /:id 轮询与取题接口惰性触发；不写 p*_correct（超时不算对）。
 * @returns 是否真的补记了超时
 */
function applyQuestionTimeout(battleId: number, userId: number): boolean {
  const db = getDb();
  const battle = db.prepare('SELECT * FROM battles WHERE id = ?').get(battleId) as BattleRow | undefined;
  if (!battle || battle.status !== 'playing') return false;
  const isP1 = battle.player1_id === userId;
  const answered = isP1 ? battle.p1_answered : battle.p2_answered;
  const total = battle.total_questions || TOTAL_QUESTIONS;
  if (answered >= total) return false;
  const deadline = questionDeadlineMs(battle, isP1);
  if (deadline == null) return false;
  if (Date.now() < deadline + QUESTION_GRACE_SECONDS * 1000) return false;

  const cur = parseAnswers(isP1 ? battle.p1_answers : battle.p2_answers);
  if (cur.some((a) => a.i === answered)) return false; // 已作答（防重）
  cur.push({ i: answered, correct: false, ts: Date.now() });

  const newAnswered = answered + 1;
  const newFinished = newAnswered >= total ? 1 : 0;
  const answersJson = JSON.stringify(cur);
  const now = nowSec();
  if (isP1) {
    db.prepare(
      'UPDATE battles SET p1_answered = ?, p1_finished = ?, p1_finish_at = ?, p1_answers = ? WHERE id = ?'
    ).run(newAnswered, newFinished, newFinished ? now : battle.p1_finish_at, answersJson, battleId);
  } else {
    db.prepare(
      'UPDATE battles SET p2_answered = ?, p2_finished = ?, p2_finish_at = ?, p2_answers = ? WHERE id = ?'
    ).run(newAnswered, newFinished, newFinished ? now : battle.p2_finish_at, answersJson, battleId);
  }
  return true;
}

/** 去掉 ==高亮== 标记，返回纯文本 */
function stripMarkers(text: string): string {
  return (text || '').replace(/==/g, '').trim();
}

/** 从例句里提取出处《书名》，取不到返回空串（与前端 extractBookSource 保持一致） */
function extractBookSource(text: string): string {
  const m = (text || '').match(/《([^》]{1,20})》/);
  return m ? `《${m[1]}》` : '';
}

/** 从例句里提取 **重点字** */
function extractKeyword(text: string): string {
  const m = (text || '').match(/\*\*([^*]{1,10})\*\*/);
  return m ? m[1] : '';
}

/** Fisher–Yates 洗牌 */
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/**
 * 旧计分公式（仅作为「无逐题记录的老对局」回溯兜底，新赛制已退役）：
 * 得分 = 答对数 + 答对数² / 已答数，四舍五入取整。
 * @param answered 已答题数
 * @param correct 答对题数
 */
function calcScore(answered: number, correct: number): number {
  if (!answered || answered <= 0) return 0;
  return Math.round(correct + (correct * correct) / answered);
}

/** 单题逐题作答记录（存入 p1_answers / p2_answers 的 JSON 元素） */
interface QA {
  /** 题目索引（0-based） */
  i: number;
  /** 是否答对 */
  correct: boolean;
  /** 作答时间戳（Date.now() 毫秒），用于「同题先答对者得 20」判定 */
  ts: number;
}

/** 解析逐题答案 JSON（容错：空 / 非法 → 空数组，避免旧局缺列时崩溃） */
function parseAnswers(raw: string | null | undefined): QA[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x: any) => x && typeof x === 'object' && typeof x.i === 'number')
      .map((x: any) => ({
        i: Number(x.i),
        correct: x.correct === true,
        ts: typeof x.ts === 'number' ? x.ts : 0,
      }));
  } catch {
    return [];
  }
}

/** 计分数据源（BattleRow 与战绩行共用的最小结构） */
interface ScoreSource {
  p1_answered: number;
  p1_correct: number;
  p2_answered: number;
  p2_correct: number;
  p1_answers: string | null;
  p2_answers: string | null;
}

/**
 * 新赛制逐题计分（满分 100，5 题）：
 *  - 每题：双方都答对 → 先作答(ts 小)得 20、后得 10；仅一方对 → 该方 20；都错 → 各 0
 *  - ts 相等（同毫秒）时令 p1 优先得 20（用 `<=` 判先）
 * @param p1 玩家1逐题答案（长度不限，缺题视为未答）
 * @param p2 玩家2逐题答案
 */
function scoreBattle(p1: QA[], p2: QA[]): { p1: number; p2: number } {
  const map1 = new Map<number, QA>();
  for (const a of p1) map1.set(a.i, a);
  const map2 = new Map<number, QA>();
  for (const a of p2) map2.set(a.i, a);

  let s1 = 0;
  let s2 = 0;
  const indices = new Set<number>([...map1.keys(), ...map2.keys()]);
  for (const idx of indices) {
    const a1 = map1.get(idx);
    const a2 = map2.get(idx);
    const c1 = a1?.correct ?? false;
    const c2 = a2?.correct ?? false;
    if (c1 && c2) {
      const t1 = a1!.ts;
      const t2 = a2!.ts;
      if (t1 <= t2) {
        s1 += 20;
        s2 += 10;
      } else {
        s2 += 20;
        s1 += 10;
      }
    } else if (c1) {
      s1 += 20;
    } else if (c2) {
      s2 += 20;
    }
  }
  return { p1: s1, p2: s2 };
}

/**
 * 统一取分（兼容老对局）：双方都有逐题记录 → 用新 scoreBattle；
 * 老局缺 p1_answers / p2_answers（均为空）→ 退回旧 calcScore，保证历史战绩不变。
 */
function computeScores(s: ScoreSource): { p1: number; p2: number } {
  const a1 = parseAnswers(s.p1_answers);
  const a2 = parseAnswers(s.p2_answers);
  if (a1.length === 0 && a2.length === 0) {
    return {
      p1: calcScore(s.p1_answered, s.p1_correct),
      p2: calcScore(s.p2_answered, s.p2_correct),
    };
  }
  return scoreBattle(a1, a2);
}

/**
 * 出题：从该用户自己的卡牌里随机抽 10 张，生成 4 选 1 文言实词题。
 * @param userId 用户 ID
 * @throws 卡牌不足时抛出中文错误
 */
function buildQuestions(userId: number): BattleQuestion[] {
  const db = getDb();
  // 注意：fields 字段在 notes 表上，cards 只保存 note_id，必须 JOIN 取回。
  // 这里一次性取全量（869 张量级），用于「按同一小卡组出题」+「大干扰项池」。
  const rows = db
    .prepare(
      `SELECT c.deck_id AS deck_id, n.fields AS fields
       FROM cards c
       JOIN notes n ON n.id = c.note_id
       WHERE c.user_id = ? AND c.deck_id IN (SELECT id FROM decks WHERE user_id = ?)`
    )
    .all(userId, userId) as { deck_id: number; fields: string }[];

  const pool: { stem: string; meaning: string; keyword: string; deckId: number }[] = [];
  const seenStem = new Set<string>();
  for (const row of rows) {
    let fields: string[] = [];
    try {
      fields = JSON.parse(row.fields || '[]');
    } catch {
      continue;
    }
    if (!Array.isArray(fields)) continue;
    const stem = String(fields[0] ?? '').trim();
    // 义项去掉 == 高亮标记后截断 40 字
    const meaning = stripMarkers(String(fields[1] ?? '')).slice(0, 40);
    if (!stem || !meaning) continue;
    if (seenStem.has(stem)) continue; // 同例句去重，避免一局里出现重复题
    seenStem.add(stem);
    pool.push({ stem, meaning, keyword: extractKeyword(stem), deckId: row.deck_id });
  }

  if (pool.length < TOTAL_QUESTIONS) {
    throw new Error('卡牌数量不足，先去学习页攒卡牌');
  }

  // ① 按「重点字」分小卡组（与学习页 MCQ 的分组口径一致；无重点字的卡按所在牌组兜底分组）
  const groups = new Map<string, typeof pool>();
  for (const card of pool) {
    const key = card.keyword || `__deck_${card.deckId}`;
    const list = groups.get(key);
    if (list) list.push(card);
    else groups.set(key, [card]);
  }

  // ② 优先从「够出满一局」的同一小卡组里出题；没有这样的组才退回全池随机
  const eligible = Array.from(groups.values()).filter((g) => g.length >= TOTAL_QUESTIONS);
  const source = eligible.length > 0 ? eligible[Math.floor(Math.random() * eligible.length)] : pool;
  const picked = shuffle(source).slice(0, TOTAL_QUESTIONS);

  // ③ 干扰项池分两层（2026-09-12 二次调整：改成「同重点字优先当干扰项」）：
  //    同组池 = 本小卡组（同一重点字）的其它义项 → 考同字多义辨析，最像、最难；
  //    全池   = 所有卡释义（去重）→ 同组义项不够 3 个时兜底，保证选项数够。
  //    旧实现只从「另外 4 道题的答案」里取，导致 5 道题永远同一组释义、答案位置也有规律可背。
  const groupMeanings = Array.from(new Set(source.map((c) => c.meaning)));
  const allMeanings = Array.from(new Set(pool.map((c) => c.meaning)));

  return picked.map((item) => {
    const distractors = pickDistractors(item.meaning, groupMeanings, allMeanings, 3);
    const options = shuffle([item.meaning, ...distractors]);
    return {
      stem: item.stem,
      source: extractBookSource(item.stem),
      keyword: item.keyword,
      options,
      answerIndex: options.indexOf(item.meaning),
    };
  });
}

/**
 * 取干扰项：同重点字组优先，不足 3 个再用全池补齐。
 * @param correct 正确义项（必须排除）
 * @param groupMeanings 同一小卡组的义项集合（去重）
 * @param allMeanings 全部卡的义项集合（去重）
 * @param need 需要的干扰项个数
 */
function pickDistractors(
  correct: string,
  groupMeanings: string[],
  allMeanings: string[],
  need: number
): string[] {
  const out: string[] = [];
  for (const pool of [groupMeanings, allMeanings]) {
    for (const m of shuffle(pool)) {
      if (out.length >= need) break;
      if (m === correct || out.includes(m)) continue;
      out.push(m);
    }
    if (out.length >= need) break;
  }
  // 释义池实在不够的兜底（正常不会发生）
  while (out.length < need) out.push(`其他释义 ${out.length + 1}`);
  return out;
}

/** 读 question_data，失败返回空数组 */
function readQuestions(battle: BattleRow): BattleQuestion[] {
  try {
    const q = JSON.parse(battle.question_data || '[]');
    return Array.isArray(q) ? (q as BattleQuestion[]) : [];
  } catch {
    return [];
  }
}

/** 取一条属于我的对局，找不到返回 null */
function loadMyBattle(battleId: number, userId: number): BattleRow | null {
  const db = getDb();
  const battle = db
    .prepare('SELECT * FROM battles WHERE id = ? AND (player1_id = ? OR player2_id = ?)')
    .get(battleId, userId, userId) as BattleRow | undefined;
  return battle || null;
}

/**
 * 统一结算（幂等）：双方都完成，或对局开始已超过 5 分钟（强结）时触发。
 *  - 分高者赢：胜者 +100 铜板（source='battle_win'）
 *  - 平分：双方各退仍标记已付的入场费 50（source='battle_refund'，置 fee_paid=0）
 *  - 败方不退费
 * @returns 结算后的最新 BattleRow
 */
function settleBattle(battle: BattleRow): BattleRow {
  if (battle.status === 'finished') return battle;
  ensureBattleColumns();
  const db = getDb();
  const now = nowSec();
  const bothDone = battle.p1_finished === 1 && battle.p2_finished === 1;
  const forceTimeout =
    battle.status === 'playing' &&
    battle.started_at != null &&
    now - (battle.started_at || 0) >= MATCH_FORCE_FINISH_SECONDS;
  if (!bothDone && !forceTimeout) return battle;

  const runSettle = db.transaction((): BattleRow => {
    const fresh = db.prepare('SELECT * FROM battles WHERE id = ?').get(battle.id) as
      | BattleRow
      | undefined;
    if (!fresh || fresh.status === 'finished') return fresh || battle;

    const { p1: s1, p2: s2 } = computeScores(fresh);
    let winnerId: number | null = null;

    /* 【2026-11-12 好友房免费】私房（room_code 非空）不收入场费、不发胜利奖励、不计段位分。
       原因：两个人开房互刷，胜者 100 铜板就是零成本印钞；ELO 同理，朋友互刷能直接刷段位。
       公开匹配（room_code 为空）的扣费/奖励/积分逻辑一行不动。
       历史遗留：11-12 之前开的私房可能已扣过 50，这里先把钱退掉（幂等，fee_paidX 置 0）。 */
    const isPrivate = fresh.room_code != null;
    if (isPrivate) {
      if (fresh.fee_paid1 === 1) {
        addCoins(fresh.player1_id, ENTRY_FEE, 'battle_refund', fresh.id);
        db.prepare('UPDATE battles SET fee_paid1 = 0 WHERE id = ?').run(fresh.id);
        fresh.fee_paid1 = 0;
      }
      if (fresh.fee_paid2 === 1 && fresh.player2_id != null) {
        addCoins(fresh.player2_id, ENTRY_FEE, 'battle_refund', fresh.id);
        db.prepare('UPDATE battles SET fee_paid2 = 0 WHERE id = ?').run(fresh.id);
        fresh.fee_paid2 = 0;
      }
    }

    if (s1 > s2) {
      winnerId = fresh.player1_id;
      if (!isPrivate) addCoins(fresh.player1_id, WIN_REWARD, 'battle_win', fresh.id);
    } else if (s2 > s1) {
      winnerId = fresh.player2_id;
      if (!isPrivate && winnerId != null) addCoins(winnerId, WIN_REWARD, 'battle_win', fresh.id);
    } else if (s1 === s2) {
      /* 【2026-10-21】同分一律判平局，双方各退入场费。
         原逻辑用 finish_at 的毫秒先后决定 50 铜板归属 —— 学生完全感知不到
         （反馈 #253「平局怎么不退款」），而 20/10 计分下「答对题数不同」也可能总分相同，
         再拿交卷时刻分胜负过于隐蔽且不公平。 */
      if (fresh.fee_paid1 === 1) {
        addCoins(fresh.player1_id, ENTRY_FEE, 'battle_refund', fresh.id);
        db.prepare('UPDATE battles SET fee_paid1 = 0 WHERE id = ?').run(fresh.id);
      }
      if (fresh.fee_paid2 === 1 && fresh.player2_id != null) {
        addCoins(fresh.player2_id, ENTRY_FEE, 'battle_refund', fresh.id);
        db.prepare('UPDATE battles SET fee_paid2 = 0 WHERE id = ?').run(fresh.id);
      }
    }

    db.prepare("UPDATE battles SET status = 'finished', winner_id = ?, finished_at = ? WHERE id = ?").run(
      winnerId,
      now,
      fresh.id
    );

    /* 【2026-11-06 段位积分】真人局结算后更新双方 ELO。
       人机局（player2_id 为空）在 applyDuelResult 内部直接返回，不计分 ——
       否则新手可以靠刷人机刷到王者。
       好友房（私房）同样不计分：朋友之间互刷能把段位刷上去，见上面的说明。
       单独 try/catch：积分算挂了也不能让已经发出的铜板回滚。 */
    if (!isPrivate) {
      try {
        applyDuelResult(fresh.player1_id, fresh.player2_id, winnerId);
      } catch (e) {
        console.error('[duel] rating update failed:', e);
      }
    }

    return { ...fresh, status: 'finished', winner_id: winnerId, finished_at: now };
  });

  return runSettle();
}

/**
 * waiting 对局超过 60 秒 → 置为 expired 并退还发起人入场费（幂等，防重复退）。
 * @returns 处理后的最新 BattleRow
 */
function expireWaitingBattle(battle: BattleRow, now: number): BattleRow {
  if (battle.status !== 'waiting') return battle;
  const db = getDb();
  const runExpire = db.transaction((): BattleRow => {
    const fresh = db.prepare('SELECT * FROM battles WHERE id = ?').get(battle.id) as
      | BattleRow
      | undefined;
    if (!fresh) return battle;
    const res = db
      .prepare("UPDATE battles SET status = 'expired', expired_at = ? WHERE id = ? AND status = 'waiting'")
      .run(now, fresh.id);
    if (res.changes > 0 && fresh.fee_paid1 === 1) {
      addCoins(fresh.player1_id, ENTRY_FEE, 'battle_refund', fresh.id);
      db.prepare('UPDATE battles SET fee_paid1 = 0 WHERE id = ?').run(fresh.id);
    }
    return { ...fresh, status: 'expired', expired_at: now };
  });
  return runExpire();
}

/**
 * 清扫超过 MATCH_TIMEOUT_SECONDS 仍无人加入的 waiting 局（用户取消匹配后遗留 / 中途掉线）。
 * 逐局调用 expireWaitingBattle（幂等，只在等待态 → 过期态成功时退款一次）。
 * @returns 本次实际退款笔数
 */
function sweepStaleWaitingBattles(now = nowSec()): number {
  const db = getDb();
  ensureBattleColumns();
  const cutoff = now - MATCH_TIMEOUT_SECONDS;
  const roomCutoff = now - ROOM_TIMEOUT_SECONDS;
  /* 私房给 10 分钟窗口，公开匹配还是 60 秒：开个房等朋友进来，60 秒根本不够 */
  const stale = db
    .prepare(
      `SELECT * FROM battles
        WHERE status = 'waiting'
          AND ((room_code IS NULL AND created_at <= ?)
            OR (room_code IS NOT NULL AND created_at <= ?))
        ORDER BY id`
    )
    .all(cutoff, roomCutoff) as BattleRow[];
  let refunded = 0;
  for (const row of stale) {
    const before = row.fee_paid1;
    const after = expireWaitingBattle(row, now);
    if (before === 1 && after.fee_paid1 === 0) refunded += 1;
  }
  return refunded;
}

/** 把对局行整理成前端需要的状态 JSON */
function buildState(battle: BattleRow, userId: number) {
  const db = getDb();
  const isP1 = battle.player1_id === userId;
  const side: 'p1' | 'p2' = isP1 ? 'p1' : 'p2';

  const myAnswered = isP1 ? battle.p1_answered : battle.p2_answered;
  const myCorrect = isP1 ? battle.p1_correct : battle.p2_correct;
  const myFinished = isP1 ? battle.p1_finished : battle.p2_finished;
  const opAnswered = isP1 ? battle.p2_answered : battle.p1_answered;
  const opCorrect = isP1 ? battle.p2_correct : battle.p1_correct;
  const opFinished = isP1 ? battle.p2_finished : battle.p1_finished;

  // 新赛制逐题计分（运行总分，满分 100）；老局无逐题记录时自动退回旧计分
  const { p1, p2 } = computeScores(battle);
  const myScore = isP1 ? p1 : p2;
  const opScore = isP1 ? p2 : p1;

  // 逐题明细 rounds（仅当双方至少有逐题记录时填充，老局留空避免展示脏数据）
  const myAnswers = parseAnswers(isP1 ? battle.p1_answers : battle.p2_answers);
  const opAnswers = parseAnswers(isP1 ? battle.p2_answers : battle.p1_answers);
  const total = battle.total_questions || TOTAL_QUESTIONS;
  const rounds: Array<{ myCorrect: boolean; opCorrect: boolean; myPoints: number; opPoints: number }> = [];
  if (myAnswers.length > 0 || opAnswers.length > 0) {
    const myMap = new Map<number, QA>();
    for (const a of myAnswers) myMap.set(a.i, a);
    const opMap = new Map<number, QA>();
    for (const a of opAnswers) opMap.set(a.i, a);
    for (let i = 0; i < total; i++) {
      const a1 = myMap.get(i);
      const a2 = opMap.get(i);
      const c1 = a1?.correct ?? false;
      const c2 = a2?.correct ?? false;
      let myP = 0;
      let opP = 0;
      if (c1 && c2) {
        if (a1!.ts <= a2!.ts) {
          myP = 20;
          opP = 10;
        } else {
          opP = 20;
          myP = 10;
        }
      } else if (c1) {
        myP = 20;
      } else if (c2) {
        opP = 20;
      }
      rounds.push({ myCorrect: c1, opCorrect: c2, myPoints: myP, opPoints: opP });
    }
  }

  let opponentName = '等待中…';
  const otherId = isP1 ? battle.player2_id : battle.player1_id;
  if (otherId != null) {
    const u = db.prepare('SELECT username FROM users WHERE id = ?').get(otherId) as
      | { username: string }
      | undefined;
    opponentName = u ? u.username : '对手';
  }

  // 本局最近 5 条嘲讽（最新在前）。前端按 id 去重，只把「对方发的」弹成气泡。
  const tauntRows = db
    .prepare(
      'SELECT id, from_user_id, text_idx, created_at FROM battle_taunts WHERE battle_id = ? ORDER BY id DESC LIMIT 5'
    )
    .all(battle.id) as Array<{ id: number; from_user_id: number; text_idx: number; created_at: number }>;
  const taunts = tauntRows.map((t) => ({
    id: t.id,
    from: t.from_user_id === userId ? 'me' : 'op',
    text: TAUNTS[t.text_idx] || '',
    at: t.created_at,
  }));
  // 本局我已用掉几次（单独 count，避免最近 5 条被对方刷满后算错）
  const myTauntUsed = (
    db
      .prepare('SELECT COUNT(*) AS n FROM battle_taunts WHERE battle_id = ? AND from_user_id = ?')
      .get(battle.id, userId) as { n: number }
  ).n;

  return {
    id: battle.id,
    status: battle.status,
    /** 好友房（私房）：免费、无铜板奖励、不计段位分。前端据此改结算文案 */
    isPrivate: battle.room_code != null,
    totalQuestions: total,
    side,
    opponentName,
    me: {
      answered: myAnswered,
      correct: myCorrect,
      score: myScore,
      finished: myFinished === 1,
    },
    opponent: {
      answered: opAnswered,
      correct: opCorrect,
      score: opScore,
      finished: opFinished === 1,
    },
    winnerId: battle.winner_id,
    rounds,
    /** 我方当前题的截止时刻（ms 时间戳）；null = 未开始计时/已答完 */
    questionDeadline: questionDeadlineMs(battle, isP1),
    /** 单题限时秒数（前端倒计时用） */
    questionSeconds: QUESTION_TIME_SECONDS,
    /** 本局嘲讽记录（最新在前）：前端只弹 from==='op' 的 */
    taunts,
    /** 我方本局已发次数（前端算剩余次数用） */
    tauntUsed: myTauntUsed,
  };
}

/* ── 路由 ────────────────────────────────────────────────────── */

/**
 * GET /stats — 我参与过的 finished 对局战绩。
 * 必须注册在 GET /:id 之前，否则会被 /:id 吞掉。
 */
router.get('/stats', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const me = req.userId!;
    const rows = db
      .prepare(
        `SELECT player1_id, p1_answered, p1_correct, p2_answered, p2_correct,
                p1_answers, p2_answers
         FROM battles
         WHERE (player1_id = ? OR player2_id = ?) AND status = 'finished'`
      )
      .all(me, me) as {
      player1_id: number;
      p1_answered: number;
      p1_correct: number;
      p2_answered: number;
      p2_correct: number;
      p1_answers: string | null;
      p2_answers: string | null;
    }[];

    // 按双方逐题计分判定胜负（与结算一致，避免榜单计分漂移）
    let wins = 0;
    let losses = 0;
    let draws = 0;
    for (const row of rows) {
      const { p1, p2 } = computeScores(row);
      const myScore = row.player1_id === me ? p1 : p2;
      const opScore = row.player1_id === me ? p2 : p1;
      if (myScore > opScore) wins++;
      else if (myScore < opScore) losses++;
      else draws++;
    }
    res.json({
      total: rows.length,
      wins,
      losses,
      draws,
      /* 2026-11-06 段位系统：决斗场所有页面都从这里取段位，避免多处算法不一致 */
      duel: duelProfile(me, myRank(me) ?? undefined),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   私房 / 好友对战（2026-11-06）
   反馈 #21 / #70 / #71 / #72 / #95 / #155 六个人提了同一句话「开房间打 pk」，
   #24 / #25 补充「指定对手单挑」，#42 补充「好友对战少扣少赚」。
   实现上刻意复用现有 battles 流程：房间只是「带邀请码的 waiting 局」，
   开局后的答题、计分、结算完全走原来的路径，不新增一套状态机。
   ============================================================ */

/** 去掉 I/O/0/1 这类容易念错的字符，6 位够用且好口述 */
function genRoomCode(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i += 1) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

function uniqueRoomCode(db: any): string {
  for (let i = 0; i < 12; i += 1) {
    const code = genRoomCode();
    const dup = db
      .prepare(
        `SELECT 1 FROM battles WHERE room_code = ? AND status IN ('waiting','playing') LIMIT 1`
      )
      .get(code);
    if (!dup) return code;
  }
  // 极端情况：加时间后缀强制唯一
  return (genRoomCode() + Date.now().toString(36).toUpperCase()).slice(0, 8);
}

/**
 * POST /room — 建一个私房，返回 6 位邀请码
 * 【2026-11-12】好友房改为**完全免费**：开房不扣、加入不扣；结算不发奖励、不计段位分，
 * 平局也不用退款（本来就没收）。目的是掐掉「开房即扣 50、退出不退」的投诉，
 * 同时避免两人互刷铜板/段位。
 */
router.post('/room', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const me = req.userId!;
    const now = nowSec();
    ensureBattleColumns();
    ensureDuelTable();

    const playing = db
      .prepare(
        `SELECT id FROM battles WHERE status = 'playing' AND (player1_id = ? OR player2_id = ?)
         ORDER BY id DESC LIMIT 1`
      )
      .get(me, me) as { id: number } | undefined;
    if (playing) {
      res.status(400).json({ error: '你还有一局没打完' });
      return;
    }

    // 已有的私房直接复用，避免反复点「开房」扣多次费
    const mine = db
      .prepare(
        `SELECT id, room_code FROM battles
          WHERE status = 'waiting' AND player1_id = ? AND room_code IS NOT NULL
            AND created_at >= ?
          ORDER BY id DESC LIMIT 1`
      )
      .get(me, now - ROOM_TIMEOUT_SECONDS) as { id: number; room_code: string } | undefined;
    if (mine) {
      res.json({ ok: true, battleId: mine.id, roomCode: mine.room_code, reused: true });
      return;
    }

    // 遗留的过期私房先清掉，别让旧局占着入场费
    const stale = db
      .prepare(
        `SELECT * FROM battles WHERE status = 'waiting' AND player1_id = ?
           AND created_at < ?`
      )
      .all(me, now - (MATCH_TIMEOUT_SECONDS)) as BattleRow[];
    for (const s of stale) expireWaitingBattle(s, now);

    /* 【2026-11-12 好友房免费】开房不再收 50 入场费，也不校验余额 ——
       好友对战本身就是约着练手，收钱反而把「点错了还要等 10 分钟退款」的投诉喂出来
       （反馈 338/339/341/349）。对应地，结算也不发奖励、不计段位，见 settleBattle。 */
    const code = uniqueRoomCode(db);
    const questions = buildQuestions(me);
    const info = db
      .prepare(
        `INSERT INTO battles (player1_id, player2_id, player2_is_bot, status, question_data,
                              bot_results, bot_answer_ms, total_questions, created_at,
                              room_code, is_private, fee_paid1)
         VALUES (?, NULL, 0, 'waiting', ?, '[]', 4200, ?, ?, ?, 1, 0)`
      )
      .run(me, JSON.stringify(questions), questions.length, now, code);
    const battleId = Number(info.lastInsertRowid);

    res.json({ ok: true, battleId, roomCode: code, reused: false });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || '开房失败' });
  }
});

/**
 * POST /room/:code/join — 凭码加入私房
 */
router.post('/room/:code/join', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const me = req.userId!;
    const now = nowSec();
    ensureBattleColumns();
    const code = String(req.params.code || '').trim().toUpperCase();
    if (!code) {
      res.status(400).json({ error: '请输入邀请码' });
      return;
    }

    const battle = db
      .prepare(
        `SELECT * FROM battles
          WHERE room_code = ? AND status = 'waiting' AND player2_id IS NULL
          ORDER BY id DESC LIMIT 1`
      )
      .get(code) as BattleRow | undefined;

    if (!battle) {
      // 可能已经开局了（房主被别人抢先 / 自己重复点）→ 给出更准确的原因
      const settled = db
        .prepare(
          `SELECT * FROM battles WHERE room_code = ?
            AND status IN ('playing','finished') ORDER BY id DESC LIMIT 1`
        )
        .get(code) as BattleRow | undefined;
      if (settled && (settled.player1_id === me || settled.player2_id === me)) {
        res.json({ ok: true, battleId: settled.id, status: settled.status, alreadyIn: true });
        return;
      }
      res.status(400).json({ error: '房间不存在或已开始' });
      return;
    }

    if (battle.player1_id === me) {
      res.status(400).json({ error: '这是你自己开的房间' });
      return;
    }
    if (now - battle.created_at > ROOM_TIMEOUT_SECONDS) {
      expireWaitingBattle(battle, now);
      res.status(400).json({ error: '房间已过期，让对方重新开一个' });
      return;
    }
    const playing = db
      .prepare(
        `SELECT id FROM battles WHERE status = 'playing' AND (player1_id = ? OR player2_id = ?)
         ORDER BY id DESC LIMIT 1`
      )
      .get(me, me) as { id: number } | undefined;
    if (playing) {
      res.status(400).json({ error: '你还有一局没打完' });
      return;
    }

    /* 【2026-11-12 好友房免费】加入私房同样不扣 50，fee_paid2 固定 0 ——
       结算时据此判断不用退款，也不会发胜利奖励（见 settleBattle）。 */
    const ok = db.transaction(() => {
      const r = db
        .prepare(
          `UPDATE battles SET player2_id = ?, status = 'playing', started_at = ?, fee_paid2 = 0
            WHERE id = ? AND status = 'waiting' AND player2_id IS NULL`
        )
        .run(me, now, battle.id);
      return r.changes > 0;
    })();

    if (!ok) {
      res.status(400).json({ error: '慢了一步，房间已被别人加入' });
      return;
    }
    res.json({ ok: true, battleId: battle.id, status: 'playing' });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || '加入失败' });
  }
});

/**
 * GET /room/:code — 查房间状态（房主轮询「有人进来了吗」）
 */
router.get('/room/:code', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const me = req.userId!;
    ensureBattleColumns();
    const code = String(req.params.code || '').trim().toUpperCase();
    const battle = db
      .prepare(
        `SELECT b.*, u1.username AS p1name, u2.username AS p2name
           FROM battles b
           LEFT JOIN users u1 ON u1.id = b.player1_id
           LEFT JOIN users u2 ON u2.id = b.player2_id
          WHERE b.room_code = ? ORDER BY b.id DESC LIMIT 1`
      )
      .get(code) as any;
    if (!battle) {
      res.status(404).json({ error: '房间不存在' });
      return;
    }
    if (battle.player1_id !== me && battle.player2_id !== me) {
      res.status(403).json({ error: '你不在这个房间里' });
      return;
    }
    const expired =
      battle.status === 'waiting' && nowSec() - battle.created_at > ROOM_TIMEOUT_SECONDS;
    res.json({
      battleId: battle.id,
      roomCode: code,
      status: expired ? 'expired' : battle.status,
      hostName: battle.p1name,
      guestName: battle.p2name || null,
      isHost: battle.player1_id === me,
      startsIn: expired ? 0 : Math.max(0, ROOM_TIMEOUT_SECONDS - (nowSec() - battle.created_at)),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '查询失败' });
  }
});


/**
 * GET /feed — 全站实时战报（最近结算的对局，含真人 / 人机）。
 * 走现有 authMiddleware：登录即可查看；前端每 4s 轮询一次。
 */
router.get("/feed", (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    let limit = parseInt(String(req.query.limit ?? "6"), 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 6;
    if (limit > 10) limit = 10;

    // 【2026-10-19 实时战报】除了已结束的对局，把**正在打**的对局也带上，
    // 客户端才能显示「进行中 30:20」而不是只有打完的战报。
    // 排序：进行中优先（status='playing' 转成 1 参与 DESC），同类按最近活动时间。
    // 复用 scoreBattle 计分（computeScores 内部调用 scoreBattle）；
    // 旧局缺逐题记录时自动退回 calcScore 兜底，保证历史对局展示正确。
    const rows = db
      .prepare(
        `SELECT b.id, b.status, b.player1_id, b.player2_id, b.player2_is_bot, b.winner_id,
                b.finished_at, b.started_at, b.created_at, b.total_questions,
                b.p1_answered, b.p1_correct, b.p2_answered, b.p2_correct,
                b.p1_answers, b.p2_answers,
                u1.username AS p1_name, u2.username AS p2_name
         FROM battles b
         LEFT JOIN users u1 ON u1.id = b.player1_id
         LEFT JOIN users u2 ON u2.id = b.player2_id
         WHERE b.status IN ('playing', 'finished')
         ORDER BY (b.status = 'playing') DESC,
                  COALESCE(b.finished_at, b.started_at, b.created_at) DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
      id: number;
      status: string;
      player1_id: number;
      player2_id: number | null;
      player2_is_bot: number;
      winner_id: number | null;
      finished_at: number | null;
      started_at: number | null;
      created_at: number | null;
      total_questions: number;
      p1_answered: number;
      p1_correct: number;
      p2_answered: number;
      p2_correct: number;
      p1_answers: string | null;
      p2_answers: string | null;
      p1_name: string | null;
      p2_name: string | null;
    }>;

    const feed = rows.map((row) => {
      const { p1, p2 } = computeScores(row);
      const isBot = row.player2_is_bot === 1;
      const p1Name = row.p1_name || `玩家${row.player1_id}`;
      const p2Name = isBot ? "人机" : row.p2_name || `玩家${row.player2_id ?? ""}`;
      let winnerName: string | null = null;
      if (row.winner_id != null) {
        if (isBot && row.winner_id === row.player2_id) winnerName = "人机";
        else if (row.winner_id === row.player1_id) winnerName = p1Name;
        else winnerName = p2Name;
      }
      return {
        id: row.id,
        p1Name,
        p2Name,
        p1Score: p1,
        p2Score: p2,
        winnerName,
        isBot,
        finishedAt: row.finished_at,
        /** playing = 正在打；finished = 已结束 */
        status: row.status === 'playing' ? 'playing' : 'finished',
        /** 进行中的进度（已答最多的一方 / 总题数），如 "3/5" */
        progress: `${Math.max(row.p1_answered || 0, row.p2_answered || 0)}/${row.total_questions || TOTAL_QUESTIONS}`,
      };
    });

    res.json({ feed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /taunts — 嘲讽配置。
 * 必须注册在 GET /:id 之前，否则 "taunts" 会被当成 battleId。
 * 文案由服务端下发，前端不硬编码（改文案不用重新发版）。
 */
router.get('/taunts', (req: AuthRequest, res: Response) => {
  try {
    res.json({
      owned: ownsTauntPack(req.userId!),
      items: TAUNTS.map((text, idx) => ({ idx, text })),
      maxPerBattle: TAUNT_MAX_PER_BATTLE,
      cooldownSeconds: TAUNT_COOLDOWN_SECONDS,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /match — 匹配对手；入场费 50；无人等待则自建 waiting 对局 */
router.post('/match', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const me = req.userId!;
    const now = nowSec();

    const runMatch = db.transaction((): { status: string; battleId: number } => {
      /* ① 已有「进行中」对局 → 直接返回该局，不再新建/加入。
       *   修复「一人同时和多个人打」：原先完全不检查，同一用户可以反复 POST /match
       *   命中多张 waiting 局或多局并行（DB 实证：有用户同时挂在 10 局 playing）。 */
      const playing = db
        .prepare(
          `SELECT id FROM battles
           WHERE status = 'playing' AND (player1_id = ? OR player2_id = ?)
           ORDER BY id DESC LIMIT 1`
        )
        .get(me, me) as { id: number } | undefined;
      if (playing) return { status: 'playing', battleId: playing.id };

      /* ② 自己已有未过期的 waiting 局（重复点匹配/刷新页面）→ 幂等返回，不重复扣费 */
      const mineWaiting = db
        .prepare(
          `SELECT id FROM battles
           WHERE status = 'waiting' AND player1_id = ? AND player2_id IS NULL AND created_at >= ?
           ORDER BY id DESC LIMIT 1`
        )
        .get(me, now - MATCH_TIMEOUT_SECONDS) as { id: number } | undefined;
      if (mineWaiting) return { status: 'waiting', battleId: mineWaiting.id };

      /* ③ 自己遗留的过期 waiting 局先过期退款（幂等），避免旧局挂着入场费 */
      const staleOwn = db
        .prepare(
          `SELECT * FROM battles WHERE status = 'waiting' AND player1_id = ? AND created_at < ?`
        )
        .all(me, now - MATCH_TIMEOUT_SECONDS) as BattleRow[];
      for (const stale of staleOwn) expireWaitingBattle(stale, now);

      /* 【2026-11-06 段位匹配】原来的规则是「谁的 waiting 局 id 小就进谁」，
         等于谁先挂机谁先被吃 —— 何文辉、李嘉权这类头部玩家对上谁都是碾压，
         新手打一把就退坑（反馈 #50/#67/#78 说的就是这个）。

         现在按 ELO 分差筛，并且窗口随对手等待时长放宽：
         宁可让他多等十几秒匹配同段位，也不要秒配一个打不过的。
         新手（定级赛未满 10 场）额外锁 300 分，任何时长都不放宽 —— 保护期必须有边界。
         私房（room_code 非空）一律不进随机池。 */
      ensureDuelTable();
      const myRating = getDuelRating(me);
      const meRatingValue = myRating.rating;
      const isRookie = myRating.games < 10 ? 1 : 0;

      const waiting = db
        .prepare(
          `SELECT b.id
             FROM battles b
             LEFT JOIN duel_ratings r ON r.user_id = b.player1_id
            WHERE b.status = 'waiting'
              AND b.player1_id <> ?
              AND b.player2_id IS NULL
              AND b.created_at >= ?
              AND b.room_code IS NULL
              AND ABS(COALESCE(r.rating, 1000) - ?) <=
                  CASE
                    WHEN ? = 1 THEN 300
                    WHEN (? - b.created_at) < 8  THEN 150
                    WHEN (? - b.created_at) < 20 THEN 350
                    WHEN (? - b.created_at) < 40 THEN 700
                    ELSE 100000
                  END
            ORDER BY ABS(COALESCE(r.rating, 1000) - ?) ASC, b.id ASC
            LIMIT 1`
        )
        .get(
          me,
          now - MATCH_TIMEOUT_SECONDS,
          meRatingValue,
          isRookie,
          now,
          now,
          now,
          meRatingValue
        ) as { id: number } | undefined;

      if (waiting) {
        // 加入已有对局：扣费 + 撮合必须原子（余额不足时 addCoins 抛错 → 整体回滚）
        addCoins(me, -ENTRY_FEE, 'battle_entry', waiting.id);
        const result = db
          .prepare(
            `UPDATE battles SET player2_id = ?, status = 'playing', started_at = ?, fee_paid2 = 1
             WHERE id = ? AND status = 'waiting' AND player2_id IS NULL`
          )
          .run(me, nowSec(), waiting.id);
        if (result.changes > 0) {
          return { status: 'playing', battleId: waiting.id };
        }
        throw new Error('该对局刚刚失效，请重试');
      }

      // 自建 waiting：先确认余额充足，再建局、扣费并标记 fee_paid1
      if (getCoins(me) < ENTRY_FEE) throw new Error('铜板不足');
      const questions = buildQuestions(me);
      const total = questions.length;
      const info = db
        .prepare(
          `INSERT INTO battles (player1_id, player2_id, player2_is_bot, status, question_data,
                                bot_results, bot_answer_ms, total_questions, created_at)
           VALUES (?, NULL, 0, 'waiting', ?, '[]', 4200, ?, ?)`
        )
        .run(me, JSON.stringify(questions), total, now);
      const battleId = Number(info.lastInsertRowid);
      addCoins(me, -ENTRY_FEE, 'battle_entry', battleId);
      db.prepare('UPDATE battles SET fee_paid1 = 1 WHERE id = ?').run(battleId);
      return { status: 'waiting', battleId };
    });

    const out = runMatch();
    res.json(out);
  } catch (err: any) {
    const msg = err?.message || '匹配失败';
    if (msg === '铜板不足') {
      res.status(400).json({ error: '铜板不足' });
      return;
    }
    res.status(400).json({ error: msg });
  }
});

/**
 * POST /:id/cancel — 匹配中主动取消（仅发起人 player1）。
 *  - waiting 局 → 标记 cancelled 并立即退还 50 入场费（与 expireWaitingBattle 同款幂等退款）
 *  - 已过期/已结算/已开局 → 不重复退款，返回当前状态；若恰在取消瞬间被真人接走（playing），
 *    由前端按正常匹配入场处理（不进则等 5 分钟强结，此时是真人对手接管，不是悬挂局）
 */
router.post('/:id/cancel', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const me = req.userId!;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: '对局不存在' });
      return;
    }
    const battle = loadMyBattle(id, me);
    if (!battle) {
      res.status(404).json({ error: '对局不存在' });
      return;
    }
    if (battle.status !== 'waiting') {
      // 已离开等待态：退款只可能由 expire / settle 流程处理过，这里不重复退
      res.json({ status: battle.status, battleId: id, refunded: 0, balance: getCoins(me) });
      return;
    }

    const runCancel = db.transaction((): { status: string; battleId: number; refunded: number; balance: number } => {
      const fresh = db.prepare('SELECT * FROM battles WHERE id = ?').get(id) as BattleRow | undefined;
      if (!fresh || fresh.status !== 'waiting' || fresh.player1_id !== me) {
        const st = fresh ? fresh.status : 'expired';
        return { status: st, battleId: id, refunded: 0, balance: getCoins(me) };
      }
      const now = nowSec();
      const res2 = db
        .prepare(
          "UPDATE battles SET status = 'cancelled', expired_at = ? WHERE id = ? AND status = 'waiting' AND player1_id = ?"
        )
        .run(now, id, me);
      if (res2.changes > 0 && fresh.fee_paid1 === 1) {
        addCoins(me, ENTRY_FEE, 'battle_refund', id);
        db.prepare('UPDATE battles SET fee_paid1 = 0 WHERE id = ?').run(id);
        return { status: 'cancelled', battleId: id, refunded: ENTRY_FEE, balance: getCoins(me) };
      }
      return { status: 'cancelled', battleId: id, refunded: 0, balance: getCoins(me) };
    });

    res.json(runCancel());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /:id — 对局状态（惰性处理：过期 / 强结 / 结算） */
router.get('/:id', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const me = req.userId!;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: '对局不存在' });
      return;
    }
    let battle = loadMyBattle(id, me);
    if (!battle) {
      res.status(404).json({ error: '对局不存在' });
      return;
    }
    const now = nowSec();

    // waiting 超过 60 秒 → 过期并退还发起人入场费
    if (battle.status === 'waiting' && now - (battle.created_at || 0) >= MATCH_TIMEOUT_SECONDS) {
      battle = expireWaitingBattle(battle, now);
    }
    // playing 超过 5 分钟或双方都完成 → 强结 / 结算
    if (battle.status === 'playing') {
      // 单题超时兜底：双方都查（对手可能已取题后离场，不能让他挂死整局）
      ensureBattleColumns();
      const otherId = battle.player1_id === me ? battle.player2_id : battle.player1_id;
      applyQuestionTimeout(battle.id, me);
      if (otherId != null) applyQuestionTimeout(battle.id, otherId);
      const fresh = db.prepare('SELECT * FROM battles WHERE id = ?').get(id) as BattleRow | undefined;
      if (fresh) battle = fresh;
      battle = settleBattle(battle);
    }

    res.json(buildState(battle, me));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /:id/question/:index — 取第 index 题 */
router.get('/:id/question/:index', (req: AuthRequest, res: Response) => {
  try {
    const me = req.userId!;
    const id = parseInt(req.params.id, 10);
    const index = parseInt(req.params.index, 10);
    if (!Number.isFinite(id) || !Number.isFinite(index)) {
      res.status(404).json({ error: '题目不存在' });
      return;
    }
    const battle = loadMyBattle(id, me);
    if (!battle) {
      res.status(404).json({ error: '对局不存在' });
      return;
    }
    if (battle.status === 'expired') {
      res.status(400).json({ error: '对局已过期' });
      return;
    }
    if (battle.status !== 'playing' && battle.status !== 'finished') {
      res.status(400).json({ error: '对局尚未开始' });
      return;
    }
    const questions = readQuestions(battle);
    if (index < 0 || index >= questions.length) {
      res.status(404).json({ error: '题目不存在' });
      return;
    }

    const isP1 = battle.player1_id === me;
    const myAnswered = isP1 ? battle.p1_answered : battle.p2_answered;
    const alreadyAnswered = myAnswered > index;

    // 单题限时：题目真正下发时才开钟（不是轮询时就开，避免「等对手追进度」期间被计时）
    ensureBattleColumns();
    if (index === myAnswered && !alreadyAnswered) {
      stampQuestionStart(battle, isP1, index);
    }

    res.json({
      index,
      stem: questions[index].stem,
      source: questions[index].source,
      keyword: questions[index].keyword,
      options: questions[index].options,
      alreadyAnswered,
      myChoice: null,
      questionDeadline: questionDeadlineMs(battle, isP1),
      questionSeconds: QUESTION_TIME_SECONDS,
      ...(alreadyAnswered ? { correctIndex: questions[index].answerIndex } : {}),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /:id/answer — 作答（顺序作答，index 必须等于我方已答数） */
router.post('/:id/answer', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const me = req.userId!;
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: '对局不存在' });
      return;
    }
    const index = Number(req.body?.index);
    const choice = Number(req.body?.choice);
    if (!Number.isInteger(index) || !Number.isInteger(choice) || choice < 0 || choice > 3) {
      res.status(400).json({ error: '作答参数不合法' });
      return;
    }

    let battle = loadMyBattle(id, me);
    if (!battle) {
      res.status(404).json({ error: '对局不存在' });
      return;
    }
    if (battle.status === 'expired') {
      res.status(400).json({ error: '对局已过期' });
      return;
    }
    if (battle.status !== 'playing') {
      res.status(400).json({ error: '对局已结束' });
      return;
    }

    const isP1 = battle.player1_id === me;
    const myAnswered = isP1 ? battle.p1_answered : battle.p2_answered;
    if (index !== myAnswered) {
      res.status(400).json({ error: '答题顺序不正确' });
      return;
    }
    ensureBattleColumns();
    const now = nowSec();

    const questions = readQuestions(battle);
    if (index < 0 || index >= questions.length) {
      res.status(404).json({ error: '题目不存在' });
      return;
    }

    // 单题限时：超过 25s(+宽限) 才送达的作答一律按答错处理（防挂机刷分/超时后补答）
    const deadline = questionDeadlineMs(battle, isP1);
    const timedOut = deadline != null && Date.now() > deadline + QUESTION_GRACE_SECONDS * 1000;
    const correctIndex = questions[index].answerIndex;
    const correct = !timedOut && choice === correctIndex ? 1 : 0;
    const total = battle.total_questions || questions.length || TOTAL_QUESTIONS;

    const newAnswered = myAnswered + 1;
    const newCorrect = (isP1 ? battle.p1_correct : battle.p2_correct) + correct;
    const newFinished = newAnswered >= total ? 1 : 0;
    const answerEntry = { i: index, correct: correct === 1, ts: Date.now() };

    // 读-改-写同一条 UPDATE：事务内基于最新行追加逐题答案，防并发覆盖（bot/真人同走此路）。
    const writeAnswer = db.transaction(() => {
      const fresh = db.prepare('SELECT * FROM battles WHERE id = ?').get(id) as BattleRow | undefined;
      if (!fresh) return;
      const curAnswers = parseAnswers(isP1 ? fresh.p1_answers : fresh.p2_answers);
      curAnswers.push(answerEntry);
      const answersJson = JSON.stringify(curAnswers);
      if (isP1) {
        db.prepare(
          'UPDATE battles SET p1_answered = ?, p1_correct = ?, p1_finished = ?, p1_finish_at = ?, p1_answers = ? WHERE id = ?'
        ).run(newAnswered, newCorrect, newFinished, newFinished ? now : fresh.p1_finish_at, answersJson, id);
      } else {
        db.prepare(
          'UPDATE battles SET p2_answered = ?, p2_correct = ?, p2_finished = ?, p2_finish_at = ?, p2_answers = ? WHERE id = ?'
        ).run(newAnswered, newCorrect, newFinished, newFinished ? now : fresh.p2_finish_at, answersJson, id);
      }
    });
    writeAnswer();

    // 刷新后尝试结算（双方都完成时马上发奖）
    battle = loadMyBattle(id, me)!;
    battle = settleBattle(battle);

    const state = buildState(battle, me);
    res.json({
      correct: correct === 1,
      correctIndex,
      timedOut,
      me: state.me,
      opponent: state.opponent,
      status: state.status,
      winnerId: state.winnerId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/taunt — 发一条嘲讽。
 * 只允许「已解锁商品 + 本人参与 + 对局进行中 + 未超次数 + 过了冷却」。
 * 文本不接受客户端内容，只收下标，从源头杜绝辱骂与超长文本。
 */
router.post('/:id/taunt', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const me = req.userId!;
    const battleId = Number(req.params.id);
    const idx = Number(req.body?.idx);

    if (!Number.isInteger(idx) || idx < 0 || idx >= TAUNTS.length) {
      res.status(400).json({ error: '这条嘲讽不存在' });
      return;
    }
    if (!ownsTauntPack(me)) {
      res.status(403).json({ error: '还没有解锁「决斗嘲讽包」' });
      return;
    }

    const battle = db.prepare('SELECT * FROM battles WHERE id = ?').get(battleId) as BattleRow | undefined;
    if (!battle) {
      res.status(404).json({ error: '对局不存在' });
      return;
    }
    if (battle.player1_id !== me && battle.player2_id !== me) {
      res.status(403).json({ error: '这不是你的对局' });
      return;
    }
    if (battle.status !== 'playing') {
      res.status(400).json({ error: '对局已经结束了' });
      return;
    }

    const stat = db
      .prepare(
        'SELECT COUNT(*) AS n, MAX(created_at) AS last FROM battle_taunts WHERE battle_id = ? AND from_user_id = ?'
      )
      .get(battleId, me) as { n: number; last: number | null };

    if (stat.n >= TAUNT_MAX_PER_BATTLE) {
      res.status(429).json({ error: `本局最多嘲讽 ${TAUNT_MAX_PER_BATTLE} 次` });
      return;
    }
    const now = nowSec();
    if (stat.last != null && now - stat.last < TAUNT_COOLDOWN_SECONDS) {
      res.status(429).json({ error: `再等 ${TAUNT_COOLDOWN_SECONDS - (now - stat.last)} 秒` });
      return;
    }

    const info = db
      .prepare('INSERT INTO battle_taunts (battle_id, from_user_id, text_idx, created_at) VALUES (?, ?, ?, ?)')
      .run(battleId, me, idx, now);

    res.json({
      success: true,
      id: Number(info.lastInsertRowid),
      text: TAUNTS[idx],
      at: now,
      remaining: TAUNT_MAX_PER_BATTLE - stat.n - 1,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 周期清扫遗留 waiting 局：用户「取消匹配/关页面/掉线」但前端没来得及调 cancel 时，
 * 该局会一直卡在 waiting 挂着 50 铜板。30 秒扫一次，超 60 秒的 waiting 一律过期退款。
 * （expireWaitingBattle 幂等，可安全重复执行）
 */
const sweeper = setInterval(() => {
  try {
    sweepStaleWaitingBattles();
  } catch {
    /* 清扫失败静默，下个周期再试；不影响请求处理 */
  }
}, SWEEP_INTERVAL_MS);
// 不让定时器阻塞进程退出（仅在测试/脚本里 import 本模块时有意义）
if (typeof (sweeper as any).unref === 'function') (sweeper as any).unref();

export default router;
