/**
 * 文言实词「跨义辨析」离线生成器（2026-11-06）
 * ============================================================
 * 不调用任何模型。用语法标签 + 同义合并，把 792 个义项归成
 * 「本义 → 怎么长出来的 → 哪两个最容易混」三段话。
 *
 * 为什么规则够用：
 *   汉典义项文本本身就带派生信号，不是要靠猜的东西——
 *     「通"伸"」        → 通假（跟本义无引申关系，必须单列）
 *     「使……」「让……」 → 使动
 *     「以为…」「认为…」→ 意动
 *     「…的样子」        → 状态描写
 *     「助词」「语气」    → 虚化
 *   这些是语法标签。规则吃掉这 56%，剩下的纯引申义靠
 *   「核心词合并」收成几条线。
 *
 * 输出字段与 Agnes 版完全一致，前端零改动。
 *
 * 用法：
 *   node scripts/gen_notes_offline.js           # 全部重算
 *   node scripts/gen_notes_offline.js --char 间 # 只看一个字
 *   node scripts/gen_notes_offline.js --dry     # 只打印不入库
 */
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const db = new Database(path.join(ROOT, 'data', 'keyi.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 8000');

const argv = process.argv.slice(2);
const ONLY = (() => {
  const i = argv.indexOf('--char');
  return i >= 0 ? argv[i + 1] : '';
})();
const DRY = argv.includes('--dry');

/* ══════════════════════════════════════════════════════════════
   一、清洗
   ══════════════════════════════════════════════════════════════ */
function cleanDef(s) {
  let t = String(s || '');
  t = t.replace(/<br\s*\/?>/gi, '；').replace(/<[^>]*>/g, '');
  t = t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  t = t.replace(/&[a-z]+;|&#\d+;/gi, '');
  t = t.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  /* 「通"众"，zòng次于…」→ 「通「众」，次于…」，去掉拼音夹注 */
  t = t.replace(/\s*[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]{1,8}\s*(?=[\u4e00-\u9fa5])/gi, '');
  return t;
}

/* 过长释义（整段课文被塞进来）截断到主干 */
function trimDef(s, max = 22) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const p = Math.max(cut.lastIndexOf('；'), cut.lastIndexOf('，'), cut.lastIndexOf('、'));
  return (p > 6 ? cut.slice(0, p) : cut) + '…';
}

/* ══════════════════════════════════════════════════════════════
   二、标签
   ══════════════════════════════════════════════════════════════ */
const TAGS = [
  ['通假', (d) => /^通[「"“']|^同[「"“']/.test(d)],
  ['使动', (d) => /使…|让…|令…/.test(d)],
  ['意动', (d) => /以为|认为|看作|当作/.test(d)],
  ['虚化', (d) => /助词|语气词|发语词|无实义|不译|句中|句末/.test(d)],
  ['状态', (d) => /的样子$|的样子，|地$|然$|貌$/.test(d)],
  ['名物', (d) => /^(指|特指|借指|泛指)|器具|工具|官职|官名/.test(d)],
  ['程度', (d) => /^(极|很|非常|最|全|都|只|仅|皆|尽|完全|全都)/.test(d)],
];

function tagOf(def) {
  for (const [t, f] of TAGS) if (f(def)) return t;
  return '引申';
}

/* 标签的中文说法，写进句子时用 */
const TAG_SAY = {
  通假: '通假字',
  使动: '使动用法',
  意动: '意动用法',
  虚化: '虚化为语法词',
  状态: '状态描写',
  名物: '专指名物',
  程度: '程度副词义',
  引申: '实义引申',
};

/* ══════════════════════════════════════════════════════════════
   三、同义合并：核心词重叠的义项算同一个意思
   ══════════════════════════════════════════════════════════════ */
function coreOf(def) {
  let c = def.split(/[，,；;：:（(]/)[0].trim();
  c = c.replace(/^(指|特指|借指|泛指)/, '').replace(/^通[「"“'].[」"”']，?/, '');
  return c.replace(/…$/, '');
}

function overlap(a, b) {
  let best = 0;
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = i + 2; j <= a.length; j++) {
      const sub = a.slice(i, j);
      if (b.includes(sub) && sub.length > best) best = sub.length;
    }
  }
  return best;
}

function sameCluster(a, b) {
  const ca = coreOf(a);
  const cb = coreOf(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (ca.length >= 2 && cb.includes(ca)) return true;
  if (cb.length >= 2 && ca.includes(cb)) return true;
  return overlap(ca, cb) >= 2;
}

/* ══════════════════════════════════════════════════════════════
   四、生成
   ══════════════════════════════════════════════════════════════ */
function build(char, rawSenses) {
  /* 4.1 清洗去重 */
  const seen = new Set();
  const senses = [];
  for (const s of rawSenses) {
    const def = trimDef(cleanDef(s.def));
    if (!def) continue;
    const k = coreOf(def);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    senses.push({
      def,
      core: k,
      sent: String(s.sent || '').trim(),
      trans: String(s.trans || '').trim(),
    });
  }
  if (senses.length < 2) return null;

  for (const s of senses) s.tag = tagOf(s.def);

  /* 4.2 同 tag 内按语义簇合并 */
  const clusters = []; // {tag, cores:[], senses:[]}
  for (const s of senses) {
    let hit = clusters.find(
      (c) => c.tag === s.tag && c.senses.some((x) => sameCluster(x.def, s.def))
    );
    if (!hit) {
      hit = { tag: s.tag, senses: [] };
      clusters.push(hit);
    }
    hit.senses.push(s);
  }

  /* 4.3 排序：引申类打头（那是本义线），其余按信息量 */
  const WEIGHT = { 引申: 0, 名物: 1, 状态: 2, 程度: 3, 虚化: 4, 使动: 5, 意动: 6, 通假: 9 };
  clusters.sort((a, b) => {
    const w = (WEIGHT[a.tag] ?? 5) - (WEIGHT[b.tag] ?? 5);
    if (w !== 0) return w;
    return b.senses.length - a.senses.length;
  });

  const yi = clusters.filter((c) => c.tag === '引申' || c.tag === '名物');
  const other = clusters.filter((c) => c.tag !== '引申' && c.tag !== '名物');

  /* ── 4.4 analysis：引申脉络 ───────────────────────────── */
  const parts = [];

  /* 第一句：本义线。拿第一个引申簇当本义，因为它通常最具体 */
  if (yi.length === 1) {
    const c = yi[0];
    parts.push(`「${char}」在这里只有一条意思线：${listCores(c)}。`);
  } else if (yi.length >= 2) {
    const head = yi[0];
    const rest = yi.slice(1);
    /* 把「核心词」用「、」串起来，而不是抄一长串释义 */
    parts.push(
      `「${char}」从${quote(head.senses[0].core)}起家，` +
        (rest.length <= 2
          ? `再长出${rest.map((c) => quote(c.senses[0].core)).join('、')}这${rest.length === 1 ? '一层' : '两层'}意思。`
          : `再长出一串：${rest.map((c) => quote(c.senses[0].core)).join('、')}。`)
    );
  }

  /* 第二句：特殊用法提醒 */
  const special = other.filter((c) => c.tag !== '通假');
  if (special.length) {
    const names = [...new Set(special.map((c) => TAG_SAY[c.tag]))].filter(Boolean);
    const samples = special
      .slice(0, 3)
      .map((c) => `${quote(c.senses[0].core)}（${TAG_SAY[c.tag]}）`)
      .join('、');
    parts.push(`另有${samples}${names.length > 3 ? '等' : ''}，这些靠语法位置就能认出来，不用逐条背。`);
  }

  /* 第三句：通假单独警告——这是学生最常错的地方 */
  const tj = other.find((c) => c.tag === '通假');
  if (tj) {
    const d = tj.senses[0].def;
    const m = /^通[「"“']([^」"”']+)[」"”']/.exec(d);
    const ben = m ? m[1] : '';
    parts.push(
      ben
        ? `最容易栽的是通「${ben}」——它跟字面上的「${char}」没有引申关系，只是读音借过去的，看到讲不通就拿通假去试。`
        : `最容易栽的是通假义，跟字面意思没有引申关系，讲不通时先往通假上想。`
    );
  }

  let analysis = parts.join('');

  /* 句数不够（只有 2 个义项、没特殊用法）时补一句怎么分 */
  if (analysis.length < 40) {
    analysis = `「${char}」这两个义项要合起来看：${clusters
      .map((c) => quote(c.senses[0].core))
      .join(' 与 ')}，出现在不同句子里，靠上下文认，不要只记一个。`;
  }

  /* ── 4.5 confusion：最容易混的一对 ────────────────────── */
  let confusion = '';
  /* 优先挑「同一 tag 里有两个簇」的——那才是真会混的 */
  const sameTagPair = clusters.filter((c) => c.senses.length >= 1);
  let pairA = null;
  let pairB = null;
  for (let i = 0; i < clusters.length && !pairA; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      if (clusters[i].tag === clusters[j].tag && clusters[i].tag === '引申') {
        pairA = clusters[i];
        pairB = clusters[j];
        break;
      }
    }
  }
  if (!pairA && clusters.length >= 2) {
    /* 退一步：拿义项数最多的两个 */
    const sorted = [...clusters].sort((a, b) => b.senses.length - a.senses.length);
    pairA = sorted[0];
    pairB = sorted[1];
  }
  if (pairA && pairB) {
    const a = pairA.senses[0];
    const b = pairB.senses[0];
    confusion =
      `「${a.def}」和「${b.def}」最容易混。` +
      (a.sent && b.sent
        ? `看例句就分开了：${a.sent}（这里取「${a.core}」），${b.sent}（这里取「${b.core}」）。`
        : `一个偏具体动作，一个偏抽象结果，先判断句子在说什么事。`);
  }

  /* ── 4.6 tip：记忆钩子 ────────────────────────────────── */
  let tip = '';
  if (tj) {
    tip = `讲不通就想通假，别硬解释。`;
  } else if (clusters.length === 2) {
    tip = `只有两条线：${clusters.map((c) => c.senses[0].core).join(' / ')}。`;
  } else {
    tip = `抓本义「${clusters[0].senses[0].core}」，其余顺着上下文拐。`;
  }

  return { analysis, confusion, tip, n: senses.length, clusters: clusters.length };
}

function quote(s) {
  return `「${s}」`;
}
function listCores(c) {
  return c.senses.map((s) => quote(s.core)).join('、');
}

/* ══════════════════════════════════════════════════════════════
   五、取数据
   ══════════════════════════════════════════════════════════════ */
function collect() {
  const rows = db
    .prepare("SELECT DISTINCT fields FROM notes WHERE fields LIKE '%**%' AND fields LIKE '%==%'")
    .all();
  const map = new Map();
  const clean = (x) => (x || '').replace(/<[^>]+>/g, '').replace(/\*\*/g, '').trim();
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
    const ch = m1[1].trim();
    if ([...ch].length !== 1) continue;
    const rec = {
      sent: clean(arr[0]),
      def: (m2[1] || '').replace(/<br\s*\/?>/gi, '；').replace(/\*\*/g, '').trim(),
      trans: clean(arr[2]),
    };
    if (!map.has(ch)) map.set(ch, []);
    const list = map.get(ch);
    if (!list.some((x) => x.def === rec.def)) list.push(rec);
  }
  return map;
}

/* ══════════════════════════════════════════════════════════════
   六、入库
   ══════════════════════════════════════════════════════════════ */
function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS word_ai_notes (
      char       TEXT PRIMARY KEY,
      senses     TEXT NOT NULL DEFAULT '[]',
      analysis   TEXT NOT NULL DEFAULT '',
      confusion  TEXT NOT NULL DEFAULT '',
      tip        TEXT NOT NULL DEFAULT '',
      model      TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
}

const all = collect();
const targets = ONLY
  ? [[ONLY, all.get(ONLY) || []]]
  : [...all.entries()].filter(([, v]) => v.length >= 2);

console.log('='.repeat(60));
console.log(`离线生成跨义辨析　共 ${targets.length} 个字`);
console.log('='.repeat(60));

if (!DRY) ensureTable();
const up = db.prepare(
  `INSERT INTO word_ai_notes (char, senses, analysis, confusion, tip, model, created_at)
   VALUES (?, ?, ?, ?, ?, 'rule-offline', unixepoch())
   ON CONFLICT(char) DO UPDATE SET
     senses=excluded.senses, analysis=excluded.analysis,
     confusion=excluded.confusion, tip=excluded.tip,
     model=excluded.model, created_at=excluded.created_at`
);

let ok = 0;
let skip = 0;
const shortOnes = [];
const tx = db.transaction((list) => {
  for (const [ch, senses] of list) {
    const r = build(ch, senses);
    if (!r) {
      skip++;
      continue;
    }
    up.run(ch, JSON.stringify(senses), r.analysis, r.confusion, r.tip);
    ok++;
    if (r.analysis.length < 45) shortOnes.push(ch);
    if (ONLY) {
      console.log(`\n【${ch}】${r.n}义 → ${r.clusters}簇`);
      console.log('脉', r.analysis);
      console.log('混', r.confusion);
      console.log('钩', r.tip);
    }
  }
});
if (!DRY) tx(targets);
else for (const [ch, s] of targets) { const r = build(ch, s); if (r) { ok++; if (ONLY) console.log(ch, r); } }

console.log(`\n入库 ${ok} 条，跳过 ${skip} 条`);
if (shortOnes.length) console.log(`偏短的 ${shortOnes.length} 个：${shortOnes.join(' ')}`);
