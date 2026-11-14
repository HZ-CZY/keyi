/**
 * 古文实词「跨义项辨析」批量生成（2026-11-06）
 * ============================================================
 * 数据来源：notes 表里 126 个实词、792 个义项、3084 条真实课文例句。
 * 产出：word_ai_notes 表，供查词页 /api/dict/lookup 附带返回。
 *
 * 为什么按「字」而不是按「义项」生成：
 *   学生真正的困难不是「不知道有哪些义项」，而是「几个义项怎么分」。
 *   「间」有 15 个义项，逐条解释等于重复抄课本；
 *   一段讲清「怎么区分」的话，才是缺的东西。
 *
 * 供应商：Agnes（免费），端点 api.agnes-ai.cn
 *   Key 从项目自己的 server/.env 读，不依赖任何外部配置。
 *
 * 特性：
 *   · 断点续跑 —— 已在 word_ai_notes 里的字直接跳过，中断后重跑不重复花钱
 *   · 自动重试 —— 503 队列满 / 超时按 2/4/8/16s 退避，最多 5 次
 *   · 温和限速 —— 每次请求间 1.5s，避免自己把自己挤进队列满
 *   · 结果校验 —— 必须能解析出 analysis，否则当失败不入库
 *
 * 用法：
 *   node scripts/gen_word_notes.js            # 跑全部未完成的
 *   node scripts/gen_word_notes.js --limit 5  # 只跑 5 个（试水）
 *   node scripts/gen_word_notes.js --char 间  # 只跑某个字
 *   node scripts/gen_word_notes.js --redo     # 忽略已有，全部重跑
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'keyi.db');
const API_URL = 'https://api.agnes-ai.cn/v1/chat/completions';
const MODEL = 'agnes-2.5-flash';

const argv = process.argv.slice(2);
const LIMIT = (() => {
  const i = argv.indexOf('--limit');
  return i >= 0 ? parseInt(argv[i + 1], 10) || 0 : 0;
})();
const ONLY = (() => {
  const i = argv.indexOf('--char');
  return i >= 0 ? argv[i + 1] : '';
})();
const REDO = argv.includes('--redo');

/* ── Key：只从项目 .env 读，不碰任何外部路径 ───────────────── */
function loadKey() {
  if (process.env.AGNES_API_KEY) return process.env.AGNES_API_KEY.trim();
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const m = env.match(/^\s*AGNES_API_KEY\s*=\s*(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {
    /* 没有 .env 就走下面的报错 */
  }
  return '';
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

/* ── 建表 ──────────────────────────────────────────────────── */
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

/* ── 从 notes 聚出每个字的义项清单 ────────────────────────── */
function collect() {
  const rows = db
    .prepare("SELECT DISTINCT fields FROM notes WHERE fields LIKE '%**%' AND fields LIKE '%==%'")
    .all();
  const map = new Map();
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
    if ([...ch].length !== 1) continue; // 只处理单字
    const clean = (x) => (x || '').replace(/<[^>]+>/g, '').replace(/\*\*/g, '').trim();
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

const SYSTEM = `你是有二十年经验的高中语文老师，专攻文言实词。
学生已经背过课文例句，真正卡住的地方是「同一个字几个意思怎么分」。
请针对给出的字和它的全部义项，写一段辨析。

要求：
1. 先用一句话点出这个字的引申脉络——义项之间是怎么从本义长出来的，让学生理解而不是死记。
2. 再指出哪两个义项最容易混，为什么混，用什么办法区分。
3. 给一个不超过 20 字的记忆钩子。
4. 语言要像老师讲话，不要用「首先/其次/综上」，不要罗列 1234。
5. 只讲给出的这些义项，不要自己补充课本外的新义项。
6. 全文控制在 180 字以内。

【极重要】提到某个义项时，必须写义项原文（如「一会儿」「间谍」），
绝对不要写「义项3」「义项5」这类编号——学生在页面上看到的是释义文字，
不是编号，编号对他没有任何意义。

只输出 JSON，不要 markdown 代码块：
{"analysis":"引申脉络 + 怎么区分，180字内","confusion":"最容易混的两个义项（写义项原文）","tip":"20字内的记忆钩子"}`;

/* ── 单次请求（带超时） ───────────────────────────────────── */
async function callOnce(char, senses, key, timeoutMs) {
  /* 故意不给编号：给了编号模型就会在正文里引用「义项5」，
     而学生页面上根本没有编号，等于没说。只用项目符号。 */
  const list = senses
    .map((s) => `· 「${s.def}」　例句：${s.sent}（${s.trans}）`)
    .join('\n');

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `字：${char}\n\n它在课文里出现过的义项：\n${list}\n\n请写辨析。` },
    ],
    temperature: 0.4,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await r.text();
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}`);
      err.status = r.status;
      err.retryable = r.status === 429 || r.status >= 500;
      err.detail = raw.slice(0, 120);
      throw err;
    }
    const j = JSON.parse(raw);
    const txt = j.choices?.[0]?.message?.content || '';
    const cleaned = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/,'').trim();
    // 有些模型会在 JSON 前后多说话，截取第一个 { 到最后一个 }
    const s = cleaned.indexOf('{');
    const e = cleaned.lastIndexOf('}');
    if (s < 0 || e < s) throw Object.assign(new Error('返回不含 JSON'), { retryable: true });
    const p = JSON.parse(cleaned.slice(s, e + 1));
    const analysis = String(p.analysis || '').trim();
    if (!analysis) throw Object.assign(new Error('analysis 为空'), { retryable: true });
    return {
      analysis,
      confusion: String(p.confusion || '').trim(),
      tip: String(p.tip || '').trim(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ── 带退避重试 ───────────────────────────────────────────── */
async function genWithRetry(char, senses, key, maxTry = 5) {
  let lastErr;
  for (let attempt = 1; attempt <= maxTry; attempt++) {
    try {
      return await callOnce(char, senses, key, 90000);
    } catch (err) {
      lastErr = err;
      const retryable = err.retryable !== false;
      if (!retryable || attempt === maxTry) break;
      /* 429 是限速，不是故障，等久一点；其他错误按 2/4/8/16s */
      const wait = err.status === 429 ? Math.pow(2, attempt) * 3000 : Math.pow(2, attempt) * 1000;
      console.log(`      ↻ ${err.message} ${err.detail ? `(${err.detail})` : ''} → 等 ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const key = loadKey();
  if (!key) {
    console.error('✗ 找不到 AGNES_API_KEY');
    console.error('  请在 /root/project-backup/server/.env 里加一行：');
    console.error('  AGNES_API_KEY=sk-xxxx');
    process.exit(1);
  }

  ensureTable();
  let map = collect();

  if (ONLY) {
    if (!map.has(ONLY)) {
      console.error(`✗ 数据里没有「${ONLY}」这个字`);
      process.exit(1);
    }
    map = new Map([[ONLY, map.get(ONLY)]]);
  }

  // 义项 >= 2 才值得辨析；按义项数从多到少排，先做最难的
  let chars = [...map.entries()]
    .filter(([, v]) => v.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);

  const doneSet = REDO
    ? new Set()
    : new Set(db.prepare('SELECT char FROM word_ai_notes').all().map((r) => r.char));

  let todo = chars.filter(([c]) => !doneSet.has(c));
  if (LIMIT > 0) todo = todo.slice(0, LIMIT);

  console.log('='.repeat(58));
  console.log(`Agnes 跨义辨析生成`);
  console.log(`端点 ${API_URL}`);
  console.log(`模型 ${MODEL}`);
  console.log('='.repeat(58));
  console.log(`数据里共 ${map.size} 个实词，其中 ≥2 义项 ${chars.length} 个`);
  console.log(`已完成 ${doneSet.size} 个，本次待生成 ${todo.length} 个`);
  if (REDO) console.log('（--redo：已有记录会被覆盖）');
  console.log('');

  if (todo.length === 0) {
    console.log('没有待生成的字，收工。');
    return;
  }

  const upsert = db.prepare(`
    INSERT INTO word_ai_notes (char, senses, analysis, confusion, tip, model)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(char) DO UPDATE SET
      senses=excluded.senses, analysis=excluded.analysis,
      confusion=excluded.confusion, tip=excluded.tip,
      model=excluded.model, created_at=unixepoch()
  `);

  let ok = 0;
  let fail = 0;
  const t0 = Date.now();
  const failedChars = [];

  for (let i = 0; i < todo.length; i++) {
    const [ch, senses] = todo[i];
    const tag = `[${i + 1}/${todo.length}] ${ch} (${senses.length}义)`;
    const tCh = Date.now();
    try {
      const res = await genWithRetry(ch, senses, key);
      upsert.run(ch, JSON.stringify(senses), res.analysis, res.confusion, res.tip, MODEL);
      ok++;
      const sec = ((Date.now() - tCh) / 1000).toFixed(1);
      console.log(`${tag} ✓ ${sec}s  ${res.analysis.slice(0, 36)}…`);
    } catch (err) {
      fail++;
      failedChars.push(ch);
      console.log(`${tag} ✗ ${err.message} ${err.detail || ''}`);
    }
    // 温和限速：不让自己把队列挤满
    /* 免费账户有每分钟请求数上限，实测 1.5s 间隔会撞 429。
       放到 8s（≈7.5 次/分钟）稳定很多。121 个字约 17 分钟跑完，可接受。 */
    if (i < todo.length - 1) await sleep(8000);
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log('');
  console.log('='.repeat(58));
  console.log(`完成：成功 ${ok}，失败 ${fail}，耗时 ${mins} 分钟`);
  if (failedChars.length) {
    console.log(`失败的字：${failedChars.join(' ')}`);
    console.log('（直接重跑本脚本即可续上，已成功的会自动跳过）');
  }
  console.log('='.repeat(58));
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
