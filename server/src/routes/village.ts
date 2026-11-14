// @ts-nocheck
/**
 * 刻忆觉醒（部落）服务端路由 —— /api/village/*
 *
 * ⚠️ 本文件原样来自编译产物 server/dist/routes/village.js（线上在跑的就是它），
 *    为了「可构建」才落成 src 源码，因此整体 @ts-nocheck、不逐行加类型。
 *    行为与线上完全一致；将来补类型请单独做，不要和业务改动混在一起。
 *
 * 部署：改完直接 <code>cd server && npm run build</code> 再重启 keyi（本次起构建是安全的：
 *    client/public/village3d 已归位、本文件已在 src 里、index.ts 已挂载路由）。
 */

/* 这行只是为了让它被当作 ES module（本文件全是 CJS 的 exports/require，
   没有它 tsc 会按「全局脚本」处理并报 TS2306: not a module）。
   编译产物不受影响：纯 JS 表达式原样保留，运行时语义与线上完全一致。 */
export { };
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStudyBonusMultiplier = getStudyBonusMultiplier;
exports.assertCostTableConsistent = assertCostTableConsistent;
const express_1 = require("express");
const database_1 = require("../db/database");
const auth_1 = require("../middleware/auth");
const coins_1 = require("../lib/coins");
const rateLimit_1 = require("../middleware/rateLimit");
/* 存档校验与「服务端权威进度」原语（2026-10-01 安全修复） */
const village_save_1 = require("../lib/village-save");
/**
 * 服务端认可的建筑类型白名单。
 *
 * ⚠️ 必须与 client/public/village3d/js/config.js 的 BUILDINGS 保持同步。
 *    生成快照时用它过滤掉手改存档塞进来的未知 type —— 否则客户端
 *    _buildFromSave 会因为 BUILDINGS[type] 不存在而崩，整场战斗白屏。
 *
 * 2026-10-01 起改从 lib/village-save.ts 引入同一份定义（原先此处与
 * 存档校验各存一份，容易改了一处漏另一处）。
 */
const KNOWN_BUILDINGS = village_save_1.KNOWN_BUILDINGS;
/**
 * 刻忆觉醒（village）—— 游戏与学习平台的整合接口
 *
 * ============================================================
 * 经济模型（2026-09-29 统一）
 * ============================================================
 * 游戏内的「金币」已取消，改为直接使用平台真实的「铜板」。因此本文件
 * 承载了全部铜板进出：任何能让玩家凭空产出铜板的路径都是印钞机。
 *
 * 四条红线（改本文件前务必逐条对照）：
 *   ① 战斗掠夺   —— 客户端 battle.js 里 gold 恒为 0。铜板只有两个出口：
 *                    · NPC 关卡：本文件 POST /events（type=battle_end）按星级【发放】
 *                    · PVP     ：POST /attack/finish 从对手钱包【真实转移】
 *                    两者共享 DAILY_BATTLE_COIN_CAP。NPC 是增发，PVP 是转移，
 *                    都不是客户端能自己造出来的 —— 客户端报的 stars/pct 只作审计。
 *   ② 建筑自产   —— config.js 里 goldmine 的 prod 已删除，它现在是纯加成建筑。
 *                    PROD_PER_GAME_HOUR 同步删掉 goldmine 项。
 *   ③ 离线收益   —— /offline-claim 的 granted.gold 恒为 0，产能全折给圣水。
 *   ④ 上报金额   —— /withdraw 必须用 EXPECTED_COST 核对「真实造价」，
 *                    只靠 SPEND_KINDS 的上限挡不住「合法但虚假」的金额。
 *
 * 客户端上报的任何数字（金额、星级、等级）都只作审计，绝不作发币依据。
 *
 * 【2026-09-29 灰度 → 2026-10-01 全量】整个模块现对全部登录用户开放。
 *   放开的前提条件已在 2026-10-01 补齐：
 *     · POST /save 存档结构校验（sanitizeVillageSave）—— 手改档抬不了等级
 *     · readPlayerProgress 双向锚定 —— 权威等级只跟真实花费走
 *     · 闭馆时段禁止写档（POST /save 移出白名单）
 *   若线上出现异常需要临时收回，把 ADMIN_ONLY 改回 true 即可（会重新要求 admin）。
 */
const router = (0, express_1.Router)();
/* 未登录不得进入：整个模块的**第一道**门。
   放在 OPEN_HOURS 闸门之前 —— 先确认"你是谁"，再谈"现在开不开门"。
   缺 token / token 无效 → authMiddleware 直接 401，不会碰到任何业务逻辑。 */
router.use(auth_1.authMiddleware);
/**
 * 灰度开关：置 true 即只允许 admin 进入（保留用于紧急收回全量开放）。
 * 2026-10-01 起为 false（全量开放），前提是存档校验三件套已上线。
 */
const ADMIN_ONLY = false;
if (ADMIN_ONLY) {
    router.use(auth_1.adminMiddleware);
}
/* ============================================================
   开放时间（北京时间 UTC+8）
   ------------------------------------------------------------
   部落只在指定时段开放（课间 + 放学后），其余时间学生进不来。
   必须做在**服务端**：前端的提示能被改前端绕过，只有服务端拒绝才算真关门。

   【2026-10-11 调整】时段分成两套：
     · 法定工作日 → WINDOWS_WORKDAY（原时段，保持不变）
     · 其余日子   → WINDOWS_OFFDAY（周末 + 法定节假日）
                    早上两场提前（07:00-07:37 / 08:20-08:27），
                    09:35-09:42 及之后的场次与工作日完全一致。

   为什么按「法定工作日」而不是简单的「周一至周五」：
     调休上班日（如 2026-10-10 周六要上班）和法定假日（如 2026-10-01
     周四放假）都会让「周一至周五」这个判定出错。所以直接内置国务院
     公布的节假日与调休表，不对星期几做猜测。

   ⚠️ 维护：每年国务院办公厅发布次年安排后，更新下面 HOLIDAYS_2026 与
      MAKEUP_WORKDAYS_2026 两个数组即可。未被覆盖的年份会自动退化为
      「周一至周五 = 法定工作日」。

   时段用「当日分钟数」表示（0=00:00，450=07:30）。
   目前没有跨天时段（如 23:00-01:00），所以直接 min <= m < max 比较即可。
   开启/关闭总闸：ENFORCE_OPEN_HOURS。
   ============================================================ */
const ENFORCE_OPEN_HOURS = process.env.VILLAGE_OPEN_HOURS !== 'off';

/** 法定工作日的开放时段（原表，未改动） */
const WINDOWS_WORKDAY = [
    [450, 482],   // 07:30 - 08:02
    [525, 532],   // 08:45 - 08:52
    [575, 582],   // 09:35 - 09:42
    [625, 632],   // 10:25 - 10:32
    [675, 683],   // 11:15 - 11:23
    [840, 850],   // 14:00 - 14:10
    [895, 902],   // 14:55 - 15:02
    [945, 952],   // 15:45 - 15:52
    [995, 1002],  // 16:35 - 16:42
    [1045, 1105], // 17:25 - 18:25
    [1160, 1170], // 19:20 - 19:30
    [1220, 1230], // 20:20 - 20:30
    [1280, 1290], // 21:20 - 21:30
];

/** 非工作日（周末 / 法定节假日）：早上两场提前，09:35 起与工作日完全一致 */
const WINDOWS_OFFDAY = [
    [420, 457],   // 07:00 - 07:37
    [500, 507],   // 08:20 - 08:27
    [575, 582],   // 09:35 - 09:42  ← 自此往下与 WINDOWS_WORKDAY 逐项相同
    [625, 632],   // 10:25 - 10:32
    [675, 683],   // 11:15 - 11:23
    [840, 850],   // 14:00 - 14:10
    [895, 902],   // 14:55 - 15:02
    [945, 952],   // 15:45 - 15:52
    [995, 1002],  // 16:35 - 16:42
    [1045, 1105], // 17:25 - 18:25
    [1160, 1170], // 19:20 - 19:30
    [1220, 1230], // 20:20 - 20:30
    [1280, 1290], // 21:20 - 21:30
];

/* ── 2026 年法定节假日 / 调休上班日（北京时间，'YYYY-MM-DD'）─────────
   来源：国务院办公厅《关于 2026 年部分节假日安排的通知》(2025-11-04)
     元旦    1/1(四)-1/3(六) 放假 ┊ 1/4(日) 上班
     春节    2/15(日)-2/23(一) 放假 ┊ 2/14(六)、2/28(六) 上班
     清明节  4/4(六)-4/6(一) 放假
     劳动节  5/1(五)-5/5(二) 放假 ┊ 5/9(六) 上班
     端午节  6/19(五)-6/21(日) 放假
     中秋节  9/25(五)-9/27(日) 放假
     国庆节  10/1(四)-10/7(三) 放假 ┊ 9/20(日)、10/10(六) 上班
   清明/端午/中秋的放假区间本就含周末，一并列出只是为了让这份数据自解释、
   不必让读者再去推算。 */
const HOLIDAYS_2026 = [
    '2026-01-01', '2026-01-02', '2026-01-03',
    '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
    '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
    '2026-04-04', '2026-04-05', '2026-04-06',
    '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
    '2026-06-19', '2026-06-20', '2026-06-21',
    '2026-09-25', '2026-09-26', '2026-09-27',
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
    '2026-10-06', '2026-10-07',
];
const MAKEUP_WORKDAYS_2026 = [
    '2026-01-04',  // 元旦调休（周日上班）
    '2026-02-14',  // 春节调休（周六上班）
    '2026-02-28',  // 春节调休（周六上班）
    '2026-05-09',  // 劳动节调休（周六上班）
    '2026-09-20',  // 国庆调休（周日上班）
    '2026-10-10',  // 国庆调休（周六上班）
];
const HOLIDAY_SET = new Set(HOLIDAYS_2026);
const MAKEUP_WORKDAY_SET = new Set(MAKEUP_WORKDAYS_2026);

/** 分钟数 → "HH:MM" */
function hmOf(min) {
    return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}
/** 时段表 → 客户端可读文本数组：「07:30-08:02」 */
function windowsText(ws) {
    return (ws || []).map(([a, b]) => hmOf(a) + '-' + hmOf(b));
}
/** 北京时间的 'YYYY-MM-DD'（服务端时区可能是 UTC，必须手动 +8） */
function cstYmd(nowMs) {
    const d = new Date(nowMs + 8 * 3600 * 1000);
    return d.getUTCFullYear() + '-' +
        String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
        String(d.getUTCDate()).padStart(2, '0');
}
/** 北京时间的「当日分钟数」（0=00:00，450=07:30） */
function cstMinuteOfDay(nowMs) {
    const d = new Date(nowMs + 8 * 3600 * 1000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
}
/** 北京时间某日 00:00 的毫秒时间戳 */
function cstDayStart(nowMs) {
    const d = new Date(nowMs + 8 * 3600 * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 8 * 3600 * 1000;
}
/**
 * 该时刻是否属于「法定工作日」。
 * 判定优先级：调休上班日 > 法定节假日 > 周一至周五。
 * 前两条正好覆盖「周末要上班」与「工作日放假」这两种反常情况。
 */
function isWorkday(nowMs) {
    const ymd = cstYmd(nowMs);
    if (MAKEUP_WORKDAY_SET.has(ymd)) return true;
    if (HOLIDAY_SET.has(ymd)) return false;
    const dow = new Date(nowMs + 8 * 3600 * 1000).getUTCDay();  // 0=周日
    return dow >= 1 && dow <= 5;
}
/** 该时刻适用的开放时段表 */
function windowsOf(nowMs) {
    return isWorkday(nowMs) ? WINDOWS_WORKDAY : WINDOWS_OFFDAY;
}
/** 是否在开放时段内（在则返回该时段，否则 null） */
function openWindowAt(nowMs) {
    const m = cstMinuteOfDay(nowMs);
    for (const w of windowsOf(nowMs))
        if (m >= w[0] && m < w[1]) return w;
    return null;
}
/**
 * 下一次「状态切换」的毫秒时间戳。
 *   当前开放中 → 本场结束时刻（客户端据此提示「还剩 X 分钟」）
 *   当前已关闭 → 下一场开始时刻
 * 【2026-10-11】改为跨日搜索：工作日与非工作日是两套表，不能再假设
 *   「明天的第一场」—— 例如周日晚上闭馆，下一场是周一 07:30（工作日表），
 *   而周日的表第一场是 07:00，沿用旧写法会算错。向后找最多 14 天（覆盖长假）。
 */
function nextOpenMs(nowMs) {
    const m = cstMinuteOfDay(nowMs);
    const today = windowsOf(nowMs);
    for (const w of today) {
        if (m < w[0]) return nowMs + (w[0] - m) * 60000;   // 还没开场 → 本场开始
        if (m < w[1]) return nowMs + (w[1] - m) * 60000;   // 正在场内 → 本场结束
    }
    for (let d = 1; d <= 14; d++) {
        const dayMs = nowMs + d * 86400000;
        const ws = windowsOf(dayMs);
        if (ws.length) return cstDayStart(dayMs) + ws[0][0] * 60000;
    }
    return nowMs + 86400000;   // 兜底（正常不可达）
}
/**
 * 打烊页要展示的时段表：**下一次开放那一天**的表。
 *   开放中 → nextOpenMs 指向本场结束（仍是今天）→ 今天的表
 *   已闭馆 → nextOpenMs 指向下一场开始 → 那天的表
 * 这样「倒计时指向的时刻」与「表里列出的场次」永远对得上，
 * 不会出现「下一场 07:30，表里却写着 07:00」这种自相矛盾。
 */
function nextOpenWindowsText(nowMs) {
    return windowsText(windowsOf(nextOpenMs(nowMs)));
}
/* 开放时间闸门。
   ── 白名单（放行）──────────────────────────────
     GET  /time   客户端靠它显示倒计时，关了也得能拿到
     GET  /wallet 宿主页要显示余额
     GET  /save   客户端要能读档（进不去游戏时也要能正常加载、避免卡白屏）
   ── 【2026-10-14】被攻打后的「被动补救」也放行 ──────────
     GET  /reports        上线弹的战报（只读）
     POST /reports/seen   标记战报已读
     POST /repair-all     一键修复被打坏的建筑
     POST /repair         单座维修（弹窗外的入口，口径必须一致）
     不放行的话：玩家在闭馆时段上线 → 被战报弹窗拦住 → 点修复返 403
     → 只能退出部落，下次进来再弹一次，等于把他锁在门外。
     这几个都是「被打之后的补救」，不是主动发育，不妨碍闭馆的设计。
   ── 其余全部拒绝 ───────────────────────────────
     POST /save（写档）、/withdraw（建造）、/events、/offline-claim、
     /opponents、/attack/*、/heartbeat

   ⚠️ 2026-10-01 安全修复：原先 POST /save 也在白名单里（顾虑是"到点踢人/
      关闭前后进度会丢"）。但那恰好给了**闭馆时段**这个最佳作案窗口 ——
      此时 /withdraw 被拦，没有任何"造价核对"环节会与存档内容交叉验证，
      手改档上传一路绿灯。既然存档校验（sanitizeVillageSave）已经上线，
      前端在收到 village_closed 时本就该停止写入，这里直接拒绝即可。
      闭馆瞬间的进度：客户端最后一次 flush 在收到 403 前已完成；
      若确实丢了几秒的改动，代价远小于"开放时段外可任意改档"。 */
const OPEN_HOURS_BYPASS = [
    ['GET', '/time'],
    ['GET', '/wallet'],
    ['GET', '/save'],
    /* 【2026-10-14】被动补救：战报与维修（理由见上方白名单说明） */
    ['GET', '/reports'],
    ['POST', '/reports/seen'],
    ['POST', '/repair-all'],
    ['POST', '/repair'],
];
/**
 * 该用户是否管理员。
 *
 * 【2026-10-14 按需求】用于让管理员不受部落开放时段限制 ——
 * 调试/管理时需要随时进村，否则每次都得等到课间窗口。
 *
 * 为什么不信任 token 里的角色：generateToken() 签发的 payload 只有
 * `{ userId }`，本来就没有 role；而且管理员随时可能被授予/撤销，
 * 缓存角色会让"撤销后仍然能进"。
 * 查询失败一律返回 false —— 兜底永远是"更严格"那一侧。
 */
function isAdminUser(userId) {
    if (!userId)
        return false;
    try {
        const row = (0, database_1.getDb)().prepare('SELECT role FROM users WHERE id = ?').get(userId);
        return !!row && row.role === 'admin';
    }
    catch {
        return false;
    }
}

router.use((req, res, next) => {
    if (!ENFORCE_OPEN_HOURS) return next();
    if (OPEN_HOURS_BYPASS.some(([mth, p]) => req.method === mth && req.path === p)) return next();
    /* 【2026-10-14 按需求】管理员不受开放时段限制：改档、查数据、验证功能
       都不必再等课间窗口。这是唯一的角色特权入口，判定见 isAdminUser。 */
    if (isAdminUser(req.userId)) return next();
    const now = Date.now();
    if (openWindowAt(now)) return next();
    res.status(403).json({
        error: 'village_closed',
        message: '部落未在开放时间内，休息一下吧',
        now,
        nextOpenAt: nextOpenMs(now),
        windows: nextOpenWindowsText(now),
    });
});
/** 允许云同步的存档 key 白名单 */
const ALLOWED_KEYS = ['village', 'army', 'quality'];
/** 允许上报的事件类型白名单 */
const ALLOWED_EVENTS = ['upgrade_done', 'train_done', 'battle_end'];
/**
 * 允许的消费类型白名单：kind → 单次允许的最大铜板数。
 *
 * ⚠️ 这一层只防「构造巨额请求」，防不住「金额合法但根本不是这个建筑的造价」。
 *    真正的校验在 EXPECTED_COST。两者必须同时在位。
 */
const SPEND_KINDS = {
    build: 1000, // 建造：最贵的 L1 是学识矿脉 220 / 军营 260，留足余量
    upgrade: 20000, // 升级：最贵的 goldmine L5 = 16500（旧上限 500 会误拒 4/5 级升级）
    rush: 5000, // 秒建筑（宝石折算，保留）
    gem_exchange: 2000, // 宝石兑换
    instant_train: 1000, // 秒训练
};
/**
 * 服务端权威造价表（红线④）。
 *
 * 从 client/public/village3d/js/config.js 的 BUILDINGS[type].up[level-1].g 抄来，
 * key 格式 "{type}:{level}"，level 是「目标等级」（建造 = 1，升级 = 现值+1）。
 *
 * 为什么要硬编码一份：客户端报什么金额服务端就扣什么金额的话，玩家可以报
 * `amount: 1` 建一座市政厅 —— 金额「合法」（>0 且不超上限），但白赚了整个建筑。
 * 只有服务端自己知道每座建筑该多少钱，才谈得上风控。
 *
 * ⚠️ 改 config.js 的 up[].g 时必须同步改这里与 STUDY_BONUS_PER_LEVEL，
 *    否则玩家会看到「扣的钱和标价对不上」或建造被 400 拒绝。
 *    启动时会做一次一致性自检，见 assertCostTableConsistent()。
 */
const EXPECTED_COST = {
    'townhall:1': 0, 'townhall:2': 500, 'townhall:3': 1600, 'townhall:4': 4600, 'townhall:5': 13000,
    'goldmine:1': 220, 'goldmine:2': 660, 'goldmine:3': 2000, 'goldmine:4': 5800, 'goldmine:5': 16500,
    /* 矿场：纯铜板造价，回本周期 15/22/30/40/50 天（累计造价 ÷ 当前日产量）。
       ⚠️ 必须与 config.js 的 mine.up[].g 一致，否则玩家看到「扣的钱和标价对不上」。 */
    'mine:1': 220, 'mine:2': 330, 'mine:3': 650, 'mine:4': 1200, 'mine:5': 2100,
    'elixircollector:1': 90, 'elixircollector:2': 270, 'elixircollector:3': 820,
    'elixircollector:4': 2400, 'elixircollector:5': 7000,
    'goldstorage:1': 130, 'goldstorage:2': 400, 'goldstorage:3': 1200, 'goldstorage:4': 3400, 'goldstorage:5': 9800,
    'elixirstorage:1': 110, 'elixirstorage:2': 330, 'elixirstorage:3': 1000,
    'elixirstorage:4': 2900, 'elixirstorage:5': 8500,
    'barracks:1': 200, 'barracks:2': 600, 'barracks:3': 1750,
    'armycamp:1': 260, 'armycamp:2': 780, 'armycamp:3': 2250,
    'cannon:1': 100, 'cannon:2': 300, 'cannon:3': 900, 'cannon:4': 2700, 'cannon:5': 7800,
    'archertower:1': 120, 'archertower:2': 360, 'archertower:3': 1100,
    'archertower:4': 3200, 'archertower:5': 9200,
    'mortar:1': 280, 'mortar:2': 840, 'mortar:3': 2500, 'mortar:4': 7200,
    // 城墙是 1×1 消耗品（TH1 上限就有 25 座），走高数量低价曲线，不套用 150 起步
    'wall:1': 20, 'wall:2': 40, 'wall:3': 80, 'wall:4': 160, 'wall:5': 320,
    'builderhut:1': 150,
};
/** 拆除返还比例（与 village.js demolish 的 0.3 一致） */
const DEMOLISH_REFUND_RATIO = 0.3;
/* ============================================================
   建筑损坏 / 维修（2026-09-30 新增）
   ------------------------------------------------------------
   被真人攻打后，防方会有一部分建筑「被打坏」：停产 + 不能升级，
   必须花铜板修好才恢复。三件事必须都做在服务端：
     ① 算「哪几座被打坏」—— 绝不能用攻击者客户端上报的拆除清单，
        否则他可以谎报把对手村庄全推平，白坑对方的维修费；
     ② 维修费定价 —— 客户端报多少就扣多少 = 白拿；
     ③ 扣费后的存档更新 —— 否则「修好了」只是本地假象。
   ============================================================ */
/** 维修费 = 该建筑「重造到当前等级」累计铜板造价的 8% */
const REPAIR_RATIO = 0.08;
/**
 * 某建筑某等级的维修费（铜板）。
 * 累计造价直接从 EXPECTED_COST 求和，天然与建造/升级价格表保持一致 ——
 * 不用再维护第二张表，也就不存在「两张表对不上」的隐患。
 */
function repairCost(type, level) {
    const lv = Math.max(1, Math.min(Math.floor(Number(level) || 1), 5));
    let acc = 0;
    for (let i = 1; i <= lv; i++) {
        const c = EXPECTED_COST[type + ':' + i];
        if (typeof c === 'number') acc += c;
    }
    return Math.max(1, Math.floor(acc * REPAIR_RATIO));
}
/**
 * 服务端重算「有效破坏百分比」。
 *
 * 【2026-10-01 安全修复】原先 pct 直接取客户端上报值（仅 clamp 0..100），
 * 而它决定了「对手有几座建筑被打坏」—— 攻击者报 pct:99.5 就能把对手全村
 * 打进损坏态（停产 + 不能升级），逼其支付大额维修费。这正是函数注释里
 * 想防的场景，但 pct 恰恰也是客户端说了算的，所以没防住。
 *
 * 服务端无法重放战斗，但可以做**一致性夹取**（保守优先）：
 *   · thDead（市政厅是否被拆）是结算请求里另一个客户端字段，但它与 pct
 *     在语义上有强关联：拆掉市政厅必然意味着高破坏率。两者矛盾时取小。
 *   · 再按"是否 3 星"给上限：非 3 星不可能把全村推平。
 * 这不是密码学级别的证明，但它把「一句话报 99.5% 全推平」的成本
 * 抬到了「必须真的打到 3 星」，与正常玩法一致。
 *
 * @param {number} rawPct    客户端上报（已 clamp 0..100）
 * @param {boolean} thDead   客户端上报的"市政厅已拆"
 * @param {number} stars     服务端重算后的星级
 * @param {boolean} suspicious 20 秒内 2 星以上 → 判异常，直接按 0 处理
 */
function effectiveRaidPct(rawPct, thDead, stars, suspicious) {
    const p = Math.max(0, Math.min(100, Number(rawPct) || 0));
    // 异常场次：不给任何破坏力（与 stars=0 一致）
    if (suspicious) return 0;
    // 未拆市政厅却报"几乎全平" → 矛盾，压到 60%
    if (!thDead && p > 60) return 60;
    // 非满星不允许"全平"（3 星才是推平级别）
    if (stars < 3 && p > 85) return 85;
    return p;
}
/**
 * 单次进攻允许打坏的最大建筑比例。
 * 即使 pct 合法，也不允许一次把对手全村打废 —— 这是体验底线
 * （注释里写的"不毁建筑"原则），同时限制了 pct 被滥用的伤害上限。
 */
const MAX_DAMAGE_RATIO = 0.5;
/**
 * 按战斗破坏率挑出「被打坏」的建筑 id。
 *
 * 口径：损坏**数量** = ceil(建筑数 × pct%)，具体是哪几座由
 * 快照 id 做确定性洗牌决定（同一次进攻每次算出来完全一样，便于审计/复现）。
 * 为什么不用「血量占比」：那需要服务端再抄一份各建筑血量表，多一处同步负担；
 * 按数量分档更好解释（"你被打坏了 6 座"），玩家也更容易接受。
 *
 * ⚠️ 传入的 pct 必须已经过 effectiveRaidPct() 夹取。
 *
 * @param {string|Array} layout 快照里的布局（JSON 字符串或数组）
 * @param {number} pct 服务端重算的破坏百分比
 * @param {number} seed 快照 id
 */
function pickDamagedBuildings(layout, pct, seed) {
    let arr = layout;
    if (typeof arr === 'string') {
        try {
            arr = JSON.parse(arr);
        }
        catch {
            return [];
        }
    }
    arr = Array.isArray(arr) ? arr.filter((b) => b && KNOWN_BUILDINGS.has(b.y) && b.y !== 'wall') : [];
    if (!arr.length || !(pct > 0))
        return [];
    /* 双重封顶：① 按 pct 算的数量；② 不超过建筑总数的 MAX_DAMAGE_RATIO。
       两层都取 min，保证任何输入都打不废对手全村。 */
    const byPct = Math.max(1, Math.ceil(arr.length * (pct / 100)));
    const byCap = Math.max(1, Math.ceil(arr.length * MAX_DAMAGE_RATIO));
    const n = Math.min(arr.length, byPct, byCap);
    // 确定性洗牌（xorshift，与前端无关，纯服务端）
    const idx = arr.map((_, i) => i);
    let h = (Number(seed) || 1) >>> 0;
    const rnd = () => { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
    for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = idx[i];
        idx[i] = idx[j];
        idx[j] = t;
    }
    return idx.slice(0, n).map((i) => arr[i].i).filter((x) => x !== undefined && x !== null).map(Number);
}
/**
 * 学识矿脉的学习铜板加成表（每级）。
 * ⚠️ 必须与 config.js 的 goldmine.effect.perLevel 一致。
 */
const STUDY_BONUS_PER_LEVEL = [0.02, 0.05, 0.09, 0.14, 0.20];
/** 学习加成总封顶：100% */
const STUDY_BONUS_MAX = 1.0;
/**
 * 袭击难度 → 我方市政厅等级要求（与 config.js RAID_TIERS[].minTH 一致，+1 后对齐）。
 * key 是客户端上报的 tier（1-based）。
 */
const RAID_MIN_TH = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 4 };
/**
 * 战斗铜板奖励：tier（1-based）→ 每颗星的铜板数。
 * 与 config.js RAID_COIN_REWARD 一致（那里是 0-based，这里是 1-based）。
 * 刻意保守：满星 tier5 = 12×3 = 36，与「学习一天 20~40 铜板」同量级。
 */
const RAID_COIN_REWARD = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 12 };
/** 战斗铜板每日上限（所有 tier 合计）。防挂机刷战斗。 */
const DAILY_BATTLE_COIN_CAP = 40;
/** 离线收益参数 */
const MAX_OFFLINE_SEC = 8 * 3600; // 最多累计 8 小时（真实秒）
const MIN_OFFLINE_SEC = 60; // 少于 60 秒不计（防秒进秒出刷）
const DAILY_OFFLINE_COIN_CAP = 5; // 每日离线铜板补贴上限（激励回访，极小额度）
const TIME_SCALE = 1; // 与游戏 config.js 保持一致：1 真实秒 = 1 游戏秒（2026-09-30 起真实时间）
/** 按市政厅等级封顶的离线虚拟资源上限（已随经济缩放同步下调；只对圣水生效） */
const OFFLINE_CAP_BY_TH = {
    1: 80, 2: 200, 3: 420, 4: 760, 5: 1280,
};
/** 单用户每分钟事件上报上限 */
const EVENT_RATE_PER_MIN = 60;
/* ============================================================
   PVP（打真实玩家部落）参数
   ------------------------------------------------------------
   经济语义与 NPC 关卡**本质不同**：
     · NPC   —— 铜板由平台按星级【发放】（增发）
     · PVP   —— 铜板从对手钱包【真实转移】（不增发，总量守恒）
   两者共享 DAILY_BATTLE_COIN_CAP，避免战斗取代学习。

   ⚠️ 「真实转移」意味着玩家资产可被他人夺走，这是用户明确接受的设计。
      所有保护（每日损失上限 / 维修期免战 / 同人冷却 / 不毁建筑）都是体验底线，
      不是可选项 —— 去掉任何一条都会变成"被抢光后弃游"。
   ============================================================ */
/**
 * 掠夺比例（2026-09-30 按需求改）：
 *   · 固定 5% —— 不再按星级递增（1 星和 2 星都是 5%，打得好不再线性放大）
 *   · 3 星额外奖励 → 8%
 *   · 0 星（进攻失败）一毛不拿
 * 铜板与圣水共用这一张表，避免「钱抢得多、水抢得少」的诡异手感。
 */
const LOOT_RATIO_BY_STARS = [0, 0.05, 0.05, 0.08];
/** 防守方每日最多被抢走的铜板总额（保护被抢的人） */
const DEFENDER_DAILY_LOSS_CAP = 25;
/* 保护口径（2026-10-14 按需求改）：
   · 被打坏建筑 → **修好之前不能被攻打**（匹配与开打两处都过滤，见 NOT_DAMAGED_SQL）
   · 一座都没打坏（0 星 / 进攻失败）→ 30 分钟冷却，防被反复骚扰
   原先「被抢到钱就送 12 小时护盾」已移除：损坏的建筑本身就会停产、不能升级，
   玩家本来就有动力尽快修；再叠一层时间护盾等于同一次攻打被保护两遍，
   对手池会明显缩水（实测合格池只有 80 人，经不起重复抠掉）。 */
const SHIELD_SEC_AFTER_FAIL = 30 * 60;
/** 同一对手的重复进攻间隔与单日次数（防反复刷同一个人） */
const SAME_TARGET_COOLDOWN_SEC = 3600;
const SAME_TARGET_PER_DAY = 2;
/** 每日总出征场次上限（含 NPC 与 PVP） */
const DAILY_RAID_MAX = 12;
/**
 * 每日「进攻真人部落」次数上限（2026-10-14 按需求：每人每天最多打别人 2 次）。
 * 与 DAILY_RAID_MAX 是叠加关系：打真人额外受这条约束，打 NPC 不受；两者都计入总场次。
 * 计数真源是 village_raid_snapshots —— 每成功发起一次真人进攻恰好插一行（带 day），
 * 所以不需要新增计数字段，也不会因为中途放弃 / 快照过期而漏算。
 */
const DAILY_PVP_ATTACK_MAX = 2;
/**
 * 进攻次数豁免名单：名单内的账号不受 DAILY_PVP_ATTACK_MAX 限制。
 * 只作用于名单内的**进攻方**，机制与防守侧 WEEKLY_DEFENSE_CAP_EXEMPT 一致。
 * ⚠️ 仅用于测试号；总场次 DAILY_RAID_MAX 仍然生效。
 *
 * 【2026-11-15 清空】原先挂着 9029（蔡东林），是真实玩家账号而非测试号，
 * 导致该号每天可无限次进攻真人。反馈 476（何文辉）投诉的「管理员无限兵力
 * 打普通玩家」即由此引起（实测该号并非管理员，只是享有进攻豁免）。
 * 现改为空名单：所有账号一律受 DAILY_PVP_ATTACK_MAX = 2 约束。
 */
const PVP_ATTACK_EXEMPT = new Set<number>([]);
const pvpAttackMaxOf = (uid: number) =>
    PVP_ATTACK_EXEMPT.has(Number(uid)) ? 999999 : DAILY_PVP_ATTACK_MAX;
/**
 * 每个部落每周最多被攻打多少次（2026-11-06 按需求）。
 *
 * 反馈 173（黄怡烨）：「弱的人天天被打，应该有每周上限」。
 * 匹配和开打两处同时过滤：列表里不出现，硬打也打不进去。
 * 取 10 —— 一周 7 天，平均一天 1.4 次，够活跃玩家打、也不至于把人打废。
 * 只统计真人 PVP（mode='pvp'），NPC 演练不算「被别人打」。
 */
const WEEKLY_DEFENSE_CAP = 10;
/**
 * 不受「每周被攻打上限」约束的账号。
 * 只作用于名单内的**防守方**：名单外的人仍按 WEEKLY_DEFENSE_CAP 拦截。
 * 用途：玩家自己测试防守阵型，希望被反复攻打。
 *
 * 【2026-11-15 清空】原因同上：9029 是真实玩家，不是测试号。
 * 若将来真需要测试，请新建专用测试账号并把 id 加进这里，不要挂真实玩家。
 */
const WEEKLY_DEFENSE_CAP_EXEMPT = new Set<number>([]);
const weeklyDefenseCapOf = (uid: number) =>
    WEEKLY_DEFENSE_CAP_EXEMPT.has(Number(uid)) ? 999999 : WEEKLY_DEFENSE_CAP;
/**
 * 北京时间「本周一」的日期串（YYYY-MM-DD），用于按周统计被攻打次数。
 * day 列本来就是北京日的字符串，直接做字典序比较即可。
 */
function weekStartDayStr(nowMs) {
    const dow = new Date(nowMs + 8 * 3600 * 1000).getUTCDay();  // 0=周日
    const back = (dow + 6) % 7;                                   // 周一 → 0
    return cstYmd(cstDayStart(nowMs) - back * 86400000);
}
/**
 * 「换一批」对手的花费（铜板）。
 * 不免费的原因：免费就能无限刷到「轻松 + 钱多」的软柿子，匹配随机性形同虚设。
 * 取 10 是「比一次出征的期望收益低、但足以拦住无脑刷」的量级
 * （一次 3 星掠夺上限 25，学一组词约 20~40）。
 * ⚠️ 客户端 ui.js 里的 REROLL_COST 必须与这里一致（只影响按钮文案与本地预校验，
 *    真正的扣费只认服务端）。
 */
const OPPONENT_REROLL_COST = 10;
/** 快照有效期：超时未结算自动作废，铜板不转移 */
const SNAPSHOT_TTL_SEC = 600;
/**
 * 战斗时长下限：低于此值且拿了 2 星以上，判为异常（改客户端或秒结算）。
 * ⚠️ 只在 stars >= 2 时才生效 —— 兵力碾压快速打完 1 星是正常玩法，
 *    但 20 秒内摧毁 99.5% 物理上不可能。
 */
const MIN_BATTLE_MS = 20_000;
/** 进池门槛：建筑太少的新村不给别人打，也不该被匹配到 */
const MIN_BUILDINGS_TO_BE_TARGET = 3;
/** 新号保护：注册不足 7 天不进匹配池（养号成本 > 掠夺收益） */
const NEWBIE_SHIELD_DAYS = 7;
/**
 * 建筑外观变体总数。
 * ⚠️ 必须与 client/public/village3d/js/models.js 的 BUILD_VARIANTS 一致。
 *    启动时由 assertVariantConsistent() 自检。
 */
const BUILD_VARIANTS = 3;
/**
 * 与 models.js variantOf() 同源的 FNV-1a 32 位哈希。
 *
 * 为什么服务端要算这个：房主看自己的村庄用 variantOf(实例id)，
 * 若进攻方用 variantOf(坐标)，同一座房子在两边会长得不一样 ——
 * "打的就是他家"这件事在视觉上就不成立了。服务端统一下发变体号。
 */
function variantOf(key) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return (h >>> 0) % BUILD_VARIANTS;
}
/**
 * 游戏建筑产能表：类型 → 每级【每游戏小时】产量。
 * ⚠️ 单位是游戏小时，不是真实小时。真实换算：
 *      真实每小时 = 本表数值 × TIME_SCALE(30) = 每真实分钟产量 × 60
 *
 * ⚠️ goldmine 已删除 —— 它改造为「学识矿脉」加成建筑后不再产出任何资源。
 *    留着它会让离线收益里凭空多出一份金币。
 *
 * 本表必须与 client/public/village3d/js/config.js 的 prod[].rate 保持一致。
 */
const PROD_PER_GAME_HOUR = {
    elixircollector: [33, 75, 150, 267, 433],
};
function clampNum(n, min, max) {
    const v = typeof n === 'number' && isFinite(n) ? n : 0;
    return Math.max(min, Math.min(max, v));
}
/**
 * 从玩家的服务端存档里解析「市政厅等级」与「学识矿脉等级」。
 *
 * ⚠️ 这是本文件的核心安全原语：一切与玩家进度相关的判定（离线产能、
 *    战斗解锁、学习加成）都必须基于服务端侧的事实，而不是客户端上报。
 *
 * 【2026-10-01 安全修复】原先这里**完全信任存档里的 b.l**。而存档是客户端
 * 通过 POST /save 交上来的 —— 只要塞一座 {y:'goldmine', l:5} 并保存，
 * 就能永久拿到 +20% 学习加成（cards.ts → getStudyBonusMultiplier），
 * 且完全不用支付 16500 铜板的真实造价。同一手法还能把离线收益上限
 * 从 TH1 的 80 抬到 TH5 的 1280（16 倍）。
 *
 * 现在的口径是**双向锚定**（见 lib/village-save.ts 的 anchorLevel）：
 *   thLevel = min(存档里的 TH 等级, users.village_th_level)
 * 权威列只在服务端确认真实花费时前进（/withdraw 成功），所以：
 *   · 客户端伪造抬高 → 被权威列压住，拿不到额外收益
 *   · 权威列为 0（尚未初始化）→ 退化为信任存档，避免老用户被回档
 * 另外存档本身已由 sanitizeVillageSave() 贴了封条（等级/数量/坐标越界直接拒），
 * 两层互为保险 —— 任何一层单独失效都不会变成印钞机。
 */
/**
 * 矿场每日铜板产量（按等级 1..5）。
 * ⚠️ 必须与 client/public/village3d/js/config.js 里 mine.prod 的 rate × 24 一致。
 */
const MINE_RATE_PER_DAY = [15, 25, 40, 60, 90];
/**
 * 铜板库容量（按等级 1..5）= 矿场 2 天的产量。
 * ⚠️ 必须与 config.js 里 goldstorage.store 的 cap 一致。
 * 语义：**所有矿场共享的总待收上限**（不是单座矿场的池）。
 */
const GOLD_STORAGE_CAP = [30, 50, 80, 120, 180];
/**
 * 没建铜板库时的兜底容量：按「矿场 1 天的产量」算。
 * 【2026-11-07 修 G05】原来 cap 只由 goldstorage 提供，cap<=0 直接返回 0，
 * 于是「只建矿场、没建铜板库」的学生永远收不到一个铜板，界面上也没有任何提示。
 * 反馈里 6 个人都在问「矿场为什么不产铜板」，张宇娴装了 10 天零产出。
 */
const MINE_FALLBACK_DAYS = 1;
/**
 * 统计玩家的矿场产能与铜板库容量。
 *
 * @param {number} userId
 * @param {number} thLevel 服务端**锚定后**的市政厅等级（不是存档自报的）
 *
 * 三层防护里的前两层：
 *   ① 按锚定后的 TH 取 MAXCNT，超出的建筑直接不计数 ——
 *      手改存档塞 20 座 5 级矿场也没用
 *   ② 数量超出时**保留等级最高的那几座**：对玩家最有利，
 *      避免"被截断"表现为收益莫名下降
 * （第三层在接口里：铜板只按服务端时间发。）
 */
function readMineStats(userId, thLevel) {
    const db = (0, database_1.getDb)();
    const row = db.prepare('SELECT data FROM village_saves WHERE user_id = ? AND save_key = ?').get(userId, 'village');
    const mineLv = [];
    const storeLv = [];
    if (row && row.data) {
        try {
            const d = JSON.parse(row.data);
            const list = Array.isArray(d && d.buildings) ? d.buildings : [];
            for (const b of list) {
                if (!b)
                    continue;
                const lv = Math.floor(Number(b.l) || 0);
                /* lv 0 = 施工中，不产能；越界等级直接忽略 */
                if (lv < 1 || lv > village_save_1.MAX_LEVEL)
                    continue;
                if (b.y === 'mine')
                    mineLv.push(lv);
                else if (b.y === 'goldstorage')
                    storeLv.push(lv);
            }
        }
        catch { /* 存档损坏按 0 处理 */ }
    }
    const maxMine = (0, village_save_1.maxCountOf)('mine', thLevel);
    const maxStore = (0, village_save_1.maxCountOf)('goldstorage', thLevel);
    mineLv.sort((a, b) => b - a);
    storeLv.sort((a, b) => b - a);
    let ratePerDay = 0;
    let cap = 0;
    for (const lv of mineLv.slice(0, maxMine))
        ratePerDay += MINE_RATE_PER_DAY[lv - 1] || 0;
    for (const lv of storeLv.slice(0, maxStore))
        cap += GOLD_STORAGE_CAP[lv - 1] || 0;
    const mines = Math.min(mineLv.length, maxMine);
    /* 没建铜板库：按矿场 1 天产量兜底，保证「建了矿就一定能收到东西」 */
    const storeCap = cap;
    if (storeCap <= 0 && ratePerDay > 0)
        cap = ratePerDay * MINE_FALLBACK_DAYS;
    return {
        ratePerDay,
        cap,
        storeCap,
        mines,
        stores: Math.min(storeLv.length, maxStore),
    };
}

function readPlayerProgress(userId) {
    const db = (0, database_1.getDb)();
    const row = db.prepare('SELECT data FROM village_saves WHERE user_id = ? AND save_key = ?').get(userId, 'village');
    let saveTh = 1;
    let saveMine = 0;
    if (row && row.data) {
        try {
            const d = JSON.parse(row.data);
            const p = (0, village_save_1.progressFromSave)(d);
            saveTh = p.thLevel;
            saveMine = p.mineLevel;
        }
        catch { /* 存档损坏按最低档处理 */ }
    }
    // 服务端权威列（0 = 未初始化 → 不参与锚定）
    let authTh = 0;
    let authMine = 0;
    try {
        const u = db.prepare('SELECT village_th_level, village_mine_level FROM users WHERE id = ?').get(userId);
        authTh = Number(u?.village_th_level) || 0;
        authMine = Number(u?.village_mine_level) || 0;
    }
    catch { /* 列不存在（未迁移）→ 退化为信任存档 */ }
    return {
        /* anchorLevel 内部会把「权威列为 0」当成"尚未初始化"并退化为采信存档，
           所以这里直接传原值即可，不要写 `authTh || null` —— 那会把语义
           藏进调用点，一旦有人漏写就把老用户压成 0 级。 */
        thLevel: Math.max(1, (0, village_save_1.anchorLevel)(saveTh, authTh)),
        mineLevel: (0, village_save_1.anchorLevel)(saveMine, authMine),
    };
}
/**
 * 推进服务端权威进度（只升不降）。
 *
 * 调用时机：服务端**确认了真实花费**之后（/withdraw 的 build/upgrade 成功）。
 * 这是唯一能让权威等级前进的入口 —— 也就是说，"等级"从此只跟真金白银挂钩，
 * 跟客户端说了什么无关。
 *
 * @param {number} nextTh   本次操作后的市政厅等级（由服务端按 type/level 推出）
 * @param {number} nextMine 本次操作后的学识矿脉等级
 */
function bumpAuthoritativeProgress(userId, nextTh, nextMine) {
    const db = (0, database_1.getDb)();
    const th = Math.max(0, Math.floor(Number(nextTh) || 0));
    const mine = Math.max(0, Math.floor(Number(nextMine) || 0));
    if (th <= 0 && mine <= 0)
        return;
    try {
        db.prepare(`UPDATE users
         SET village_th_level   = MAX(village_th_level, ?),
             village_mine_level = MAX(village_mine_level, ?)
       WHERE id = ?`).run(th, mine, userId);
    }
    catch { /* 列缺失等异常不影响主流程：安全上只会"更保守" */ }
}
/**
 * 首次保存时把权威列初始化成存档当前值。
 *
 * 为什么需要：老用户升级前就玩到 TH3，权威列是 0。如果不初始化，
 * 他某天存档丢了一次（重建村庄回到 TH1）再想升回 TH3，会被 UI 允许，
 * 但 readPlayerProgress 取 min(3, 0→不参与) 还好；可一旦某次真实升级
 * 把权威列写成 TH4，而他存档其实是 TH3，就会出现"权威 > 存档"的倒挂。
 * 初始化一次即可让两边从同一起点出发。
 *
 * 只在权威列仍为 0 时写入，且值直接取**已经过校验的**存档进度 ——
 * 此时存档已由 sanitizeVillageSave 验过，等级可信。
 */
function initAuthoritativeProgress(userId, thLevel, mineLevel) {
    const db = (0, database_1.getDb)();
    const th = Math.max(1, Math.floor(Number(thLevel) || 1));
    const mine = Math.max(0, Math.floor(Number(mineLevel) || 0));
    try {
        db.prepare(`UPDATE users
         SET village_th_level   = CASE WHEN village_th_level   = 0 THEN ? ELSE village_th_level   END,
             village_mine_level = CASE WHEN village_mine_level = 0 THEN ? ELSE village_mine_level END
       WHERE id = ?`).run(Math.min(th, 5), Math.min(mine, 5), userId);
    }
    catch { /* 忽略 */ }
}
/* ============================================================
   PVP 辅助：对手索引 / 防守队列 / 结算
   ============================================================ */
/**
 * 解析一次村庄存档，抽出匹配需要的字段。
 * 容错优先：任何一处解析失败都按"空村"处理，绝不让匹配接口 500。
 */
function parseVillageSafe(data) {
    const empty = { th: 1, total: 0, walls: 0, defs: 0, elixir: 0, buildings: [] };
    if (!data)
        return empty;
    let d;
    try {
        d = JSON.parse(data);
    }
    catch {
        return empty;
    }
    const list = Array.isArray(d?.buildings) ? d.buildings : [];
    let th = 1, walls = 0, defs = 0;
    for (const b of list) {
        if (!b)
            continue;
        if (b.y === 'townhall')
            th = Math.max(th, Number(b.l) || 1);
        if (b.y === 'wall')
            walls++;
        if (b.y === 'cannon' || b.y === 'archertower' || b.y === 'mortar')
            defs++;
    }
    return {
        th: Math.max(1, th), total: list.length, walls, defs,
        elixir: Math.max(0, Math.floor(Number(d?.res?.elixir) || 0)),
        buildings: list,
    };
}
/**
 * 刷新某玩家的对手索引（village_profiles）。
 *
 * 只在 POST /save 成功写库后调用，所以永远与 village_saves 同步，
 * 不需要定时全表扫。users.coins 的变动（学习/消费/被抢）不经过 /save，
 * 所以 loot_coins 只是粗镜像 —— 匹配时会再取一次 users.coins 做真值。
 */
function refreshProfile(db, userId, data) {
    const p = parseVillageSafe(data);
    db.prepare(`
    INSERT INTO village_profiles
      (user_id, th_level, building_cnt, wall_cnt, def_cnt, loot_coins, loot_elixir, updated_at)
    VALUES (?,?,?,?,?,(SELECT COALESCE(coins,0) FROM users WHERE id=?),?,unixepoch())
    ON CONFLICT(user_id) DO UPDATE SET
      th_level     = excluded.th_level,
      building_cnt = excluded.building_cnt,
      wall_cnt     = excluded.wall_cnt,
      def_cnt      = excluded.def_cnt,
      loot_coins   = (SELECT COALESCE(coins,0) FROM users WHERE id=?),
      loot_elixir  = excluded.loot_elixir,
      updated_at   = unixepoch()
  `).run(userId, p.th, p.total, p.walls, p.defs, userId, p.elixir, userId);
}
/**
 * 把「被掠夺」的圣水损失应用到防守方存档。
 *
 * ⚠️ 必须在 GET /save 里调用，不能在 POST /save 里：
 *    GET 时客户端还没拿到 version，我们改完 version+1 再返回，
 *    客户端下次提交的 baseVersion 就是最新的 —— 零冲突。
 *    若在 POST 里做，客户端手里的 base 永远落后一步，100% 409，
 *    而 409 时 storage.js 是「服务端优先覆盖本地」→ 玩家丢进度。
 *
 * 幂等靠 `WHERE status='pending'` + 同一事务内 UPDATE：
 * 双开标签页同时触发也只扣一次。
 */
function applyDefenseQueue(db, userId) {
    const pend = db.prepare(`SELECT * FROM village_defense_queue
     WHERE defender_id = ? AND status = 'pending' ORDER BY id`).all(userId);
    if (!pend.length)
        return { applied: 0, lostElixir: 0, notices: [] };
    const skipAll = () => {
        db.prepare(`UPDATE village_defense_queue SET status='skipped', applied_at=unixepoch()
       WHERE defender_id = ? AND status = 'pending'`).run(userId);
        return { applied: 0, lostElixir: 0, notices: [] };
    };
    const sv = db.prepare('SELECT data FROM village_saves WHERE user_id = ? AND save_key = ?').get(userId, 'village');
    // 没有存档（新号）或存档损坏：无从扣起，标 skipped 避免队列永远堵着
    if (!sv || !sv.data)
        return skipAll();
    let d;
    try {
        d = JSON.parse(sv.data);
    }
    catch {
        return skipAll();
    }
    let lost = 0;
    const notices = [];
    for (const q of pend) {
        /* 二次夹取：结算时按快照算的 elixir_lost，此刻对手可能已经把圣水花掉。
           实际扣额 = min(应扣, 当前余额) —— 圣水永不为负，与铜板同一套规则。 */
        const want = Math.max(0, Math.floor(Number(q.elixir_lost) || 0));
        const have = Math.max(0, Math.floor(Number(d?.res?.elixir) || 0));
        const real = Math.min(want, have);
        d.res = d.res || {};
        d.res.elixir = have - real;
        lost += real;
        let p = {};
        try {
            p = JSON.parse(q.payload);
        }
        catch { /* 坏了就只显示匿名 */ }
        /* 建筑损坏：把这次打坏的那几座并进存档的 dmg 列表（去重）。
           只收存档里真实存在的建筑 id —— 被抢期间玩家可能自己把建筑拆了，
           留悬空 id 会让客户端在「维修列表」里出现幽灵条目。 */
        const dm = Array.isArray(p.dmg) ? p.dmg.map(Number).filter((x) => Number.isFinite(x)) : [];
        let dmgAdded = 0;
        if (dm.length) {
            const alive = new Set((Array.isArray(d.buildings) ? d.buildings : []).map((b) => Number(b && b.i)));
            const ids = new Set((Array.isArray(d.dmg) ? d.dmg : []).map(Number));
            for (const id of dm) {
                if (alive.has(id) && !ids.has(id)) { ids.add(id); dmgAdded++; }
            }
            d.dmg = [...ids];
        }
        notices.push({
            attacker: p.attackerName || '匿名',
            stars: Number(p.stars) || 0,
            pct: Number(p.pct) || 0,
            coins: Number(p.coinsLost) || 0,
            elixir: real,
            at: Number(p.at) || 0,
            /** 这次被打坏的建筑数（客户端据此提示「有 N 座需要维修」） */
            dmg: dmgAdded,
        });
    }
    /* 写回并 version+1。客户端本次 GET 拿到的就是这个新 version，
       所以它下一次 POST 的 baseVersion 一定匹配 —— 零冲突。 */
    db.prepare(`UPDATE village_saves SET data = ?, version = version + 1, updated_at = unixepoch()
     WHERE user_id = ? AND save_key = 'village'`).run(JSON.stringify(d), userId);
    db.prepare(`UPDATE village_defense_queue SET status='applied', applied_at=unixepoch(), notified=1
     WHERE defender_id = ? AND status = 'pending'`).run(userId);
    return { applied: pend.length, lostElixir: lost, notices };
}
/**
 * PVP 结算：校验 → 算掠夺 → 原子双向转移铜板 → 圣水入队 → 护盾/冷却/计数。
 *
 * ⚠️ 本函数内所有 addCoins / getCoins **必须在调用方的事务里**。
 *    addCoins 是先读后写（非原子），只有包在 db.transaction() 里
 *    才能保证"扣"和"加"之间不会被另一个请求穿插。
 */
function settlePvpRaid(db, atk, s, stars, pct, day, suspicious, durMs) {
    const def = Number(s.defender_id);
    const now = Math.floor(Date.now() / 1000);
    // ① 想抢多少（按星级 × 快照时刻对手的可抢池）
    const want = Math.floor(Number(s.loot_coins) * (LOOT_RATIO_BY_STARS[stars] || 0));
    // ② 对手当日还剩多少"可被抢额度"
    const defLostRow = db.prepare(`SELECT COALESCE(SUM(-delta),0) AS x FROM coins_ledger
     WHERE user_id = ? AND day = ? AND delta < 0 AND source = 'village_raid_loss'`).get(def, day);
    const defRoom = Math.max(0, DEFENDER_DAILY_LOSS_CAP - (Number(defLostRow?.x) || 0));
    // ③ 对手当前真实余额
    const defBal = (0, coins_1.getCoins)(def);
    // ④ 三重取小 —— 保证对手余额永不为负
    const take = Math.min(want, defRoom, defBal);
    // ⑤ 进攻方当日还剩多少"可获取额度"（与 NPC 共享 40 上限）
    const atkGotRow = db.prepare(`SELECT COALESCE(SUM(delta),0) AS x FROM coins_ledger
     WHERE user_id = ? AND day = ? AND delta > 0
       AND source IN ('village_raid_gain','village_battle')`).get(atk, day);
    const atkRoom = Math.max(0, DAILY_BATTLE_COIN_CAP - (Number(atkGotRow?.x) || 0));
    /* ★★ 守恒的关键：gain 是 take 的下界裁剪，扣与加用的是同一个 gain ★★
       若写成「扣 take、加 min(take, atkRoom)」，多出来的 (take - gain)
       会凭空蒸发 —— 玩家会看到"我只有 5 块，系统说抢了 20"。 */
    const gain = Math.min(take, atkRoom);
    const raidId = Number(db.prepare(`INSERT INTO village_battles
       (user_id, defender_id, snapshot_id, mode, tier, seed, stars, pct, coins, elixir,
        duration_ms, suspect, status, day)
     VALUES (?,?,?, 'pvp', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`).run(atk, def, Number(s.id), Number(s.th_level), stars, Math.round(pct), gain, 0, Math.round(durMs), suspicious ? 1 : 0, stars > 0 ? 'settled' : 'defeat', day).lastInsertRowid);
    if (gain > 0) {
        (0, coins_1.addCoins)(def, -gain, 'village_raid_loss', raidId);
        (0, coins_1.addCoins)(atk, gain, 'village_raid_gain', raidId);
        db.prepare(`UPDATE village_profiles SET loot_coins = MAX(0, loot_coins - ?), last_raided_at = ?
       WHERE user_id = ?`).run(gain, now, def);
    }
    // 圣水 + 建筑损坏：都不直接改对手存档，入队等他下次 GET /save 时一起应用
    // （见 applyDefenseQueue）。合并成一条队列记录，保证「扣圣水」和「标记损坏」
    // 要么都生效要么都不生效，不会出现扣了水但建筑没坏的中间态。
    const elixirWant = Math.floor(Number(s.loot_elixir) * (LOOT_RATIO_BY_STARS[stars] || 0) * 0.62);
    /* 打坏了哪几座：服务端按 pct + 快照布局自己算（绝不信客户端上报）。 */
    const damaged = stars > 0 ? pickDamagedBuildings(s.layout, pct, Number(s.id)) : [];
    if (elixirWant > 0 || damaged.length) {
        const nameRow = db.prepare('SELECT username FROM users WHERE id = ?').get(atk);
        db.prepare(`INSERT INTO village_defense_queue (defender_id, raid_id, attacker_id, elixir_lost, payload)
       VALUES (?,?,?,?,?)`).run(def, raidId, atk, elixirWant, JSON.stringify({
            attackerName: nameRow?.username || '匿名',
            stars, pct: Math.round(pct), coinsLost: gain, at: now,
            dmg: damaged,
        }));
    }
    /* 保护口径（2026-10-14 按需求改）：
       · 打坏了建筑（stars>0 必然打坏）→ 时间护盾归零，改为「修好之前不能被攻打」
         真正的拦截在匹配与开打两处（见 NOT_DAMAGED_SQL），这里只负责不给时间护盾。
       · 一座都没打坏（0 星 / 进攻失败）→ 30 分钟冷却，防被反复骚扰。 */
    const shieldSec = damaged.length > 0 ? 0 : SHIELD_SEC_AFTER_FAIL;
    db.prepare('UPDATE village_profiles SET shield_until = MAX(shield_until, ?) WHERE user_id = ?').run(now + shieldSec, def);
    // 同对手冷却 / 单日次数
    db.prepare(`
    INSERT INTO village_raid_targets (attacker_id, defender_id, last_at, times_today, day)
    VALUES (?,?,?,1,?)
    ON CONFLICT(attacker_id, defender_id) DO UPDATE SET
      last_at = excluded.last_at,
      times_today = CASE WHEN village_raid_targets.day = excluded.day
                         THEN village_raid_targets.times_today + 1 ELSE 1 END,
      day = excluded.day
  `).run(atk, def, now, day);
    // 当日计数（快路径；coins_ledger 仍是对账真源）
    db.prepare('INSERT OR IGNORE INTO village_daily_quota (user_id, day) VALUES (?,?)').run(atk, day);
    db.prepare(`UPDATE village_daily_quota
     SET raid_count = raid_count + 1, raid_coins_gained = raid_coins_gained + ?
     WHERE user_id = ? AND day = ?`).run(gain, atk, day);
    db.prepare('INSERT OR IGNORE INTO village_daily_quota (user_id, day) VALUES (?,?)').run(def, day);
    db.prepare(`UPDATE village_daily_quota SET raid_coins_lost = raid_coins_lost + ?
     WHERE user_id = ? AND day = ?`).run(gain, def, day);
    return {
        coinsGained: gain,
        elixirGained: elixirWant,
        stars,
        defenderLost: gain,
        /** 本次打坏了防方几座建筑（防方下次进游戏时会看到并需要维修） */
        damagedCount: damaged.length,
        /* 拆成两个语义，UI 文案才能对得上：
           defenderShort = 对手钱不够或其日损失已触顶
           capped        = 自己当日 40 上限触顶 */
        defenderShort: take < want,
        capped: gain < take,
        suspicious,
        shieldUntil: now + shieldSec,
    };
}
/**
 * 计算某用户的学习铜板加成倍率，例如 0.14 表示 +14%。
 *
 * 由学识矿脉（goldmine）等级决定，多座累加后按 STUDY_BONUS_MAX 封顶。
 * 供 routes/cards.ts 在学习发币时调用。
 */
function getStudyBonusMultiplier(userId) {
    try {
        const { mineLevel } = readPlayerProgress(userId);
        if (mineLevel <= 0)
            return 0;
        const lv = Math.min(mineLevel, STUDY_BONUS_PER_LEVEL.length);
        return Math.min(STUDY_BONUS_PER_LEVEL[lv - 1] || 0, STUDY_BONUS_MAX);
    }
    catch {
        // 加成计算失败绝不能影响答题主流程
        return 0;
    }
}
/* ============================================================
   ⓪ 服务器时间（客户端施工计时的权威时钟）
   ------------------------------------------------------------
   客户端如果自己用本机时间算「完工时刻」，把设备时间往前调就能瞬间完工。
   所以统一以服务端时间为准：客户端启动时取一次 now，算出与本机时钟的偏移，
   之后一律用 (本机 Date.now() + offset) 当时间轴 —— 设备时间改了多少都不影响。
   见 client/dist/village3d/js/village.js 的 nowServer() / setServerTime()。
   ============================================================ */
/**
 * GET /quiz — 部落对战「答题强化」题库（看词选义）。
 *
 * 从**当前用户自己的卡片**里随机抽题，干扰项取自同一批卡片，保证 4 个选项都真实存在。
 * 判分在客户端（只影响战斗里的部队强度，不发币、不进排行榜），
 * 所以服务端直接把正确下标下发，不额外存答案。
 *
 * 返回 { ok, items: [{ q, options: [4], answer }] }
 * 卡片不足 4 张时返回空数组 —— 前端会提示「先去学几张卡」。
 */
router.get('/quiz', (req, res) => {
    try {
        /* ⚠️ 本文件是 CJS 编译产物，必须走 database_1，不能直接写 getDb() */
        const db = (0, database_1.getDb)();
        const rows = db.prepare(`
      SELECT n.fields AS fields
      FROM cards c JOIN notes n ON n.id = c.note_id
      WHERE c.user_id = ?
      ORDER BY RANDOM() LIMIT 200
    `).all(req.userId);
        const cut = (v, n) => (v.length > n ? v.slice(0, n) + '…' : v);
        const escHtml = (v) => String(v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        /* 【2026-10-19 反馈修复】卡片原文用 **字** 标出被考的那个字（全站 16.5 万张里 99% 都有），
           `==释义==` 是释义字段的强调标记。原实现把 ** 直接删掉，整句变成普通文本，
           学生根本不知道要答哪个字 —— 有两条反馈说的就是这件事
           （「不知道是回答哪一个字」「看不清楚加粗的字是哪一个」）。
           现在返回两套：q 纯文本（去标记），qHtml 把标记还原成 <b class="q-em">。
           注意顺序：先截断 → 把成对标记换成占位符 → 删掉残余单字符 → 转义 → 再填回标签，
           这样既不会把 ** 截成半个，也不会因为插入标签而漏转义。 */
        const plain = (v, n) => cut(String(v || '')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/\*\*/g, '')
            .replace(/==/g, '')
            .replace(/[*=]/g, '')
            .trim(), n);
        const toHtml = (v, n) => {
            let t = cut(String(v || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim(), n);
            t = t.replace(/\*\*/g, '\u0001').replace(/==/g, '\u0001').replace(/[*=]/g, '');
            t = escHtml(t);
            let open = false;
            t = t.replace(/\u0001/g, () => {
                open = !open;
                return open ? '<b class="q-em">' : '</b>';
            });
            return open ? t + '</b>' : t;
        };
        /* 题干 / 答案都做长度上限：释义可能是一整句，直接塞进选项会撑爆面板 */
        const pool = [];
        const seenQ = new Set();
        for (const r of rows) {
            let fields;
            try {
                fields = JSON.parse(r.fields || '[]');
            }
            catch {
                continue;
            }
            if (!Array.isArray(fields))
                continue;
            const q = plain(fields[0], 60);
            const qHtml = toHtml(fields[0], 60);
            const a = plain(fields[1], 36);
            if (!q || !a || seenQ.has(q + '|' + a))
                continue;
            seenQ.add(q + '|' + a);
            pool.push({ q, qHtml, a });
        }
        if (pool.length < 4) {
            return res.json({ ok: true, items: [] });
        }
        const want = Math.min(20, pool.length);
        const picked = [...pool].sort(() => Math.random() - 0.5).slice(0, want);
        const items = [];
        for (const p of picked) {
            const opts = [p.a];
            const used = new Set([p.a]);
            let guard = 0;
            while (opts.length < 4 && guard++ < 400) {
                const cand = pool[Math.floor(Math.random() * pool.length)].a;
                if (used.has(cand))
                    continue;
                used.add(cand);
                opts.push(cand);
            }
            if (opts.length < 4)
                continue;
            for (let i = opts.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [opts[i], opts[j]] = [opts[j], opts[i]];
            }
            items.push({ q: p.q, qHtml: p.qHtml, options: opts, answer: opts.indexOf(p.a) });
        }
        res.json({ ok: true, items });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ── 部落铜板彩蛋（2026-10-19）────────────────────────────────
   村庄里随机时段冒出一枚铜板，点开答对一题 +5 铜板，每天最多 5 次（25 铜板）。
   次数直接数 coins_ledger 的 village_bonus 流水，不额外建表：
   流水本身就是发钱凭据，再存一份计数反而会出现「两处不一致」。
   先查后发之间没有 await（better-sqlite3 同步），Node 单线程下不会并发重复领。 */
const BONUS_REWARD = 5;
const BONUS_DAILY_LIMIT = 5;

function bonusUsedToday(userId) {
    const db = (0, database_1.getDb)();
    const row = db
        .prepare(`SELECT COUNT(*) AS n FROM coins_ledger
                  WHERE user_id = ? AND source = 'village_bonus' AND day = date('now','+8 hours')`)
        .get(userId);
    return Number(row && row.n) || 0;
}

/** GET /bonus/status — 今天还能领几次 */
router.get('/bonus/status', (req, res) => {
    try {
        const used = bonusUsedToday(req.userId);
        res.json({
            ok: true,
            reward: BONUS_REWARD,
            limit: BONUS_DAILY_LIMIT,
            used,
            remaining: Math.max(0, BONUS_DAILY_LIMIT - used),
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/** POST /bonus/claim — 答对后领 5 铜板（只校验次数，答案由客户端判） */
router.post('/bonus/claim', (req, res) => {
    try {
        const used = bonusUsedToday(req.userId);
        if (used >= BONUS_DAILY_LIMIT) {
            return res.status(429).json({
                error: `今天已经领满 ${BONUS_REWARD * BONUS_DAILY_LIMIT} 铜板了，明天再来`,
                remaining: 0,
            });
        }
        const balance = (0, coins_1.addCoins)(req.userId, BONUS_REWARD, 'village_bonus', null);
        res.json({
            ok: true,
            gained: BONUS_REWARD,
            balance,
            remaining: Math.max(0, BONUS_DAILY_LIMIT - used - 1),
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/time', (req, res) => {
    const now = Date.now();
    /* 管理员恒为「开放」：否则前端仍会盖「部落打烊啦」页 ——
       闸门放行只解决服务端拒绝，客户端的显示判据就是这个 open 字段。
       adminBypass 一并回传，方便前端（将来）显示「管理员模式」角标。 */
    const admin = isAdminUser(req.userId);
    res.json({
        ok: true,
        now,
        /* 开放时间状态：客户端据此显示「已打烊 + 倒计时 + 时段表」，
           并在收到 open:false 时把自己踢回关闭页（服务端同时会拒绝写操作）。 */
        open: admin ? true : !!openWindowAt(now),
        adminBypass: admin,
        nextOpenAt: nextOpenMs(now),
        windows: nextOpenWindowsText(now),
    });
});
/* ============================================================
   ① 读取全部存档
   ============================================================ */
router.get('/save', (req, res) => {
    try {
        const db = (0, database_1.getDb)();
        const userId = req.userId;
        /* ── 应用「被掠夺」的圣水损失 ──────────────────────────────
           为什么必须在这里而不是 POST /save：
           此刻客户端还没拿到 version。我们改完存档并 version+1 后一并返回，
           客户端下次提交 baseVersion 就是最新的 —— 不产生 409、不覆盖玩家改动。
           若在 POST 里做，客户端手里的 base 永远落后一步 → 100% 冲突 →
           storage.js「服务端优先覆盖」会吞掉他刚建的房子、刚收的气泡。 */
        const applied = db.transaction(() => applyDefenseQueue(db, userId))();
        const rows = db.prepare('SELECT save_key, data, version FROM village_saves WHERE user_id = ?').all(userId);
        const bag = {};
        for (const k of ALLOWED_KEYS)
            bag[k] = { data: null, version: 0 };
        for (const r of rows) {
            if (ALLOWED_KEYS.indexOf(r.save_key) < 0)
                continue;
            let parsed = null;
            try {
                parsed = r.data ? JSON.parse(r.data) : null;
            }
            catch {
                parsed = null;
            }
            bag[r.save_key] = { data: parsed, version: r.version };
        }
        res.json({ ok: true, data: bag, raids: applied.notices });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/* ============================================================
   ② 保存单个存档（乐观并发）
   ============================================================ */
router.post('/save', (req, res) => {
    try {
        const { key, data, baseVersion } = req.body || {};
        if (ALLOWED_KEYS.indexOf(key) < 0) {
            res.status(400).json({ error: '非法的存档 key' });
            return;
        }
        const db = (0, database_1.getDb)();
        const userId = req.userId;
        /* ── 存档结构校验（2026-10-01 安全修复，红线①的地基）────────────
           这是本文件最重要的一道闸门：存档是**所有**经济判定的真源
           （readPlayerProgress 读它算学习加成与离线上限、refreshProfile 读它
           算 PVP 匹配画像）。在本次修复之前，这里对内容零校验 —— 玩家只要
           POST 一份 {buildings:[{y:'goldmine',l:5,...}]} 就能永久白拿 +20%
           学习加成，且不必支付 16500 铜板真实造价。

           校验规则见 lib/village-save.ts：建筑类型白名单、等级 0..5、
           坐标在 GRID 内、实例 id 唯一、数量不超过该 TH 等级上限。
           不合格一律 400 并说明原因，**不做静默修正** —— 修正会让玩家
           遇到"我建的房子不见了"的诡异手感，且掩盖前端 bug。

           只对 village 档做内容校验：army/quality 是纯配置档，
           没有经济价值（不参与任何发币判定），校验它们只会徒增误拒风险。 */
        let sanitized = null;
        if (key === 'village' && data !== null && data !== undefined) {
            const check = (0, village_save_1.sanitizeVillageSave)(data);
            if (!check.ok) {
                /* 记一条审计：手改档的尝试值得留下痕迹（也便于我们发现前端自身 bug）。
                   失败不影响主流程，绝不能因为审计写不进去就拒绝存档。 */
                try {
                    db.prepare('INSERT INTO village_events (user_id, type, payload, stars, day) VALUES (?, ?, ?, 0, ?)')
                        .run(userId, 'save_rejected', JSON.stringify({ key, reason: check.reason }), (0, coins_1.todayCn)());
                }
                catch { /* 审计失败忽略 */ }
                res.status(400).json({ error: '存档不合法：' + check.reason, code: 'SAVE_INVALID' });
                return;
            }
            sanitized = check;
        }
        const payload = data === null || data === undefined
            ? null
            : JSON.stringify(sanitized ? sanitized.data : data);
        const base = Number(baseVersion) || 0;
        // 单条存档体积上限 1MB，防止超大 JSON 拖垮库
        if (payload && payload.length > village_save_1.MAX_SAVE_BYTES) {
            res.status(413).json({ error: '存档过大' });
            return;
        }
        const tx = db.transaction(() => {
            const row = db.prepare('SELECT version FROM village_saves WHERE user_id = ? AND save_key = ?').get(userId, key);
            // 首次保存：直接插入
            if (!row) {
                db.prepare('INSERT INTO village_saves (user_id, save_key, data, version, updated_at) VALUES (?, ?, ?, 1, unixepoch())').run(userId, key, payload);
                return { ok: true, version: 1 };
            }
            // 冲突检测：客户端拿到的版本落后于服务端，说明别的设备改过
            if (base !== row.version) {
                return { conflict: true, version: row.version };
            }
            db.prepare('UPDATE village_saves SET data = ?, version = version + 1, updated_at = unixepoch() WHERE user_id = ? AND save_key = ?').run(payload, userId, key);
            return { ok: true, version: row.version + 1 };
        });
        const out = tx();
        if (out.conflict) {
            const cur = db.prepare('SELECT data, version FROM village_saves WHERE user_id = ? AND save_key = ?').get(userId, key);
            let parsed = null;
            try {
                parsed = cur.data ? JSON.parse(cur.data) : null;
            }
            catch {
                parsed = null;
            }
            res.status(409).json({ ok: false, conflict: true, data: parsed, version: cur.version });
            return;
        }
        /* 校验通过后、写库成功后，才允许推进/初始化权威进度列。
           放在事务外：它是"尽力而为"的加固，失败也不该让存档保存失败
           （读的时候 authLevel=0 会退化为信任存档，安全上仍是安全的）。 */
        if (key === 'village' && sanitized && sanitized.ok) {
            try {
                initAuthoritativeProgress(userId, sanitized.thLevel, sanitized.mineLevel);
            }
            catch { /* 加固失败不影响存档 */ }
        }
        /* 村庄档变了 → 同步对手索引（PVP 匹配用）。
           放在事务外、写库成功后：索引是冗余数据，晚一点更新无所谓，
           但绝不能因为索引失败而让玩家的存档保存失败。 */
        if (key === 'village') {
            try {
                refreshProfile(db, userId, payload);
            }
            catch { /* 索引失败不影响存档 */ }
        }
        res.json(out);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/* ============================================================
   ③ 事件上报
   ------------------------------------------------------------
   upgrade_done / train_done 只审计，不发币。
   battle_end 是唯一的例外：它按服务端规则发铜板（见下）。
   ============================================================ */
router.post('/events', (req, res) => {
    try {
        const { type, payload } = req.body || {};
        if (ALLOWED_EVENTS.indexOf(type) < 0) {
            res.status(400).json({ error: '非法的事件类型' });
            return;
        }
        const db = (0, database_1.getDb)();
        const userId = req.userId;
        const day = (0, coins_1.todayCn)();
        // 限流：每分钟最多 N 条，防止日志灌爆
        const cntRow = db.prepare(`SELECT COUNT(*) AS c FROM village_events
       WHERE user_id = ? AND created_at > unixepoch() - 60`).get(userId);
        if ((cntRow?.c || 0) >= EVENT_RATE_PER_MIN) {
            res.status(429).json({ error: '上报过于频繁' });
            return;
        }
        const stars = type === 'battle_end' ? clampNum(payload?.stars, 0, 3) : 0;
        db.prepare('INSERT INTO village_events (user_id, type, payload, stars, day) VALUES (?, ?, ?, ?, ?)').run(userId, type, payload ? JSON.stringify(payload) : null, stars, day);
        /* ── 战斗结算发铜板（红线①的唯一合法出口） ──
           为什么放在这里而不是 /withdraw：/withdraw 是消费接口，语义是扣钱。
           把「发钱」硬塞进扣钱接口，以后谁改错符号就是印钞机。单独分支、单独注释、
           单独校验，改起来不容易误伤。 */
        if (type === 'battle_end') {
            const out = settleBattle(db, userId, day, payload, stars);
            res.json({ ok: true, recorded: true, ...out });
            return;
        }
        res.json({ ok: true, recorded: true, coinsAwarded: 0 });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/**
 * 战斗结算：校验 → 落表。
 *
 * ⚠️ 2026-09-30 起 **NPC 演练不再发放铜板**。
 *    铜板唯一来源收敛到「学习」（cards.ts 的 study_card：每答对一张不同卡片 +1）。
 *    理由：战斗发币等于「打游戏换真钱」，而战斗是客户端模拟的，
 *    20 秒下限只能提高伪造成本、挡不住改客户端。既然要彻底断掉这条路，
 *    就干脆不发 —— 战斗回归纯粹的玩法与星级成就。
 *    详细权衡见文件头的红线说明。
 *
 * 安全要点（保留至今仍然有效）：
 *   · 我方市政厅等级从**服务端存档**读，不信客户端上报的 thLevel
 *   · tier 必须已被 RAID_MIN_TH 解锁，否则记非法
 *   · 星级由服务端按 pct + thDead 重算，且夹在 0..3
 */
function settleBattle(db, userId, day, payload, stars) {
    const tier = Math.floor(Number(payload?.tier));
    const seed = Math.floor(Number(payload?.seed));
    // 非法 tier：仍然记事件（上面已插），但不发币
    if (!isFinite(tier) || !RAID_COIN_REWARD[tier]) {
        return { coinsAwarded: 0 };
    }
    const { thLevel } = readPlayerProgress(userId);
    // 越级打本：记 defeat，不发币
    if (thLevel < (RAID_MIN_TH[tier] || 1)) {
        return { coinsAwarded: 0 };
    }
    /* NPC 发币开关：恒为 false。
       保留这个常量而不是直接删代码，是为了让「铜板来源」这件事在代码里显式可查
       —— 以后若决定重新开放，改这里一处即可，不用去翻 RAID_COIN_REWARD 的调用点。 */
    const NPC_BATTLE_COIN_REWARD = false;
    const tx = db.transaction(() => {
        let coins = 0;
        if (NPC_BATTLE_COIN_REWARD && stars > 0) {
            const alreadyRow = db.prepare(`SELECT COALESCE(SUM(delta), 0) AS s FROM coins_ledger
         WHERE user_id = ? AND day = ? AND delta > 0 AND source = 'village_battle'`).get(userId, day);
            const already = Number(alreadyRow?.s) || 0;
            const raw = (RAID_COIN_REWARD[tier] || 0) * stars;
            coins = Math.max(0, Math.min(raw, DAILY_BATTLE_COIN_CAP - already));
            if (coins > 0)
                (0, coins_1.addCoins)(userId, coins, 'village_battle', null);
        }
        db.prepare(`INSERT INTO village_battles (user_id, tier, seed, stars, coins, status, day)
       VALUES (?, ?, ?, ?, ?, ?, ?)`).run(userId, tier, isFinite(seed) ? seed : 0, stars, coins, stars > 0 ? 'settled' : 'defeat', day);
        return { coinsAwarded: coins };
    });
    return tx();
}
/* ============================================================
   ④ 钱包快照
   ============================================================ */
router.get('/wallet', (req, res) => {
    try {
        const db = (0, database_1.getDb)();
        const userId = req.userId;
        const day = (0, coins_1.todayCn)();
        const balance = (0, coins_1.getCoins)(userId);
        // 今日学习所得（正向流水，排除游戏自身的收支）
        const studyRow = db.prepare(`SELECT COALESCE(SUM(delta), 0) AS s FROM coins_ledger
       WHERE user_id = ? AND day = ? AND delta > 0
         AND source NOT LIKE 'village_%'`).get(userId, day);
        // 今日游戏发放的铜板（补贴/战斗）
        const gameRow = db.prepare(`SELECT COALESCE(SUM(delta), 0) AS s FROM coins_ledger
       WHERE user_id = ? AND day = ? AND delta > 0
         AND source LIKE 'village_%'`).get(userId, day);
        res.json({
            ok: true,
            balance,
            todayStudyEarned: Number(studyRow?.s) || 0,
            todayGameGranted: Number(gameRow?.s) || 0,
            /** 学识矿脉带来的学习加成，UI 展示用（也可以让玩家知道"再升一级值不值"） */
            studyBonus: getStudyBonusMultiplier(userId),
            limits: {
                offlineCapSec: MAX_OFFLINE_SEC,
                minOfflineSec: MIN_OFFLINE_SEC,
                offlineCoinCap: DAILY_OFFLINE_COIN_CAP,
                battleCoinCap: DAILY_BATTLE_COIN_CAP,
                timeScale: TIME_SCALE,
            },
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/* ============================================================
   ⑤ 消费铜板（幂等，事务内完成）
   ------------------------------------------------------------
   红线④：金额必须与 EXPECTED_COST 里该建筑该等级的真实造价一致。
   kind=build/upgrade 时 ref 必须形如 "{type}:{level}"。
   ============================================================ */
router.post('/withdraw', (req, res) => {
    try {
        const { idemKey, kind, amount, ref } = req.body || {};
        const userId = req.userId;
        if (!idemKey || typeof idemKey !== 'string' || idemKey.length > 64) {
            res.status(400).json({ error: '缺少幂等键' });
            return;
        }
        const maxAmount = SPEND_KINDS[kind];
        if (maxAmount === undefined) {
            res.status(400).json({ error: '非法的消费类型' });
            return;
        }
        const amt = Math.floor(Number(amount));
        if (!isFinite(amt) || amt <= 0 || amt > maxAmount) {
            res.status(400).json({ error: '消费金额非法' });
            return;
        }
        /* ── 红线④：建筑造价二次校验 ──
           建造/升级的金额由服务端自己算，与客户端上报的 amount 比对，不等就拒。
           这样玩家没法用 amount:1 白拿一座市政厅。 */
        let spendRefKey = '';
        if (kind === 'build' || kind === 'upgrade') {
            const key = typeof ref === 'string' ? ref : '';
            const expected = EXPECTED_COST[key];
            if (expected === undefined) {
                res.status(400).json({ error: '未知的建筑或等级' });
                return;
            }
            if (expected !== amt) {
                res.status(400).json({ error: '建筑造价不符', expected });
                return;
            }
            spendRefKey = key;
        }
        const db = (0, database_1.getDb)();
        const day = (0, coins_1.todayCn)();
        let result;
        try {
            const tx = db.transaction(() => {
                // 幂等：插入消费记录，0 行说明这次动作已经处理过
                const ins = db.prepare('INSERT OR IGNORE INTO village_spends (user_id, idem_key, kind, amount, ref) VALUES (?, ?, ?, ?, ?)').run(userId, idemKey, kind, amt, ref == null ? null : String(ref));
                if (ins.changes === 0) {
                    // 重复请求：直接回显当前余额，不再扣费
                    return { ok: true, balance: (0, coins_1.getCoins)(userId), deducted: 0, duplicated: true };
                }
                // 真正扣费（addCoins 负数，余额不足会抛错 → 事务回滚）
                const next = (0, coins_1.addCoins)(userId, -amt, `village_${kind}`, null);
                /* ── 推进服务端权威进度（2026-10-01 安全修复）────────────
                   这是**唯一**能让 users.village_th_level / village_mine_level
                   前进的地方：钱真的扣了、ref 已经过 EXPECTED_COST 核对，
                   说明这次升级是真实的。readPlayerProgress 之后会用这两列
                   与客户端存档取 min，于是"等级"只跟真金白银挂钩。
                   放在同一个事务里：扣费成功而进度没推进（或反之）都不该发生。 */
                if (spendRefKey) {
                    const seg = spendRefKey.split(':');
                    const bType = seg[0];
                    const bLevel = Math.min(5, Math.max(1, Math.floor(Number(seg[1]) || 1)));
                    if (bType === 'townhall') {
                        bumpAuthoritativeProgress(userId, bLevel, 0);
                    }
                    else if (bType === 'goldmine') {
                        bumpAuthoritativeProgress(userId, 0, bLevel);
                    }
                    else if (bType === 'mine' || bType === 'goldstorage') {
                        /* 矿场/铜板库：首次购买时启动「矿场收取计时器」。
                           为什么不无条件写 now：玩家已有矿场正在攒钱时再建一座，
                           把计时器清零等于白白吞掉已累积的产出；
                           COALESCE 只在从未启动过时才初始化。 */
                        db.prepare(`UPDATE users
                         SET village_mine_coin_at = COALESCE(village_mine_coin_at, unixepoch())
                       WHERE id = ?`).run(userId);
                    }
                }
                return { ok: true, balance: next, deducted: amt };
            });
            result = tx();
        }
        catch (e) {
            if (e && String(e.message).includes('铜板不足')) {
                res.status(400).json({ error: '铜板不足' });
                return;
            }
            throw e;
        }
        // 保持 day 变量被使用（便于后续按日统计扩展）
        void day;
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/* ============================================================
   ⑤-b 拆除返还铜板
   ------------------------------------------------------------
   单独一条路，不复用 /withdraw：
     · /withdraw 的金额是「客户端报多少扣多少（经造价表核对）」，
       返还需要的是「服务端按造价表自己算 30%」，语义相反。
     · 如果允许 /withdraw 传负数，那个接口就同时是扣费口和发币口，
       以后任何一处符号写错都会变成印钞机。物理隔离比约定安全。

   金额服务端自算（EXPECTED_COST × 30%），客户端只提供「拆了哪座、几级」，
   改不了金额，也刷不出钱（返还永远是投入的 30%，净亏 70%）。

   ⚠️ 2026-09-29 补漏：最初这版**没有幂等**，实测同一 ref 连调 5 次即凭空
      多出 175 铜板。金额自算只挡住了「改金额」，挡不住「重复领」。
      现在强制要求 `instId`（建筑实例 id），并把发放记录写进
      `village_refunds`，唯一索引保证「一座建筑一辈子只退一次」。
   ============================================================ */
router.post('/refund', (req, res) => {
    try {
        const { ref, instId } = req.body || {};
        const userId = req.userId;
        const key = typeof ref === 'string' ? ref : '';
        const cost = EXPECTED_COST[key];
        if (cost === undefined) {
            res.status(400).json({ error: '未知的建筑或等级' });
            return;
        }
        /* 幂等键：建筑实例 id。
           没有它就无法区分「真拆了 10 座炮塔」和「同一座报了 10 次」，
           所以缺失时直接拒绝，宁可让客户端补字段也不要留发币缺口。 */
        const inst = Number(instId);
        if (!isFinite(inst) || inst <= 0 || Math.floor(inst) !== inst) {
            res.status(400).json({ error: '缺少建筑实例标识' });
            return;
        }
        const back = Math.floor(cost * DEMOLISH_REFUND_RATIO);
        if (back <= 0) {
            // 这座建筑本来就没花铜板（如学识矿脉造价走圣水），无需返还
            res.json({ ok: true, refunded: 0, balance: (0, coins_1.getCoins)(userId) });
            return;
        }
        const db = (0, database_1.getDb)();
        const tx = db.transaction(() => {
            /* INSERT OR IGNORE + 唯一索引 (user_id, inst_id)：
               已退过的实例返回 changes===0，直接返回 duplicated，不再加钱。
               用数据库约束而不是「先查再写」——后者在并发下会双花。 */
            const ins = db.prepare(`INSERT OR IGNORE INTO village_refunds (user_id, inst_id, ref, amount)
         VALUES (?, ?, ?, ?)`).run(userId, inst, key, back);
            if (ins.changes === 0) {
                return { ok: true, refunded: 0, duplicated: true, balance: (0, coins_1.getCoins)(userId) };
            }
            const next = (0, coins_1.addCoins)(userId, back, 'village_demolish', inst);
            return { ok: true, refunded: back, balance: next };
        });
        res.json(tx());
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/* ============================================================
   ⑤-d 升级落地对账（2026-11-06 修「扣了铜板、建筑没升级」）
   ------------------------------------------------------------
   背景（线上事故，有 4 条用户反馈）：
     /withdraw 是服务端**即时**扣费，而建筑等级只存在客户端提交的
     village_saves 里。前端扣费成功后只调了 save()（30 秒合并窗口），
     玩家在窗口内退出/切页就变成「钱扣了、东西没有」。
     实测：用户 142 于 11-02 15:50 升迫击炮 -840，存档里仍是 L1；
     同一分钟还重复扣了两笔 cannon -300，只落地了一笔。

   已在前端同步修掉根因（扣费成功即 flush + 离页前补 save），
   这里负责两件事：
     ① 把**已经丢失**的历史消费补回来；
     ② 前端崩溃/被强杀/flush 失败时兜底。

   对每笔最近 24h、未对账过的 build/upgrade 消费：
     · 存档里同类型建筑已达目标等级      → 已落地，记账后跳过
     · 该建筑正在施工且 w.to >= 目标等级 → 施工会自然完成，不插手
     · 存在同类型但等级不足、也不在施工  → 直接把等级补到目标
     · 完全找不到该建筑                  → 全额退款
       （但如果这笔消费之后有过拆除流水，说明是玩家自己拆的，
        不能退，否则「升级→拆除返 30%→对账再退 100%」就成了刷钱口）

   幂等：village_reconcile 以 (user_id, idem_key) 为主键，重复调用不重复补。
   安全：金额只认 village_spends 里服务端自己记下的 amount，客户端传不了价。
   ============================================================ */
let _reconcileTableReady = false;
function ensureReconcileTable(db) {
    if (_reconcileTableReady) return;
    try {
        db.exec(`CREATE TABLE IF NOT EXISTS village_reconcile (
      user_id    INTEGER NOT NULL,
      idem_key   TEXT    NOT NULL,
      action     TEXT    NOT NULL,
      amount     INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, idem_key)
    )`);
        _reconcileTableReady = true;
    }
    catch (e) {
        // 建表失败（只读库等）→ 本次不启用对账，不影响主流程
        console.error('[village.reconcile] 建表失败:', e && e.message);
    }
}
router.post('/reconcile', (req, res) => {
    try {
        const db = (0, database_1.getDb)();
        const userId = req.userId;
        ensureReconcileTable(db);
        const sv = db.prepare(`SELECT data, version FROM village_saves
       WHERE user_id = ? AND save_key = 'village'`).get(userId);
        if (!sv || !sv.data) {
            res.json({ ok: true, upgraded: 0, refunded: 0, version: sv ? sv.version : 0 });
            return;
        }
        let d;
        try {
            d = JSON.parse(sv.data);
        }
        catch {
            res.json({ ok: true, upgraded: 0, refunded: 0, version: sv.version });
            return;
        }
        if (!d || !Array.isArray(d.buildings)) {
            res.json({ ok: true, upgraded: 0, refunded: 0, version: sv.version });
            return;
        }
        const since = Math.floor(Date.now() / 1000) - 24 * 3600;
        const spends = db.prepare(`SELECT idem_key, amount, ref, created_at FROM village_spends
       WHERE user_id = ? AND kind IN ('build','upgrade') AND created_at >= ?
       ORDER BY created_at ASC`).all(userId, since);
        if (!spends.length) {
            res.json({ ok: true, upgraded: 0, refunded: 0, version: sv.version });
            return;
        }
        let upgraded = 0;
        let refunded = 0;
        let changed = false;
        /* 回传具体补了哪几座，前端据此同步本地内存里的等级。
           只回数量的话，前端拿不到明细，下一次 save 会用旧等级覆盖回去。 */
        const applied = [];
        const out = db.transaction(() => {
            for (const sp of spends) {
                const done = db.prepare('SELECT 1 FROM village_reconcile WHERE user_id = ? AND idem_key = ?').get(userId, sp.idem_key);
                if (done)
                    continue;
                const seg = String(sp.ref || '').split(':');
                if (seg.length !== 2)
                    continue;
                const type = seg[0];
                const lv = Math.min(village_save_1.MAX_LEVEL, Math.max(1, Math.floor(Number(seg[1]) || 1)));
                const same = d.buildings.filter((b) => b && b.y === type);
                // ① 已有达标建筑
                if (same.some((b) => Math.floor(Number(b.l) || 0) >= lv)) {
                    db.prepare('INSERT OR REPLACE INTO village_reconcile (user_id, idem_key, action, amount) VALUES (?, ?, ?, 0)')
                        .run(userId, sp.idem_key, 'ok');
                    continue;
                }
                // ② 正在施工且目标不低 → 让它自然完工
                const building = same
                    .filter((b) => Math.floor(Number(b.l) || 0) >= 1)
                    .sort((a, b) => Number(a.l) - Number(b.l))[0];
                if (building) {
                    const workTo = building.w ? Math.floor(Number(building.w.to) || 0) : 0;
                    if (workTo >= lv) {
                        db.prepare('INSERT OR REPLACE INTO village_reconcile (user_id, idem_key, action, amount) VALUES (?, ?, ?, 0)')
                            .run(userId, sp.idem_key, 'pending-build');
                        continue;
                    }
                    /* ③ 钱扣了、等级没动、也没进施工队列 → 直接补上。
                       只改 l（和施工字段），其它存档字段一概不动，
                       避免把玩家的资源/皮肤等状态覆盖掉。 */
                    building.l = lv;
                    building.w = null;
                    building.work = null;
                    changed = true;
                    upgraded += 1;
                    applied.push({ i: Number(building.i) || 0, y: type, l: lv });
                    db.prepare('INSERT OR REPLACE INTO village_reconcile (user_id, idem_key, action, amount) VALUES (?, ?, ?, 0)')
                        .run(userId, sp.idem_key, 'upgraded');
                    continue;
                }
                // ④ 建筑根本不存在：玩家自己拆过就不退（防「拆了再对账」刷钱）
                const demolished = db.prepare(`SELECT 1 FROM coins_ledger
           WHERE user_id = ? AND source = 'village_demolish' AND created_at > ?
           LIMIT 1`).get(userId, sp.created_at);
                if (demolished) {
                    db.prepare('INSERT OR REPLACE INTO village_reconcile (user_id, idem_key, action, amount) VALUES (?, ?, ?, 0)')
                        .run(userId, sp.idem_key, 'demolished');
                    continue;
                }
                const back = Math.max(0, Math.floor(Number(sp.amount) || 0));
                if (back > 0) {
                    (0, coins_1.addCoins)(userId, back, 'village_refund', null);
                    refunded += back;
                }
                db.prepare('INSERT OR REPLACE INTO village_reconcile (user_id, idem_key, action, amount) VALUES (?, ?, ?, ?)')
                    .run(userId, sp.idem_key, 'refunded', back);
            }
            let version = sv.version;
            if (changed) {
                db.prepare(`UPDATE village_saves SET data = ?, version = version + 1, updated_at = unixepoch()
           WHERE user_id = ? AND save_key = 'village'`).run(JSON.stringify(d), userId);
                version = sv.version + 1;
            }
            return { ok: true, upgraded, refunded, version, applied, balance: (0, coins_1.getCoins)(userId) };
        });
        res.json(out());
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/* ============================================================
   ⑥ 离线收益结算（服务端权威计算）
   ============================================================ */
/* ============================================================
   ⑤-c 维修被打坏的建筑（服务端定价 + 服务端清除标记）
   ------------------------------------------------------------
   与 /refund 同一思路：客户端只说「修哪一座」，金额由服务端按
   repairCost(类型, 等级) 自己算，改不了价；扣费成功后才把该 id 从
   存档的 dmg 列表里移除 —— 修好了标记才消失，不会是本地假象。

   为什么不复用 /withdraw：那里是「客户端报价、服务端核价」；
   这里客户端连报价都不需要参与，语义更干净，也少一个可滥用入口。
   ============================================================ */
router.post('/repair', (req, res) => {
    try {
        const userId = req.userId;
        const inst = Math.floor(Number(req.body?.instId));
        if (!isFinite(inst) || inst <= 0) {
            res.status(400).json({ error: '缺少建筑实例标识' });
            return;
        }
        const db = (0, database_1.getDb)();
        const out = db.transaction(() => {
            const sv = db.prepare(`SELECT data, version FROM village_saves
         WHERE user_id = ? AND save_key = 'village'`).get(userId);
            if (!sv || !sv.data)
                return { err: 404, msg: '还没有村庄存档' };
            let d;
            try {
                d = JSON.parse(sv.data);
            }
            catch {
                return { err: 500, msg: '存档损坏' };
            }
            const b = (Array.isArray(d.buildings) ? d.buildings : []).find((x) => Number(x && x.i) === inst);
            if (!b)
                return { err: 404, msg: '建筑不存在' };
            const dmg = (Array.isArray(d.dmg) ? d.dmg : []).map(Number);
            if (dmg.indexOf(inst) < 0)
                return { err: 400, msg: '这座建筑没有损坏' };
            const cost = repairCost(String(b.y), Math.floor(Number(b.l)) || 1);
            try {
                (0, coins_1.addCoins)(userId, -cost, 'village_repair', inst);
            }
            catch (e) {
                if (e && String(e.message).includes('铜板不足'))
                    return { err: 400, msg: '铜板不足' };
                throw e;
            }
            d.dmg = dmg.filter((x) => x !== inst);
            db.prepare(`UPDATE village_saves SET data = ?, version = version + 1, updated_at = unixepoch()
         WHERE user_id = ? AND save_key = 'village'`).run(JSON.stringify(d), userId);
            /* 回传新 version：客户端拿到后写进自己的 _version，
               这样它紧接着的 POST /save 不会因为版本落后而 409（否则会弹"其他设备改过"）。 */
            return { ok: true, cost, balance: (0, coins_1.getCoins)(userId), version: sv.version + 1 };
        })();
        if (out && typeof out === 'object' && 'err' in out) {
            const e = out;
            res.status(e.err).json({ error: e.msg });
            return;
        }
        res.json(out);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/* ============================================================
   被攻打战报 + 一键修复（2026-10-14 按需求）
   ------------------------------------------------------------
   玩家上线后先看战报、先把被打坏的建筑修好，才能进村庄游玩：
     · GET  /reports        未读战报 + 待修建筑清单与总价
     · POST /reports/seen   标记战报已读
     · POST /repair-all     一键修复全部受损建筑
   「未读」的判定列是 village_defense_queue.def_seen（迁移见 db/database.ts）。
   ============================================================ */
router.get('/reports', (req, res) => {
    try {
        const db = (0, database_1.getDb)();
        const userId = req.userId;
        /* 只认 status='applied' 的记录：pending 的圣水与建筑损坏还没落进存档，
           此时给出「待修清单」会与玩家看到的村庄对不上（例如建筑明明好好的，
           弹窗却说它坏了）。applyDefenseQueue 在 GET /save 时把它们刷成 applied。 */
        const rows = db.prepare(`SELECT id, attacker_id, elixir_lost, payload, status,
              applied_at, created_at
         FROM village_defense_queue
        WHERE defender_id = ? AND status = 'applied' AND COALESCE(def_seen, 0) = 0
        ORDER BY id DESC LIMIT 10`).all(userId);
        /* 兜底：7 天前的旧战报一律当作已读。
           防止队列积压（玩家很久不上线）导致他回来时被一串陈年战报糊脸 ——
           战报的意义是「刚被人打了，快去修」，过期就没价值了。
           只动自己这几十行，代价可忽略。 */
        db.prepare(`UPDATE village_defense_queue SET def_seen = 1
         WHERE defender_id = ? AND status = 'applied' AND COALESCE(def_seen, 0) = 0
           AND created_at < unixepoch() - 7 * 86400`).run(userId);

        /* 待修清单：直接读存档的 dmg 列表，**与 /repair 共用 repairCost**，
           绝不另算一套价 —— 否则弹窗报的价与真扣的钱会对不上。
           顺手过滤幽灵 id：建筑已被玩家自己拆掉的，不算待修（同 applyDefenseQueue）。 */
        const sv = db.prepare(`SELECT data, version FROM village_saves
       WHERE user_id = ? AND save_key = 'village'`).get(userId);
        let damaged = [];
        let totalCost = 0;
        if (sv && sv.data) {
            let d = null;
            try {
                d = JSON.parse(sv.data);
            }
            catch {
                d = null;
            }
            const list = Array.isArray(d && d.buildings) ? d.buildings : [];
            const byId = new Map();
            for (const b of list)
                byId.set(Number(b && b.i), b);
            const dm = Array.isArray(d && d.dmg) ? d.dmg : [];
            for (const raw of dm) {
                const id = Number(raw);
                const b = byId.get(id);
                if (!b)
                    continue;
                const lv = Math.floor(Number(b.l)) || 1;
                const cost = repairCost(String(b.y), lv);
                /* 只回 type/level/cost，名字由客户端查它自己的 BUILDINGS 表 ——
                   服务端不需要也不应该再维护一份建筑名。 */
                damaged.push({ id, type: String(b.y), level: lv, cost });
                totalCost += cost;
            }
        }

        if (!rows.length && !damaged.length) {
            res.json({ ok: true, reports: [], damaged: [], totalCost: 0, balance: (0, coins_1.getCoins)(userId) });
            return;
        }

        /* 攻击者名字：批量查一次，避免逐条查库 */
        const ids = [];
        for (const r of rows) {
            const id = Number(r.attacker_id);
            if (Number.isFinite(id) && id > 0 && ids.indexOf(id) < 0)
                ids.push(id);
        }
        const names = new Map();
        if (ids.length) {
            const q = ids.map(() => '?').join(',');
            for (const u of db.prepare(`SELECT id, username FROM users WHERE id IN (${q})`).all(...ids))
                names.set(Number(u.id), u.username);
        }

        const reports = rows.map((r) => {
            let p = {};
            try {
                p = JSON.parse(r.payload) || {};
            }
            catch { /* 坏档就只显示匿名 */ }
            return {
                id: Number(r.id),
                /* 【2026-11-06 反击】带上攻击者 userId，战报里才能直接「打回去」。
                   反馈 #81/#86 要的就是这个：被打了只知道名字，找不到人。 */
                attackerId: Number(r.attacker_id) || 0,
                attacker: names.get(Number(r.attacker_id)) || p.attackerName || '匿名',
                stars: Number(p.stars) || 0,
                pct: Number(p.pct) || 0,
                coins: Number(p.coinsLost) || 0,
                /* 圣水用队列里的 elixir_lost（applyDefenseQueue 二次夹取前的应扣值），
                   与 payload 无关 —— payload 里没有这个字段。 */
                elixir: Number(r.elixir_lost) || 0,
                at: Number(p.at) || Number(r.applied_at) || Number(r.created_at) || 0,
            };
        });

        res.json({
            ok: true,
            reports,
            damaged,
            totalCost,
            balance: (0, coins_1.getCoins)(userId),
            version: sv ? Number(sv.version) || 0 : 0,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.post('/reports/seen', (req, res) => {
    try {
        const db = (0, database_1.getDb)();
        const userId = req.userId;
        const raw = Array.isArray(req.body && req.body.ids) ? req.body.ids : null;
        /* 不传 ids = 全部已读（弹窗的「知道了」按钮就是这么调的） */
        const r = raw && raw.length
            ? db.prepare(`UPDATE village_defense_queue SET def_seen = 1
             WHERE defender_id = ? AND status = 'applied'
               AND id IN (${raw.map(() => '?').join(',')})`).run(userId, ...raw.map(Number))
            : db.prepare(`UPDATE village_defense_queue SET def_seen = 1
             WHERE defender_id = ? AND status = 'applied' AND COALESCE(def_seen, 0) = 0`).run(userId);
        res.json({ ok: true, marked: r.changes });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.post('/repair-all', (req, res) => {
    try {
        const userId = req.userId;
        const db = (0, database_1.getDb)();
        const out = db.transaction(() => {
            const sv = db.prepare(`SELECT data, version FROM village_saves
         WHERE user_id = ? AND save_key = 'village'`).get(userId);
            if (!sv || !sv.data)
                return { err: 404, msg: '还没有村庄存档' };
            let d;
            try {
                d = JSON.parse(sv.data);
            }
            catch {
                return { err: 500, msg: '存档损坏' };
            }
            const list = Array.isArray(d.buildings) ? d.buildings : [];
            const byId = new Map();
            for (const b of list)
                byId.set(Number(b && b.i), b);
            const dm = (Array.isArray(d.dmg) ? d.dmg : []).map(Number);
            if (!dm.length) {
                return { ok: true, repaired: 0, remaining: 0, cost: 0, balance: (0, coins_1.getCoins)(userId), version: Number(sv.version) || 0 };
            }

            /* 从便宜到贵依次修：铜板不够时「能修几座修几座」，
               剩下的原样留在 dmg 里等他之后再来（对玩家最有利，也绝不半途回滚已修的）。
               ⚠️ addCoins 对管理员是免费且不记流水（见 lib/coins），所以管理员
                  无论余额多少都会全部修好 —— 这里不用特判。 */
            const targets = [];
            for (const id of dm) {
                const b = byId.get(id);
                if (!b)
                    continue;
                targets.push({ id, cost: repairCost(String(b.y), Math.floor(Number(b.l)) || 1) });
            }
            targets.sort((a, b) => a.cost - b.cost);

            let spent = 0;
            const done = new Set();
            for (const t of targets) {
                try {
                    (0, coins_1.addCoins)(userId, -t.cost, 'village_repair', t.id);
                }
                catch (e) {
                    /* 余额不足 → 停在这里，剩下的保持损坏（不抛错，不进回滚） */
                    if (e && String(e.message).includes('铜板不足'))
                        break;
                    throw e;
                }
                done.add(t.id);
                spent += t.cost;
            }

            const remain = dm.filter((id) => !done.has(id));
            d.dmg = remain;
            db.prepare(`UPDATE village_saves SET data = ?, version = version + 1, updated_at = unixepoch()
         WHERE user_id = ? AND save_key = 'village'`).run(JSON.stringify(d), userId);
            /* 回传新 version：客户端紧接着的 POST /save 才不会 409（与 /repair 同一套做法） */
            return {
                ok: true,
                repaired: done.size,
                remaining: remain.length,
                /* 客户端要按 id 对齐本地的 damaged 集合（哪些还坏着）——
                   只给数量的话，它无法判断该保留哪几座的损坏外观。 */
                remainingIds: remain,
                cost: spent,
                balance: (0, coins_1.getCoins)(userId),
                version: (Number(sv.version) || 0) + 1,
            };
        })();
        if (out && typeof out === 'object' && 'err' in out) {
            const e = out;
            res.status(e.err).json({ error: e.msg });
            return;
        }
        res.json(out);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.post('/offline-claim', (req, res) => {
    try {
        const db = (0, database_1.getDb)();
        const userId = req.userId;
        const day = (0, coins_1.todayCn)();
        const now = Math.floor(Date.now() / 1000);
        const tx = db.transaction(() => {
            // 取当日额度行（不存在则插入）
            db.prepare('INSERT OR IGNORE INTO village_daily_quota (user_id, day) VALUES (?, ?)').run(userId, day);
            const q = db.prepare('SELECT * FROM village_daily_quota WHERE user_id = ? AND day = ?').get(userId, day);
            const lastSeen = Number(q.last_seen_at) || 0;
            // 首次进入（没有 last_seen）只记录时间，不发收益
            if (lastSeen <= 0) {
                db.prepare('UPDATE village_daily_quota SET last_seen_at = ? WHERE user_id = ? AND day = ?').run(now, userId, day);
                return { ok: true, granted: { gold: 0, elixir: 0 }, coinsGranted: 0, capped: false, skipped: 'first' };
            }
            const elapsed = now - lastSeen;
            // 时间太短不计（防秒进秒出）
            if (elapsed < MIN_OFFLINE_SEC) {
                db.prepare('UPDATE village_daily_quota SET last_seen_at = ? WHERE user_id = ? AND day = ?').run(now, userId, day);
                return { ok: true, granted: { gold: 0, elixir: 0 }, coinsGranted: 0, capped: false, skipped: 'too-short' };
            }
            const effSec = Math.min(elapsed, MAX_OFFLINE_SEC);
            const cappedByTime = elapsed > MAX_OFFLINE_SEC;
            /* 从玩家的服务端存档推算产能（红线③：客户端上报的数字一个都不看）。
               goldmine 已从产能表移除，所以这里算出来的是纯圣水产能。 */
            const { thLevel } = readPlayerProgress(userId);
            let ratePerGameHour = 0; // 每【游戏小时】圣水产量
            const saveRow = db.prepare('SELECT data FROM village_saves WHERE user_id = ? AND save_key = ?').get(userId, 'village');
            if (saveRow && saveRow.data) {
                try {
                    const d = JSON.parse(saveRow.data);
                    const list = Array.isArray(d.buildings) ? d.buildings : [];
                    for (const b of list) {
                        const table = PROD_PER_GAME_HOUR[b?.y];
                        if (table && b.l > 0) {
                            const lv = Math.min(Number(b.l), table.length);
                            ratePerGameHour += table[lv - 1] || 0;
                        }
                    }
                }
                catch { /* 存档解析失败则按 0 产能处理 */ }
            }
            const cap = OFFLINE_CAP_BY_TH[Math.min(thLevel, 5)] || OFFLINE_CAP_BY_TH[1];
            // 真实秒 → 游戏小时：effSec × TIME_SCALE 得到游戏秒，再 ÷3600 换成游戏小时
            const produced = ratePerGameHour * (effSec * TIME_SCALE / 3600) * 0.25;
            const grantedElixir = Math.floor(Math.min(produced, cap));
            const capped = cappedByTime || produced > cap;
            // 铜板补贴：仅当日有学习行为才发，且日封顶极低
            let coinsGranted = 0;
            const studiedRow = db.prepare(`SELECT COUNT(*) AS c FROM coins_ledger
         WHERE user_id = ? AND day = ? AND delta > 0 AND source NOT LIKE 'village_%'`).get(userId, day);
            const studied = (studiedRow?.c || 0) > 0;
            const already = Number(q.coins_granted) || 0;
            if (studied && already < DAILY_OFFLINE_COIN_CAP) {
                coinsGranted = DAILY_OFFLINE_COIN_CAP - already;
                (0, coins_1.addCoins)(userId, coinsGranted, 'village_offline', null);
            }
            db.prepare(`UPDATE village_daily_quota
         SET last_seen_at = ?, offline_claims = offline_claims + 1,
             offline_res_granted = offline_res_granted + ?,
             coins_granted = coins_granted + ?
         WHERE user_id = ? AND day = ?`).run(now, grantedElixir, coinsGranted, userId, day);
            return {
                ok: true,
                /* ⚠️ granted.gold 恒为 0（红线③）。
                   这里发的是「游戏内虚拟资源」，但金币已经不虚拟了 —— 它等于真实铜板。
                   客户端 main.js 的 add('gold') 也已被硬拦，两道防线互相独立。 */
                granted: { gold: 0, elixir: grantedElixir },
                coinsGranted,
                capped,
                elapsedSec: elapsed,
            };
        });
        res.json(tx());
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/* ============================================================
   ⑦-b PVP：搜索对手
   ------------------------------------------------------------
   只匹配真实玩家的村庄；一个都匹配不到时返回 degraded:true，
   客户端降级回 5 个 NPC 演练关卡。

   只下发「类型:等级」组成的 compo，**不下发坐标**。坐标是村庄的
   核心资产，只在真正开打时下发 —— 否则任何人都能爬走全服布局。
   ============================================================ */
/* ============================================================
   不能攻打的条件：对手还有「未修复的建筑损坏」
   ------------------------------------------------------------
   （2026-10-14 按需求新增）被攻打后，在自己把建筑修好之前不能再被攻打。

   为什么是两条 NOT EXISTS，而不是给 village_profiles 加一个 needs_repair 列：
     损坏的落点有两处 —— 结算后先进 village_defense_queue（等对手下次进游戏
     才 apply 进存档），apply 之后才出现在存档的 dmg 数组里。只查任何一处都会漏：
       · 只查存档 → 「结算完成、对手还没上线」那段真空期能被打第二次
       · 只查队列 → 队列 apply 完就查不到了，攻击一上线保护就消失
     两处合起来恰好等于「有损坏且没修好」。

   ⚠️ 队列表必须按 payload 里的 dmg 判，不能只看有没有 pending 行 ——
     0 星、只掉了圣水的记录 payload.dmg 为空，那不是损坏，不该白送保护。

   ⚠️ 别名约定：外层查询里的 village_profiles 必须别名为 p（两个调用点都是）。
   ============================================================ */
const NOT_DAMAGED_SQL = `
        AND NOT EXISTS (
              SELECT 1 FROM village_saves ds
              WHERE ds.user_id = p.user_id AND ds.save_key = 'village'
                AND COALESCE(json_array_length(json_extract(ds.data, '$.dmg')), 0) > 0)
        AND NOT EXISTS (
              SELECT 1 FROM village_defense_queue dq
              WHERE dq.defender_id = p.user_id AND dq.status = 'pending'
                AND COALESCE(json_array_length(json_extract(dq.payload, '$.dmg')), 0) > 0)`;
const opponentsLimiter = (0, rateLimit_1.rateLimit)({
    windowMs: 60_000,
    max: 30,
    message: '搜索过于频繁',
    keyOf: (req) => String(req.userId),
});
/* ============================================================
   PVP 总开关（2026-10-14 已开放）
   ------------------------------------------------------------
   历史：2026-09-30 ~ 2026-10-14 整块关闭（新号只有一座市政厅、达不到
   3 座门槛，对战经济也没验收完）。当时用的是「拦截不删除」：三个接口
   保留完整实现、提前 503 返回，前端拿到 503 自动降级去打 NPC 关卡。

   2026-10-14 起默认开启，并改成**可运行时开关**：
       Environment=VILLAGE_PVP=off   → 关闭
   （systemd 改完 daemon-reload + 重启 keyi 即可生效，不用改代码重新构建。
     不配置 = 开启。与 VILLAGE_OPEN_HOURS 同一套做法。）

   ⚠️ 与之配套：`/village/opponents` 一旦返回 503，客户端就不会再调
      attack/start、attack/finish，所以这三个接口的状态是一致的。
   ============================================================ */
const PVP_ENABLED = process.env.VILLAGE_PVP !== 'off';
function pvpClosed(_req, res, next) {
    if (PVP_ENABLED) {
        next();
        return;
    }
    res.status(503).json({
        error: '对战功能暂未开放',
        code: 'PVP_DISABLED',
        /** 显式告诉客户端：请走 NPC 关卡，不要重试 */
        fallback: 'npc',
    });
}
/* ------------------------------------------------------------
   对手匹配核心查询 —— /opponents 与 /opponents/reroll 共用。
   抽成函数而不是复制两份：这段 WHERE 里**每一条都是「不能打的对手」**，
   复制之后任何一条调整都只会改到一半（例如加了维修期免战却漏了换一批）。
   ------------------------------------------------------------ */
/**
 * 挑选可进攻的对手。
 *
 * 【2026-10-14 按需求】**取消市政厅等级分级匹配** —— 全服随机。
 *
 * 原先的策略是「先取同 TH，不足 3 个再放宽到 ±1」。在本站的实际人口分布下
 * （诊断实测：TH1 69 人、TH2 28 人、TH3 2 人、TH4 1 人、TH5 1 人），
 * 高本玩家会被直接锁在 PvP 之外 —— TH5 的玩家同档无人、±1 也只剩一个 TH4，
 * 那个人一旦在护盾/维修免战/冷却中就返回空列表，界面上就是「没有可匹配的对手」。
 *
 * 不分级之后，公平性由这几层兜底，而不是靠等级筛选：
 *   · 掠夺有上限：单次所得按星级比例取，且受 DEFENDER_DAILY_LOSS_CAP 与
 *     防守方真实余额三重取小 —— 高本打低本也抢不走多少；
 *   · 建筑数 ≥ MIN_BUILDINGS_TO_BE_TARGET 才算「值得打的目标」；
 *   · 新手 7 天内不进池子；
 *   · 同一对手 1 小时内只能打一次，每天最多打 2 个人。
 * @param {number} myTh 仅保留参数位（兼容调用方），不再参与筛选
 */
function pickOpponents(db, me, myTh, now, newbieAfter) {
    const weekStart = weekStartDayStr(now * 1000);
    const items = db.prepare(`
      SELECT p.user_id     AS userId,
             u.username    AS name,
             p.th_level    AS th,
             p.building_cnt AS buildingCnt,
             p.wall_cnt    AS wallCnt,
             MIN(u.coins, ?) AS lootCoins,
             p.loot_elixir AS lootElixir,
             (SELECT GROUP_CONCAT(
                       json_extract(json_each.value, '$.y') || ':' ||
                       json_extract(json_each.value, '$.l'), ',')
              FROM village_saves s, json_each(s.data, '$.buildings')
              WHERE s.user_id = p.user_id AND s.save_key = 'village') AS compo
      FROM village_profiles p
      JOIN users u ON u.id = p.user_id
      WHERE p.user_id <> ?
        AND p.shield_until <= ?
        AND p.building_cnt >= ?
        AND u.created_at <= ?
        AND COALESCE(u.banned_until, 0) <= ?
        AND NOT EXISTS (
              SELECT 1 FROM village_raid_targets t
              WHERE t.attacker_id = ? AND t.defender_id = p.user_id
                AND t.last_at > ?)
        /* 本周已经被打满的人不再出现在列表里（feedback 173）。
           计数只认真人 PVP；NPC 演练是玩家自己选的，不算「被打」。 */
        AND (SELECT COUNT(*) FROM village_battles b
             WHERE b.defender_id = p.user_id AND b.mode = 'pvp' AND b.day >= ?)
            < ?
        ${NOT_DAMAGED_SQL}
      ORDER BY RANDOM() LIMIT ?
    `).all(DEFENDER_DAILY_LOSS_CAP, me, now, MIN_BUILDINGS_TO_BE_TARGET, newbieAfter, now, me, now - SAME_TARGET_COOLDOWN_SEC, weekStart, WEEKLY_DEFENSE_CAP, 8);
    /* spread 恒为 0：字段保留只是为了不改客户端协议（那边本来也没用它）。 */
    return { items, spread: 0 };
}
/** 今日真人进攻配额（计数真源 = 真人快照条数，见 DAILY_PVP_ATTACK_MAX 注释） */
function pvpQuota(db, me, day) {
    const used = Number(db.prepare('SELECT COUNT(*) AS n FROM village_raid_snapshots WHERE attacker_id = ? AND day = ?').get(me, day)?.n) || 0;
    return { used, left: Math.max(0, pvpAttackMaxOf(me) - used) };
}
/* ============================================================
   ⑧ 矿场收取（2026-10-14 新增）
   ------------------------------------------------------------
   机制：矿场按时间产出铜板，存在「铜板库」里（总容量 = Σ 库容量），
        存满就停产 —— 不是靠定时器，而是靠「最多只能算出 cap 那么多」，
        于是「存满后第三天不产」天然成立，无需额外的状态位。

   ⚠️ 为什么必须走服务端：铜板是账号级资产（users.coins），真源在服务端。
      客户端能自行算出的铜板数就是一台印钞机（改一行 JS 即可无限刷）。
      所以客户端只显示预估，真正的账在这里按**服务端时间**算。

   ⚠️ 幂等/防重放：靠「发钱 + 推进计时器」在同一事务里完成。
      只发钱不推时间 → 可以反复领；只推时间不发钱 → 玩家白等。
   ============================================================ */
/**
 * 矿场结算的纯计算部分（不碰数据库）。
 *
 * 抽出来的唯一目的是**可测试**：把「按时间累积、再被总容量封顶」这条规则
 * 单独暴露，就能用任意 (rate, cap, elapsed) 组合验证边界 ——
 * 尤其是「存满之后还产不产」这个需求核心点。
 *
 * @param {number} ratePerDay 每日产量
 * @param {number} cap        总容量（Σ 铜板库容量）
 * @param {number} elapsedSec 距上次收取的秒数
 * @returns {{pending:number, consumed:number, capSec:number}}
 *   pending  本次应发（可能带小数，调用方负责 floor）
 *   consumed 应从计时器扣掉的秒数
 *   capSec   存满所需秒数
 */
function computeMinePending(ratePerDay, cap, elapsedSec) {
    const rate = Number(ratePerDay) || 0;
    const c = Number(cap) || 0;
    const el = Math.max(0, Number(elapsedSec) || 0);
    if (!(rate > 0) || !(c > 0) || el <= 0)
        return { pending: 0, consumed: 0, capSec: 0 };
    const perSec = rate / 86400;
    const capSec = Math.floor(c / perSec);
    /* min(cap, ...) 就是「存满即停产」的全部实现 ——
       不需要额外的停机标志位：算得出来的上限就是 cap，多等的时间直接作废。 */
    const pending = Math.min(c, el * perSec);
    return { pending, consumed: Math.min(el, capSec), capSec };
}

router.post('/mine/claim', (req, res) => {
    try {
        const db = (0, database_1.getDb)();
        const userId = req.userId;
        const now = Math.floor(Date.now() / 1000);
        /* TH 用锚定后的值（min(存档, 权威列)）：谎报市政厅等级换不来产能 */
        const prog = readPlayerProgress(userId);
        const th = Math.max(1, Math.min(village_save_1.MAX_LEVEL, prog.thLevel));
        const s = readMineStats(userId, th);
        const bal = () => (0, coins_1.getCoins)(userId);
        const base = { ratePerDay: s.ratePerDay, cap: s.cap, mines: s.mines, stores: s.stores };
        if (s.mines <= 0 || s.ratePerDay <= 0 || s.cap <= 0) {
            return res.json(Object.assign({ ok: true, granted: 0, pending: 0, balance: bal() }, base));
        }
        const u = db.prepare('SELECT village_mine_coin_at FROM users WHERE id = ?').get(userId);
        const last = Number(u && u.village_mine_coin_at) || 0;
        if (last <= 0) {
            /* 首次调用：只启动计时器，本次不发钱（从此刻起算） */
            db.prepare('UPDATE users SET village_mine_coin_at = ? WHERE id = ?').run(now, userId);
            return res.json(Object.assign({ ok: true, granted: 0, pending: 0, inited: true, balance: bal() }, base));
        }
        const elapsed = Math.max(0, now - last);
        const calc = computeMinePending(s.ratePerDay, s.cap, elapsed);
        const pending = calc.pending;
        const granted = Math.floor(pending);
        if (granted <= 0) {
            return res.json(Object.assign({ ok: true, granted: 0, pending: pending, balance: bal() }, base));
        }
        const tx = db.transaction(() => {
            const balance = (0, coins_1.addCoins)(userId, granted, 'village_mine', null);
            /* 只消耗「真正产出了铜板的那段时间」：
                 · 没存满 → elapsed 全消耗（时间归零，下轮重新计）
                 · 已存满 → 只消耗 capSec，超出的时间作废
               后一条正是「存满后不产出」的实现。 */
            /* 【2026-10-14 端到端验证修复】计时器一律归位到「现在」。
               原先写的是 village_mine_coin_at + consumed（consumed = min(elapsed, capSec)）：
               当 elapsed > capSec（存满之后继续等）时只推进了 capSec，残留的
               超出时间留在计时器里，下一次点击会被重新折成铜板 —— 实测回拨 3 天
               再连点两次，共拿到 45（= 满 3 天全量），「存满即停产」形同虚设。
               只有归位到 now，超出的时间才会真正作废。 */
            db.prepare('UPDATE users SET village_mine_coin_at = ? WHERE id = ?').run(now, userId);
            return balance;
        });
        const balance = tx();
        res.json(Object.assign({
            ok: true,
            granted,
            pending: Math.round(pending * 100) / 100,
            balance,
        }, base));
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.get('/opponents', pvpClosed, opponentsLimiter, (req, res) => {
    try {
        const db = (0, database_1.getDb)();
        const me = req.userId;
        const now = Math.floor(Date.now() / 1000);
        const { thLevel } = readPlayerProgress(me);
        const newbieAfter = now - NEWBIE_SHIELD_DAYS * 86400;
        const day = (0, coins_1.todayCn)();
        const quota = pvpQuota(db, me, day);
        const { items, spread } = pickOpponents(db, me, thLevel, now, newbieAfter);
        res.json({
            ok: true,
            degraded: items.length === 0,
            thSpread: spread,
            myTh: thLevel,
            /** 今日剩余可进攻真人的次数（0 = 用完了，客户端应引导去打演练关卡） */
            pvpLeft: quota.left,
            pvpMax: pvpAttackMaxOf(me),
            /** 换一批的花费，客户端按钮文案直接读它，避免两边写死 */
            rerollCost: OPPONENT_REROLL_COST,
            items,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/* ============================================================
   ⑦-b-2 PVP：换一批对手（收 OPPONENT_REROLL_COST 铜板）
   ------------------------------------------------------------
   2026-10-14 按需求加。要点：
     · 池子为空 **不收费** —— 花了钱换回空列表说不过去，也会变成投诉项；
     · 扣费走 addCoins（与 /repair 同一套：服务端定价，客户端只发起）；
     · 与 /opponents 共用 pickOpponents，保证过滤口径完全一致；
     · 没消耗当天的出征次数（换一批只是挑对手，不出征）。
   ============================================================ */
const rerollLimiter = (0, rateLimit_1.rateLimit)({
    windowMs: 60_000,
    max: 20,
    message: '换一批过于频繁',
    keyOf: (req) => String(req.userId),
});
router.post('/opponents/reroll', pvpClosed, rerollLimiter, (req, res) => {
    try {
        const db = (0, database_1.getDb)();
        const me = req.userId;
        const now = Math.floor(Date.now() / 1000);
        const { thLevel } = readPlayerProgress(me);
        const newbieAfter = now - NEWBIE_SHIELD_DAYS * 86400;
        const day = (0, coins_1.todayCn)();
        const quota = pvpQuota(db, me, day);
        const { items, spread } = pickOpponents(db, me, thLevel, now, newbieAfter);
        const base = {
            ok: true,
            thSpread: spread,
            myTh: thLevel,
            pvpLeft: quota.left,
            pvpMax: pvpAttackMaxOf(me),
            rerollCost: OPPONENT_REROLL_COST,
            items,
        };
        // 没有可打的对手 → 不收费
        if (items.length === 0) {
            res.json({ ...base, degraded: true, charged: 0, balance: (0, coins_1.getCoins)(me) });
            return;
        }
        try {
            (0, coins_1.addCoins)(me, -OPPONENT_REROLL_COST, 'village_reroll', 0);
        }
        catch (e) {
            const lack = e && String(e.message).includes('铜板不足');
            res.status(400).json({
                error: lack
                    ? '铜板不足：换一批需要 ' + OPPONENT_REROLL_COST + ' 铜板'
                    : '换一批失败，请稍后再试',
            });
            return;
        }
        res.json({ ...base, degraded: false, charged: OPPONENT_REROLL_COST, balance: (0, coins_1.getCoins)(me) });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/* ============================================================
   ⑦-c PVP：开打（生成对手村庄快照）
   ------------------------------------------------------------
   异步快照：把对手村庄冻结成一份副本，打的是这份副本。
   对手爱怎么改村庄怎么改 —— 不需要分布式锁、不需要踢下线、
   对手离线也能打。save_version 只作审计留痕。
   ============================================================ */
const attackLimiter = (0, rateLimit_1.rateLimit)({
    windowMs: 60_000,
    max: 15,
    message: '出征过于频繁',
    keyOf: (req) => String(req.userId),
});
router.post('/attack/start', pvpClosed, attackLimiter, (req, res) => {
    try {
        const me = req.userId;
        const defId = Math.floor(Number(req.body?.defenderId));
        if (!isFinite(defId) || defId <= 0) {
            res.status(400).json({ error: '非法对手' });
            return;
        }
        if (defId === me) {
            res.status(400).json({ error: '不能进攻自己' });
            return;
        }
        const db = (0, database_1.getDb)();
        const now = Math.floor(Date.now() / 1000);
        const day = (0, coins_1.todayCn)();
        /* 【2026-10-14 按需求】这里原先会读一次市政厅等级（myTh），
           用来拦「与对手等级差 > 1」的进攻。匹配改成全服随机后（见 pickOpponents），
           继续拦就会出现「能匹配到、一打却被拒」的自相矛盾 —— 所以一并去掉。
           高本打低本的收益本来就受掠夺上限约束，不需要靠等级硬拦。 */
        const out = db.transaction(() => {
            // ① 当日总场次
            db.prepare('INSERT OR IGNORE INTO village_daily_quota (user_id, day) VALUES (?,?)').run(me, day);
            const q = db.prepare('SELECT raid_count FROM village_daily_quota WHERE user_id = ? AND day = ?').get(me, day);
            if ((Number(q?.raid_count) || 0) >= DAILY_RAID_MAX) {
                return { err: 429, msg: '今日出征次数已达上限' };
            }
            /* ①-b 真人进攻的独立日限（每人每天最多 2 次，2026-10-14 按需求）。
               计数真源：今天已生成的真人快照条数 —— 每发起一次恰好一行。 */
            const pvpUsed = Number(db.prepare('SELECT COUNT(*) AS n FROM village_raid_snapshots WHERE attacker_id = ? AND day = ?').get(me, day)?.n) || 0;
            const pvpMaxToday = pvpAttackMaxOf(me);
            if (pvpUsed >= pvpMaxToday) {
                return { err: 429, msg: '今日进攻真人部落的次数已用完（每天 ' + pvpMaxToday + ' 次）' };
            }
            /* ② 重校验对手资格。
               客户端可能拿着几分钟前的旧列表强打，所以列表里过滤过的这里必须再过滤一遍。 */
            const p = db.prepare(`
        SELECT p.*, u.coins, u.username, u.created_at, COALESCE(u.banned_until,0) AS banned_until
        FROM village_profiles p JOIN users u ON u.id = p.user_id
        WHERE p.user_id = ?`).get(defId);
            if (!p)
                return { err: 404, msg: '对手不存在' };
            if (Number(p.shield_until) > now)
                return { err: 409, msg: '对手处于护盾中' };
            if (Number(p.building_cnt) < MIN_BUILDINGS_TO_BE_TARGET)
                return { err: 400, msg: '对手村庄过于简陋' };
            /* 对手还有未修复的损坏 → 不能打。
               与 /opponents 的列表过滤同一口径（见 NOT_DAMAGED_SQL 的两处落点），
               列表是几分钟前拉的，这里必须再判一次。 */
            const dmgRow = db.prepare(`
        SELECT COALESCE((SELECT json_array_length(json_extract(s.data, '$.dmg'))
                         FROM village_saves s
                         WHERE s.user_id = ? AND s.save_key = 'village'), 0) AS selfDmg,
               (SELECT COUNT(*) FROM village_defense_queue q
                WHERE q.defender_id = ? AND q.status = 'pending'
                  AND COALESCE(json_array_length(json_extract(q.payload, '$.dmg')), 0) > 0) AS pendingDmg
      `).get(defId, defId);
            if ((Number(dmgRow?.selfDmg) || 0) > 0 || (Number(dmgRow?.pendingDmg) || 0) > 0) {
                return { err: 409, msg: '对手正在维修建筑，暂时不能攻打' };
            }
            if (Number(p.created_at) > now - NEWBIE_SHIELD_DAYS * 86400)
                return { err: 400, msg: '新手保护中' };
            if (Number(p.banned_until) > now)
                return { err: 400, msg: '对手不可用' };
            /* ②-b 本周被攻打次数（feedback 173）。
               列表已经过滤过，但客户端可能拿着几分钟前的旧列表硬打，
               这里必须再判一次 —— 否则「每周上限」只是摆设。 */
            const defTimes = Number(db.prepare(`SELECT COUNT(*) AS n FROM village_battles
          WHERE defender_id = ? AND mode = 'pvp' AND day >= ?`)
                .get(defId, weekStartDayStr(now * 1000))?.n) || 0;
            if (defTimes >= weeklyDefenseCapOf(defId)) {
                return { err: 409, msg: `这个部落本周已被攻打 ${defTimes} 次，换一个吧` };
            }
            // ③ 同一对手冷却
            const t = db.prepare('SELECT * FROM village_raid_targets WHERE attacker_id = ? AND defender_id = ?').get(me, defId);
            if (t && Number(t.last_at) > now - SAME_TARGET_COOLDOWN_SEC) {
                return { err: 429, msg: '刚打过这个对手' };
            }
            if (t && t.day === day && Number(t.times_today) >= SAME_TARGET_PER_DAY) {
                return { err: 429, msg: '今日对该对手出征次数已用完' };
            }
            // ④ 把旧的 open 快照作废：防"开一场不打"占坑，也防并发重入
            db.prepare(`UPDATE village_raid_snapshots SET status = 'expired'
         WHERE attacker_id = ? AND status = 'open'`).run(me);
            // ⑤ 生成快照
            const sv = db.prepare('SELECT data, version FROM village_saves WHERE user_id = ? AND save_key = ?').get(defId, 'village');
            if (!sv || !sv.data)
                return { err: 404, msg: '对手没有存档' };
            let d;
            try {
                d = JSON.parse(sv.data);
            }
            catch {
                return { err: 404, msg: '对手存档损坏' };
            }
            const rows = Array.isArray(d.buildings) ? d.buildings : [];
            /* 只取重建建筑必需的四个值，外加服务端算好的外观变体号。
               · l 用 max(1,...) —— 存档里 l=0 表示施工中，maxHp(type,0) 会越界
               · 未知 type 跳过（与 village.js 的 load() 同策略，防手改档白屏） */
            const layout = rows
                .filter((b) => b && typeof b.y === 'string' && KNOWN_BUILDINGS.has(b.y))
                .map((b) => ({
                /* ⚠️ 实例 id 必须进快照 —— pickDamagedBuildings() 就是靠它返回
                   「打坏了哪几座」，settlePvpRaid 再把这份 id 列表写进
                   village_defense_queue，最后 applyDefenseQueue 按 id 并进
                   防守方存档的 dmg 数组。这里漏掉 i 的话整条链路静默失效：
                   damagedCount 恒为 0、建筑永远打不坏、维修按钮永远不出现
                   （2026-10-14 之前一直是这个状态，因为 PvP 关着没人发现）。
                   下发给客户端时会剥掉它，见 /attack/start 的 return。 */
                i: Math.round(Number(b.i) || 0),
                y: b.y,
                l: Math.max(1, Math.min(5, Math.floor(Number(b.l)) || 1)),
                x: Math.round(Number(b.x) || 0),
                z: Math.round(Number(b.z) || 0),
                v: variantOf(String(b.i ?? '')),
            }));
            if (layout.length < MIN_BUILDINGS_TO_BE_TARGET) {
                return { err: 400, msg: '对手村庄过于简陋' };
            }
            const lootElixir = Math.max(0, Math.floor(Number(d?.res?.elixir) || 0));
            const lootCoins = Math.max(0, Number(p.coins) || 0);
            const ins = db.prepare(`
        INSERT INTO village_raid_snapshots
          (attacker_id, defender_id, layout, th_level, loot_coins, loot_elixir,
           save_version, status, created_at, expires_at, day)
        VALUES (?,?,?,?,?,?,?, 'open', ?, ?, ?)`).run(me, defId, JSON.stringify(layout), Number(p.th_level), lootCoins, lootElixir, Number(sv.version) || 0, now, now + SNAPSHOT_TTL_SEC, day);
            return {
                snapshotId: Number(ins.lastInsertRowid),
                defender: { userId: defId, name: p.username, th: Number(p.th_level) },
                /* 下发时剥掉实例 id：客户端重建敌村只用 y/l/x/z/v
                   （见 battle.js 的 _buildFromSave），id 属于服务端内部标识。
                   这样协议与修复前完全一致，客户端无需改动。 */
                layout: layout.map((x) => ({ y: x.y, l: x.l, x: x.x, z: x.z, v: x.v })),
                loot: { coins: lootCoins, elixir: lootElixir },
                expiresAt: now + SNAPSHOT_TTL_SEC,
            };
        })();
        if (out && typeof out === 'object' && 'err' in out) {
            const e = out;
            res.status(e.err).json({ error: e.msg });
            return;
        }
        res.json({ ok: true, ...out });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/* ============================================================
   ⑦-d PVP：结算
   ------------------------------------------------------------
   不复用 POST /events —— 理由与 /refund 独立于 /withdraw 一致：
   这是**同时动两个人钱包**的新语义，塞进 settleBattle() 会让
   「发币」和「双向转账」混在一个函数里，日后改错符号就是事故。

   不收客户端的 stars：由服务端按 pct + thDead 重算。
   ============================================================ */
const finishLimiter = (0, rateLimit_1.rateLimit)({
    windowMs: 60_000,
    max: 20,
    message: '结算过于频繁',
    keyOf: (req) => String(req.userId),
});
router.post('/attack/finish', pvpClosed, finishLimiter, (req, res) => {
    try {
        const me = req.userId;
        const snapId = Math.floor(Number(req.body?.snapshotId));
        const pct = clampNum(req.body?.pct, 0, 100);
        const thDead = req.body?.thDead === true;
        const durMs = clampNum(req.body?.durationMs, 0, 3_600_000);
        if (!isFinite(snapId) || snapId <= 0) {
            res.status(400).json({ error: '缺少快照' });
            return;
        }
        const db = (0, database_1.getDb)();
        const day = (0, coins_1.todayCn)();
        const out = db.transaction(() => {
            /* ① 锁快照：条件 UPDATE 是幂等的唯一凭据。
               changes === 0 说明已结算过（重放请求）或已过期。 */
            const lock = db.prepare(`UPDATE village_raid_snapshots SET status = 'settled'
         WHERE id = ? AND attacker_id = ? AND status = 'open'`).run(snapId, me);
            if (lock.changes === 0) {
                const old = db.prepare('SELECT status FROM village_raid_snapshots WHERE id = ? AND attacker_id = ?').get(snapId, me);
                if (!old)
                    return { err: 404, msg: '快照不存在' };
                if (old.status === 'expired')
                    return { err: 410, msg: '本次进攻已过期' };
                return { duplicated: true }; // 已结算：回显 0 收益，不再扣钱
            }
            const s = db.prepare('SELECT * FROM village_raid_snapshots WHERE id = ?').get(snapId);
            if (Number(s.expires_at) < Math.floor(Date.now() / 1000)) {
                db.prepare(`UPDATE village_raid_snapshots SET status = 'expired' WHERE id = ?`).run(snapId);
                return { err: 410, msg: '本次进攻已过期' };
            }
            // ② 星级服务端重算，绝不信客户端
            const suspicious = durMs > 0 && durMs < MIN_BATTLE_MS;
            let stars = pct >= 99.5 ? 3 : (pct >= 50 ? 1 : 0) + (thDead ? 1 : 0);
            // 20 秒内拿 2 星以上物理上不可能 —— 改客户端或秒结算
            if (suspicious && stars >= 2)
                stars = 0;
            /* ③ 破坏百分比也要夹取（2026-10-01 安全修复）。
               原先 pct 直接透传给 settlePvpRaid，而它决定"对手几座建筑被打坏"，
               等于进攻方一句话就能把对手全村打废、逼其交维修费。
               夹取后再传给结算，见 effectiveRaidPct 的注释。 */
            const effPct = effectiveRaidPct(pct, thDead, stars, suspicious);
            return settlePvpRaid(db, me, s, stars, effPct, day, suspicious, durMs);
        })();
        if (out && typeof out === 'object' && 'err' in out) {
            const e = out;
            res.status(e.err).json({ error: e.msg });
            return;
        }
        res.json({ ok: true, ...out });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/* ============================================================
   ⑦ 心跳：刷新 last_seen_at（前端定期调用，让离线时长更准）
   ============================================================ */
router.post('/heartbeat', (req, res) => {
    try {
        const db = (0, database_1.getDb)();
        const userId = req.userId;
        const day = (0, coins_1.todayCn)();
        db.prepare('INSERT OR IGNORE INTO village_daily_quota (user_id, day) VALUES (?, ?)').run(userId, day);
        db.prepare('UPDATE village_daily_quota SET last_seen_at = ? WHERE user_id = ? AND day = ?').run(Math.floor(Date.now() / 1000), userId, day);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/* ============================================================
   ⑧ 启动自检：造价表与游戏 config.js 是否仍然一致
   ------------------------------------------------------------
   EXPECTED_COST 是从 config.js 手工抄的。改游戏数值时忘了同步，
   玩家就会遇到「扣的钱和标价对不上」或建造被 400 拒。这类问题不会崩服务，
   只会静默地毁掉体验 —— 所以启动时喊一声，比事后翻日志便宜。
   ============================================================ */
const COST_SANITY = [
    // 抽几个最有代表性的抽查：最贵的、最便宜的、刚改过的
    ['townhall:1', 0], // 唯一的免费建筑（初始村庄自带）
    ['townhall:5', 13000], // 天花板以上一档
    ['goldmine:5', 16500], // 全表最贵
    ['wall:1', 20], // 唯一不套 150 起步的（1×1 消耗品）
    ['cannon:1', 100], // 防御起步价
    ['cannon:5', 7800],
    ['elixircollector:3', 820], // 资源档
    ['mortar:4', 7200],
    ['armycamp:1', 260], // 军事档（军营）
    ['builderhut:1', 150],
];
/** variantOf 的自检样本（用 models.js 的同款 FNV-1a 预先算好） */
const VARIANT_SANITY = [
    ['1', 1], ['42', 2], ['123', 2], ['1001', 0],
];
function assertCostTableConsistent() {
    const bad = [];
    for (const [k, v] of COST_SANITY) {
        if (EXPECTED_COST[k] !== v)
            bad.push(`${k} 期望 ${v} 实际 ${EXPECTED_COST[k]}`);
    }
    if (bad.length) {
        console.error('[village] ⚠️ EXPECTED_COST 与预期不符，可能是改了造价表但漏改这里：');
        for (const b of bad)
            console.error('   · ' + b);
    }
    /* 外观变体哈希自检：服务端的 variantOf 必须与 models.js 的逐字符一致，
       否则「房主自己看的房子」和「被别人打时的房子」会长得不一样。
       期望值是用 models.js 的同款 FNV-1a 预先算好的。 */
    const vbad = [];
    for (const [k, v] of VARIANT_SANITY) {
        if (variantOf(k) !== v)
            vbad.push(`'${k}' 期望 ${v} 实际 ${variantOf(k)}`);
    }
    if (vbad.length) {
        console.error('[village] ⚠️ variantOf 与 models.js 不一致，PVP 里建筑外观会错乱：');
        for (const b of vbad)
            console.error('   · ' + b);
    }
}
exports.default = router;
/* 再写一遍 ES 形式的导出，只是为了让 TypeScript 认得这两个符号
   （文件内全是 CJS 的 exports.xxx=... ，类型系统看不见）。
   编译产物是同一句 exports.default = router / exports.assertCostTableConsistent = ...，
   运行时语义与线上完全一致。 */
export default router;
export { assertCostTableConsistent };
export { getStudyBonusMultiplier };
/* 【2026-10-11】开放时间相关内部函数导出，仅供自测脚本调用真实实现，
   不对外暴露任何接口。 */
export { isWorkday, windowsOf, openWindowAt, nextOpenMs, nextOpenWindowsText, WINDOWS_WORKDAY, WINDOWS_OFFDAY };
/* 【2026-10-14】矿场结算的纯计算部分导出，仅供自测脚本调用真实实现，不对外暴露任何接口。 */
export { computeMinePending };
