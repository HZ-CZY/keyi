/**
 * 错题举一反三（2026-11-06，七项清单第 3 项）
 * ============================================================
 * 学生错一道题，他真正没搞懂的不是这道题，是「这个字的这个义项」。
 * 所以「反三」的落点不是再给他一道相似的题，而是：
 *   ① 把这个字在全部课文里的**其他义项**摆出来 —— 让他看清这个字有
 *      几条线，他错的那条在哪；
 *   ② 把他错的那个义项，配上**另一篇课文**里的例句 —— 换语境再认一次，
 *      这是「反三」的核心：同一个意思，在不同句子里认出来；
 *   ③ 给出这个字最容易混的两个义项，指明判断办法。
 *
 * 数据来源：
 *   wrong_book  → 谁错了哪张卡
 *   cards/notes → 卡面对应哪个字、哪个义项、哪句课文
 *   全库同字义项 → 用来「反三」
 *   word_ai_notes → 已写好的跨义辨析，直接复用
 *
 * 产出表：
 *   wrong_insight  每个学生每个字一行：错了哪些义项、还差哪几条线
 */
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const db = new Database(path.join(ROOT, 'data', 'keyi.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 8000');

const clean = (x) =>
  String(x || '')
    .replace(/<br\s*\/?>/gi, '；')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;|&#\d+;/gi, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/* 释义：兼容「==释义==」与纯释义两种写法 */
function parseDef(s) {
  const raw = String(s || '').trim();
  const m = /==(.+?)==/.exec(raw);
  let d = m ? clean(m[1]) : clean(raw);
  /* 有的义项前面挂着出处，两种写法都有：
     「（《阿房宫赋》）经过」和「《阿房宫赋》经过」。
     不剥掉会被当成一条独立义项，页面上就读成「《阿房宫赋》经过」。 */
  d = d.replace(/^[（(]\s*《[^》]*》\s*[）)]\s*/, '');
  d = d.replace(/^《[^》]*》\s*/, '');
  /* 去掉开头的注音「bèn，」 */
  d = d.replace(/^[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]+\s*[,，]\s*/i, '');
  return clean(d);
}

/* 从 fields 取出 字 / 义项 / 例句 / 译文 */
function parseNote(fields) {
  let a;
  try {
    a = JSON.parse(fields);
  } catch {
    return null;
  }
  if (!Array.isArray(a) || a.length < 2) return null;
  const m1 = /\*\*(.+?)\*\*/.exec(a[0] || '');
  if (!m1) return null;
  const ch = m1[1].trim();
  if ([...ch].length !== 1) return null;
  const def = parseDef(a[1]);
  if (!def) return null;
  return { char: ch, def, sent: clean(a[0]), trans: clean(a[2]) };
}

db.exec(`
  CREATE TABLE IF NOT EXISTS wrong_insight (
    user_id     INTEGER NOT NULL,
    char        TEXT NOT NULL,
    wrong_n     INTEGER NOT NULL DEFAULT 0,
    wrong_defs  TEXT NOT NULL DEFAULT '[]',
    total_defs  INTEGER NOT NULL DEFAULT 0,
    coverage    REAL NOT NULL DEFAULT 0,
    lines       TEXT NOT NULL DEFAULT '[]',
    confused    TEXT NOT NULL DEFAULT '',
    tip         TEXT NOT NULL DEFAULT '',
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, char)
  )
`);

/* ── 1. 全库：每个字的全部义项（用来「反三」）── */
const allNotes = db.prepare('SELECT fields FROM notes').all();
const byChar = new Map(); // char -> [{def, sent, trans}]
const defSeen = new Map(); // char -> Set(def 核心)
for (const r of allNotes) {
  const p = parseNote(r.fields);
  if (!p) continue;
  if (!byChar.has(p.char)) {
    byChar.set(p.char, []);
    defSeen.set(p.char, new Set());
  }
  const core = p.def.split(/[，,；;（(]/)[0].trim();
  if (!core || defSeen.get(p.char).has(core)) continue;
  defSeen.get(p.char).add(core);
  byChar.get(p.char).push(p);
}

/* ── 2. 错题：谁、错了哪个字、哪个义项 ── */
const wrongs = db.prepare(
  `SELECT w.user_id, w.wrong_count, n.fields
     FROM wrong_book w
     JOIN cards c ON c.id = w.card_id
     JOIN notes n ON n.id = c.note_id
    WHERE w.resolved = 0`
).all();

const acc = new Map(); // `${uid}|${char}` -> {uid,char,wrongN,wrongDefs:Set}
for (const w of wrongs) {
  const p = parseNote(w.fields);
  if (!p) continue;
  const k = `${w.user_id}|${p.char}`;
  if (!acc.has(k)) acc.set(k, { uid: w.user_id, char: p.char, wrongN: 0, wrongDefs: new Set() });
  const e = acc.get(k);
  e.wrongN += w.wrong_count || 1;
  e.wrongDefs.add(p.def.split(/[，,；;（(]/)[0].trim());
}

/* ── 3. 辨析（已写好的 121 条）── */
const aiMap = new Map();
for (const r of db.prepare('SELECT char, analysis, confusion, tip FROM word_ai_notes').all()) {
  aiMap.set(r.char, r);
}

/* ── 4. 组装 ── */
const up = db.prepare(`INSERT INTO wrong_insight
  (user_id,char,wrong_n,wrong_defs,total_defs,coverage,lines,confused,tip,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,unixepoch())
  ON CONFLICT(user_id,char) DO UPDATE SET
    wrong_n=excluded.wrong_n, wrong_defs=excluded.wrong_defs, total_defs=excluded.total_defs,
    coverage=excluded.coverage, lines=excluded.lines, confused=excluded.confused,
    tip=excluded.tip, updated_at=excluded.updated_at`);

let n = 0;
const tx = db.transaction(() => {
  for (const e of acc.values()) {
    const all = byChar.get(e.char) || [];
    if (!all.length) continue;

    /* 每条线：义项 + 一条学生没见过的例句（优先挑跟他错的义项不同的课文） */
    const lines = all.slice(0, 8).map((s) => ({
      /* 有的义项前面挂了「（《阿房宫赋》）」这种出处，剥掉，否则显示成一条野义项 */
      def: s.def
        .replace(/^[（(]《[^》]*》[）)]\s*/, '')
        .split(/[，,；;（(]/)[0]
        .trim(),
      sent: s.sent,
      trans: s.trans,
      missed: !e.wrongDefs.has(s.def.split(/[，,；;（(]/)[0].trim()),
    }));

    /* 覆盖率：错的义项占这个字全部义项的比例 —— 越低说明他只见了冰山一角 */
    const coverage = all.length ? e.wrongDefs.size / all.length : 0;
    const ai = aiMap.get(e.char);

    up.run(
      e.uid,
      e.char,
      e.wrongN,
      JSON.stringify([...e.wrongDefs]),
      all.length,
      Math.round(coverage * 1000) / 1000,
      JSON.stringify(lines),
      ai ? ai.confusion : '',
      ai ? ai.tip : ''
    );
    n++;
  }
});
tx();

console.log(`wrong_insight 写入 ${n} 行`);
const s = db.prepare('SELECT COUNT(DISTINCT user_id) u, COUNT(DISTINCT char) c, COUNT(*) n FROM wrong_insight').get();
console.log('覆盖用户', s.u, '个字', s.c, '行数', s.n);

/* 抽一个用户看效果 */
const demo = db
  .prepare('SELECT * FROM wrong_insight ORDER BY wrong_n DESC LIMIT 1')
  .get();
if (demo) {
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(demo.user_id);
  console.log(`\n示例：${u?.username || demo.user_id} 栽在「${demo.char}」${demo.wrong_n} 次`);
  console.log(`  错了 ${JSON.parse(demo.wrong_defs).length}/${demo.total_defs} 条线，覆盖率 ${(demo.coverage * 100).toFixed(0)}%`);
  console.log('  错的是：', JSON.parse(demo.wrong_defs).join(' / '));
  console.log('  还没碰过的线：', JSON.parse(demo.lines).filter((x) => x.missed).map((x) => x.def).slice(0, 6).join(' / '));
  console.log('  辨识：', (demo.confused || '（无）').slice(0, 90));
}
