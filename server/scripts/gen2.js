/**
 * 文言实词「跨义辨析」直接生成（2026-11-06）
 * ============================================================
 * 不调用模型。用义项自身的语义结构直接拼出「怎么分」。
 *
 * 核心判断：学生不缺义项表，缺的是「这几条线怎么归」。
 * 所以每段辨析必须做三件事：
 *   1. 给出本义锚点（最常见、最具体的那条）
 *   2. 把剩下的义项按共同核心词归成几簇，说清每簇是什么走向
 *   3. 指出最容易混的一对，用真实课文例句当场分开
 *
 * 输出字段与前端约定一致：analysis / confusion / tip
 */
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const db = new Database(path.join(ROOT, 'data', 'keyi.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 8000');

const argv = process.argv.slice(2);
const i = argv.indexOf('--char');
const ONLY = i >= 0 ? argv[i + 1] : '';
const DRY = argv.includes('--dry');

/* ════════════════════════════════ 清洗 ══ */
function cleanDef(s) {
  let t = String(s || '');
  t = t.replace(/<br\s*\/?>/gi, '；').replace(/<[^>]*>/g, '');
  t = t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  t = t.replace(/&[a-z]+;|&#\d+;/gi, '');
  t = t.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  return t;
}

/* 释义太长（整段课文被塞进来）时截到主干 */
function short(def, max = 14) {
  const d = def.split(/[；;]/)[0].trim() || def;
  if (d.length <= max) return d;
  const c = d.slice(0, max);
  const p = Math.max(c.lastIndexOf('，'), c.lastIndexOf('、'));
  return p > 5 ? c.slice(0, p) : c;
}

/* 核心词：第一个分句、去掉「指…」「通…」前缀 */
function core(def) {
  let c = cleanDef(def).split(/[，,；;：:（(]/)[0].trim();
  c = c.replace(/^(指|特指|借指|泛指)/, '').replace(/^通[「"“'].?[」"”']，?/, '');
  c = c.replace(/[。，、；]+$/, '');
  return c;
}

/* ════════════════════════════ 聚类 ══ */
function overlap(a, b) {
  let best = 0;
  for (let x = 0; x < a.length - 1; x++)
    for (let y = x + 2; y <= a.length; y++) {
      const sub = a.slice(x, y);
      if (b.includes(sub) && sub.length > best) best = sub.length;
    }
  return best;
}

function same(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 2 && b.includes(a)) return true;
  if (b.length >= 2 && a.includes(b)) return true;
  return overlap(a, b) >= 2;
}

/* ════════════════════════════ 生成 ══ */
function build(ch, raw) {
  /* 1. 清洗去重 */
  const seen = new Set();
  const list = [];
  for (const r of raw) {
    const def = cleanDef(r.def);
    const c = core(def);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    list.push({ def, c: short(c, 10), sent: String(r.sent || '').trim(), trans: String(r.trans || '').trim() });
  }
  if (list.length < 2) return null;

  /* 2. 按核心词聚簇 */
  const clusters = [];
  for (const s of list) {
    let hit = clusters.find((g) => g.items.some((x) => same(x.c, s.c)));
    if (!hit) {
      hit = { items: [] };
      clusters.push(hit);
    }
    hit.items.push(s);
  }
  /* 大簇在前：义项多的那条线才是主干 */
  clusters.sort((a, b) => b.items.length - a.items.length);

  /* 3. 通假单独拎出来——它跟本义无引申关系，是另一套逻辑 */
  const fake = clusters.filter((g) => /^通[「"“']|^同[「"“']/.test(g.items[0].def));
  const main = clusters.filter((g) => !fake.includes(g));

  /* 4. analysis：本义 → 怎么长出来 → 特殊用法 */
  const seg = [];
  const head = main[0];
  const rest = main.slice(1);

  if (rest.length === 0) {
    seg.push(`「${ch}」在课文里就一条线：${quote(head.items.map((x) => x.c))}。`);
  } else {
    const r = rest.slice(0, 3).map((g) => `「${g.items[0].c}」`);
    seg.push(`「${ch}」的本义是${quote(head.items.map((x) => x.c))}，`);
    if (rest.length <= 3) {
      seg.push(`从这里分出${r.join('')} ${rest.length === 2 ? '两支' : '三支'}。`);
    } else {
      seg.push(`从这里分出${r.join('')}几支，${rest.length > 3 ? '再往后就越走越远。' : ''}`);
    }
  }
  if (fake.length) {
    const f = fake[0].items[0].def;
    const m = /^通[「"“']([^」"”']+)[」"”']/.exec(f);
    seg.push(
      m
        ? `另外「通${m[1]}」跟字面意思没有引申关系，只是读音借过去，讲不通时才用它。`
        : `另外还有通假义，跟字面意思无引申关系，讲不通时才用它。`
    );
  }
  let analysis = seg.join('');

  /* 5. confusion：挑真会混的一对 —— 同簇内两个不同核心词最像，
     其次是最大两簇的代表 */
  let a = null;
  let b = null;
  for (const g of clusters) {
    if (g.items.length >= 2) {
      const [x, y] = g.items;
      if (!same(x.c, y.c)) {
        a = x;
        b = y;
        break;
      }
    }
  }
  if (!a && clusters.length >= 2) {
    a = clusters[0].items[0];
    b = clusters[1].items[0];
  }
  let confusion = '';
  if (a && b) {
    confusion = `「${a.c}」和「${b.c}」最容易混`;
    if (a.sent && b.sent && a.sent !== b.sent) {
      confusion += `：「${clip(a.sent)}」取${a.c}，「${clip(b.sent)}」取${b.c}，摆回原句就分开。`;
    } else {
      confusion += `，一个偏具体、一个偏抽象，先看句子在说人还是说事。`;
    }
  }

  /* 6. tip */
  let tip = '';
  if (fake.length) tip = `讲不通就想通假。`;
  else if (main.length <= 2) tip = `抓「${main[0].items[0].c}」，其余靠上下文。`;
  else tip = `${main[0].items[0].c}→${main[1].items[0].c}，一线串下去。`;

  return { analysis, confusion, tip, n: list.length, k: clusters.length };
}

function clip(s, n = 16) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function quote(arr) {
  return [...new Set(arr)].slice(0, 4).map((x) => `「${x}」`).join('');
}

/* ════════════════════════════ 数据 ══ */
function collect() {
  const rows = db
    .prepare("SELECT DISTINCT fields FROM notes WHERE fields LIKE '%**%' AND fields LIKE '%==%'")
    .all();
  const map = new Map();
  const cl = (x) => (x || '').replace(/<[^>]+>/g, '').replace(/\*\*/g, '').trim();
  for (const { fields } of rows) {
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
    const c = m1[1].trim();
    if ([...c].length !== 1) continue;
    const def = (m2[1] || '').replace(/<br\s*\/?>/gi, '；').replace(/\*\*/g, '').trim();
    if (!map.has(c)) map.set(c, []);
    const l = map.get(c);
    if (!l.some((x) => x.def === def)) l.push({ def, sent: cl(arr[0]), trans: cl(arr[2]) });
  }
  return map;
}

/* ════════════════════════════ 入库 ══ */
const all = collect();
const targets = ONLY ? [[ONLY, all.get(ONLY) || []]] : [...all.entries()].filter(([, v]) => v.length >= 2);

db.exec(`CREATE TABLE IF NOT EXISTS word_ai_notes (
  char TEXT PRIMARY KEY, senses TEXT NOT NULL DEFAULT '[]',
  analysis TEXT NOT NULL DEFAULT '', confusion TEXT NOT NULL DEFAULT '',
  tip TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()))`);

const up = db.prepare(`INSERT INTO word_ai_notes (char,senses,analysis,confusion,tip,model,created_at)
  VALUES (?,?,?,?,?,'rule',unixepoch())
  ON CONFLICT(char) DO UPDATE SET senses=excluded.senses, analysis=excluded.analysis,
    confusion=excluded.confusion, tip=excluded.tip, model=excluded.model, created_at=excluded.created_at`);

console.log(`共 ${targets.length} 个字`);
let ok = 0;
const tx = db.transaction(() => {
  for (const [c, s] of targets) {
    const r = build(c, s);
    if (!r) continue;
    if (!DRY) up.run(c, JSON.stringify(s), r.analysis, r.confusion, r.tip);
    ok++;
    if (ONLY || DRY) {
      console.log(`\n【${c}】${r.n}义 →${r.k}簇`);
      console.log('脉：' + r.analysis);
      console.log('混：' + r.confusion);
      console.log('钩：' + r.tip);
    }
  }
});
if (DRY) for (const [c, s] of targets) { const r = build(c, s); if (r) ok++; }
else tx();
console.log(`\n完成 ${ok} 条`);
