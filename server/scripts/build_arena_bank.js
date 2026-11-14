/**
 * 竞技场题库扩充（2026-11-06，七项清单第 4 项）
 * ============================================================
 * 问题不在题量，在**干扰项池太小**。
 *
 * 现状：buildPools(cards) 只拿当前学生自己的卡做干扰项池。
 *   学生只有 30 张卡 → 义项池里只有 30 条 → 4 个选项里有 2~3 个
 *   是从这 30 条里挑的，一眼就能排掉。打久了就变成肌肉记忆，
 *   题目没难度，还容易撞见重复选项。
 *
 * 做法：建一张全局题库 arena_bank，从全站 16 万条笔记里，
 *   按「义项长度 4~30 字、例句不超 60 字、有书名出处」筛出干净条目，
 *   按字去重。出题时：
 *     · 干扰项优先从「同字不同义」里挑 —— 这才是真会混的
 *     · 同字不够再从全局池补
 *     · 学生自己的卡照旧出题，不替换，只扩充选项来源
 *
 * 用法：
 *   node scripts/build_arena_bank.js          # 重建
 *   node scripts/build_arena_bank.js --stat   # 只看统计
 */
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const db = new Database(path.join(ROOT, 'data', 'keyi.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 8000');

const STAT_ONLY = process.argv.includes('--stat');

const clean = (x) =>
  String(x || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z]+;|&#\d+;/gi, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function parseDef(s) {
  const raw = String(s || '').trim();
  const m = /==(.+?)==/.exec(raw);
  let d = m ? clean(m[1]) : clean(raw);
  d = d.replace(/^[（(]\s*《[^》]*》\s*[）)]\s*/, '').replace(/^《[^》]*》\s*/, '');
  d = d.replace(/^[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]+\s*[,，]\s*/i, '');
  return clean(d);
}

const BOOK = /[《(（]\s*([^》())（）]{2,12})\s*[》]?/;

db.exec(`
  CREATE TABLE IF NOT EXISTS arena_bank (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    char      TEXT NOT NULL,
    def       TEXT NOT NULL,
    sent      TEXT NOT NULL,
    trans     TEXT NOT NULL DEFAULT '',
    book      TEXT NOT NULL DEFAULT '',
    def_len   INTEGER NOT NULL DEFAULT 0,
    UNIQUE(char, def, sent)
  );
  CREATE INDEX IF NOT EXISTS idx_bank_char ON arena_bank(char);
  CREATE INDEX IF NOT EXISTS idx_bank_deflen ON arena_bank(def_len);
`);

if (STAT_ONLY) {
  const s = db.prepare('SELECT COUNT(*) n, COUNT(DISTINCT char) c FROM arena_bank').get();
  console.log('arena_bank', s.n, '条，', s.c, '个字');
  process.exit(0);
}

/* ── 从全站笔记里筛选 ── */
const rows = db.prepare('SELECT DISTINCT fields FROM notes').all();
const ins = db.prepare(
  `INSERT OR IGNORE INTO arena_bank (char, def, sent, trans, book, def_len) VALUES (?,?,?,?,?,?)`
);

let seen = 0;
let kept = 0;
let skipForm = 0;
let skipLen = 0;
let skipNoBook = 0;

const tx = db.transaction(() => {
  for (const r of rows) {
    let a;
    try {
      a = JSON.parse(r.fields);
    } catch {
      continue;
    }
    if (!Array.isArray(a) || a.length < 2) continue;
    seen++;

    const m1 = /\*\*(.+?)\*\*/.exec(a[0] || '');
    if (!m1) continue;
    const ch = m1[1].trim();
    if ([...ch].length !== 1) continue; // 竞技场只出单字题

    const def = parseDef(a[1]);
    const sent = clean(a[0]);
    const trans = clean(a[2]);

    /* 义项长度 4~30：太短区分不了，太长手机上放不下 */
    if (def.length < 2 || def.length > 30) {
      skipLen++;
      continue;
    }
    /* 例句里不能带问号——疑问句挖空后没法答 */
    if (/[?？]/.test(sent)) {
      skipForm++;
      continue;
    }
    if (sent.length > 70 || sent.length < 4) {
      skipLen++;
      continue;
    }
    /* 要有出处，接龙题和显示来源都要用 */
    const bm = /《([^》]{2,12})》/.exec(sent);
    if (!bm) {
      skipNoBook++;
      continue;
    }

    ins.run(ch, def, sent, trans, bm[1], def.length);
    kept++;
  }
});
tx();

const s = db.prepare('SELECT COUNT(*) n, COUNT(DISTINCT char) c FROM arena_bank').get();
console.log('='.repeat(50));
console.log(`扫描 ${seen} 条笔记，入库 ${kept} 条`);
console.log(`  义项长度不合格 ${skipLen}`);
console.log(`  疑问句/太长 ${skipForm}`);
console.log(`  无出处 ${skipNoBook}`);
console.log(`arena_bank 现有 ${s.n} 条，覆盖 ${s.c} 个字`);

/* 每个字的义项数分布 —— 义项越多，干扰项越好挑 */
const multi = db
  .prepare(
    `SELECT char, COUNT(*) n FROM arena_bank GROUP BY char HAVING n >= 3 ORDER BY n DESC LIMIT 10`
  )
  .all();
console.log('\n义项最多的字（干扰项池最深）：');
for (const x of multi) console.log(`  ${x.char}  ${x.n} 个义项`);
const deep = db.prepare('SELECT COUNT(*) n FROM (SELECT char FROM arena_bank GROUP BY char HAVING COUNT(*)>=4)').get();
console.log(`\n有 ≥4 个义项的字：${deep.n} 个（这些字能出高区分度的四选一）`);
