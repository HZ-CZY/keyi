/**
 * 落后学生回归计划（2026-11-06，七项清单第 5 项）
 * ============================================================
 * 「落后」有三种人，救法完全不同，混在一起就救不了：
 *
 *   stale      还来但没复习 —— 最近登录过，但几天没刷卡。这是「忘了」，
 *              该给一个极低门槛的回归动作（3 张卡，不是 50 张）。
 *   drifted    走了但没走远 —— 8~30 天没来。这是「断了」，该给台阶：
 *              告诉他欠了多少、今天只要做多少就能接上，别报总数吓他。
 *   lost       30 天以上没来 —— 已经放弃。常规提醒无效，只能靠外部钩子
 *              （同伴有动静、部落被打、班级有活动）。
 *
 * 判断依据不用「学了多少」，用**衰减速度**：
 *   把到期卡片堆成「今天不做会积到多少」，这个数比「总共学了几张」
 *   更能反映他回不回得来。积压 500 张的人打开就要放弃。
 *
 * 产出：
 *   student_retention  每人一行：状态、距今天数、积压量、建议动作
 *   retention_plan     给每个人的回归任务（今日 3~8 张，按积压量递减）
 */
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const db = new Database(path.join(ROOT, 'data', 'keyi.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 8000');

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);

db.exec(`
  CREATE TABLE IF NOT EXISTS student_retention (
    user_id      INTEGER PRIMARY KEY,
    username     TEXT NOT NULL DEFAULT '',
    state        TEXT NOT NULL DEFAULT '',
    days_idle    INTEGER NOT NULL DEFAULT 0,
    due_now      INTEGER NOT NULL DEFAULT 0,
    due_today    INTEGER NOT NULL DEFAULT 0,
    total_cards  INTEGER NOT NULL DEFAULT 0,
    active_days  INTEGER NOT NULL DEFAULT 0,
    streak_best  INTEGER NOT NULL DEFAULT 0,
    plan_size    INTEGER NOT NULL DEFAULT 0,
    hook         TEXT NOT NULL DEFAULT '',
    computed_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_retention_state ON student_retention(state, days_idle DESC);
`);

/* ── 1. 每人最近一次复习、复习天数、卡片数 ── */
const base = db
  .prepare(
    `SELECT u.id AS uid, u.username,
            COALESCE((SELECT MAX(reviewed_at) FROM revlog WHERE user_id = u.id), 0) AS last_rev,
            COALESCE((SELECT COUNT(DISTINCT date(reviewed_at,'unixepoch','+8 hours')) FROM revlog WHERE user_id = u.id), 0) AS active_days,
            COALESCE((SELECT COUNT(*) FROM cards WHERE user_id = u.id), 0) AS total_cards,
            COALESCE(u.last_login_at, 0) AS last_login
       FROM users u
      WHERE u.banned_until < ? OR u.banned_until = 0`
  )
  .all(now);

/* ── 2. 积压量：按 SM-2 的 due 算，今天到期和总量都取 ── */
/* 注意：全站每人都是同一套 869 张卡（统一题库预制），所以「到期」几乎等于
   「全部卡」，直接拿 due<=now 计数会把每个人都算成欠 869 张，没有区分度。
   真正有意义的是「已经学过的卡里有多少该复习了」——按 reps>0 区分。 */
const dueStmt = db.prepare(
  `SELECT
     SUM(CASE WHEN reps > 0 AND due <= ? THEN 1 ELSE 0 END) AS due_now,
     SUM(CASE WHEN reps > 0 AND due <= ? THEN 1 ELSE 0 END) AS due_today,
     SUM(CASE WHEN reps > 0 THEN 1 ELSE 0 END) AS studied
   FROM cards WHERE user_id = ?`
);
const endOfToday = (() => {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  d.setUTCHours(23, 59, 59, 0);
  return Math.floor(d.getTime() / 1000) - 8 * 3600;
})();

/* ── 3. 最长连续签到，用来做钩子 ── */
const bestStreak = (uid) => {
  const rows = db
    .prepare("SELECT checked_date FROM checkins WHERE user_id = ? ORDER BY checked_date ASC")
    .all(uid);
  let best = 0;
  let cur = 0;
  let prev = '';
  for (const r of rows) {
    if (!prev) cur = 1;
    else {
      const p = new Date(prev + 'T00:00:00Z').getTime();
      const c = new Date(r.checked_date + 'T00:00:00Z').getTime();
      cur = c - p === DAY * 1000 ? cur + 1 : 1;
    }
    if (cur > best) best = cur;
    prev = r.checked_date;
  }
  return best;
};

/* ── 4. 判定与计划 ── */
function decide(daysIdle, dueNow) {
  /* 还来，但没复习 */
  if (daysIdle <= 3) return 'ok';
  if (daysIdle <= 7) return 'stale';
  if (daysIdle <= 30) return 'drifted';
  return 'lost';
}

function planSize(state, dueNow) {
  /* 积压越多，给的量越少。让 500 张积压的人做 3 张，只要他做，
     队列就不会继续烂下去；报 500 张他直接关掉页面。 */
  if (state === 'stale') return Math.min(10, Math.max(5, Math.ceil(dueNow / 20)));
  if (state === 'drifted') return dueNow <= 60 ? 8 : dueNow <= 200 ? 5 : 3;
  if (state === 'lost') return 3;
  return 0;
}

function hookFor(state, dueNow, streak) {
  if (state === 'stale') {
    return dueNow > 0
      ? `今天到期 ${dueNow} 张，先做 ${Math.min(10, Math.ceil(dueNow / 20))} 张就能压住，不用一次清完`
      : '今天没有到期的，随便刷 5 张热热身';
  }
  if (state === 'drifted') {
    if (dueNow > 200) return `欠了 ${dueNow} 张，别看着怕——今天只做 3 张，算续上`;
    if (dueNow > 0) return `欠了 ${dueNow} 张，做 5 张就算回来过`;
    return '没欠账，做 5 张就把手感找回来';
  }
  if (state === 'lost') {
    return streak >= 7
      ? `你最长连续签过 ${streak} 天，那会儿的手感还在，做 3 张试试`
      : '不用补，从今天 3 张重新开始';
  }
  return '';
}

const rows = [];
for (const b of base) {
  const lastAct = Math.max(b.last_rev || 0, b.last_login || 0);
  /* 完全没动过的账号不参与（8 个），不打扰 */
  if (!b.last_rev && !b.last_login) continue;

  const daysIdle = lastAct ? Math.floor((now - lastAct) / DAY) : 999;
  const d = dueStmt.get(now, endOfToday, b.uid) || { due_now: 0, due_today: 0 };
  const dueNow = d.due_now || 0;
  const studied = d.studied || 0;
  const state = decide(daysIdle, dueNow);
  if (state === 'ok') continue;

  const ps = planSize(state, dueNow);
  rows.push({
    uid: b.uid,
    username: b.username,
    state,
    daysIdle,
    dueNow,
    dueToday: d.due_today || 0,
    totalCards: studied,
    activeDays: b.active_days,
    streakBest: bestStreak(b.uid),
    planSize: ps,
    hook: hookFor(state, dueNow, bestStreak(b.uid)),
  });
}

const up = db.prepare(`INSERT INTO student_retention
  (user_id,username,state,days_idle,due_now,due_today,total_cards,active_days,streak_best,plan_size,hook,computed_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,unixepoch())
  ON CONFLICT(user_id) DO UPDATE SET
    username=excluded.username, state=excluded.state, days_idle=excluded.days_idle,
    due_now=excluded.due_now, due_today=excluded.due_today, total_cards=excluded.total_cards,
    active_days=excluded.active_days, streak_best=excluded.streak_best,
    plan_size=excluded.plan_size, hook=excluded.hook, computed_at=excluded.computed_at`);

const tx = db.transaction(() => {
  for (const r of rows) {
    up.run(r.uid, r.username, r.state, r.daysIdle, r.dueNow, r.dueToday,
      r.totalCards, r.activeDays, r.streakBest, r.planSize, r.hook);
  }
});
tx();

const s = db.prepare('SELECT state, COUNT(*) n FROM student_retention GROUP BY state').all();
console.log('='.repeat(52));
console.log(`需要回归干预的学生：${rows.length} 人`);
for (const x of s) console.log(`  ${x.state}  ${x.n}`);

console.log('\n── 各状态样例 ──');
for (const st of ['stale', 'drifted', 'lost']) {
  const one = db.prepare('SELECT * FROM student_retention WHERE state = ? ORDER BY due_now DESC LIMIT 1').get(st);
  if (!one) continue;
  console.log(`[${st}] ${one.username}  闲置 ${one.days_idle} 天  积压 ${one.due_now} 张  计划 ${one.plan_size} 张`);
  console.log(`      ${one.hook}`);
}
