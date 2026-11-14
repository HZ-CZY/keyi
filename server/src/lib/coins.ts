import { getDb } from '../db/database';

/** 铜板经济系统 —— 集中封装服务器账号余额的读改写与流水记录 */

/**
 * 中国时区今日字符串 YYYY-MM-DD（服务器多为 UTC，+8 为北京时间）。
 * 与 lib/dates.ts 的 cnDateStr 语义一致（北京 00:00 切日）。
 */
export function todayCn(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * 「无限铜板」哨兵值 —— 管理员账号的余额对外一律上报这个数。
 *
 * 为什么不用 Infinity / null：
 *   · 前端、游戏侧、服务端三处都要判「是否无限」，具体数字最简单，
 *     判据统一为 `n >= UNLIMITED_COINS`（三处常量必须保持一致）；
 *   · JSON 序列化会把 Infinity 变成 null，根本传不到前端。
 * 取 999999999 而不是 Number.MAX_SAFE_INTEGER：它远大于任何真实价格
 * （目前最贵的 mine L5 = 2100、goldmine L5 = 16500），又不会撑破 UI 布局。
 */
export const UNLIMITED_COINS = 999999999;

/**
 * 是否「无限铜板」账号（即管理员）。
 *
 * 【2026-10-14 按需求】管理员铜板设成无限：调试、验收、改档时不必再让
 * 后台手工加币，也不会因为一次误点把余额刷成负数。
 *
 * 口径与部落开放时段放行（village.ts 的 isAdminUser）完全一致：
 * 每条请求现查 users.role，不做缓存 —— 撤销管理员权限后立刻失效。
 * 查询失败一律返回 false，兜底永远偏向更严格的那一侧。
 */
export function isUnlimitedCoins(userId: number): boolean {
  if (!userId) return false;
  try {
    const row = getDb().prepare('SELECT role FROM users WHERE id = ?').get(userId) as
      | { role?: string }
      | undefined;
    return !!row && row.role === 'admin';
  } catch {
    return false;
  }
}

/**
 * 读取**真实**余额列，不做任何无限判定。
 * ⚠️ addCoins 记账必须用它取 before —— 若用 getCoins，管理员会拿到哨兵值，
 *    `before + delta` 一写就把 999999999 灌进 users.coins。
 */
function readRawCoins(userId: number): number {
  const db = getDb();
  const row = db.prepare('SELECT coins FROM users WHERE id = ?').get(userId) as
    | { coins: number }
    | undefined;
  return row ? Number(row.coins) || 0 : 0;
}

/** 读取某用户当前铜板余额（无记录视为 0）。管理员返回 UNLIMITED_COINS。 */
export function getCoins(userId: number): number {
  if (isUnlimitedCoins(userId)) return UNLIMITED_COINS;
  return readRawCoins(userId);
}

/**
 * 加/减铜板并记流水，返回新余额；delta 可为负。
 * 余额不足以扣减（新余额 < 0）时抛出中文错误，由调用方在事务内回滚并转成 400。
 */
export function addCoins(userId: number, delta: number, source: string, refId?: number | null): number {
  const db = getDb();
  const unlimited = isUnlimitedCoins(userId);

  /* ── 管理员：支出免费 ─────────────────────────────────────────────
     delta < 0 直接返回，既不扣真实余额、也不写流水。于是：
       · 部落的建造/升级（/withdraw）、战斗入场费、商店购买、PvP 换对手
         一律不花钱；
       · 账本里不会留下「管理员花掉 16500」这类纯噪声流水，
         日后对账不受污染。
     收入（delta > 0）**照常入账**：管理员答题、战斗胜利、领取福利
     仍然正常记流水。为什么不一起免掉 —— 排行榜积分是按 coins_ledger
     的净得统计的（training_correct 等），一起免掉会让管理员的积分凭空归零。 */
  if (unlimited && delta < 0) return UNLIMITED_COINS;

  const before = readRawCoins(userId);
  const next = before + delta;
  /* 【2026-10-15 修 P0】只有**支出**才需要校验余额充足。
     原先无条件 `next < 0` 抛错，把**收入**也一并拦下了：
       · 被追回成负数的学生（余额 -3564 之类）每笔学习收入都在这里抛
         「铜板不足」，被 cards.ts 的 catch 静默吞掉 → 答题「答对了却没加钱」；
       · 领任务奖励（+20）同样抛错，且错误信息被透传给学生 ——
         这正是学生反馈的原话「领任务都能提示铜板不足？」。
     负余额的语义是「欠债」：收入必须能逐步把债还清，否则等于永久封掉了
     收入来源，人也永远爬不回来。支出侧的限制保持不变（防透支）。 */
  if (delta < 0 && next < 0) throw new Error('铜板不足');
  db.prepare('UPDATE users SET coins = ? WHERE id = ?').run(next, userId);
  db.prepare(
    `INSERT INTO coins_ledger (user_id, delta, balance, source, ref_id, day, created_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch())`
  ).run(userId, delta, next, source, refId == null ? null : refId, todayCn());
  /* 对外统一报哨兵值：管理员在任意接口拿到的余额必须一致，
     否则 UI 会在「999999999」与真实余额（可能只有几十）之间反复横跳。 */
  return unlimited ? UNLIMITED_COINS : next;
}

/**
 * 追回铜板（clawback）—— **允许把余额扣成负数**。
 *
 * 为什么不能复用 addCoins，两条都要绕开：
 *   ① addCoins 在 next < 0 时抛「铜板不足」并让调用方回滚 ——
 *      而追回场景下「余额已经花掉了」是常态，必须能扣成负数；
 *   ② addCoins 对管理员（无限铜板）的 delta < 0 直接 return ——
 *      追回若走它，管理员账目永远追不回来。
 * 所以这里不复用，直接改列 + 记流水，保证账实一致。
 *
 * 【2026-10-14 首次使用】追回 9 月 9 日以来「按 revlog 行数发币」造成的超发。
 * 流水 source 统一用 `clawback:*` 前缀，便于日后对账与回滚。
 *
 * @param amount 追回金额（正数，内部取负入账）
 * @returns      追回后的真实余额（可能为负）
 */
export function clawbackCoins(userId: number, amount: number, source: string): number {
  const db = getDb();
  const amt = Math.round(Number(amount) || 0);
  if (!userId || amt <= 0) return readRawCoins(userId);
  const before = readRawCoins(userId);
  const next = before - amt;
  db.prepare('UPDATE users SET coins = ? WHERE id = ?').run(next, userId);
  db.prepare(
    `INSERT INTO coins_ledger (user_id, delta, balance, source, ref_id, day, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, unixepoch())`
  ).run(userId, -amt, next, source, todayCn());
  return next;
}

/**
 * 某用户「训练场正确答题」所得铜板合计：
 *  - day 省略 = 累计
 *  - 指定 day（YYYY-MM-DD）= 当日
 * 只统计 source='training_correct' 的正向流水，不掺入 admin_reset 等冲减。
 */
export function sumTrainingEarned(userId: number, day?: string): number {
  const db = getDb();
  const sql =
    day != null
      ? "SELECT COALESCE(SUM(delta), 0) AS s FROM coins_ledger WHERE user_id = ? AND source = 'training_correct' AND day = ?"
      : "SELECT COALESCE(SUM(delta), 0) AS s FROM coins_ledger WHERE user_id = ? AND source = 'training_correct'";
  const row = (day != null
    ? db.prepare(sql).get(userId, day)
    : db.prepare(sql).get(userId)) as { s: number } | undefined;
  return row ? Number(row.s) || 0 : 0;
}

/* ═══════════════════════ 训练场每日铜板上限 ═══════════════════════ */

/**
 * 训练场（arena）每天最多能赚多少铜板。
 *
 * 【2026-10-22 按需求】上限 300。判据是「实际到手的铜板」，
 * 与答题次数、题目数量无关：同一账号当天累计够 300 后，
 * 后续结算只记成绩、不再发币（退费也不占用额度）。
 */
export const ARENA_DAILY_COIN_CAP = 300;

/**
 * 今日训练场已获得铜板。
 * 同时统计新 arena 的 `arena_correct` 与旧训练场的 `training_correct`，
 * 避免历史流水（同一天两种来源都有）被漏算；只计正向流水，退费/冲减不占额度。
 */
export function arenaEarnedToday(userId: number): number {
  /* 【2026-11-06 改口径：毛收入 → 净收益】
     原来只 SUM 正数流水，入场费（arena_entry -3/局）不算在内，于是
     「上限 300」在学生眼里变成了「一天只能拿 210」—— 打 30 局先交 90，
     再赚满 300 就封顶，净到手 210。反馈里 288、283 两条说的就是这个
     （「只刷了 205/207 就上限了，300 到底算的是什么」）。

     现在把入场费与退款一起计入，上限的语义变成「今天靠训练场净赚 300」：
       · 每局赚 10 → 净 +7，额度按 7 扣，打到 300 为止
       · 没玩成退回来的入场费（arena_refund +3）会把已占额度冲回去
       · 净额为负（只输不赢）时按 0 处理，不会倒欠额度
     上限数值本身不变，仍然是 300。 */
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(delta), 0) AS x FROM coins_ledger
       WHERE user_id = ? AND day = ?
         AND source IN (
           'arena_correct', 'training_correct',
           'arena_entry', 'training_entry',
           'arena_refund', 'training_refund',
           'arena_learning', 'training_learning'
         )`
    )
    .get(userId, todayCn()) as { x: number } | undefined;
  return Math.max(0, Number(row?.x) || 0);
}

/** 今日训练场还剩多少可赚额度（0 表示已封顶） */
export function arenaRemainingToday(userId: number): number {
  return Math.max(0, ARENA_DAILY_COIN_CAP - arenaEarnedToday(userId));
}
