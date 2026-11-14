import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getDb } from '../db/database';
import { cnDateStr, cnTodayWindow, CN_SQL_MODIFIER, shiftDay } from '../lib/dates';
import { addCoins, getCoins } from '../lib/coins';

const router = Router();
router.use(authMiddleware);

/* ============================================================
   连续打卡阶梯奖励（2026-11-06 · 反馈 83 / 149 / 168）
   原来每天固定 +5，连签 30 天和连签 1 天一样多，学生说「勤着来没意义」。
   现在按连续天数分档发放；档位表同时下发给前端，方便展示「明天能拿多少」。
   ============================================================ */
export const CHECKIN_TIERS = [
  { minDays: 30, reward: 30, label: '30 天' },
  { minDays: 14, reward: 18, label: '14 天' },
  { minDays: 7, reward: 12, label: '7 天' },
  { minDays: 3, reward: 8, label: '3 天' },
];
const BASE_REWARD = 5;

/** 给定「今天打卡后的连续天数」，返回本次应发铜板 */
export function rewardForStreak(streak: number): number {
  for (const t of CHECKIN_TIERS) {
    if (streak >= t.minDays) return t.reward;
  }
  return BASE_REWARD;
}

/** 下一个能提档的天数（用于前端提示「再连 N 天每天多拿 X」），已封顶返回 null */
export function nextTier(streak: number): { minDays: number; reward: number } | null {
  const asc = [...CHECKIN_TIERS].sort((a, b) => a.minDays - b.minDays);
  for (const t of asc) {
    if (streak < t.minDays) return { minDays: t.minDays, reward: t.reward };
  }
  return null;
}

/* 补打卡（反馈 150）
   — 只能补最近 7 天、且必须是真的漏掉的天（已有记录的不给补）
   — 每次 30 铜板，近 7 天最多补 2 次：既要能救急，又不能变成「花钱买全勤」 */
const BACKFILL_COST = 30;
const BACKFILL_WINDOW_DAYS = 7;
const BACKFILL_MAX_PER_WEEK = 2;

/**
 * 连签计算：revlog 的有效学习日 ∪ checkins 的主动打卡，从今天（或昨天）往前连续回溯。
 * 【2026-11-07 重写】前一天线上出现全班连签归零，根因是本函数的 SQL 被改坏
 * （UNION 两侧列数不一致 / 外层包裹丢失），而 catch 把异常吞掉直接 return 0，
 * 于是一个人都不报错、全班一起归零。现在：
 *   · SQL 结构固定为「外层 SELECT review_date FROM ( A UNION B )」；
 *   · 出错写日志，不再静默；
 *   · 逐日回溯用 shiftDay 做纯日期字符串运算，不看服务器时区。
 */
function computeStreak(db: any, userId: number): number {
  try {
    const rows = db.prepare(`
        SELECT review_date FROM (
          SELECT review_date FROM (
            SELECT day AS review_date, AVG(time_ms) AS med_ms, MAX(n) AS n
              FROM (
                SELECT day, time_ms, n,
                       ROW_NUMBER() OVER (PARTITION BY day ORDER BY time_ms) AS rn
                  FROM (SELECT date(reviewed_at,'unixepoch','${CN_SQL_MODIFIER}') AS day,
                               time_ms,
                               COUNT(*) OVER (PARTITION BY date(reviewed_at,'unixepoch','${CN_SQL_MODIFIER}')) AS n
                          FROM revlog WHERE user_id = ?)
              )
             WHERE rn IN ((n + 1) / 2, (n + 2) / 2)
             GROUP BY day
            /* ① 中位耗时 < 700ms → 刷时长；② 满 30 条且 < 1500ms → 也算刷 */
            HAVING med_ms >= 700 AND NOT (MAX(n) >= 30 AND med_ms < 1500)
          )
          UNION
          SELECT checked_date AS review_date FROM checkins WHERE user_id = ?
        )
      ORDER BY review_date DESC LIMIT 365
    `).all(userId, userId) as any[];

    if (rows.length === 0) return 0;
    const today = cnDateStr();
    const dates = new Set(rows.map((r: any) => r.review_date));
    let cursor = dates.has(today) ? today : shiftDay(today, -1);
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      if (!dates.has(cursor)) break;
      streak++;
      cursor = shiftDay(cursor, -1);
    }
    return streak;
  } catch (e) {
    console.error('[streak] 计算失败 userId=', userId, e);
    return 0;
  }
}

function todayWindow() {
  return cnTodayWindow();
}

/** 近 7 天已补卡次数 */
function backfillUsed(db: any, userId: number, today: string): number {
  try {
    const row = db.prepare(
      `SELECT COUNT(*) AS c FROM checkins
       WHERE user_id = ? AND checked_date >= date(?, '-6 days')`
    ).get(userId, today) as { c: number } | undefined;
    const ledger = db.prepare(
      `SELECT COUNT(*) AS c FROM coins_ledger
       WHERE user_id = ? AND source = 'checkin_backfill' AND created_at >= unixepoch() - 7*86400`
    ).get(userId) as { c: number } | undefined;
    // 补卡写的是 checkins，真正能反映「补了几次」的是流水；这里取流水为准
    return Math.max(0, Number(ledger?.c) || 0);
  } catch {
    return 0;
  }
}

/** 最近 7 天里漏掉的日子（不含今天），按时间倒序 */
function missingDays(db: any, userId: number, today: string): string[] {
  const have = new Set(
    (db.prepare(
      `SELECT checked_date FROM checkins WHERE user_id = ? AND checked_date >= date(?, '-6 days')`
    ).all(userId, today) as { checked_date: string }[]).map((r) => r.checked_date)
  );
  const learned = new Set(
    (db.prepare(
      `SELECT DISTINCT date(reviewed_at, 'unixepoch', '${CN_SQL_MODIFIER}') AS d
       FROM revlog WHERE user_id = ? AND reviewed_at >= unixepoch() - 8*86400`
    ).all(userId) as { d: string }[]).map((r) => r.d)
  );
  const out: string[] = [];
  const base = new Date(today + 'T00:00:00+08:00');
  for (let i = 1; i <= BACKFILL_WINDOW_DAYS; i++) {
    const d = new Date(base.getTime() - i * 86400 * 1000);
    const s = cnDateStr(d);
    // 那天学过习就不算「漏签」——连续天数本来就把 revlog 算进去了，补了也没意义
    if (!have.has(s) && !learned.has(s)) out.push(s);
  }
  return out;
}

/**
 * GET /api/checkin/status
 * Returns whether the user has checked in today, plus current streak & today's reviews.
 */
router.get('/status', (req: AuthRequest, res) => {
  try {
    const db = getDb();
    const userId = req.userId!;
    const { today, startOfDay, endOfDay } = todayWindow();

    const existing = db.prepare(`
      SELECT id FROM checkins WHERE user_id = ? AND checked_date = ?
    `).get(userId, today);

    const todayReviews = db.prepare(`
      SELECT COUNT(*) AS count FROM revlog
      WHERE user_id = ? AND reviewed_at >= ? AND reviewed_at < ?
    `).get(userId, startOfDay, endOfDay) as { count: number };

    /* 【2026-11-06 秒过提示】学生掉签必须知道原因，否则只会觉得系统坏了。
       这里算出今天「算不算有效学习日」，前端据此显示一句提示。 */
    const todayPass = db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN time_ms < 1000 THEN 1 ELSE 0 END) AS fast
        FROM revlog
       WHERE user_id = ? AND reviewed_at >= ? AND reviewed_at < ?
    `).get(userId, startOfDay, endOfDay) as { total: number; fast: number } | undefined;

    const total = todayPass?.total || 0;
    const fast = todayPass?.fast || 0;
    const fastPct = total > 0 ? Math.round((fast * 100) / total) : 0;
    /* 有效学习日：复习过，且秒过比例 < 80% */
    const todayCounts = total > 0 && fastPct < 80;

    const streak = computeStreak(db, userId);
    const checkedInToday = !!existing;
    // 今天还没打：打卡后就是 streak+1（若昨天断了，computeStreak 会是 0，这里也按 1 算）
    const projected = checkedInToday ? streak : (streak > 0 ? streak + 1 : 1);

    res.json({
      checkedInToday,
      streak,
      todayReviews: todayReviews.count,
      checkedDate: today,
      /* 秒过相关：今天算不算有效学习日 */
      todayCounts,
      todayFastReviews: fast,
      todayFastPct: fastPct,
      /* 本次（或今天）可得铜板 */
      todayReward: rewardForStreak(projected),
      nextTier: nextTier(projected),
      tiers: CHECKIN_TIERS,
      backfill: {
        cost: BACKFILL_COST,
        usedThisWeek: backfillUsed(db, userId, today),
        maxPerWeek: BACKFILL_MAX_PER_WEEK,
        missingDays: missingDays(db, userId, today),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/checkin
 * Marks the user as checked in for today (idempotent). Recomputes streak on success.
 */
router.post('/', (req: AuthRequest, res) => {
  try {
    const db = getDb();
    const userId = req.userId!;
    const { today, startOfDay, endOfDay } = todayWindow();

    const existing = db.prepare(`
      SELECT id FROM checkins WHERE user_id = ? AND checked_date = ?
    `).get(userId, today);

    let alreadyCheckedIn = false;
    let coinsAwarded = 0;
    let streak = computeStreak(db, userId);
    if (existing) {
      alreadyCheckedIn = true;
    } else {
      db.prepare(`
        INSERT INTO checkins (user_id, checked_date) VALUES (?, ?)
      `).run(userId, today);
      streak = computeStreak(db, userId);
      const reward = rewardForStreak(streak);
      // 连续打卡按档发放，重复打卡不会重复发放
      try {
        addCoins(userId, reward, 'checkin_daily', null);
        coinsAwarded = reward;
      } catch (coinErr) {
        console.error('[coins] checkin award failed:', coinErr);
      }
    }

    const todayReviews = db.prepare(`
      SELECT COUNT(*) AS count FROM revlog
      WHERE user_id = ? AND reviewed_at >= ? AND reviewed_at < ?
    `).get(userId, startOfDay, endOfDay) as { count: number };

    res.json({
      ok: true,
      alreadyCheckedIn,
      streak,
      todayReviews: todayReviews.count,
      checkedDate: today,
      coinsAwarded,
      balance: getCoins(userId),
      nextTier: nextTier(streak),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/checkin/backfill  { date: 'YYYY-MM-DD' }
 * 补一天签到：消耗铜板，写一条 checkins 记录，用于接上断掉的连续天数。
 */
router.post('/backfill', (req: AuthRequest, res) => {
  try {
    const db = getDb();
    const userId = req.userId!;
    const { today } = todayWindow();
    const date = String(req.body?.date || '').trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: '日期格式不对' });
      return;
    }
    if (date >= today) {
      res.status(400).json({ error: '只能补过去的日子' });
      return;
    }
    const daysAgo = Math.round(
      (Date.parse(today + 'T00:00:00+08:00') - Date.parse(date + 'T00:00:00+08:00')) / 86400000
    );
    if (!Number.isFinite(daysAgo) || daysAgo < 1 || daysAgo > BACKFILL_WINDOW_DAYS) {
      res.status(400).json({ error: `只能补最近 ${BACKFILL_WINDOW_DAYS} 天` });
      return;
    }

    const used = backfillUsed(db, userId, today);
    if (used >= BACKFILL_MAX_PER_WEEK) {
      res.status(400).json({ error: `7 天内最多补 ${BACKFILL_MAX_PER_WEEK} 次，下次再来吧` });
      return;
    }

    // 那天已经学过习的，补了也不增加连续天数，直接拒绝，别让人白花钱
    const learned = db.prepare(
      `SELECT 1 FROM revlog WHERE user_id = ?
         AND date(reviewed_at, 'unixepoch', '${CN_SQL_MODIFIER}') = ? LIMIT 1`
    ).get(userId, date);
    if (learned) {
      res.status(400).json({ error: '那天你学过词，本来就算连续，不用补' });
      return;
    }

    const exists = db.prepare(
      `SELECT id FROM checkins WHERE user_id = ? AND checked_date = ?`
    ).get(userId, date);
    if (exists) {
      res.status(400).json({ error: '那天已经打过卡了' });
      return;
    }

    if (getCoins(userId) < BACKFILL_COST) {
      res.status(400).json({ error: `铜板不足，补一次需要 ${BACKFILL_COST}` });
      return;
    }

    db.transaction(() => {
      addCoins(userId, -BACKFILL_COST, 'checkin_backfill', null);
      db.prepare(`INSERT INTO checkins (user_id, checked_date) VALUES (?, ?)`).run(userId, date);
    })();

    const streak = computeStreak(db, userId);
    res.json({
      ok: true,
      date,
      cost: BACKFILL_COST,
      streak,
      balance: getCoins(userId),
      usedThisWeek: used + 1,
      maxPerWeek: BACKFILL_MAX_PER_WEEK,
      missingDays: missingDays(db, userId, today),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
