import { Router } from 'express';
import { getDb } from '../db/database';
import { cnDateStr } from '../lib/dates';

/**
 * 每日时政（GET /api/daily/news）— 2026-10-20 换为「中学生校园版」
 * ────────────────────────────────────────────────────────────
 * 主源：**中国青年网**（共青团中央主办，GBK 编码）
 *   https://www.youth.cn/
 *   · 内容天然面向青年：教育政策、文化遗产、科技成就、青年榜样；
 *   · 比央视/人民日报的成人时政（医保、GDP、广交会）更适合校内阅读。
 *
 * 补充：**央视《新闻联播》内容提要**（只取 2 条国家大事：习近平/李强/中共中央…）
 *
 * 筛选规则：
 *   · 可读性打分（scoreTitle）：故事/探访/人物 +4，科技/文化遗产 +3，教育/青年 +3，
 *     体育 +2，习近平/总书记 +2；「会议/规划/发布/条例/法/纲要」-1（政策类降权）。
 *   · 同主题去重（themeOf）：文化遗产/长征/教育/外交/科技/文化/体育/民生/经济
 *     各只保留 1 条，避免同一场发布会连占 3 条。
 *   · 剔除（ECON）：GDP/金融/股市/贸易/广交会/进出口/外汇/税收/货运/楼市…
 *   · 最终 = 中青网 5 条（打分+去重后）+ 央视首页 2 条 + 联播国家大事 1 条，
 *     全局再去重一次，最多 8 条。
 *
 * 兜底：中青网失败 → 央视网首页要闻 → 人民日报头版。
 *
 * 不存可跳转链接：表里只有标题与摘要，前端没有 <a>。
 * 抓取策略：当天有缓存直接返回；失败 5 分钟内不重试；抓不到返回空列表由前端隐藏。
 */
const router = Router();

const YOUTH_HOME = 'https://www.youth.cn/';
const PEOPLE_BASE = 'http://paper.people.com.cn/rmrb/pc/layout';
const CCTV_API =
  'https://api.cntv.cn/NewVideo/getVideoListByColumn?id=TOPC1451528971114112&n=5&sort=desc&p=1&mode=0&serviceId=tvcctv';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const MAX_ITEMS = 8;
const FETCH_TIMEOUT_MS = 8000;
const RETRY_GAP_MS = 5 * 60 * 1000;

const SUMMARY_MIN = 70;
const SUMMARY_MAX = 120;

/** 国家大事 */
const POLITICS = /习近平|李强|中共中央|国务院|全国人大|政协|总书记|主席/;
/** 纯经济/贸易类，校园场景下剔除 */
const ECON = /GDP|国内生产总值|金融|股市|证券|贸易|广交会|进出口|外汇|税收|消费|货运|铁路发送|经济增长|经济运行|三季报|制造业|楼市|房地产|物价|CPI/;

let lastAttempt = 0;

interface NewsItem {
  title: string;
  summary: string;
}

/** 北京时间的 YYYYMM/DD 与 YYYY-MM-DD（offsetDays 为往前推的天数） */
function bjDate(offsetDays = 0): { path: string; day: string } {
  const d = new Date(Date.now() + 8 * 3600 * 1000 - offsetDays * 86400 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return { path: `${y}${m}/${dd}`, day: `${y}-${m}-${dd}` };
}

function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ensp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ============================================================
   一、主源：中国青年网（GBK）
   ============================================================ */

/** 抓 GBK 页面（中青网仍是 GBK，必须显式解码，否则全是乱码） */
async function fetchGbk(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': UA, Referer: 'https://www.youth.cn/' },
    });
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {
      return buf.toString('utf8');
    }
  } catch {
    return '';
  }
}

/** 从文章页取导语：跳过「发稿时间/作者」等元信息，取正文前 2 段 */
function extractYouthSummary(html: string): string {
  const ps = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => cleanText(m[1]).replace(/^[\s　]+/, '').trim())
    .filter((t) => {
      if (t.length < 20) return false;
      if (/^(发稿时间|作者|编辑|来源|责任编辑)[:：]/.test(t)) return false;
      if (/^\d{4}-\d{2}-\d{2}/.test(t)) return false;
      return true;
    });

  let out = '';
  for (const p of ps) {
    if (out.length >= SUMMARY_MIN) break;
    /* 去掉新闻电头，如「中国青年网北京10月20日电（见习记者 刘雅欣 记者 任洁）」 */
    const cleaned = p.replace(/^中国青年网[^。]{0,60}电（[^）]{0,60}）\s*/, '').trim();
    out += (out ? ' ' : '') + (cleaned || p);
    if (out.length >= SUMMARY_MAX) break;
  }
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > SUMMARY_MAX ? out.slice(0, SUMMARY_MAX - 2) + '…' : out;
}

/* ── 主题聚类与可读性打分：让 8 条尽量「不同主题、故事优先」 ── */
const THEME_RULES: [string, RegExp][] = [
  ['文化遗产', /文化遗产|非遗/],
  ['长征', /长征/],
  ['教育', /教育|教师|学生|学校|校园|高考|中考/],
  ['外交', /会见|会谈|访问|出席|峰会|总理|总统/],
  ['科技', /科技|航天|创新|数字|智能|应用场景|人工智能/],
  ['文化', /文化|文学|艺术|博物馆|文物|传统/],
  ['体育', /体育|运动|赛事|奥运|全运/],
  ['民生', /医保|社保|就业|养老|医疗|住房/],
  ['经济', /经济|GDP|贸易|金融|消费|产业/],
];

function themeOf(title: string): string | null {
  for (const [k, re] of THEME_RULES) if (re.test(title)) return k;
  return null;
}

/** 可读性打分：故事/科技/文化优先，纯政策/会议降权 */
function scoreTitle(t: string): number {
  let s = 0;
  if (/故事|讲述|亲历|背后|探访|直击|对话|人物/.test(t)) s += 4;
  if (/长征|航天|科技|创新|文化遗产|非遗|博物馆|文物/.test(t)) s += 3;
  if (/教育|教师|学生|学校|青年|少年|志愿|榜样/.test(t)) s += 3;
  if (/体育|运动|健康/.test(t)) s += 2;
  if (/习近平|总书记/.test(t)) s += 2;
  if (/会议|规划|发布|通知|意见|条例|法|纲要|部署/.test(t)) s -= 1;
  return s;
}

/** 打分排序 + 同主题只留一条 */
function pickDiverse(list: { title: string; url: string }[], n: number) {
  const scored = list
    .filter((x) => !ECON.test(x.title))
    .map((x) => ({ ...x, score: scoreTitle(x.title) }))
    .sort((a, b) => b.score - a.score);

  const usedTheme = new Set<string>();
  const out: typeof scored = [];
  for (const x of scored) {
    const th = themeOf(x.title);
    if (th) {
      if (usedTheme.has(th)) continue;
      usedTheme.add(th);
    }
    out.push(x);
    if (out.length >= n) break;
  }
  return out;
}

/** 摘要开头若原样复述标题，剥掉，避免「标题 + 同样的标题」占两行 */
function stripTitlePrefix(summary: string, title: string): string {
  const ts = title.replace(/\s+/g, '');
  const ss = summary.replace(/\s+/g, '');
  if (!ts || !ss) return summary;

  const head = ts.slice(0, 10);
  const pos = ss.indexOf(head);
  if (pos >= 0 && pos <= 2) {
    const tail = ts.slice(-6);
    const end = summary.indexOf(tail);
    if (end >= 0) {
      return summary.slice(end + tail.length).replace(/^[\s—\-:：,，。、]+/, '').trim();
    }
  }
  return summary;
}

/** 抓中青网首页新闻并按「教育科技文化优先」筛选 */
async function grabYouth(): Promise<NewsItem[]> {
  const html = await fetchGbk(YOUTH_HOME);
  if (!html) return [];

  const list: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]+href="([^"]*news\.youth\.cn\/[^"]+\.htm)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1];
    const title = cleanText(m[2]);
    if (title.length < 8 || title.length > 60) continue;
    if (/^(更多|滚动新闻|返回|首页|下一版|上一版)$/.test(title)) continue;
    /* 机构公告/版权声明不是新闻，混进来会占版面 */
    if (/社会责任报告|版权|声明|招聘|广告|联系我们|关于我们|举报|订阅/.test(title)) continue;
    if (seen.has(title)) continue;
    seen.add(title);
    const url = href.startsWith('//') ? `https:${href}` : href;
    list.push({ title, url });
  }

  /* 打分排序 + 同主题去重，避免同一场发布会连占 3 条 */
  const top = pickDiverse(list, 8);
  if (!top.length) return [];

  /* 并发抓导语，单篇失败只丢该条摘要 */
  return Promise.all(
    top.map(async (x) => {
      let summary = await fetchGbk(x.url).then(extractYouthSummary);
      /* 正文第一段常原样复述标题：剥掉，避免标题与摘要重复 */
      summary = stripTitlePrefix(summary, x.title);
      summary = summary.replace(/^原标题[:：]\s*/, '');
      /* 抓到页面底部备案信息说明这不是正文页，摘要作废 */
      if (/ICP备|公网安备|举报电话|版权所有|Copyright|违法和不良信息/.test(summary)) summary = '';
      return { title: x.title, summary };
    })
  );
}

/* ============================================================
   二、补充：新闻联播（只取国家大事）
   ============================================================ */

function toTitleSummary(text: string): NewsItem {
  const t = text.trim();
  if (!t) return { title: '', summary: '' };
  if (t.length <= 26) return { title: t, summary: '' };

  const i = t.search(/\s/);
  if (i >= 8 && i <= 30 && t.length - i - 1 >= 8) {
    return { title: t.slice(0, i).trim(), summary: t.slice(i).trim() };
  }
  return { title: t, summary: '' };
}

function splitBrief(brief: string): NewsItem[] {
  const body = String(brief || '').replace(/^\s*本期节目主要内容[:：]?\s*/, '').trim();
  if (!body) return [];

  const items: NewsItem[] = [];
  /* 以分号切段，再剥掉段首编号。
     ⚠️ 不能按「数字.」切：正文里的 4.6% 会被误判成编号。 */
  for (let part of body.split(/[；;]\s*/)) {
    part = part
      .replace(/^\s*\d{1,2}\s*[.．、]\s*/, '')
      .replace(/^\s*[（(]\s*\d{1,2}\s*[）)]\s*/, '')
      .replace(/[；;]\s*$/, '')
      .trim();
    if (part.length < 6) continue;

    part = part.replace(/^【[^】]{0,24}】\s*/, '');
    if (part.length > 80) part = part.slice(0, 60) + '…';

    const it = toTitleSummary(part);
    if (it.title && it.title.length >= 4) items.push(it);
    if (items.length >= 12) break;
  }
  return items;
}

async function grabXwlb(): Promise<NewsItem[]> {
  try {
    const res = await fetch(CCTV_API, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': UA, Referer: 'https://tv.cctv.com/' },
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    const list: any[] = json?.data?.list || [];
    if (!list.length) return [];

    const latest = list
      .filter((x) => x && x.brief)
      .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')))[0];
    if (!latest) return [];

    return splitBrief(latest.brief);
  } catch {
    return [];
  }
}

/* ============================================================
   三、兜底：央视网首页 / 人民日报
   ============================================================ */

async function grabCctvHome(): Promise<NewsItem[]> {
  try {
    const res = await fetch('https://news.cctv.com/', {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) return [];
    const html = await res.text();

    const re = /<h3[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>\s*<p[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/g;
    const out: NewsItem[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const title = cleanText(m[2]);
      let summary = cleanText(m[3]);
      if (title.length < 8 || summary.length < 20) continue;
      if (ECON.test(title)) continue;                 // 纯经济同样剔除（央视侧）
      if (title.includes('+data.') || summary.includes('+data.')) continue;
      if (out.some((x) => x.title === title)) continue;
      if (summary.length > SUMMARY_MAX) summary = summary.slice(0, SUMMARY_MAX - 2) + '…';
      out.push({ title, summary });
      if (out.length >= 4) break;
    }
    return out;
  } catch {
    return [];
  }
}

function extractPeopleSummary(html: string): string {
  const anchor = html.indexOf('id="articleContent"');
  if (anchor < 0) return '';
  const seg = html.slice(anchor, anchor + 20000);
  const paras = [...seg.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => cleanText(m[1]).replace(/^[\s　]+/, '').trim())
    .filter((t) => {
      if (t.length < 8) return false;
      if (t.length <= 14 && !/[，。；：！？、]/.test(t)) return false;
      return true;
    });
  let out = '';
  for (const p of paras) {
    if (out.length >= SUMMARY_MIN) break;
    out += (out ? ' ' : '') + p;
    if (out.length >= SUMMARY_MAX) break;
  }
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > SUMMARY_MAX ? out.slice(0, SUMMARY_MAX - 2) + '…' : out;
}

async function fetchPeopleSummary(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) return '';
    return extractPeopleSummary(await res.text());
  } catch {
    return '';
  }
}

async function grabPeople(
  offsetDays: number
): Promise<{ day: string; source: string; items: NewsItem[] } | null> {
  const { path, day } = bjDate(offsetDays);
  const pageUrl = `${PEOPLE_BASE}/${path}/node_01.html`;
  try {
    const res = await fetch(pageUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const list = [...html.matchAll(/<a[^>]+href="([^"]*content_\d+\.html)"[^>]*>([\s\S]*?)<\/a>/g)]
      .map((m) => ({ href: m[1], title: cleanText(m[2]) }))
      .filter((x) => x.title.length >= 6 && !/^(导读|要闻|上一版|下一版|返回目录|版面目录)$/.test(x.title));

    const seen = new Set<string>();
    const uniq: { href: string; title: string }[] = [];
    for (const x of list) {
      if (seen.has(x.title)) continue;
      seen.add(x.title);
      uniq.push(x);
      if (uniq.length >= MAX_ITEMS) break;
    }
    if (uniq.length < 3) return null;

    const items = await Promise.all(
      uniq.map(async (x) => {
        let abs = '';
        try {
          abs = new URL(x.href, pageUrl).toString();
        } catch {
          abs = '';
        }
        const summary = abs ? await fetchPeopleSummary(abs) : '';
        return { title: x.title, summary };
      })
    );

    return { day, source: '人民日报', items };
  } catch {
    return null;
  }
}

/* ============================================================
   四、合并与接口
   ============================================================ */

/** 中青网 5 条 + 央视首页 2 条 + 联播国家大事 1 条，全局同主题去重 */
async function grabDaily(): Promise<{ day: string; source: string; items: NewsItem[] } | null> {
  const [youth, xwlb, home] = await Promise.all([grabYouth(), grabXwlb(), grabCctvHome()]);

  const merged: NewsItem[] = [];
  const usedTitle = new Set<string>();
  const usedTheme = new Set<string>();
  const push = (x: NewsItem) => {
    const k = x.title.slice(0, 5);
    if (usedTitle.has(k)) return;
    const th = themeOf(x.title);
    if (th && usedTheme.has(th)) return;
    usedTitle.add(k);
    if (th) usedTheme.add(th);
    merged.push(x);
  };

  /* 主源中青网（已按可读性排序） */
  youth.forEach((x) => { if (merged.length < 5) push(x); });
  /* 央视首页补 2 条（摘要完整、新闻性强） */
  home.forEach((x) => { if (merged.length < 7) push(x); });
  /* 联播只补 1 条国家大事 */
  const pol = xwlb.filter((x) => POLITICS.test(x.title));
  (pol.length ? pol : xwlb).slice(0, 1).forEach(push);
  /* 仍不足则依次补满 */
  [...youth, ...home, ...xwlb].forEach((x) => { if (merged.length < MAX_ITEMS) push(x); });

  if (merged.length < 3) return null;
  return {
    day: cnDateStr(),
    source: youth.length ? '中青网 · 央视新闻' : '央视新闻',
    items: merged.slice(0, MAX_ITEMS),
  };
}

async function ensureHeadlines(): Promise<{ day: string; source: string }> {
  const db = getDb();
  const today = cnDateStr();

  const cached = db.prepare('SELECT source FROM daily_news WHERE day = ? LIMIT 1').get(today) as
    | { source: string }
    | undefined;
  if (cached) return { day: today, source: cached.source || '中青网 · 央视新闻' };

  if (Date.now() - lastAttempt < RETRY_GAP_MS) return { day: today, source: '中青网 · 央视新闻' };
  lastAttempt = Date.now();

  let got = await grabDaily();
  if (!got) got = await grabPeople(0);
  if (!got) got = await grabPeople(1);
  if (!got) return { day: today, source: '中青网 · 央视新闻' };

  const ins = db.prepare(
    'INSERT OR IGNORE INTO daily_news (day, title, source, sort, summary) VALUES (?, ?, ?, ?, ?)'
  );
  const payload = got;
  db.transaction(() => {
    payload.items.forEach((it, i) => ins.run(payload.day, it.title, payload.source, i, it.summary));
  })();

  return { day: payload.day, source: payload.source };
}

router.get('/news', async (_req, res) => {
  try {
    const { day, source } = await ensureHeadlines();
    const rows = getDb()
      .prepare('SELECT title, summary FROM daily_news WHERE day = ? ORDER BY sort ASC')
      .all(day) as { title: string; summary: string }[];
    res.json({ day, source, items: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
