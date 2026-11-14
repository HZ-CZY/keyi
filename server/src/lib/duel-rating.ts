/**
 * 竞技场段位系统（2026-11-06）
 *
 * 背景：反馈 #47 / #50 / #67 / #78 / #90 集中指向同一件事 ——
 * 「竞技场全是老玩家，新手打一把就破防，然后就不来了」。
 * 原来匹配是纯先来后到（谁的 waiting 局 id 小就进谁），
 * 结果何文辉、李嘉权这类头部玩家对上谁都是碾压，新手体验为 0。
 *
 * 方案：ELO 积分 + 段位区间 + 按分差限流的匹配。
 *  - 积分是唯一真值，段位只是给它起个学生看得懂的名字；
 *  - 赢强手得分多、赢弱手得分少，天然收敛，不需要手动调平衡；
 *  - 定级期（前 10 场）K 值更大，快速把人送到该在的位置。
 */

import { getDb } from '../db/database';

export type DuelTier = {
  key: string;
  name: string;
  min: number;
  max: number;
  color: string;
};

export const DUEL_TIERS: DuelTier[] = [
  { key: 'bronze', name: '青铜', min: 0, max: 899, color: '#9A6B4F' },
  { key: 'silver', name: '白银', min: 900, max: 1049, color: '#7C8CA3' },
  { key: 'gold', name: '黄金', min: 1050, max: 1199, color: '#D9A227' },
  { key: 'platinum', name: '铂金', min: 1200, max: 1349, color: '#2FBFA0' },
  { key: 'diamond', name: '钻石', min: 1350, max: 1499, color: '#4C8DF6' },
  { key: 'star', name: '星耀', min: 1500, max: 1649, color: '#A855F7' },
  { key: 'king', name: '王者', min: 1650, max: 9999, color: '#F04E6B' },
];

const RATING_MIN = 400;
const RATING_MAX = 2600;
const DEFAULT_RATING = 1000;
/** 定级赛场次：这之内的场次 K 值更大，人掉得快也爬得快 */
const PLACEMENT_GAMES = 10;
const K_PLACEMENT = 44;
const K_NORMAL = 24;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** 段位 + 段内小段（IV→I），王者没有小段 */
export function tierOf(rating: number): {
  tier: DuelTier;
  sub: string;
  label: string;
  progress: number;
} {
  const r = clamp(Math.round(rating), 0, 9999);
  let tier = DUEL_TIERS[DUEL_TIERS.length - 1];
  for (const t of DUEL_TIERS) {
    if (r <= t.max) { tier = t; break; }
  }
  const span = tier.max - tier.min + 1;
  const progress = clamp((r - tier.min) / span, 0, 1);
  if (tier.key === 'king') {
    return { tier, sub: '', label: tier.name, progress };
  }
  const subs = ['IV', 'III', 'II', 'I'];
  const idx = Math.min(3, Math.floor(progress * 4));
  return { tier, sub: subs[idx], label: `${tier.name} ${subs[idx]}`, progress };
}

export type DuelRatingRow = {
  user_id: number;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  streak_win: number;
  peak_rating: number;
  updated_at: number;
};

let ensured = false;

/** 惰性建表：沿用项目里 ensureBattleColumns 的风格，第一次访问时补上 */
export function ensureDuelTable() {
  if (ensured) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS duel_ratings (
      user_id     INTEGER PRIMARY KEY,
      rating      INTEGER NOT NULL DEFAULT ${DEFAULT_RATING},
      games       INTEGER NOT NULL DEFAULT 0,
      wins        INTEGER NOT NULL DEFAULT 0,
      losses      INTEGER NOT NULL DEFAULT 0,
      draws       INTEGER NOT NULL DEFAULT 0,
      streak_win  INTEGER NOT NULL DEFAULT 0,
      peak_rating INTEGER NOT NULL DEFAULT ${DEFAULT_RATING},
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_duel_ratings_rating ON duel_ratings(rating DESC);
  `);
  ensured = true;
}

export function getDuelRating(userId: number): DuelRatingRow {
  ensureDuelTable();
  const db = getDb();
  let row = db.prepare('SELECT * FROM duel_ratings WHERE user_id = ?').get(userId) as
    | DuelRatingRow
    | undefined;
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO duel_ratings (user_id) VALUES (?)').run(userId);
    row = db.prepare('SELECT * FROM duel_ratings WHERE user_id = ?').get(userId) as DuelRatingRow;
  }
  return row;
}

/** 给前端用的完整段位信息 */
export function duelProfile(userId: number, rank?: number, total?: number) {
  const r = getDuelRating(userId);
  const t = tierOf(r.rating);
  return {
    rating: r.rating,
    peakRating: r.peak_rating,
    games: r.games,
    wins: r.wins,
    losses: r.losses,
    draws: r.draws,
    winStreak: r.streak_win,
    winRate: r.games > 0 ? Math.round((r.wins / r.games) * 1000) / 10 : 0,
    placement: r.games < PLACEMENT_GAMES,
    placementLeft: Math.max(0, PLACEMENT_GAMES - r.games),
    tier: {
      key: t.tier.key,
      name: t.tier.name,
      color: t.tier.color,
      sub: t.sub,
      label: t.label,
      progress: Math.round(t.progress * 1000) / 10,
      min: t.tier.min,
      max: t.tier.max,
    },
    rank: rank ?? null,
    total: total ?? null,
  };
}

/**
 * 结算一场真人 PVP，更新双方积分。
 * @param winnerId 胜者；null 表示平局
 */
export function applyDuelResult(
  p1: number,
  p2: number | null,
  winnerId: number | null
) {
  if (p2 == null) return; // 人机局不计分
  ensureDuelTable();
  const db = getDb();

  const a = getDuelRating(p1);
  const b = getDuelRating(p2);

  const ra = a.rating;
  const rb = b.rating;
  // ELO 期望胜率
  const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  const eb = 1 - ea;

  let sa = 0.5;
  let sb = 0.5;
  if (winnerId === p1) { sa = 1; sb = 0; }
  else if (winnerId === p2) { sa = 0; sb = 1; }

  const ka = a.games < PLACEMENT_GAMES ? K_PLACEMENT : K_NORMAL;
  const kb = b.games < PLACEMENT_GAMES ? K_PLACEMENT : K_NORMAL;

  const nextA = clamp(Math.round(ra + ka * (sa - ea)), RATING_MIN, RATING_MAX);
  const nextB = clamp(Math.round(rb + kb * (sb - eb)), RATING_MIN, RATING_MAX);

  const upd = db.prepare(`
    UPDATE duel_ratings
       SET rating = ?, games = games + 1,
           wins = wins + ?, losses = losses + ?, draws = draws + ?,
           streak_win = ?, peak_rating = MAX(peak_rating, ?),
           updated_at = unixepoch()
     WHERE user_id = ?
  `);

  const tx = db.transaction(() => {
    upd.run(
      nextA,
      winnerId === p1 ? 1 : 0,
      winnerId === p2 ? 1 : 0,
      winnerId == null ? 1 : 0,
      winnerId === p1 ? a.streak_win + 1 : 0,
      nextA,
      p1
    );
    upd.run(
      nextB,
      winnerId === p2 ? 1 : 0,
      winnerId === p1 ? 1 : 0,
      winnerId == null ? 1 : 0,
      winnerId === p2 ? b.streak_win + 1 : 0,
      nextB,
      p2
    );
  });
  tx();
}

export function duelLeaderboard(limit = 20, offset = 0) {
  ensureDuelTable();
  const db = getDb();
  return db.prepare(`
    SELECT r.user_id AS userId, u.username AS name, u.avatar_url AS avatarUrl,
           r.rating, r.games, r.wins, r.losses
      FROM duel_ratings r
      JOIN users u ON u.id = r.user_id
     WHERE r.games > 0 AND COALESCE(u.banned_until, 0) <= unixepoch()
     ORDER BY r.rating DESC, r.games DESC
     LIMIT ? OFFSET ?
  `).all(limit, offset) as any[];
}

export function myRank(userId: number): number | null {
  ensureDuelTable();
  const db = getDb();
  const me = db.prepare('SELECT rating FROM duel_ratings WHERE user_id = ?').get(userId) as
    | { rating: number }
    | undefined;
  if (!me) return null;
  const row = db.prepare(
    `SELECT COUNT(*) + 1 AS r FROM duel_ratings
      WHERE games > 0 AND rating > ?`
  ).get(me.rating) as { r: number };
  return row?.r ?? null;
}

/**
 * 用历史对局给存量用户定级（只跑一次）。
 * 净胜场数做主项，胜率做修正 —— 打得多但输得多的人不该被顶到王座上；
 * 赢得少但胜率极高的人（比如 356 胜 19 负的祝溢星）必须被识别出来。
 */
export function backfillRatingsFromHistory(): { inserted: number } {
  ensureDuelTable();
  const db = getDb();
  const rows = db.prepare(`
    SELECT u.id AS userId,
           SUM(CASE WHEN b.winner_id = u.id THEN 1 ELSE 0 END) AS w,
           SUM(CASE WHEN b.winner_id IS NOT NULL AND b.winner_id <> u.id THEN 1 ELSE 0 END) AS l
      FROM users u
      JOIN battles b ON (b.player1_id = u.id OR b.player2_id = u.id)
     WHERE b.player2_is_bot = 0 AND b.status = 'finished'
       AND (b.player1_id = u.id OR b.player2_id IS NOT NULL)
     GROUP BY u.id
  `).all() as { userId: number; w: number; l: number }[];

  const ins = db.prepare(`
    INSERT INTO duel_ratings (user_id, rating, games, wins, losses, peak_rating)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO NOTHING
  `);
  let inserted = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const w = Number(r.w) || 0;
      const l = Number(r.l) || 0;
      const games = w + l;
      if (games === 0) continue;
      const net = w - l;
      const wr = w / games;
      const winFactor = clamp(wr * 2, 0.55, 1.3);
      const mag = 110 * Math.log2(1 + Math.abs(net) / 12) * winFactor;
      const rating = clamp(Math.round(1000 + Math.sign(net) * mag), RATING_MIN, RATING_MAX);
      const info = ins.run(r.userId, rating, games, w, l, rating);
      if (info.changes > 0) inserted += 1;
    }
  });
  tx();
  return { inserted };
}
