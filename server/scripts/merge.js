/**
 * 把人工撰写的辨析合并入库
 * ============================================================
 * 只写 analysis/confusion/tip，senses 保留原样（前端要用它配例句）。
 * model 标记为 'manual'，方便以后区分来源、单独重跑。
 */
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const db = new Database(path.join(ROOT, 'data', 'keyi.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 8000');

const files = ['notes_p1', 'notes_p2', 'notes_p3', 'notes_p4', 'notes_p5', 'notes_p6', 'notes_p7', 'notes_p8'];
let rows = [];
for (const f of files) {
  try {
    rows = rows.concat(require(path.join(__dirname, 'notes', f + '.js')));
  } catch (e) {
    console.error('读不到', f, e.message);
  }
}
console.log('待写入', rows.length, '条');

const up = db.prepare(`INSERT INTO word_ai_notes (char,senses,analysis,confusion,tip,model,created_at)
  VALUES (?,?,?,?,?,'manual',unixepoch())
  ON CONFLICT(char) DO UPDATE SET analysis=excluded.analysis,
    confusion=excluded.confusion, tip=excluded.tip, model=excluded.model, created_at=excluded.created_at`);

/* 已有的 senses 不能丢，先查出来 */
const getSenses = db.prepare('SELECT senses FROM word_ai_notes WHERE char = ?');

/* 表里还没有这个字时，直接从 notes 表现算 senses（和生成器同一套口径） */
const allNotes = db
  .prepare("SELECT DISTINCT fields FROM notes WHERE fields LIKE '%**%' AND fields LIKE '%==%'")
  .all();
const senseMap = new Map();
const cl = (x) => (x || '').replace(/<[^>]+>/g, '').replace(/\*\*/g, '').trim();
for (const { fields } of allNotes) {
  let arr;
  try {
    arr = JSON.parse(fields);
  } catch {
    continue;
  }
  if (!Array.isArray(arr) || arr.length < 2) continue;
  const m1 = /\*\*(.+?)\*\*/.exec(arr[0] || '');
  const m2 = /==(.+?)==/.exec(arr[1] || '');
  if (!m1 || !m2) continue;
  const ch = m1[1].trim();
  if ([...ch].length !== 1) continue;
  const def = (m2[1] || '').replace(/<br\s*\/?>/gi, '；').replace(/\*\*/g, '').trim();
  if (!senseMap.has(ch)) senseMap.set(ch, []);
  const l = senseMap.get(ch);
  if (!l.some((x) => x.def === def)) l.push({ def, sent: cl(arr[0]), trans: cl(arr[2]) });
}

let ok = 0;
const tx = db.transaction(() => {
  for (const r of rows) {
    if (!r.char || !r.analysis) continue;
    let senses = getSenses.get(r.char)?.senses;
    if (!senses) {
      const calc = senseMap.get(r.char);
      if (!calc || !calc.length) {
        console.warn('真的没有义项数据，跳过', r.char);
        continue;
      }
      senses = JSON.stringify(calc);
    }
    up.run(r.char, senses, r.analysis.trim(), (r.confusion || '').trim(), (r.tip || '').trim());
    ok++;
  }
});
tx();
console.log('写入完成', ok, '条');

const stat = db.prepare('SELECT model, COUNT(*) n FROM word_ai_notes GROUP BY model').all();
console.log(stat);
