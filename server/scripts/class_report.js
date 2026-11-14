/**
 * 教师学情报表（2026-11-06，七项清单第 7 项）
 * ============================================================
 * 不用模型。教师报表的每一个数字都会被拿去做判断（谁该谈话、
 * 谁该表扬），错一个就是误导。SQL 直出，可核对、可复算。
 *
 * 口径（重要，写清楚免得被误读）：
 *   · 全站每人都是同一套 869 张预制卡，「学了 300 张」的意思是
 *     「这套卡里他已过 300 张」，不是「他只有 300 张」。
 *   · 活跃 = 当天有 revlog 记录（任意一张卡）。
 *   · 有效学习 = 当天有 ≥10 条记录且秒过率 < 80%。
 *     秒过率 = 单次复习耗时 < 1s 的占比。刷时长的会被这张表抓出来。
 *   · 正确率 = 复习时判为「忘记」的比例的反面，只统计 review_type=2（复习卡）。
 *
 * 产出表：
 *   class_report_daily   每人每天一行（近 60 天）
 *   class_report_weekly  每人每周一行（近 8 周）
 *   class_report_summary 全班当前快照
 */
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const db = new Database(path.join(ROOT, 'data', 'keyi.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 8000');

const TZ = "'+8 hours'";

db.exec(`
  CREATE TABLE IF NOT EXISTS class_report_daily (
    user_id    INTEGER NOT NULL,
    username   TEXT NOT NULL DEFAULT '',
    day        TEXT NOT NULL,
    reviews    INTEGER NOT NULL DEFAULT 0,
    new_cards  INTEGER NOT NULL DEFAULT 0,
    correct    INTEGER NOT NULL DEFAULT 0,
    accuracy   REAL NOT NULL DEFAULT 0,
    fast_n     INTEGER NOT NULL DEFAULT 0,
    fast_pct   REAL NOT NULL DEFAULT 0,
    seconds    REAL NOT NULL DEFAULT 0,
    effective  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  );
  CREATE TABLE IF NOT EXISTS class_report_weekly (
    user_id    INTEGER NOT NULL,
    username   TEXT NOT NULL DEFAULT '',
    week_start TEXT NOT NULL,
    reviews    INTEGER NOT NULL DEFAULT 0,
    active_days INTEGER NOT NULL DEFAULT 0,
    accuracy   REAL NOT NULL DEFAULT 0,
    fast_pct   REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, week_start)
  );
  CREATE TABLE IF NOT EXISTS class_report_summary (
    user_id     INTEGER PRIMARY KEY,
    username    TEXT NOT NULL DEFAULT '',
    studied     INTEGER NOT NULL DEFAULT 0,
    studied_pct REAL NOT NULL DEFAULT 0,
    rev_30d     INTEGER NOT NULL DEFAULT 0,
    active_30d  INTEGER NOT NULL DEFAULT 0,
    acc_30d     REAL NOT NULL DEFAULT 0,
    fast_30d    REAL NOT NULL DEFAULT 0,
    days_idle   INTEGER NOT NULL DEFAULT 0,
    wrong_open  INTEGER NOT NULL DEFAULT 0,
    flag        TEXT NOT NULL DEFAULT '',
    computed_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

/* ── 1. 日表 ── */
db.prepare('DELETE FROM class_report_daily').run();
const daily = db
  .prepare(
    `SELECT r.user_id,
            date(r.reviewed_at,'unixepoch',${TZ}) AS day,
            COUNT(*) AS reviews,
            SUM(CASE WHEN r.review_type = 0 THEN 1 ELSE 0 END) AS new_cards,
            SUM(CASE WHEN r.review_type = 2 AND r.ease > 1 THEN 1 ELSE 0 END) AS correct,
            SUM(CASE WHEN r.review_type = 2 THEN 1 ELSE 0 END) AS reviewed,
            SUM(CASE WHEN r.time_ms < 1000 THEN 1 ELSE 0 END) AS fast_n,
            SUM(r.time_ms) / 1000.0 AS seconds
       FROM revlog r
      WHERE r.reviewed_at >= strftime('%s','now','-60 days')
      GROUP BY r.user_id, day`
  )
  .all();

const insD = db.prepare(`INSERT OR REPLACE INTO class_report_daily
  (user_id,username,day,reviews,new_cards,correct,accuracy,fast_n,fast_pct,seconds,effective)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);

/* ease>1 当作「没忘」（Anki 语义：ease 1=again 2=hard 3=good 4=easy） */
const uname = new Map(db.prepare('SELECT id, username FROM users').all().map((u) => [u.id, u.username]));

const txD = db.transaction(() => {
  for (const d of daily) {
    const reviewed = d.reviewed || 0;
    const acc = reviewed ? (d.correct || 0) / reviewed : 0;
    const fastPct = d.reviews ? (d.fast_n || 0) / d.reviews : 0;
    const effective = d.reviews >= 10 && fastPct < 0.8 ? 1 : 0;
    insD.run(
      d.user_id, uname.get(d.user_id) || '', d.day, d.reviews, d.new_cards || 0,
      d.correct || 0, Math.round(acc * 1000) / 1000, d.fast_n || 0,
      Math.round(fastPct * 1000) / 1000, Math.round(d.seconds || 0), effective
    );
  }
});
txD();

/* ── 2. 周表 ── */
db.prepare('DELETE FROM class_report_weekly').run();
const weekly = db
  .prepare(
    `SELECT user_id,
            date(day, 'weekday 0', '-6 days') AS week_start,
            SUM(reviews) AS reviews,
            COUNT(DISTINCT day) AS active_days,
            SUM(correct) AS correct,
            SUM(CASE WHEN reviews > 0 THEN reviews ELSE 0 END) AS tot,
            SUM(fast_n) AS fast_n
       FROM class_report_daily GROUP BY user_id, week_start`
  )
  .all();
const insW = db.prepare(`INSERT OR REPLACE INTO class_report_weekly
  (user_id,username,week_start,reviews,active_days,accuracy,fast_pct) VALUES (?,?,?,?,?,?,?)`);
const txW = db.transaction(() => {
  for (const w of weekly) {
    const reviewed = w.tot || 0;
    insW.run(
      w.user_id, uname.get(w.user_id) || '', w.week_start, w.reviews,
      w.active_days, reviewed ? Math.round(((w.correct || 0) / reviewed) * 1000) / 1000 : 0,
      w.reviews ? Math.round(((w.fast_n || 0) / w.reviews) * 1000) / 1000 : 0
    );
  }
});
txW();

/* ── 3. 快照 ── */
db.prepare('DELETE FROM class_report_summary').run();
const summary = db
  .prepare(
    `SELECT u.id AS uid, u.username,
       (SELECT COUNT(*) FROM cards WHERE user_id=u.id AND reps>0) AS studied,
       (SELECT COUNT(*) FROM cards WHERE user_id=u.id) AS total,
       (SELECT COUNT(*) FROM revlog WHERE user_id=u.id AND reviewed_at >= strftime('%s','now','-30 days')) AS rev30,
       (SELECT COUNT(DISTINCT date(reviewed_at,'unixepoch',${TZ})) FROM revlog
         WHERE user_id=u.id AND reviewed_at >= strftime('%s','now','-30 days')) AS act30,
       (SELECT CASE WHEN COUNT(*)=0 THEN 0
          ELSE 1.0*SUM(CASE WHEN review_type=2 AND ease>1 THEN 1 ELSE 0 END)
               /NULLIF(SUM(CASE WHEN review_type=2 THEN 1 ELSE 0 END),0) END
         FROM revlog WHERE user_id=u.id AND reviewed_at >= strftime('%s','now','-30 days')) AS acc30,
       (SELECT CASE WHEN COUNT(*)=0 THEN 0
          ELSE 1.0*SUM(CASE WHEN time_ms<1000 THEN 1 ELSE 0 END)/COUNT(*) END
         FROM revlog WHERE user_id=u.id AND reviewed_at >= strftime('%s','now','-30 days')) AS fast30,
       (SELECT COUNT(*) FROM revlog WHERE user_id=u.id) AS rev_all,
       (SELECT MAX(reviewed_at) FROM revlog WHERE user_id=u.id) AS last_rev,
       (SELECT COUNT(*) FROM wrong_book WHERE user_id=u.id AND resolved=0) AS wrong
     FROM users u WHERE u.role='user'`
  )
  .all();

const insS = db.prepare(`INSERT INTO class_report_summary
  (user_id,username,studied,studied_pct,rev_30d,active_30d,acc_30d,fast_30d,days_idle,wrong_open,flag,computed_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,unixepoch())`);

/* 标签：给老师一个直接可用的分组，不用自己算
 * idle = -1 表示「一条复习记录都没有」，和「闲置很久」是两回事：
 * 前者是根本没开始（该催注册/开通），后者是学了又停（该谈话）。
 * 早先把无记录兜成 999 天，结果从没学过的 5 个人被排到流失最久的位置。 */
function flagOf(r) {
  if (r.idle < 0) return '未开始';
  if (r.idle >= 30) return '已流失';
  if (r.idle >= 8) return '掉队';
  if (r.fast30 > 0.3) return '疑似刷时长';
  if (r.act30 >= 15 && (r.acc30 || 0) >= 0.85) return '稳定';
  if (r.act30 >= 10) return '正常';
  if (r.act30 > 0) return '偏少';
  return '未开始';
}

const txS = db.transaction(() => {
  for (const r of summary) {
    r.idle = r.rev_all ? Math.floor((Date.now() / 1000 - r.last_rev) / 86400) : -1;
    if (r.idle < 0) r.idle = -1;
    insS.run(
      r.uid, r.username,
      r.studied || 0,
      r.total ? Math.round(((r.studied || 0) / r.total) * 1000) / 1000 : 0,
      r.rev30 || 0, r.act30 || 0,
      Math.round((r.acc30 || 0) * 1000) / 1000,
      Math.round((r.fast30 || 0) * 1000) / 1000,
      r.idle,
      r.wrong || 0,
      flagOf(r)
    );
  }
});
txS();

console.log(`日表 ${daily.length} 行，周表 ${weekly.length} 行，快照 ${summary.length} 人`);
const flags = db
  .prepare('SELECT flag, COUNT(*) n FROM class_report_summary GROUP BY flag ORDER BY n DESC')
  .all();
console.log('\n学生分组：');
for (const f of flags) console.log(`  ${f.flag}  ${f.n} 人`);

const top = db
  .prepare("SELECT username, studied, active_30d, acc_30d FROM class_report_summary WHERE flag='稳定' ORDER BY active_30d DESC LIMIT 5")
  .all();
console.log('\n稳定学习前 5：');
for (const t of top) console.log(`  ${t.username}  学过 ${t.studied} 张  30天活跃 ${t.active_30d} 天  正确率 ${(t.acc_30d * 100).toFixed(0)}%`);

const risk = db
  .prepare("SELECT username, days_idle, wrong_open, studied FROM class_report_summary WHERE flag IN ('掉队','已流失') ORDER BY days_idle DESC LIMIT 5")
  .all();
console.log('\n最需要谈话的 5 人（学过又停下来的）：');
for (const t of risk) console.log(`  ${t.username}  闲置 ${t.days_idle} 天  学过 ${t.studied} 张  未解决错题 ${t.wrong_open}`);

const never = db
  .prepare("SELECT username FROM class_report_summary WHERE flag='未开始' LIMIT 10")
  .all();
console.log(`\n从未学过（该催开通，不是谈话对象）：${never.length ? never.map((t) => t.username).join('、') : '无'}`);
