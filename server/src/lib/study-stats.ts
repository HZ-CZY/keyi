import { getDb } from '../db/database';
import { todayCn } from './coins';

/**
 * 学习指标 —— 供每日任务判定与前端进度展示共用。
 *
 * 【2026-10-14】本模块的指标口径都由「间隔重复」的学习原理决定，不是随便选的：
 * 间隔重复的价值在于「在遗忘临界点复习」，所以奖励应当奖励**按节奏完成**，
 * 而不是奖励「单日复习张数」—— 后者会诱导学生提前猛刷、打乱间隔，效果反而更差。
 */

/** 「正确率」任务的最小样本量。没有它，「答 1 张全对」就是 100%。 */
export const ACC_MIN_SAMPLE = 20;

/** 「连续达标日」里，某天至少复习多少张不同卡片才算达标。 */
export const STREAK_MIN_CARDS = 20;

/** 北京日字符串（YYYY-MM-DD）加减天数。 */
export function shiftDay(day: string, delta: number): string {
  const d = new Date(day + 'T00:00:00+08:00');
  return new Date(d.getTime() + delta * 86400000 + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 北京日某天的 [起始秒, 结束秒) 边界。 */
export function dayWindow(day?: string): { start: number; end: number } {
  const d = day || todayCn();
  const start = Math.floor(new Date(d + 'T00:00:00+08:00').getTime() / 1000);
  return { start, end: start + 86400 };
}

/**
 * 该用户是否有进入复习流程的卡（queue > 0）。
 *
 * 没有 → 「完成今日到期的复习」对他属于**不适用**（没有可完成的对象），
 * 与「未完成」不是一回事：前端据此把按钮指向「去学习新卡」，
 * 免得学生反复点「去完成」却无事可做。
 */
export function hasReviewCards(userId: number): boolean {
  try {
    const db = getDb();
    return !!db
      .prepare('SELECT 1 FROM cards WHERE user_id = ? AND queue > 0 LIMIT 1')
      .get(userId);
  } catch {
    return false;
  }
}

/**
 * 当日「到期卡完成度」百分比（0~100）。
 *
 * 分母 = 今天复习过的不同卡数 + 今天仍待复习的卡数（当前 due 已到、未毕业、且今天没复习过）。
 *
 * ⚠️ 分母不能用「当前到期卡数」—— 答对一张卡后它的 due 会移到未来、立刻从分母消失，
 *    结果复习 7/10 就显示成 100%（分母从 10 掉到 3）。实测踩过一次。
 *    所以要显式把「今天已完成的」加回来，分母才等于「当天开始时该复习的总量」。
 *
 * 为什么这个指标是对的：
 *   · 卡组大的人到期多、卡组小的人到期少 —— 是**相对**指标，对不同水平公平；
 *   · 不学 → 0；按时学完 → 满额；
 *   · **提前猛刷无法提高它**（超出的不算），从根上断掉「刷量换钱」的动机。
 *
 * 边界：到期卡为 0 时（刚学完、间隔都还没到），当天动过就记 100%，完全没动记 0%
 * —— 既不把「没欠账」白送，也不把正常学生卡死。
 */
export function dueProgressPct(userId: number, day?: string): number {
  try {
    const db = getDb();
    const { start, end } = dayWindow(day);
    const doneRow = db
      .prepare(
        `SELECT COUNT(DISTINCT card_id) AS c FROM revlog
          WHERE user_id = ? AND reviewed_at >= ? AND reviewed_at < ?`
      )
      .get(userId, start, end) as { c: number } | undefined;
    /* 仍未完成 = 当前到期、未毕业，**且今天一次都没复习过**的卡。
       「今天没复习过」这个条件很关键：答错的卡 after-lapse 会重新到期，
       若不加这条件它会同时计入「已完成」和「未完成」，把分母撑大。 */
    const pendRow = db
      .prepare(
        `SELECT COUNT(*) AS c FROM cards c
          WHERE c.user_id = ? AND c.queue > 0 AND c.due <= ?
            AND NOT EXISTS (
                  SELECT 1 FROM revlog r
                   WHERE r.user_id = c.user_id AND r.card_id = c.id AND r.reviewed_at >= ?)`
      )
      .get(userId, end - 1, start) as { c: number } | undefined;
    const done = Number(doneRow?.c) || 0;
    const pending = Number(pendRow?.c) || 0;
    const total = done + pending;
    /* 【2026-10-15 按反馈】今天没有到期卡 —— 必须区分两种人，不能一刀切：
       · **有卡、只是今天一张都没到期**：他没欠账，本来就该算完成。
         学生反馈「接下来一周复习词汇为 0，每日任务只能做个打卡」——
         她的卡间隔都还没到，按旧逻辑（没动就记 0%）这条任务永远做不了，
         等于把正常学生卡死在任务之外，而她其实什么都没落下。
       · **一张卡都没有的新人**：没有可完成的对象，不能白送。
       学生改不了 due（由服务端 SM-2 计算），所以这里不存在钻空子的空间。 */
    if (total <= 0) {
      /* 【2026-10-15 修 bug】判据必须是「有没有**复习卡**」（queue > 0），
         而不是「有没有卡」。全是新卡（queue = 0，导入后还没开始学）的学生
         同样满足「有卡」，会被误判成「没欠账 → 已完成」白拿奖励 —— 实测 14 人命中。
         有复习卡、只是今天没到期（间隔都还没到）→ 100%：这是上一轮按学生反馈保留的
         （「接下来一周复习词汇为 0，每日任务只能做个打卡」），不是本次的 bug。 */
      const hasReviewCard = db.prepare(
        'SELECT 1 FROM cards WHERE user_id = ? AND queue > 0 LIMIT 1'
      ).get(userId);
      return hasReviewCard ? 100 : 0;
    }
    return Math.min(100, Math.floor((done * 100) / total));
  } catch {
    return 0;
  }
}

/** 当日复习正确率（按次数统计，只算复习卡 review_type=2）。 */
export function accuracyToday(userId: number, day?: string): { total: number; pct: number } {
  try {
    const db = getDb();
    const d = day || todayCn();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN ease >= 3 THEN 1 ELSE 0 END) AS correct
           FROM revlog
          WHERE user_id = ? AND review_type = 2
            AND date(reviewed_at, 'unixepoch', '+8 hours') = ?`
      )
      .get(userId, d) as { total: number; correct: number } | undefined;
    const total = Number(row?.total) || 0;
    const correct = Number(row?.correct) || 0;
    return { total, pct: total > 0 ? Math.floor((correct * 100) / total) : 0 };
  } catch {
    return { total: 0, pct: 0 };
  }
}

/**
 * 连续「达标日」天数 —— 某日复习的不同卡片数 ≥ minCards 才算达标。
 *
 * 断一天就归零（不设补签）：连续本身就是要奖励的东西，补签会把「坚持」稀释掉。
 * 今天尚未达标时从昨天开始数（今天还没过完，不该算断）。
 */
export function qualifiedStreak(userId: number, minCards: number = STREAK_MIN_CARDS): number {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        /* 【2026-10-21】统计口径从「只算复习卡」改为「当天学过的全部卡片」。
           原口径要求每天复习 20 张不同卡片才算一天，但学生主要做「新学」，
           复习卡池本来就小（反馈 #255：「每天都复习了但天数一直不加」）。
           学生理解的「坚持」是今天有没有学，按学习总量计更符合直觉，
           门槛仍保留 20 张，防刷效果不变。 */
        `SELECT date(reviewed_at, 'unixepoch', '+8 hours') AS d, COUNT(DISTINCT card_id) AS c
           FROM revlog
          WHERE user_id = ?
            AND reviewed_at >= unixepoch() - 90 * 86400
          GROUP BY d HAVING c >= ?`
      )
      .all(userId, minCards) as { d: string; c: number }[];
    const days = new Set(rows.map((r) => r.d));
    const today = todayCn();
    let cursor = today;
    if (!days.has(cursor)) cursor = shiftDay(cursor, -1);
    let n = 0;
    while (days.has(cursor)) {
      n += 1;
      cursor = shiftDay(cursor, -1);
    }
    return n;
  } catch {
    return 0;
  }
}

/** 当日已通过卡片学习获得的铜板（用于日上限判定）。 */
export function studyCoinsToday(userId: number): number {
  try {
    const db = getDb();
    const row = db
      .prepare(
        "SELECT COALESCE(SUM(delta), 0) AS s FROM coins_ledger WHERE user_id = ? AND source = 'study_card' AND day = ?"
      )
      .get(userId, todayCn()) as { s: number } | undefined;
    return Number(row?.s) || 0;
  } catch {
    return 0;
  }
}
