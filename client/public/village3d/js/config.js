/* ============================================================
   config.js — 全部游戏数值与静态配置
   ------------------------------------------------------------
   时间单位：全部使用「游戏秒」。
   1 现实秒 = TIME_SCALE 游戏秒（TIME_SCALE 现为 1 → 游戏秒 == 现实秒）。
   ============================================================ */

/** 一格的世界尺寸 */
export const TILE = 1;
/** 村庄网格边长（格） */
export const GRID = 44;
/**
 * 时间倍率：现实秒 → 游戏秒。
 *
 * ⚠️ 2026-09-30 起固定为 1（真实时间）。
 *    原先 = 30，会把「工期 60 秒」的兵营压成 2 秒盖好、圣水快 30 倍地流，
 *    配置里的 t 值与实际耗时完全对不上（fmtTime 一直是按真实秒展示的）。
 *    改成 1 后：工期就是 up[].t 写的秒数，生产速率按 prod[].rate/小时走。
 *
 * ⚠️ 服务端 server/dist/routes/village.js 有一份同名常量（离线收益折算用），
 *    两边必须保持一致，否则「离线圣水」与在线速率对不上。
 */
export const TIME_SCALE = 1;

/** 网格坐标 → 世界坐标 */
export function gridToWorld(gx, gz) {
  return { x: (gx - (GRID - 1) / 2) * TILE, z: (gz - (GRID - 1) / 2) * TILE };
}
/** 世界坐标 → 网格坐标（连续，用于放置预览） */
export function worldToGridF(wx, wz) {
  return { gx: wx / TILE + (GRID - 1) / 2, gz: wz / TILE + (GRID - 1) / 2 };
}
/** 世界坐标 → 整数网格 */
export function worldToGrid(wx, wz) {
  const f = worldToGridF(wx, wz);
  return { gx: Math.round(f.gx), gz: Math.round(f.gz) };
}

/* ------------------------------------------------------------------
   调色板（三渲二：低饱和环境 + 高饱和主体 + 固定暗色描边）
   ------------------------------------------------------------------ */
export const PALETTE = {
  outline:     0x30243c,
  grassA:      '#8ed36a',
  grassB:      '#83cb60',
  grassC:      '#a3dd7c',
  dirt:        '#c9a06a',
  sand:        '#f2dcb0',
  cliff:       '#8a6a4a',

  stone:       0xcfc6bb,
  stoneDark:   0xa79c90,
  wood:        0xb87a46,
  woodDark:    0x8c5a30,
  roofRed:     0xe2574c,
  roofRedDark: 0xb93f36,
  roofBlue:    0x5b8fd6,
  gold:        0xffc63d,
  goldDark:    0xd09414,
  elixir:      0xd76bff,
  elixirDark:  0x9d33c4,
  metal:       0xb9c2cc,
  metalDark:   0x7d8792,
  skin:        0xf5c9a0,
  cloth:       0x4f6ec9,
  canvas:      0xf0e2c4,
  leaf:        0x5fb84a,
  leafDark:    0x3f8c33,

  /* --- 精细建模扩展：石材（偏暖的砂岩，与草地/红瓦形成三色基本盘） --- */
  stoneLight:  0xdfd0b0,
  stoneMid:    0xbfa478,
  stoneDark:   0x947c52,
  stoneWarm:   0xd6bd93,
  stoneCool:   0xc2c6cc,
  mortar:      0xa8906c,

  /* --- 抹灰 / 墙面 --- */
  plaster:     0xf4e6c6,
  plasterWarm: 0xecd6a8,
  plasterRose: 0xf2dbd2,
  plasterCream:0xfaf0d8,

  /* --- 木材 --- */
  timber:      0x9e6a44,
  timberDark:  0x6d4527,
  timberLight: 0xc48d55,
  beam:        0x7d4f2c,

  /* --- 屋顶 --- */
  shingleA:    0xd85545,
  shingleB:    0xc44a3a,
  shingleC:    0x9e342c,
  shingle:     0xd0503f,
  tileBlue:    0x5b8fd6,
  tileBlueDark:0x3f6dad,
  tileGreen:   0x5aa860,
  tileGreenDk: 0x3d8446,
  thatch:      0xd8b45f,
  thatchDark:  0xb08c3c,
  copper:      0x54ac8e,
  copperDark:  0x37815f,

  /* --- 金属 --- */
  iron:        0x9ba5b1,
  ironDark:    0x5e6672,
  ironLight:   0xc6cfd9,
  brass:       0xd9a63c,
  brassDark:   0xa8781f,

  /* --- 杂项 --- */
  sandbag:     0xcbb076,
  glassTint:   0xd2e6ff,
  ember:       0xff8a3a,
  charcoal:    0x4a444e,
  plankLight:  0xd8a86a,
};

/* ------------------------------------------------------------------
   建筑等级数值
   每项索引 0 = 1 级
   ------------------------------------------------------------------ */

/** 数量上限：[TH1..TH5] */
/* ⚠️ 改这里必须同步 server/src/lib/village-save.ts 的 MAXCNT（服务端存盘会按它校验，
      两边不一致 = 玩家建好一存就被 400 拒档）。
   2026-10-08 防御解锁前置：加农炮 TH1 由 1→2、箭塔 TH1 由 0→1（原本 TH2 才开）、
      迫击炮由「TH3 起」提前到「TH2 起」，各档数量整体 +1，玩家开局就能布防。 */
const MAXCNT = {
  goldmine:        [2, 3, 4, 5, 6],
  /* 矿场：产出建筑，数量刻意保守 —— 它给的是**被动**铜板收入，
     数量不封住的话，后期「挂机收益」会盖过「学习收益」。 */
  mine:            [1, 1, 2, 2, 3],
  elixircollector: [2, 3, 4, 5, 6],
  goldstorage:     [1, 2, 2, 3, 4],
  elixirstorage:   [1, 2, 2, 3, 4],
  barracks:        [1, 1, 2, 2, 3],
  /* 【2026-10-19 平衡】armycamp TH4 由 2 → 3。
     原因：敌方防御塔数量是 1→2→5→7→10 递增的，而 TH4 原本只能有 2 座军营
     （兵力与 TH3 完全相同），越到高本「防御增长 / 兵力增长」越失衡，
     TH4 打同本 tier 的伤亡一度接近九成。放行第 3 座军营后
     TH4 兵力 112 → 168，与 tier3 的塔数匹配。
     ⚠️ 必须同步 server/src/lib/village-save.ts 的 MAXCNT，否则存盘会被 400 拒档。 */
  armycamp:        [1, 1, 2, 3, 3],
  cannon:          [2, 3, 4, 5, 6],
  archertower:     [1, 2, 3, 4, 5],
  mortar:          [0, 1, 2, 2, 3],
  wall:            [25, 50, 75, 100, 125],
  builderhut:      [2, 2, 2, 2, 2],
};

/**
 * 建筑定义
 *  size     : [宽, 深]（格）
 *  up[]     : 各等级 {g:铜板, e:圣水, t:建造/升级游戏秒, hp}
 *  prod     : {res, rate(每小时), cap}  每级
 *  store    : {res, cap}                每级
 *  def      : {dps, range, min, splash, rof} 每级
 *  army     : {housing} 或 {speed, unlock[]}
 *  effect   : {key, perLevel[], stack, max} 每级增益（派生 getter 消费，不存状态）
 *
 * ⚠️ 经济模型（2026-09-29 统一）：up[].g 就是平台真实的「铜板」，不是游戏内货币。
 *    数值已在原值基础上 ÷4 重标定（玩家一天正常学习约 +20~40 铜板）。
 *
 * 🔖 2026-09-30 差异化定价：各建筑按定位分档，不再统一 150/450/1400/4000/12200。
 *    分档：核心/加成（市政厅·学识矿脉）最贵 → 军事（兵营·军营·迫击炮）次之
 *          → 存储类中档 → 防御（加农炮/箭塔）与资源采集最便宜 → 城墙另算。
 *    ⚠️ 改这里任何 up[].g 都必须同步 server/dist/routes/village.js 的
 *       EXPECTED_COST 与 COST_SANITY，否则玩家建造会被服务端 400（建筑造价不符）拒绝。
 *
 *    goldmine 的 prod 已删除 —— 它改成「学识矿脉」加成建筑后不再产铜板，
 *    否则就成了凭空印钞机。唯一能产出铜板的路径是学习 + 服务端按星级发的战斗奖励。
 */
export const BUILDINGS = {
  townhall: {
    name: '市政厅', emoji: '🏛️', size: [4, 4], unique: true, maxLevel: 5,
    tag: '核心', desc: '村庄的核心，被摧毁即失守。升级可解锁更多建筑。',
    up: [
      { g: 0, e: 0, t: 0,     hp: 1400 },
      { g: 500, e: 0, t: 7200,   hp: 1800 },
      { g: 1600, e: 0, t: 21600,   hp: 2400 },
      { g: 4600, e: 0, t: 57600,  hp: 3200 },
      { g: 13000, e: 0, t: 129600, hp: 4200 },
    ],
  },

  /**
   * 学识矿脉 —— 原「金矿」（2026-09-29 改造）
   *
   * 为什么改：金币统一成平台铜板后，一个能自产铜板的建筑等于一台印钞机。
   * 于是把它改成纯加成建筑：不再产出任何资源，转而提高「学习所得铜板」的倍率。
   * 加成由服务端读玩家存档计算（server/src/routes/cards.ts getStudyBonus），
   * 客户端这里只做展示，改本地等级刷不出铜板。
   *
   * ⚠️ 造价用圣水（e）而不是铜板：玩家为了提升学习收益，需要先玩/建圣水产业链，
   *    形成「游戏 → 圣水 → 加成 → 学习收益」的正循环，而不是「游戏 → 铜板」的自循环。
   */
  goldmine: {
    name: '学识矿脉', emoji: '📚', size: [3, 3], maxLevel: 5,
    tag: '加成', desc: '提升学习所得的铜板加成，等级越高加成越多。',
    up: [
      { g: 220, e: 13, t: 1800,   hp: 500 },
      { g: 660, e: 50, t: 5400,  hp: 600 },
      { g: 2000, e: 167, t: 14400, hp: 750 },
      { g: 5800, e: 500, t: 36000, hp: 900 },
      { g: 16500, e: 1250, t: 86400, hp: 1080 },
    ],
    /**
     * 学习铜板加成：每级 2% / 5% / 9% / 14% / 20%，多座累加，总封顶 100%。
     * 服务端硬编码同一张表（server/src/routes/cards.ts STUDY_BONUS_PER_LEVEL），
     * 两边必须一致；以服务端为准，客户端这份只用于 UI 展示。
     */
    effect: {
      key: 'studyCoinBonus',
      label: '学习铜板加成',
      perLevel: [0.02, 0.05, 0.09, 0.14, 0.20],
      stack: 'sum',
      max: 1.0,
    },
  },

  /* ============================================================
     矿场（2026-10-14 新增）
     ------------------------------------------------------------
     为什么是独立建筑、而不是把「学识矿脉」改回产铜板：
       学识矿脉的定位是**学习加成**（+2%~+20% 学习所得），那是一个
       「乘数」；矿场是**稳定产出**，是一个「加数」。把两种收益模型
       揉进一栋建筑，玩家看不懂它到底在干嘛，数值也没法独立调。
       分开之后各司其职：想放大学习收益就升矿脉，想有被动收入就建矿场。
     ============================================================ */
  mine: {
    name: '矿场', emoji: '⛏️', size: [3, 3], maxLevel: 5,
    tag: '产出', desc: '持续产出铜板，存满后停产，记得定时来收。',
    /* 造价刻意走纯铜板：矿场是「投入铜板换铜板」的建筑，语义最直白，
       也把圣水留给它的本职定位（训练部队、升级防御）。
       回本周期（累计造价 ÷ 当前日产量）：15 / 22 / 30 / 40 / 50 天。 */
    up: [
      { g: 220,  e: 0, t: 1800,    hp: 550 },
      { g: 330,  e: 0, t: 5400,   hp: 640 },
      { g: 650,  e: 0, t: 14400,  hp: 800 },
      { g: 1200, e: 0, t: 36000,  hp: 980 },
      { g: 2100, e: 0, t: 86400, hp: 1200 },
    ],
    /**
     * 铜板产出：每天 15 / 25 / 40 / 60 / 90。
     * rate 的单位与其它 prod 一致 —— **每小时**，所以写成 日产量/24。
     *
     * ⚠️ 这里的 cap **不是**这座矿场自己的停产线。
     *    真实机制是【各座矿场各自累积，但共享一个总容量】：
     *        总容量 = Σ(每座铜板库的容量)      ← 见下面 goldstorage.store
     *        总已存 = Σ(每座矿场的 stored)
     *        总已存 >= 总容量  →  所有矿场一起停产
     *    （用户的口径：「铜板库 1 级只能存 2 天的铜板」，库才是仓。）
     *    所以下面每级的 cap 只用于「气泡出现阈值」与单座进度条显示，
     *    取值恰等于「1 座同等级铜板库」的容量 = 2 天产量。
     *    实际停产判断见 village.js 的 tick()，走全局量。
     */
    prod: [
      { res: 'gold', rate: 15 / 24, cap: 30 },
      { res: 'gold', rate: 25 / 24, cap: 50 },
      { res: 'gold', rate: 40 / 24, cap: 80 },
      { res: 'gold', rate: 60 / 24, cap: 120 },
      { res: 'gold', rate: 90 / 24, cap: 180 },
    ],
  },

  elixircollector: {
    name: '圣水收集器', emoji: '⚗️', size: [3, 3], maxLevel: 5,
    tag: '资源', desc: '抽取圣水，训练部队的必需品。',
    up: [
      { g: 90, e: 0, t: 1800,   hp: 500 },
      { g: 270, e: 0, t: 5400,  hp: 600 },
      { g: 820, e: 0, t: 14400, hp: 750 },
      { g: 2400, e: 0, t: 36000, hp: 900 },
      { g: 7000, e: 0, t: 86400, hp: 1080 },
    ],
    prod: [
      { res: 'elixir', rate: 33,  cap: 83 },
      { res: 'elixir', rate: 75,  cap: 208 },
      { res: 'elixir', rate: 150, cap: 417 },
      { res: 'elixir', rate: 267, cap: 750 },
      { res: 'elixir', rate: 433, cap: 1250 },
    ],
  },

  goldstorage: {
    name: '铜板库', emoji: '🏦', size: [3, 3], maxLevel: 5,
    tag: '加成', desc: '提高铜板的存储上限。',
    up: [
      { g: 130, e: 25, t: 2700,  hp: 600 },
      { g: 400, e: 100, t: 7200,  hp: 730 },
      { g: 1200, e: 333, t: 21600, hp: 880 },
      { g: 3400, e: 1000, t: 50400, hp: 1080 },
      { g: 9800, e: 2500, t: 108000, hp: 1320 },
    ],
    /* 【2026-10-14 改】容量按「矿场 2 天的产量」重定：
         30 / 50 / 80 / 120 / 180（对应矿场 15/25/40/60/90 每天）。
       语义也随之变了 —— 它不再是「铜板余额上限」（那个早已改成无上限，
       见 village.js 的 caps getter 里 `if (s.res === 'gold') gold = Infinity`），
       而是「矿场待收池的总容量」。
       改这里对存量玩家零影响：旧值 94/219/... 从来没被真正读取过。 */
    store: [
      { res: 'gold', cap: 30 },
      { res: 'gold', cap: 50 },
      { res: 'gold', cap: 80 },
      { res: 'gold', cap: 120 },
      { res: 'gold', cap: 180 },
    ],
  },

  elixirstorage: {
    name: '圣水瓶', emoji: '🫙', size: [3, 3], maxLevel: 5,
    tag: '资源', desc: '提高圣水的存储上限。',
    up: [
      { g: 110, e: 0, t: 2700,  hp: 600 },
      { g: 330, e: 0, t: 7200,  hp: 730 },
      { g: 1000, e: 0, t: 21600, hp: 880 },
      { g: 2900, e: 0, t: 50400, hp: 1080 },
      { g: 8500, e: 0, t: 108000, hp: 1320 },
    ],
    store: [
      { res: 'elixir', cap: 250 },
      { res: 'elixir', cap: 583 },
      { res: 'elixir', cap: 1167 },
      { res: 'elixir', cap: 2167 },
      { res: 'elixir', cap: 3750 },
    ],
  },

  barracks: {
    name: '兵营', emoji: '⛺', size: [3, 3], maxLevel: 3,
    tag: '军事', desc: '训练部队，等级越高训练越快并解锁新兵种。',
    up: [
      { g: 200, e: 17, t: 3600,   hp: 520 },
      { g: 600, e: 83, t: 10800,  hp: 640 },
      { g: 1750, e: 333, t: 28800, hp: 780 },
    ],
    army: [
      { speed: 1.00, unlock: ['barbarian', 'archer'] },
      { speed: 1.30, unlock: ['barbarian', 'archer', 'giant'] },
      { speed: 1.70, unlock: ['barbarian', 'archer', 'giant', 'wallbreaker'] },
    ],
  },

  armycamp: {
    name: '军营', emoji: '🔥', size: [4, 4], maxLevel: 3,
    /* 【2026-10-19 血量平衡】非防御建筑整体往上抬，缩小「塔很硬、民房一碰就碎」的落差：
       学识矿脉/圣水收集器 +19%，矿场/铜板库/圣水瓶/兵营 +15%，军营 +25%。
       防御塔（上一轮已 +30%）不再动，保持「优先打塔、拆民房要看兵种」的节奏。 */
    tag: '军事', desc: '提供部队容量，出征前部队在此集结。',
    up: [
      { g: 260, e: 21, t: 3600,  hp: 440 },
      { g: 780, e: 125, t: 10800,  hp: 540 },
      { g: 2250, e: 500, t: 28800, hp: 660 },
    ],
    /* 【2026-10-19 平衡】容量 20/35/50 → 24/40/56（约 +12%~20%）。
       与下方防御塔的调整配套：塔变强之后，攻方也需要更多兵力才打得动。
       三座军营满级 = 168 个野蛮人，正好对上 TH5 敌方 10 座塔的火力。 */
    army: [
      { housing: 24 },
      { housing: 40 },
      { housing: 56 },
    ],
  },

  cannon: {
    name: '加农炮', emoji: '💣', size: [3, 3], maxLevel: 5,
    tag: '防御', desc: '地面单体防御，性价比最高的火力。',
    /* 【2026-10-19】塔血整体 +30% 左右（380/460/560/680/820 → 500/600/730/880/1060）。
       为什么要动血量：dps 提上去之后，如果塔还是 1.4 秒就被兵海拆掉，
       它根本没时间把 dps 打出来 —— 抬血量才是让「火力」真正生效的前提。 */
    up: [
      { g: 100, e: 0, t: 2400,   hp: 500 },
      { g: 300, e: 0, t: 7200,  hp: 600 },
      { g: 900, e: 0, t: 18000, hp: 730 },
      { g: 2700, e: 0, t: 43200, hp: 880 },
      { g: 7800, e: 0, t: 100800, hp: 1060 },
    ],
    /* 【2026-10-19 平衡重定】dps 9/17/29/47/72 → 24/31/39/48/58。
       上一轮（2026-10-14）是「按等级 ×1.5~×3」，只做了「越高级越强」，
       没解决两个结构性问题：
         ① 低本防御形同虚设：L1 只有 9 dps，20 个野蛮人（1400 血）要 155 秒
            才杀得光，而攻方拆完整个 tier0 只要 20 秒 —— 新手期毫无压力；
         ② 高本反而打不动：塔数量随 TH 是 1→2→5→7→10，兵力却只有
            20→24→112→168，满配 14 座塔的 dps 合起来能吞掉整支军队。
       这轮改成缓坡：L1 从 9 抬到 24（×2.7），L5 从 72 压到 58（×0.8）。
       目标手感：各本打同难度 tier 伤亡 30%~60%，一星容易、三星要带对兵。
       range / min / splash / rof 一律不动 —— 只调数值，不碰索敌手感。
       【2026-10-19 二轮】按需求整体再 +15%：24/31/39/48/58 → 28/36/45/55/67。 */
    def: [
      { dps: 28, range: 6.0, min: 0, splash: 0, rof: 0.9 },
      { dps: 36, range: 6.2, min: 0, splash: 0, rof: 0.9 },
      { dps: 45, range: 6.4, min: 0, splash: 0, rof: 0.85 },
      { dps: 55, range: 6.6, min: 0, splash: 0, rof: 0.8 },
      { dps: 67, range: 6.8, min: 0, splash: 0, rof: 0.75 },
    ],
  },

  archertower: {
    name: '箭塔', emoji: '🏹', size: [3, 3], maxLevel: 5,
    tag: '防御', desc: '射程极远，可以覆盖大片村庄。',
    /* 【2026-10-19】塔血 +33%（330/400/480/580/700 → 440/530/640/770/920），
       理由同加农炮：先让塔活得够久，dps 才有意义。 */
    up: [
      { g: 120, e: 0, t: 2400,  hp: 440 },
      { g: 360, e: 0, t: 7200,  hp: 530 },
      { g: 1100, e: 0, t: 18000, hp: 640 },
      { g: 3200, e: 0, t: 43200, hp: 770 },
      { g: 9200, e: 0, t: 100800, hp: 920 },
    ],
    /* 【2026-10-19 平衡重定】dps 11/19/32/50/75 → 22/28/36/44/54。
       箭塔射程本来就远（8.5~9.7），是「压制后排」的主力，
       所以 dps 仍略低于加农炮；但它能同时覆盖更大范围，
       实战总输出反而更高。高本从 75 压到 54，避免 5 座满级箭塔
       把 168 个兵在进场 10 秒内清空。
       【2026-10-19 二轮】整体 +15%：22/28/36/44/54 → 25/32/41/51/62。 */
    def: [
      { dps: 25, range: 8.5, min: 0, splash: 0, rof: 0.7 },
      { dps: 32, range: 8.8, min: 0, splash: 0, rof: 0.7 },
      { dps: 41, range: 9.1, min: 0, splash: 0, rof: 0.65 },
      { dps: 51, range: 9.4, min: 0, splash: 0, rof: 0.6 },
      { dps: 62, range: 9.7, min: 0, splash: 0, rof: 0.6 },
    ],
  },

  mortar: {
    name: '迫击炮', emoji: '🎯', size: [3, 3], maxLevel: 4,
    tag: '防御', desc: '范围溅射，对成群的步兵非常致命，但有射击盲区。',
    /* 【2026-10-19】塔血 +35%（350/430/530/650 → 470/570/700/860）。 */
    up: [
      { g: 280, e: 0, t: 3600,   hp: 470 },
      { g: 840, e: 0, t: 10800,  hp: 570 },
      { g: 2500, e: 0, t: 21600,  hp: 700 },
      { g: 7200, e: 0, t: 57600, hp: 860 },
    ],
    /* 【2026-10-19 平衡重定】dps 22/39/64/100 → 22/34/46/60。
       与另外两座塔不同，**L1 刻意保持 22 不动**：
       单发伤害 = dps × rof，L1 是 22 × 3.0 = 66，刚好低于野蛮人 70 血 ——
       保住「两发才死一个」的开荒节奏（这条是 2026-10-14 定的红线）。
       L2 起单发必然破 70（102 / 129 / 156），这是范围塔「低频高伤」的
       固有形态，属于升级后的合理回报。
       高本从 100 压到 60：2 座满级迫击炮 × 溅射 1.9 格，原值会成片清空兵海。
       【2026-10-19 二轮】L2~L4 +10%（34/46/60 → 37/51/66），
       **L1 仍然保持 22**：单发 66 < 野蛮人 70 血的红线不能破。 */
    def: [
      { dps: 22, range: 10.5, min: 3, splash: 1.6, rof: 3.0 },
      { dps: 37, range: 10.8, min: 3, splash: 1.7, rof: 3.0 },
      { dps: 51, range: 11.1, min: 3, splash: 1.8, rof: 2.8 },
      { dps: 66, range: 11.4, min: 3, splash: 1.9, rof: 2.6 },
    ],
  },

  wall: {
    name: '城墙', emoji: '🧱', size: [1, 1], maxLevel: 5,
    tag: '防御', desc: '阻挡敌军前进，是布局的灵魂。拖动可连续放置。',
    up: [
      { g: 20, e: 0, t: 0,   hp: 300 },
      { g: 40, e: 0, t: 30,  hp: 500 },
      { g: 80, e: 0, t: 180, hp: 800 },
      { g: 160, e: 0, t: 900, hp: 1200 },
      { g: 320, e: 0, t: 3600, hp: 1800 },
    ],
  },

  builderhut: {
    name: '建筑工人小屋', emoji: '🛖', size: [2, 2], maxLevel: 1,
    tag: '核心', desc: '每位建筑工人同时只能负责一个工程。',
    up: [{ g: 150, e: 0, t: 0, hp: 260 }],
  },
};

/* ------------------------------------------------------------------
   兵种
   ------------------------------------------------------------------ */
export const TROOPS = {
  barbarian: {
    name: '野蛮人', emoji: '🪓', unlockBarracks: 1,
    cost: 2, housing: 1, trainTime: 20, hp: 70, dps: 14,
    speed: 2.2, range: 0.9, preference: 'any',
    color: 0xf0b070, desc: '便宜、量大、什么都打。',
  },
  archer: {
    name: '弓箭手', emoji: '🏹', unlockBarracks: 1,
    cost: 4, housing: 1, trainTime: 25, hp: 42, dps: 11,
    speed: 2.6, range: 3.6, preference: 'any',
    color: 0xe07ab0, desc: '远程输出，射程内可越过城墙射击。',
  },
  giant: {
    name: '巨人', emoji: '🗿', unlockBarracks: 2,
    cost: 21, housing: 5, trainTime: 120, hp: 480, dps: 18,
    speed: 1.5, range: 1.0, preference: 'defense',
    color: 0xd0705a, desc: '血厚，专挑防御建筑砸，为后排挡枪。',
  },
  wallbreaker: {
    name: '炸弹人', emoji: '💥', unlockBarracks: 3,
    cost: 50, housing: 2, trainTime: 60, hp: 30, dps: 20,
    speed: 3.0, range: 0.9, preference: 'wall', suicide: true,
    splash: 2.4, splashMult: 15,
    color: 0x6a6a7a, desc: '抱着炸弹冲向城墙，一次炸开一大片。',
  },
};

/* ------------------------------------------------------------------
   任务（成就）
   ------------------------------------------------------------------ */
export const QUESTS = [
  { id: 'q_build3',  name: '初具规模', desc: '建造 3 座建筑', goal: 3,      reward: 30,  emoji: '🏗️' },
  { id: 'q_th2',     name: '蒸蒸日上', desc: '市政厅升到 2 级', goal: 1,    reward: 50,  emoji: '🏛️' },
  { id: 'q_raid',    name: '初次远征', desc: '赢下 1 场进攻', goal: 1,      reward: 40,  emoji: '⚔️' },
  { id: 'q_star5',   name: '百战之师', desc: '累计获得 5 颗星', goal: 5,    reward: 80,  emoji: '⭐' },
  { id: 'q_def6',    name: '铁壁村庄', desc: '拥有 6 座防御建筑', goal: 6,  reward: 60,  emoji: '🛡️' },
  { id: 'q_th3',     name: '一方霸主', desc: '市政厅升到 3 级', goal: 1,    reward: 120, emoji: '👑' },
];

/* ------------------------------------------------------------------
   袭击对手模板（按难度）
   ------------------------------------------------------------------ */
export const RAID_TIERS = [
  { id: 0, name: '荒废哨站', th: 1, loot: 47,  minTH: 1, desc: '几个木栅栏和一座孤零零的炮台。' },
  { id: 1, name: '边境营地', th: 2, loot: 125, minTH: 1, desc: '初具规模的营地，有城墙环绕。' },
  { id: 2, name: '石墙要塞', th: 3, loot: 344, minTH: 2, desc: '厚重的石墙与交叉火力。' },
  { id: 3, name: '熔炉堡垒', th: 4, loot: 813, minTH: 3, desc: '多座迫击炮覆盖全图。' },
  { id: 4, name: '黑曜城塞', th: 5, loot: 1719, minTH: 4, desc: '满级防御的钢铁之城。' },
];

/**
 * 战斗铜板奖励表（**当前已停用**）。
 *
 * ⚠️ 2026-09-30 起 NPC 演练不再发放铜板，服务端 settleBattle 里的
 *    NPC_BATTLE_COIN_REWARD 已置 false，这张表因此不再被任何地方读取。
 *    保留定义是为了将来若重新开放，数值有个明确出处；服务端同名表
 *    （server/src/routes/village.ts RAID_COIN_REWARD）也一并保留。
 *
 *    铜板唯一来源已收敛为「学习」：cards.ts 的 study_card / review_group。
 *    历史理由（供参考）：数值刻意保守，满星打 tier5 是 12×3=36 铜板，
 *    与「学习一天 20~40 铜板」同量级，本意是让战斗成为学习的补充而非替代。
 */
export const RAID_COIN_REWARD = { 0: 1, 1: 2, 2: 4, 3: 7, 4: 12 };

/* ------------------------------------------------------------------ */
export const SAVE_KEY = 'toonvillage.save.v1';

/**
 * 工人数组的**初始占位长度**（不再代表工人数量上限）。
 *
 * ⚠️ 2026-09-30 变更：工人数改为由「建筑工人小屋数量」决定，
 *    见 village.js 的 syncBuilders() / builderCount。
 *    这个常量现在只用于两处「还没读到存档」的时刻：
 *      · 构造函数里给 builders 一个能跑的初值
 *      · load() 里读完 buildings 之前的临时值（紧接着就会被 syncBuilders 校正）
 *    工人上限实际由 MAXCNT.builderhut 决定（各等级均为 2 座 → 最多 2 名工人）。
 */
export const BUILDERS_TOTAL = 2;

/** 计算达成某等级所需的资源 */
export function upCost(type, level) {
  const d = BUILDINGS[type];
  const u = d.up[level - 1];
  return { gold: u.g, elixir: u.e, time: u.t };
}

/**
 * 单座建筑的「学习铜板加成」倍率（不含 max 封顶，封顶由调用方聚合时处理）。
 * 非加成建筑返回 0。注意：这只是本地镜像，服务端有自己的权威副本。
 */
export function effectBonus(type, level) {
  const e = BUILDINGS[type] && BUILDINGS[type].effect;
  if (!e || !e.perLevel) return 0;
  const lv = Math.max(1, Math.min(level || 0, e.perLevel.length));
  return e.perLevel[lv - 1] || 0;
}

/**
 * 整个村庄的学习铜板加成（多座累加后按 max 封顶）。
 * @param {Array<{type:string,level:number}>} buildings
 * @returns {number} 例如 0.14 表示 +14%
 */
export function totalStudyBonus(buildings) {
  const key = 'studyCoinBonus';
  let sum = 0;
  let max = 1.0;
  for (const b of buildings || []) {
    const e = BUILDINGS[b.type] && BUILDINGS[b.type].effect;
    if (!e || e.key !== key) continue;
    sum += effectBonus(b.type, b.level);
    if (typeof e.max === 'number') max = Math.min(max, e.max);
  }
  return Math.min(sum, max);
}

/** 某建筑在某等级的数量上限 */
export function maxCount(type, thLevel) {
  const arr = MAXCNT[type];
  if (!arr) return 99;
  return arr[Math.min(thLevel, arr.length) - 1];
}
/** 把游戏秒格式化成人类可读 */
export function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  if (sec < 60) return sec + '秒';
  const m = Math.floor(sec / 60);
  if (m < 60) return m + '分' + (sec % 60 ? (sec % 60) + '秒' : '');
  const h = Math.floor(m / 60);
  if (h < 24) return h + '小时' + (m % 60 ? (m % 60) + '分' : '');
  return Math.floor(h / 24) + '天' + (h % 24 ? (h % 24) + '小时' : '');
}
/**
 * 「无限铜板」哨兵值 —— 必须与 server/src/lib/coins.ts 的
 * UNLIMITED_COINS、client/src/lib/coins.ts 三处保持一致。
 * 管理员账号的余额由服务端上报成这个数，UI 侧一律渲染成 ∞。
 */
export const UNLIMITED_COINS = 999999999;

/** 大数字缩写 */
export function fmtNum(n) {
  n = Math.floor(n);
  if (n < 10000) return n.toLocaleString('en-US');
  if (n < 1000000) return (n / 1000).toFixed(n < 100000 ? 1 : 0) + '万';
  return (n / 1000000).toFixed(2) + 'M';
}
