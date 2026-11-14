/**
 * 待办组定义 + 入库（2026-11-06）
 * ============================================================
 * 一条反馈不等于一个待办。同一个根因被多人反馈的，归成一条，
 * 站长要改的是「矿场不产出」这一个东西，不是挨个回六个人。
 */
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const db = new Database(path.join(ROOT, 'data', 'keyi.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 8000');

const T = require(path.join(__dirname, 'notes', 'fb_triage.js'));

/* 待办组：标题 / 优先级 / 要改什么 / 状态 */
const GROUPS = {
  G01: { p: 0, title: '连续签到天数异常归零', fix: '查 checkins 表，20 天记录被重置。要找出是谁在哪一步把它清掉的，并把天数恢复' },
  G02: { p: 0, title: '好友房创建即扣 50，退出不退', fix: '扣费时机从「创建房间」挪到「进入对局」。已有扣费按记录退还（涉及 4 人）' },
  G03: { p: 0, title: '退出部落导致训练队列丢失、圣水照扣', fix: '训练队列要随部落存档持久化，不能只在内存/页面状态里' },
  G04: { p: 0, title: '升建筑卡顿：铜板扣了没升级', fix: '扣费与升级要在一个事务里，升级失败必须回滚铜板。涉及 840+ 铜板' },
  G05: { p: 0, title: '矿场不产出铜板（配置 15 实发 5，多数为 0）', fix: '产出结算逻辑坏了。按配置给所有人补发差额，张宇娴装 10 天零产出要单独补' },
  G06: { p: 1, title: '拆城墙不退铜板', fix: '拆除按比例返还建造费' },
  G07: { p: 1, title: '长按按键可绕过限制卡进部落', fix: '路由/状态守卫补一道校验，不能靠按钮隐藏' },
  G08: { p: 0, title: '总榜分数异常：重置卡组后不加分、部分分数虚高', fix: '统计口径要按卡独立累计，重置不清历史。同时排查 66 亿分是怎么来的（疑似刷分）' },
  G09: { p: 0, title: '学习矿脉加成不生效', fix: '检查学习铜板结算有没有读加成倍率。买了没生效的按天补差' },
  G10: { p: 1, title: '铜板流水只记支出，收入显示 0', fix: 'coins_ledger 写入要覆盖所有收入来源，核对今日收支是否平衡' },
  G11: { p: 1, title: '竞技场打赢只给 1 铜板', fix: '结算公式有问题，核对 rating 差值与奖励的关系' },
  G12: { p: 1, title: '上传头像报「令牌无效或已过期」', fix: '上传接口的鉴权与主站登录态不一致，检查 token 续期' },
  G13: { p: 1, title: '段位匹配范围过窄，只能匹配同一个人', fix: '匹配池扩大：允许跨 1~2 个段位，或按等待时间逐步放宽' },
  G14: { p: 1, title: '每日任务「到期复习」不可完成（多了做不完、少了不够）', fix: '任务目标改成「完成当天全部到期复习」或按实际到期数的比例，不写死数字' },
  G15: { p: 1, title: '复习了但任务天数不增加', fix: '任务判定读不到复习记录，检查 revlog 与任务进度的关联条件' },
  G16: { p: 2, title: '训练场 300 铜板上限口径不清（疑似与其他来源共用）', fix: '确认上限是否独立计算，若不独立则拆开，并在页面写清口径' },
  G17: { p: 2, title: '卡片全部学完后无内容可学', fix: '加新卡组，或提供「重置指定卡组」入口' },
  G18: { p: 1, title: '负债用户无法进入训练场还债（死循环）', fix: '允许负余额进入训练场，收益优先抵扣债务' },
  G19: { p: 2, title: '考点字加粗几乎看不见（训练场/部落答题）', fix: '加粗样式改为字号+字重双重加强，手机上要能一眼分辨' },
  G20: { p: 2, title: '首页背景模糊、有一层白雾', fix: '去掉叠在上面的白色遮罩，换高清图' },
  G21: { p: 2, title: '每日铜板上限 80 偏低', fix: '上调上限（建议 120~150），并同步调整相关文案' },
  G22: { p: 2, title: '部落被打后修复成本过高、无保护期', fix: '加被攻破后的保护期；提供「暂不修复」选项' },
  G23: { p: 2, title: '攻击建筑缺少范围显示', fix: '放置/移动时画出攻击范围圈' },
  G24: { p: 2, title: '进攻/出兵缺确认键，误触即损失', fix: '出兵前加二次确认' },
  G25: { p: 2, title: '需要「打自己部落」的演练模式', fix: '加演练模式，不消耗兵力' },
  G26: { p: 2, title: '铜板收入缺少来源明细', fix: '加收支明细页，按来源分类（学习/矿场/部落/竞技场）' },
  G27: { p: 2, title: '实时战报被移除，想恢复', fix: '恢复实时战报入口' },
  G28: { p: 2, title: '缺少「再战一局」', fix: '对局结束页加「再来一局」，好友房加「邀请再战」' },
  G29: { p: 2, title: '卡组数量不够用', fix: '增加卡组' },
  G30: { p: 2, title: '商城物品种类少', fix: '上新品' },
  G31: { p: 2, title: '称号 buff 叠加 / 自定义称号', fix: '评估叠加规则（要防无敌）；自定义称号需审核或仅自己可见' },
  G32: { p: 1, title: '排行榜疑似存在刷分（66 亿分）', fix: '排查异常分数来源，加异常检测' },
  G33: { p: 2, title: '希望增加铜板排行榜', fix: '加铜板榜，比分数榜更能暴露刷分' },
  G34: { p: 3, title: '—（闲聊，无需处理）', fix: '' },
  G35: { p: 3, title: '回答「admin 是谁」', fix: '' },
  G36: { p: 3, title: '回答部落上线/修复时间', fix: '' },
};

/* ── 建表 ── */
db.exec(`
  CREATE TABLE IF NOT EXISTS feedback_triage (
    feedback_id INTEGER PRIMARY KEY,
    ftype     TEXT NOT NULL DEFAULT '',
    module    TEXT NOT NULL DEFAULT '',
    severity  INTEGER NOT NULL DEFAULT 3,
    brief     TEXT NOT NULL DEFAULT '',
    grp       TEXT NOT NULL DEFAULT '',
    reply_text TEXT NOT NULL DEFAULT '',
    need_human INTEGER NOT NULL DEFAULT 0,
    replied   INTEGER NOT NULL DEFAULT 0,
    model     TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS feedback_todos (
    grp        TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    priority   INTEGER NOT NULL DEFAULT 2,
    fix        TEXT NOT NULL DEFAULT '',
    module     TEXT NOT NULL DEFAULT '',
    n_feedback INTEGER NOT NULL DEFAULT 0,
    status     TEXT NOT NULL DEFAULT 'todo',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

const upT = db.prepare(`INSERT INTO feedback_triage
  (feedback_id,ftype,module,severity,brief,grp,reply_text,need_human,replied,model,created_at)
  VALUES (?,?,?,?,?,?,?,?,0,'manual',unixepoch())
  ON CONFLICT(feedback_id) DO UPDATE SET ftype=excluded.ftype,module=excluded.module,
    severity=excluded.severity,brief=excluded.brief,grp=excluded.grp,
    reply_text=excluded.reply_text,need_human=excluded.need_human,model=excluded.model`);

const upG = db.prepare(`INSERT INTO feedback_todos (grp,title,priority,fix,module,n_feedback,status)
  VALUES (?,?,?,?,?,?,'todo')
  ON CONFLICT(grp) DO UPDATE SET title=excluded.title,priority=excluded.priority,
    fix=excluded.fix,module=excluded.module,n_feedback=excluded.n_feedback,updated_at=unixepoch()`);

const setReply = db.prepare(
  "UPDATE feedback SET reply=?, replied_at=unixepoch(), replied_by='AI助手', reply_read=0 WHERE id=? AND (reply IS NULL OR reply='')"
);
const markReplied = db.prepare('UPDATE feedback_triage SET replied=1 WHERE feedback_id=?');

/* 统计每组反馈数、取模块 */
const cnt = new Map();
const modOf = new Map();
for (const r of T) {
  cnt.set(r.group, (cnt.get(r.group) || 0) + 1);
  if (!modOf.has(r.group)) modOf.set(r.group, r.module);
}

let nT = 0;
let nR = 0;
const tx = db.transaction(() => {
  for (const r of T) {
    upT.run(r.id, r.type, r.module, r.sev, r.brief, r.group, r.reply, r.human ? 1 : 0);
    nT++;
    /* 咨询类（human=1）不自动回复，等人工 */
    if (!r.human) {
      if (setReply.run(r.reply, r.id).changes > 0) {
        markReplied.run(r.id);
        nR++;
      }
    }
  }
  for (const [g, v] of Object.entries(GROUPS)) {
    if (!cnt.get(g)) continue;
    upG.run(g, v.title, v.p, v.fix, modOf.get(g) || '其他', cnt.get(g));
  }
});
tx();

/* 回填：已经由 AI 助手回复过的，标记回来（重跑不会把标记丢掉） */
db.prepare("UPDATE feedback_triage SET replied=1 WHERE feedback_id IN (SELECT id FROM feedback WHERE replied_by='AI助手' AND reply!='')").run();
console.log(`分诊写入 ${nT} 条，本次自动回复 ${nR} 条`);
console.log(`待办 ${Object.keys(GROUPS).filter((g) => cnt.get(g)).length} 条`);

const s1 = db.prepare('SELECT ftype,COUNT(*) n FROM feedback_triage GROUP BY ftype ORDER BY n DESC').all();
const s3 = db.prepare('SELECT severity,COUNT(*) n FROM feedback_triage GROUP BY severity ORDER BY severity').all();
console.log('\n按类型', s1);
console.log('按严重度', s3);
