/**
 * 一次性补偿脚本：把「已扣 6 铜板入场费、但一题未答」的孤儿局入场费退回用户。
 *
 * 复用 routes/arena.ts 的 sweepOpenSessions()，把「未作答」阈值放宽到 0 秒，
 * 因此和线上定时清扫走的是同一套幂等/状态守卫逻辑：
 *  - 只处理 status='open' 的局，已 refunded/done/abandoned 一律跳过；
 *  - 事务内二次校验状态 + 校验 coins_ledger 无同一 session 的 arena_refund；
 *  - 重复执行不会重复加钱。
 * 同时把「已作答」阈值设成极大值，保证本脚本只退费、不做任何结算发奖。
 *
 * 用法：cd server && node dist/scripts/sweep-arena-once.js
 */
import { getDb } from '../db/database';
import { sweepOpenSessions } from '../routes/arena';

const db = getDb();

function nameOf(userId: number): string {
  const row = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as
    | { username: string }
    | undefined;
  return row ? row.username : `(user ${userId})`;
}

function accountDiff(): string {
  const row = db
    .prepare(
      `SELECT (SELECT COALESCE(SUM(coins),0) FROM users) AS uc,
              (SELECT COALESCE(SUM(delta),0) FROM coins_ledger) AS lc`
    )
    .get() as { uc: number; lc: number };
  return `users.coins=${row.uc} ledger=${row.lc} 差额=${row.lc - row.uc}`;
}

const pending = db
  .prepare(
    `SELECT s.id, s.user_id, s.entry_fee, s.created_at
     FROM arena_sessions s
     WHERE s.status = 'open' AND s.answered_count = 0
     ORDER BY s.id`
  )
  .all() as { id: number; user_id: number; entry_fee: number; created_at: number }[];

console.log('=== 补偿前 ===');
console.log(`待退孤儿局：${pending.length} 条`);
console.log(`账目：${accountDiff()}`);

// 只退费：未作答阈值 0 秒（全部纳入）；已作答阈值设极大值（本脚本不结算发奖）
const result = sweepOpenSessions({ refundIdleSec: 0, abandonIdleSec: 10 ** 9 });

console.log('\n=== 退费清单（session_id → username → +铜板）===');
let total = 0;
const users = new Set<number>();
for (const e of result.refunded) {
  total += e.delta;
  users.add(e.userId);
  console.log(`session ${e.sessionId} → ${nameOf(e.userId)} (user ${e.userId}) → +${e.delta}`);
}

console.log('\n=== 汇总 ===');
console.log(`补偿用户数：${users.size}`);
console.log(`退费笔数：${result.refunded.length}`);
console.log(`退费总额：${total} 铜板`);
console.log(`结算笔数：${result.abandoned.length}（本脚本不结算，应为 0）`);
console.log(`守卫跳过：${result.skipped} 条，失败：${result.failed} 条`);

console.log('\n=== 补偿后 ===');
console.log(`账目：${accountDiff()}`);
const left = db
  .prepare("SELECT COUNT(*) AS n FROM arena_sessions WHERE status='open' AND answered_count=0")
  .get() as { n: number };
console.log(`残留 open+未作答：${left.n} 条`);
