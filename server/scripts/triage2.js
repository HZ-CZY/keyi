/**
 * 反馈自动分诊 + 待办生成 + 自动回复（2026-11-06）
 * ============================================================
 * 分工：
 *   Agnes 只做「看懂」和「回话」——判断这是什么问题、要不要改、
 *   怎么跟用户说。它不碰代码、不承诺修复时间。
 *   真正改代码/改数据由站长（或协作者）照待办来做。
 *
 * 每条输出五样：
 *   type/module/severity  分类
 *   brief                 一句话：谁遇到了什么
 *   issue                 具体现象，定位到功能
 *   action                要改什么（空字符串=不用改）
 *   reply_text            给用户的回复
 *
 * 【硬约束】咨询类（问「怎么用」）不自动回复。
 *   模型不知道训练场上限怎么算、矿脉加成怎么判，答了就是编。
 *   这类标 need_human=1，等人工答。
 *
 * 【硬约束】bug 类回复不许承诺时间、不许说「已修复」。
 *   因为此刻还没修。只能说到「已定位」为止。
 *
 * 用法：
 *   node scripts/triage_feedback.js --limit 3   # 试水，不写回复
 *   node scripts/triage_feedback.js             # 跑全部并自动回复
 *   node scripts/triage_feedback.js --dry       # 只打印不入库
 *   node scripts/triage_feedback.js --redo      # 全部重跑
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
const DRY = argv.includes('--dry');
const NO_REPLY = argv.includes('--no-reply');
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
    ftype     TEXT NOT NULL DEFAULT '',
    module    TEXT NOT NULL DEFAULT '',
    severity  INTEGER NOT NULL DEFAULT 3,
    brief     TEXT NOT NULL DEFAULT '',
    issue     TEXT NOT NULL DEFAULT '',
    action    TEXT NOT NULL DEFAULT '',
    reply_text TEXT NOT NULL DEFAULT '',
    need_fix  INTEGER NOT NULL DEFAULT 0,
    need_human INTEGER NOT NULL DEFAULT 0,
    replied   INTEGER NOT NULL DEFAULT 0,
    model     TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);

const SYSTEM = `你是「刻忆」这个中学生文言文/背单词平台的产品助理，在帮站长处理用户反馈。

【背景】站内主要模块：卡组学习（间隔重复）、训练场、竞技场（PK）、部落（3D 城建，含矿场/训练军队/圣水）、铜板经济、签到任务、排行榜、商城、头像审核。
用户是初高中生，说话口语化、常带表情。

请判断并输出六项：

1) type，只能一个：
   bug   = 功能不正常、报错、数据不对、扣了资产没给到
   建议   = 希望加新功能、改规则、调数值
   咨询   = 问某功能怎么用、什么意思、为什么这样
   投诉   = 表达不满，但没明确指出坏在哪
   闲聊   = 打招呼、调侃、无实质诉求

2) module，只能一个：
   部落 / 竞技场 / 训练场 / 铜板经济 / 签到任务 / 卡组学习 / 头像 / 排行榜 / 商城 / 账号 / 其他

3) severity：
   0 = 丢了铜板、圣水、卡片、签到天数、训练队列等实际资产或数据
   1 = 某功能完全不能用
   2 = 体验问题（看不清、不顺手、数值不合理）
   3 = 闲聊或无实质诉求

4) brief：不超过 20 字，「谁遇到什么问题」。不复述原文废话。

5) issue：具体现象，写清是哪个功能、什么操作、什么结果。若只是建议或闲聊，写「—」。

6) action：如果要改代码或改数据，写清「改什么」，要具体（如「好友房创建时先不扣费，进入对局才扣」）。不用改就留空字符串。

7) reply_text：给用户本人的回复，2 句以内，60 字以内。
   【必须遵守】
   - 只能回「我看到了 / 定位到哪 / 会怎么处理 / 谢谢」，绝不能说你已经修好了，也不能承诺具体时间。
   - 不许编造技术细节。
   - 语气像站长本人在打字，口语，不要客服腔，不要说「亲」「尊敬的用户」。
   - 必须针对他说的那件具体事，不能是通用模板。
   - 如果是咨询类（问他怎么用、为什么），reply_text 写「这个我去确认一下，晚点回你」这类，绝不能自己编答案。

只输出 JSON，不要 markdown 代码块：
{"type":"","module":"","severity":0,"brief":"","issue":"","action":"","reply_text":""}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callOnce(content, key) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `用户反馈原文：${content}` },
        ],
        temperature: 0.3,
      }),
      signal: ctrl.signal,
    });
    const raw = await r.text();
    if (!r.ok) {
      const e = new Error(`HTTP ${r.status}`);
      e.status = r.status;
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
    const brief = String(p.brief || '').slice(0, 26);
    const issue = String(p.issue || '').slice(0, 80);
    const action = String(p.action || '').slice(0, 100);
    let reply = String(p.reply_text || '').trim().slice(0, 80);
    if (!brief || !reply) throw new Error('字段为空');

    /* 咨询类一律不自动回复：模型不懂实现，答就是编 */
    const needHuman = type === '咨询' ? 1 : 0;
    if (needHuman) reply = '这个我去确认一下，晚点回你。';

    /* 有 action 才算要改 */
    const needFix = action && action !== '—' && action !== '-' && action.length > 3 ? 1 : 0;

    return { type, module, severity, brief, issue, action, reply, needFix, needHuman };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const key = loadKey();
  if (!key) {
    console.error('缺少 AGNES_API_KEY');
    process.exit(1);
  }

  const done = new Set(
    db.prepare('SELECT feedback_id FROM feedback_triage').all().map((r) => r.feedback_id)
  );
  let rows = db
    .prepare("SELECT id, username, content FROM feedback WHERE content != '' ORDER BY id ASC")
    .all();
  if (!REDO) rows = rows.filter((r) => !done.has(r.id));
  if (LIMIT) rows = rows.slice(0, LIMIT);

  console.log('='.repeat(60));
  console.log(`反馈分诊 + 待办 + 自动回复　待处理 ${rows.length} 条`);
  console.log('='.repeat(60));

  const up = db.prepare(`INSERT INTO feedback_triage
    (feedback_id,ftype,module,severity,brief,issue,action,reply_text,need_fix,need_human,replied,model,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,0,?,unixepoch())
    ON CONFLICT(feedback_id) DO UPDATE SET ftype=excluded.ftype,module=excluded.module,
      severity=excluded.severity,brief=excluded.brief,issue=excluded.issue,action=excluded.action,
      reply_text=excluded.reply_text,need_fix=excluded.need_fix,need_human=excluded.need_human,
      replied=0,model=excluded.model,created_at=excluded.created_at`);

  const setReply = db.prepare(
    "UPDATE feedback SET reply=?, replied_at=unixepoch(), replied_by='AI助手', reply_read=0 WHERE id=? AND (reply IS NULL OR reply='')"
  );
  const markReplied = db.prepare('UPDATE feedback_triage SET replied=1 WHERE feedback_id=?');

  let ok = 0;
  let fail = 0;
  let replied = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let res = null;
    for (let a = 0; a < 4 && !res; a++) {
      try {
        res = await callOnce(r.content, key);
      } catch (err) {
        const wait = err.status === 429 ? Math.pow(2, a) * 8000 : Math.pow(2, a) * 2000;
        process.stdout.write(`  ↻ ${err.message} 等 ${wait / 1000}s\n`);
        await sleep(wait);
      }
    }

    if (!res) {
      fail++;
      console.log(`[${i + 1}/${rows.length}] #${r.id} 失败`);
      if (i < rows.length - 1) await sleep(8000);
      continue;
    }

    if (DRY) {
      console.log(`\n#${r.id} ${r.username}　${r.content.slice(0, 40)}`);
      console.log(`  ${res.type}/${res.module}/P${res.severity}　${res.brief}`);
      console.log(`  现象 ${res.issue || '—'}`);
      console.log(`  待办 ${res.action || '（无需改）'}`);
      console.log(`  回复 ${res.reply}`);
      ok++;
      continue;
    }

    up.run(
      r.id, res.type, res.module, res.severity, res.brief, res.issue,
      res.action, res.reply, res.needFix, res.needHuman, MODEL
    );
    ok++;

    /* 自动回复：咨询类不写，已回过的不覆盖 */
    if (!NO_REPLY && !res.needHuman) {
      const info = setReply.run(res.reply, r.id);
      if (info.changes > 0) {
        markReplied.run(r.id);
        replied++;
      }
    }

    const tag = res.needHuman ? '需人工' : res.needFix ? '待办' : '—';
    console.log(
      `[${i + 1}/${rows.length}] #${r.id} ${res.type}/${res.module}/P${res.severity} [${tag}] ${res.brief}`
    );
    if (i < rows.length - 1) await sleep(8000);
  }

  console.log(`\n完成 ${ok} 条，失败 ${fail} 条，自动回复 ${replied} 条`);

  if (!DRY) {
    const s1 = db.prepare('SELECT ftype, COUNT(*) n FROM feedback_triage GROUP BY ftype ORDER BY n DESC').all();
    const s2 = db.prepare('SELECT module, COUNT(*) n FROM feedback_triage GROUP BY module ORDER BY n DESC').all();
    const s3 = db.prepare('SELECT severity, COUNT(*) n FROM feedback_triage GROUP BY severity ORDER BY severity').all();
    console.log('\n按类型', s1);
    console.log('按模块', s2);
    console.log('按严重度', s3);
  }
}

main();
