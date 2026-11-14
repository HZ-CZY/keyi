/* ============================================================
   查词接口（2026-11-06 换源：hwxnet → 汉典 zdic.net）
   ------------------------------------------------------------
   为什么换源：
     · 旧源（hwxnet）文言文字典对常用字大量返回空，实测「其」
       返回 0 条释义、「你好」返回空词条；且拼音字段正则长期
       匹配不到，学生查文言文最先要的「怎么读」永远是空的。
     · 汉典的字义带读音分组、词性标注、书证出处，数据完整度
       高一个量级；页面 class 命名语义化，解析比旧源码更稳。

   三个约束：
     1. 必须缓存。汉典是个人站点，学校几百人同时查会直接被
        封 IP。所有结果落 dict_cache，查过的字永久复用，TTL
        只是兜底更新手段。
     2. 必须有超时与降级。上游挂了要返回明确错误，不能让学生
        盯着转圈。
     3. 不改变对外契约。前端仍然调 /api/dict/zd|cd|cy|wyw，
       返回结构做向后兼容（旧字段保留、新字段新增）。
   ============================================================ */

import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getDb } from '../db/database';

const router = Router();

const ZDIC = 'https://zdic.net/hans/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';
/** 缓存有效期：30 天。字典内容几乎不变，主要是兜底更新 */
const CACHE_TTL = 30 * 24 * 3600;

/* ────────────────────────── 基础工具 ────────────────────────── */

function stripTags(s: string): string {
  if (!s) return '';
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<[^>]+>/g, '')
    /* 实体反转义（2026-11-06）：汉典的法语/德语释义里会出现 &#039; 这种
       带前导零的写法，原来只写了 &#39; 于是页面上直接显示「c&#039;est」。
       改成通用数字实体解码，顺带覆盖 &#8217; 之类的标点。
       注意顺序：&amp; 必须最后解，否则 &amp;#039; 会被二次解码成 '。 */
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 汉典正文里字与标点之间常有多余空格：「与“ 坏 ”相对」→「与“坏”相对」 */
function cleanPunct(s: string): string {
  return s
    /* 汉典用「◎」分隔例句正文和出处（例：「…为此奇谈。 ◎《花月痕》第五一回」），
       前端已经是「例子 + ——出处」的排版，这个符号纯属多余，直接删掉。 */
    .replace(/\s*◎\s*/g, ' ')
    .replace(/“\s+([^”]{1,4}?)\s+”/g, '“$1”')
    .replace(/（\s+([^）]{1,6}?)\s+）/g, '（$1）')
    .replace(/\s+([，。、；：？！）》」』”])/g, '$1')
    .replace(/([（《「『“])\s+/g, '$1')
    .trim();
}

/**
 * 取 <section id="xx"> … </section> 的内部 HTML。
 * 汉典的 section 是平级的，内部还会嵌套 <section class="xxjs-pos-section">，
 * 所以不能用正则匹配到第一个 </section>，必须做括号计数。
 */
function sectionOf(html: string, id: string): string {
  const head = new RegExp(`<section[^>]*\\bid="${id}"[^>]*>`).exec(html);
  if (!head) return '';
  const start = head.index + head[0].length;
  const re = /<section\b[^>]*>|<\/section>/g;
  re.lastIndex = start;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('</')) depth--;
    else depth++;
    if (depth === 0) return html.slice(start, m.index);
  }
  return html.slice(start);
}

/** 抓 char-card 里的 meta 字段（部首 / 部外 / 总笔画 / 字形结构 …） */
function metaOf(html: string, badge: string): string {
  const re = new RegExp(
    `<span class="meta-badge"[^>]*>\\s*${badge}\\s*</span>\\s*` +
      `(?:<span class="meta-value[^"]*"[^>]*>([\\s\\S]*?)</span>` +
      `|<a[^>]*class="meta-radical"[^>]*>([\\s\\S]*?)</a>)`,
  );
  const m = re.exec(html);
  if (!m) return '';
  return stripTags(m[1] !== undefined ? m[1] : m[2]);
}

function titleOf(html: string): string {
  const m = /<title>([^<]*)<\/title>/.exec(html);
  return m ? stripTags(m[1]) : '';
}

/* ────────────────────────── 解析 ────────────────────────── */

interface Sense {
  def: string;
  example: string;
}
interface Reading {
  pinyin: string;
  zhuyin: string;
  senses: Sense[];
}
interface Citation {
  text: string;
  source: string;
}
interface DetailedItem {
  def: string;
  citations: Citation[];
  english: string;
}
interface PosGroup {
  pos: string;
  items: DetailedItem[];
}
interface DetailedBlock {
  pinyin: string;
  posGroups: PosGroup[];
}

/** 详细解释（含词性、书证）。汉字用 xxjs-reading，词语用 xxjs-reading-head。 */
function parseDetailed(xx: string): DetailedBlock[] {
  const out: DetailedBlock[] = [];
  const chunks = xx.split(/<div class="xxjs-reading(?:-head)?">/).slice(1);
  for (const b of chunks) {
    const py = /<span class="xxjs-reading__py">([^<]*)<\/span>/.exec(b);

    const parseItems = (fragment: string): DetailedItem[] => {
      const items: DetailedItem[] = [];
      /* 2026-11-06 修：「你好」「论语」「刻舟求剑」这类只有一个义项的条目，
         原来写成 …<\/li>\s*(?=<li|$) 收尾，可片段末尾还跟着 </ol></div>，
         前瞻到不了 `$` 也没有下一个 <li>，整条匹配直接失败 → 返回 0 条释义。
         改成非贪婪匹配到最近的 </li> 即可，不再依赖前瞻。 */
      const liRe = /<li class="xxjs-item[^"]*">([\s\S]*?)<\/li>/g;
      let li: RegExpExecArray | null;
      while ((li = liRe.exec(fragment))) {
        const item = li[1];
        const d = /<div class="xxjs-item__def">([\s\S]*?)<\/div>/.exec(item);
        const cits: Citation[] = [];
        const citRe =
          /<span class="xxjs-citation__text">([\s\S]*?)<\/span>\s*<span class="xxjs-citation__dash">[^<]*<\/span>\s*<cite class="xxjs-citation__source">([\s\S]*?)<\/cite>/g;
        let cm: RegExpExecArray | null;
        while ((cm = citRe.exec(item))) {
          cits.push({
            text: cleanPunct(stripTags(cm[1])),
            source: cleanPunct(stripTags(cm[2])),
          });
        }
        const en = /<span class="xxjs-english__text">([\s\S]*?)<\/span>/.exec(item);
        items.push({
          def: d ? cleanPunct(stripTags(d[1])) : '',
          citations: cits,
          english: en ? stripTags(en[1]) : '',
        });
      }
      return items;
    };

    const groups: PosGroup[] = [];
    const posRe =
      /<section class="xxjs-pos-section">\s*<span class="xxjs-pos-badge">([^<]*)<\/span>([\s\S]*?)<\/section>/g;
    let pm: RegExpExecArray | null;
    while ((pm = posRe.exec(b))) {
      const items = parseItems(pm[2]);
      if (items.length) groups.push({ pos: stripTags(pm[1]), items });
    }
    // 词语 / 成语没有词性分组，义项直接挂在 <ol> 下
    if (!groups.length) {
      const items = parseItems(b);
      if (items.length) groups.push({ pos: '', items });
    }
    if (groups.length) {
      out.push({ pinyin: py ? stripTags(py[1]) : '', posGroups: groups });
    }
  }
  return out;
}

/** 基本解释：按读音分组，每组若干义项 + 例如 */
function parseBasic(html: string): Reading[] {
  const jb = sectionOf(html, 'jbjs');
  const out: Reading[] = [];
  const re = /<div class="jbjs-reading">([\s\S]*?)<\/ol>\s*<\/div>/g;
  let g: RegExpExecArray | null;
  while ((g = re.exec(jb))) {
    const block = g[1];
    const py = /<span class="jbjs-reading__py">([^<]*)<\/span>/.exec(block);
    const zy = /<span class="jbjs-reading__zy">([^<]*)<\/span>/.exec(block);
    const senses: Sense[] = [];
    const liRe = /<li class="jbjs-item">([\s\S]*?)<\/li>/g;
    let li: RegExpExecArray | null;
    while ((li = liRe.exec(block))) {
      const item = li[1];
      const d = /<span class="jbjs-item__def">([\s\S]*?)<\/span>/.exec(item);
      const e = /<span class="jbjs-item__eg">([\s\S]*?)<\/span>/.exec(item);
      senses.push({
        def: d ? cleanPunct(stripTags(d[1])) : '',
        example: e ? cleanPunct(stripTags(e[1])) : '',
      });
    }
    if (senses.length) {
      out.push({
        pinyin: py ? stripTags(py[1]) : '',
        zhuyin: zy ? stripTags(zy[1]) : '',
        senses,
      });
    }
  }
  return out;
}

/** 近反义词 */
function parseSynonyms(html: string): { synonyms: string[]; antonyms: string[] } {
  const syn = sectionOf(html, 'syn');
  const pick = (kind: string): string[] => {
    const m = new RegExp(
      `<span class="synonym-label synonym-label--${kind}">[^<]*</span>\\s*<span class="synonym-tags">([\\s\\S]*?)</span>`,
    ).exec(syn);
    if (!m) return [];
    const arr: string[] = [];
    const re = /class="synonym-tag">([^<]*)<\/a>/g;
    let t: RegExpExecArray | null;
    while ((t = re.exec(m[1]))) arr.push(stripTags(t[1]));
    return arr;
  };
  return { synonyms: pick('syn'), antonyms: pick('ant') };
}

/** 翻译（英 / 德 / 法 …） */
function parseTranslations(html: string): { lang: string; text: string }[] {
  const tr = sectionOf(html, 'trans');
  const out: { lang: string; text: string }[] = [];
  const re = /<dt class="word-trans__lang">([^<]*)<\/dt>\s*<dd class="word-trans__text">([\s\S]*?)<\/dd>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tr))) {
    out.push({ lang: stripTags(m[1]), text: cleanPunct(stripTags(m[2])) });
  }
  return out;
}

/**
 * 统一解析入口。
 * 返回结构对前端保持向后兼容：word / pinyin / radical / strokeCount /
 * strokesOuter / meanings / words 这些旧字段仍然存在。
 */
export function parseZdic(html: string, query: string): any {
  const title = titleOf(html);
  const isChar = !!sectionOf(html, 'jbjs');
  const detailed = parseDetailed(sectionOf(html, 'xxjs'));
  const cySection = sectionOf(html, 'cy');

  // 标题形如「好 hǎo、hào - 汉典」/「画蛇添足的意思|汉典…」
  let word = query;
  let pinyinAll = '';
  const pm = /^(\S+?)\s+([^-|]+?)\s*[-|]/.exec(title);
  if (pm) {
    word = pm[1].trim();
    pinyinAll = pm[2].trim();
  }

  const base: any = {
    source: 'zdic',
    kind: isChar ? 'char' : cySection ? 'idiom' : 'word',
    word,
    pinyin: pinyinAll,
    title,
  };

  if (isChar) {
    base.radical = metaOf(html, '部首');
    base.strokeCount = metaOf(html, '总笔画');
    base.strokesOuter = metaOf(html, '部外');
    base.structure = metaOf(html, '字形结构');
    base.shapeAnalysis = metaOf(html, '字形分析');
    base.strokeOrder = metaOf(html, '笔顺');

    const readings = parseBasic(html);
    base.readings = readings;
    // 旧字段兼容：meanings 拉平成字符串数组
    base.meanings = readings.flatMap((r) =>
      r.senses.map((s) => (s.example ? `${s.def} 例：${s.example}` : s.def)),
    );
    // 旧字段兼容：single pinyin
    base.pinyin = readings.map((r) => r.pinyin).filter(Boolean).join('；') || pinyinAll;
  } else {
    const py = /<span class="xxjs-reading__py">([^<]*)<\/span>/.exec(sectionOf(html, 'xxjs'));
    base.pinyin = py ? stripTags(py[1]) : pinyinAll;
  }

  if (detailed.length) base.detailed = detailed;

  if (cySection) {
    const fields: Record<string, string> = {};
    const re =
      /<div class="idiom-entry__line[^"]*">\s*<span class="idiom-entry__label">([^<]*)<\/span>\s*<span class="idiom-entry__text">([\s\S]*?)<\/span>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cySection))) {
      fields[stripTags(m[1])] = cleanPunct(stripTags(m[2]));
    }
    base.idiom = {
      meaning: fields['解释'] || '',
      source: fields['出处'] || '',
      example: fields['示例'] || '',
      grammar: fields['语法'] || '',
    };
    // 旧字段兼容
    base.meaning = base.idiom.meaning;
    base.source_text = base.idiom.source;
    base.example = base.idiom.example;
  }

  const { synonyms, antonyms } = parseSynonyms(html);
  if (synonyms.length) base.synonyms = synonyms.join('、');
  if (antonyms.length) base.antonyms = antonyms.join('、');

  const trans = parseTranslations(html);
  if (trans.length) base.translations = trans;

  return base;
}

/* ────────────────────────── 抓取 + 缓存 ────────────────────────── */

function ensureCacheTable(): void {
  try {
    getDb()
      .prepare(
        `CREATE TABLE IF NOT EXISTS dict_cache (
           word       TEXT PRIMARY KEY,
           payload    TEXT NOT NULL,
           created_at INTEGER NOT NULL DEFAULT (unixepoch())
         )`,
      )
      .run();
  } catch (e) {
    console.error('[dict] 建缓存表失败', e);
  }
}

function cacheGet(word: string): any | null {
  try {
    const row = getDb()
      .prepare(
        'SELECT payload, created_at FROM dict_cache WHERE word = ? AND created_at > unixepoch() - ?',
      )
      .get(word, CACHE_TTL) as any;
    if (!row) return null;
    const d = JSON.parse(row.payload);
    d.cached = true;
    return d;
  } catch {
    return null;
  }
}

function cacheSet(word: string, payload: any): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO dict_cache (word, payload, created_at) VALUES (?, ?, unixepoch())
         ON CONFLICT(word) DO UPDATE SET payload = excluded.payload, created_at = unixepoch()`,
      )
      .run(word, JSON.stringify(payload));
  } catch (e) {
    console.error('[dict] 写缓存失败', word, e);
  }
}

const inflight = new Map<string, Promise<any>>();

async function lookup(word: string): Promise<any> {
  const hit = cacheGet(word);
  if (hit) return hit;

  // 同一个字的并发请求合并，避免一个热门字打穿上游
  const running = inflight.get(word);
  if (running) return running;

  const task = (async () => {
    const url = ZDIC + encodeURIComponent(word);
    const r = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
    });
    if (!r.ok) throw new Error(`上游返回 ${r.status}`);
    const html = await r.text();
    const data = parseZdic(html, word);
    // 只有解析出实质内容才入缓存，避免把空结果缓存 30 天
    if (data.meanings?.length || data.detailed?.length || data.idiom?.meaning) {
      cacheSet(word, data);
    }
    return data;
  })().finally(() => inflight.delete(word));

  inflight.set(word, task);
  return task;
}

/* ────────────────────────── 路由 ────────────────────────── */

/**
 * 统一查询端点。
 * 前端仍可继续调 /zd /cd /cy /wyw（下面四个别名都指向这里），
 * 也可以直接用 /lookup。
 */
router.get('/lookup', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const wd = String(req.query.wd || req.query.q || '').trim();
    if (!wd) {
      res.status(400).json({ error: '请输入要查询的字词' });
      return;
    }
    if (wd.length > 12) {
      res.status(400).json({ error: '查询内容过长，一次最多 12 个字' });
      return;
    }
    const data = await lookup(wd);

    /* 【2026-11-06 跨义辨析】单字查询时附带本地生成的辨析。
       数据来自 word_ai_notes 表，由 scripts/gen_word_notes.js 离线跑批产出，
       查一次是本机 SQLite，毫秒级，不影响汉典那 20ms 的响应。
       表可能不存在（批量任务还没跑），整段用 try 包住，失败就当没有。 */
    try {
      if (wd.length === 1) {
        const row = getDb()
          .prepare('SELECT analysis, confusion, tip FROM word_ai_notes WHERE char = ?')
          .get(wd) as { analysis: string; confusion: string; tip: string } | undefined;
        if (row && row.analysis) {
          data.aiNote = {
            analysis: row.analysis,
            confusion: row.confusion || '',
            tip: row.tip || '',
          };
        }
      }
    } catch {
      /* 表不存在或查询失败，静默跳过 */
    }

    res.json(data);
  } catch (e: any) {
    console.error('[dict] 查询失败', req.query.wd, e?.message);
    const msg = /timeout|aborted/i.test(e?.message || '')
      ? '字典服务响应超时，请稍后重试'
      : '字典服务暂时不可用';
    res.status(502).json({ error: msg });
  }
});

// 向后兼容的四个别名：语义上已经统一，都走同一个解析器
for (const alias of ['zd', 'cd', 'cy', 'wyw']) {
  router.get(`/${alias}`, authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const wd = String(req.query.wd || req.query.q || '').trim();
      if (!wd) {
        res.status(400).json({ error: '请输入要查询的字词' });
        return;
      }
      if (wd.length > 12) {
        res.status(400).json({ error: '查询内容过长，一次最多 12 个字' });
        return;
      }
      const data = await lookup(wd);
      res.json(data);
    } catch (e: any) {
      console.error('[dict] 查询失败', req.query.wd, e?.message);
      const msg = /timeout|aborted/i.test(e?.message || '')
        ? '字典服务响应超时，请稍后重试'
        : '字典服务暂时不可用';
      res.status(502).json({ error: msg });
    }
  });
}

/** 启动时确保缓存表存在 */
try {
  ensureCacheTable();
} catch {
  /* 延迟到首次查询再建 */
}

export default router;
