/**
 * 反馈自动分诊（2026-11-06）
 * ============================================================
 * 用 Agnes 给每条反馈打三组标签：
 *   type      bug / 建议 / 咨询 / 投诉 / 闲聊
 *   module    落到站内哪个模块（部落/竞技场/铜板/签到/卡组/头像/排行榜/商城/其他）
 *   severity  0=P0 金钱或数据损失  1=P1 功能不可用  2=P2 体验问题  3=P3 闲聊
 * 再产出一句 brief，方便管理员扫一眼就知道在说什么。
 *
 * 为什么用模型而不用关键词规则：
 *   「矿场不产铜板」是 bug，「铜板太少了」是建议，字面都含「铜板」。
 *   关键词分不开，模型能分开。这是 Agnes 的合适场景：批量、可容错、
 *   结果落库后人工复核。
 *
 * Key 只从项目 server/.env 的 AGNES_API_KEY 读。
 *
 * 用法：
 *   node scripts/triage_feedback.js            # 跑未分诊的
 *   node scripts/triage_feedback.js --redo     # 全部重跑
 *   node scripts/triage_feedback.js --limit 5  # 试水
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const db = new Database(path.join(ROOT, 'data', 'keyi.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 8000');

const API_URL = 'https://api.agnes-ai.cn/v1/chat/completions';
const MODEL = 'agnes-2.5-flash';

const argv = process.argv.slice(2);
const REDO = argv.includes('--redo');
const li = argv.indexOf('--limit');
const LIMIT = li >= 0 ? parseInt(argv[li + 1], 10) || 0 : 0;

function loadKey() {
  if (process.env.AGNES_API_KEY) return process.env.AGNES_API_KEY.trim();
  const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  const m = /^\s*AGNES_API_KEY\s*=\s*(.+)$/m.exec(env);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

db.exec(`
  CREATE TABLE IF NOT EXISTS feedback_triage (
    feedback_id INTEGER PRIMARY KEY,
    ftype    TEXT NOT NULL DEFAULT '',
    module   TEXT NOT NULL DEFAULT '',
    severity INTEGER NOT NULL DEFAULT 3,
    brief    TEXT NOT NULL DEFAULT '',
    model    TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);

const SYSTEM = `你是「刻忆」这个中学生背单词/文言文平台的产品运营。
任务：给用户反馈分类，供站长快速处理。

【type】只能选一个：
bug   = 功能不正常、报错、数据不对、扣了钱没给东西
建议   = 希望加新功能、改规则、调数值
咨询   = 问某个功能怎么用、什么意思
投诉   = 表达不满、抱怨，但没有明确指出坏在哪
闲聊   = 打招呼、调侃、没具体诉求

【module】只能选一个：
部落 / 竞技场 / 训练场 / 铜板经济 / 签到任务 / 卡组学习 / 头像 / 排行榜 / 商城 / 账号 / 其他

【severity】
0 = 用户丢了铜板、圣水、卡片、签到天数、训练队列等实际资产或数据
1 = 某功能完全不能用（点不动、白屏、打不开）
2 = 体验问题（看不清、不顺手、数值不合理）
3 = 闲聊、无实质诉求

【brief】不超过 22 字，写清「谁遇到了什么问题」，不要复述原文废话。

只输出 JSON，不要 markdown 代码块：
{"type":"...","module":"...","severity":0,"brief":"..."}`

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callOnce(content, key) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `反馈原文：${content}` },
    ],
    temperature: 0.1,
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40000);
  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await r.text();
    if (!r.ok) {
      const e = new Error(`HTTP ${r.status}`);
      e.status = r.status;
      e.detail = raw.slice(0, 100);
      throw e;
    }
    const j = JSON.parse(raw);
    const txt = j.choices?.[0]?.message?.content || '';
    const s = txt.indexOf('{');
    const e2 = txt.lastIndexOf('}');
    if (s < 0 || e2 < s) throw new Error('无 JSON');
    const p = JSON.parse(txt.slice(s, e2 + 1));
    const TYPES = ['bug', '建议', '咨询', '投诉', '闲聊'];
    const MODS = ['部落', '竞技场', '训练场', '铜板经济', '签到任务', '卡组学习', '头像', '排行榜', '商城', '账号', '其他'];
    const type = TYPES.includes(p.type) ? p.type : '其他';
    const module = MODS.includes(p.module) ? p.module : '其他';
    const severity = [0, 1, 2, 3].includes(Number(p.severity)) ? Number(p.severity) : 3;
    const brief = String(p.brief || '').slice(0, 30);
    if (!brief) throw new Error('brief 为空');
    return { type, module, severity, brief };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const key = loadKey();
  if (!key) {
    console.error('没有 AGNES_API_KEY，检查 server/.env');
    process.exit(1);
  }

  const done = new Set(
    db.prepare('SELECT feedback_id FROM feedback_triage').all().map((r) => r.feedback_id)
  );
  let rows = db.prepare('SELECT id, username, content FROM feedback ORDER BY id ASC').all();
  if (!REDO) rows = rows.filter((r) => !done.has(r.id));
  if (LIMIT) rows = rows.slice(0, LIMIT);

  console.log('='.repeat(56));
  console.log(`反馈分诊　待处理 ${rows.length} 条`);
  console.log('='.repeat(56));

  const up = db.prepare(`INSERT INTO feedback_triage (feedback_id,ftype,module,severity,brief,model,created_at)
    VALUES (?,?,?,?,?,?,unixepoch())
    ON CONFLICT(feedback_id) DO UPDATE SET ftype=excluded.ftype,module=excluded.module,
      severity=excluded.severity,brief=excluded.brief,model=excluded.model,created_at=excluded.created_at`);

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let res = null;
    for (let attempt = 0; attempt < 4 && !res; attempt++) {
      try {
        res = await callOnce(r.content, key);
      } catch (err) {
        const wait = err.status === 429 ? Math.pow(2, attempt) * 8000 : Math.pow(2, attempt) * 2000;
        process.stdout.write(`  ↻ ${err.message} 等 ${wait / 1000}s\n`);
        await sleep(wait);
      }
    }
    if (res) {
      up.run(r.id, res.type, res.module, res.severity, res.brief, MODEL);
      ok++;
      console.log(
        `[${i + 1}/${rows.length}] #${r.id} ${res.type}/${res.module}/P${res.severity}  ${res.brief}`
      );
    } else {
      fail++;
      console.log(`[${i + 1}/${rows.length}] #${r.id} 失败`);
    }
    if (i < rows.length - 1) await sleep(8000);
  }

  console.log(`\n完成 ${ok} 条，失败 ${fail} 条`);
  const stat = db
    .prepare('SELECT ftype, COUNT(*) n FROM feedback_triage GROUP BY ftype ORDER BY n DESC')
    .all();
  console.log(stat);
}

main();
