// @ts-nocheck
/**
 * 刻忆觉醒（部落）—— 存档校验与「服务端权威进度」原语。
 *
 * ============================================================
 * 为什么需要这个文件（2026-10-01 安全修复）
 * ============================================================
 * 背景漏洞：`POST /api/village/save` 原先对 `data` 内容零校验，只检查
 * key 在白名单里、体积 < 1MB，然后原样落库。而服务端**所有**经济判定都从
 * 这份存档里读 —— 包括：
 *     · readPlayerProgress()  → 学习加成倍率（cards.ts）
 *     · readPlayerProgress()  → 离线收益上限 OFFLINE_CAP_BY_TH
 *     · refreshProfile()      → PVP 匹配画像（th_level / building_cnt / def_cnt）
 *
 * 于是任意登录用户只要构造一份存档（塞一座 `{y:'goldmine', l:5}`）并 POST /save，
 * 就能永久拿到 +20% 学习加成，且完全不用支付 16500 铜板的真实造价。
 *
 * 修复思路分两层，缺一不可：
 *   【第一层 · 贴封条】sanitizeVillageSave() —— 拒绝结构非法的存档。
 *     等级越界、建筑类型不在白名单、坐标超出 GRID、数量超过 MAXCNT 上限
 *     都会让整份存档被拒绝（400），而不是"悄悄改小"——悄悄改小会让玩家
 *     遇到"我明明建了却没了"的诡异手感，直接拒绝至少是可解释的。
 *
 *   【第二层 · 不让它成为唯一真源】progressFromSave() + 双向锚定。
 *     校验再严也可能有漏（以后加新建筑忘了同步 MAXCNT 表格就会漏）。
 *     所以在 users 表里存一份「服务端认定的进度」th_level / mine_level，
 *     取值时用 min(存档等级, 权威等级)，**只降不升**。
 *     即使有人绕过第一层把 l 改成 5，只要权威列还是 1，经济上拿到的仍是 1。
 *     权威列只在服务端能确认真实花费时（/withdraw 成功）前进。
 * ============================================================
 */

/** 服务端认可的建筑类型白名单（与 config.js BUILDINGS 同步） */
export const KNOWN_BUILDINGS = new Set([
  'townhall', 'builderhut',
  'goldmine', 'mine', 'elixircollector', 'goldstorage', 'elixirstorage',
  'barracks', 'armycamp',
  'cannon', 'archertower', 'mortar', 'wall',
]);

/** 等级上限（config.js 里所有建筑都是 5 级） */
export const MAX_LEVEL = 5;

/** 世界格边长（config.js 的 GRID = 44）。坐标必须落在这个范围内。 */
export const GRID = 44;

/**
 * 各建筑在各市政厅等级下的数量上限。
 * ⚠️ 必须与 client/public/village3d/js/config.js 的 MAXCNT 保持一致。
 *    数组下标 = thLevel - 1。townhall 不在此表（全局只允许 1 座，单独判）。
 *
 * 首次开放时这里只放了一部分；后来加了 archertower / mortar。
 * barrel 表里有 `[7, 0]` 这种写法 —— 意思是"该档不允许建造"，0 就是 0。
 */
export const MAXCNT = {
  goldmine:        [2, 3, 4, 5, 6],
  /* 矿场：产出建筑，与客户端 config.js 的 MAXCNT 必须逐位一致，
     否则玩家建好一存就被 400 拒档。 */
  mine:            [1, 1, 2, 2, 3],
  elixircollector: [2, 3, 4, 5, 6],
  goldstorage:     [1, 2, 2, 3, 4],
  elixirstorage:   [1, 2, 2, 3, 4],
  barracks:        [1, 1, 2, 2, 3],
  armycamp:        [1, 1, 2, 3, 3],   /* 【2026-10-19】TH4 由 2 → 3，与客户端 config.js 同步（兵力跟上防御增长） */
  cannon:          [2, 3, 4, 5, 6],
  archertower:     [1, 2, 3, 4, 5],
  mortar:          [0, 1, 2, 2, 3],
  wall:            [25, 50, 75, 100, 125],
  builderhut:      [2, 2, 2, 2, 2],
};

/** 某类型在某 TH 等级的数量上限（不在表里 = 视为 99，宽松兜底） */
export function maxCountOf(type, thLevel) {
  const arr = MAXCNT[type];
  if (!arr) return 99;
  const idx = Math.min(Math.max(1, Math.floor(Number(thLevel) || 1)), arr.length) - 1;
  return Number(arr[idx]) || 0;
}

/**
 * 单份存档允许的最大建筑总数（硬顶，防"造 10 万个"打爆 JSON.parse 与匹配 SQL）。
 * 按 TH5 满配算：6+6+3+4+4+3+3+6+5+3+125+2+1 = 171，留一倍余量取 400。
 */
export const MAX_BUILDINGS_HARD = 400;

/** 存档允许的最大序列化体积（与 POST /save 的 1MB 限制一致） */
export const MAX_SAVE_BYTES = 1024 * 1024;

/**
 * 校验并规范化一份村庄存档。
 *
 * @param {any} data 客户端提交的存档对象（已 JSON.parse）
 * @returns {{ ok: true, data: object, thLevel: number, mineLevel: number, buildings: number }
 *          | { ok: false, reason: string }}
 *
 * 设计取舍：
 *   · **拒绝而不是修正** —— 修正会让玩家看到"我建的房子不见了"，且掩盖了
 *     前端 bug；拒绝会返回明确中文原因，玩家/我们能立刻定位。
 *   · **只认服务端已知字段** —— 未知的 `b.y` 直接算非法（而不是过滤掉），
 *     因为过滤会让"手改档塞私货"变成静默成功，失去了告警价值。
 *   · 施工中（l = 0）是**合法状态**，不拒绝，但算等级时按 0 处理。
 */
export function sanitizeVillageSave(data) {
  if (data === null || data === undefined) {
    // 允许清空存档（客户端 newGame 会这么干）
    return { ok: true, data: null, thLevel: 1, mineLevel: 0, buildings: 0 };
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: '存档必须是一个对象' };
  }

  const list = data.buildings;
  if (list !== undefined && !Array.isArray(list)) {
    return { ok: false, reason: 'buildings 必须是数组' };
  }
  const arr = Array.isArray(list) ? list : [];
  if (arr.length > MAX_BUILDINGS_HARD) {
    return { ok: false, reason: `建筑数量超出上限（${arr.length} > ${MAX_BUILDINGS_HARD}）` };
  }

  // ── 先定 TH 等级：它是校验其它建筑数量的前提 ──────────────
  // 取"存档里市政厅的最高等级"。如果一座市政厅都没有，按 1 处理
  //（初始村庄总是自带一座 TH1；缺了说明档坏了，但不必因此拒整个档）。
  let thLevel = 1;
  let townhallCount = 0;
  for (const b of arr) {
    if (!b || typeof b !== 'object') continue;
    if (b.y !== 'townhall') continue;
    townhallCount++;
    const lv = Math.floor(Number(b.l) || 0);
    if (lv > MAX_LEVEL) return { ok: false, reason: `市政厅等级超出上限（${lv}）` };
    if (lv > thLevel) thLevel = lv;
  }
  if (townhallCount > 1) {
    return { ok: false, reason: `市政厅最多 1 座（收到 ${townhallCount} 座）` };
  }

  // ── 逐座校验 ────────────────────────────────────────────
  const byType = {};
  let mineLevel = 0;
  const seenIds = new Set();

  for (let i = 0; i < arr.length; i++) {
    const b = arr[i];
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      return { ok: false, reason: `第 ${i + 1} 座建筑不是对象` };
    }
    const type = b.y;
    if (typeof type !== 'string' || !KNOWN_BUILDINGS.has(type)) {
      return { ok: false, reason: `第 ${i + 1} 座建筑类型未知：${String(type).slice(0, 32)}` };
    }

    // 等级：0 = 施工中（合法）；1..5 = 已建成；负数 / >5 / 非数字 = 非法
    const rawLv = Number(b.l);
    if (!isFinite(rawLv) || rawLv < 0 || Math.floor(rawLv) !== rawLv) {
      return { ok: false, reason: `第 ${i + 1} 座建筑等级非法：${String(b.l).slice(0, 16)}` };
    }
    if (rawLv > MAX_LEVEL) {
      return { ok: false, reason: `第 ${i + 1} 座建筑等级超出上限：${rawLv}` };
    }

    // 坐标：有限整数且在 [0, GRID-1]
    const x = Number(b.x);
    const z = Number(b.z);
    if (!isFinite(x) || !isFinite(z)) {
      return { ok: false, reason: `第 ${i + 1} 座建筑坐标非法` };
    }
    if (Math.floor(x) !== x || Math.floor(z) !== z) {
      return { ok: false, reason: `第 ${i + 1} 座建筑坐标必须是整数` };
    }
    if (x < 0 || x >= GRID || z < 0 || z >= GRID) {
      return { ok: false, reason: `第 ${i + 1} 座建筑坐标越界（${x},${z}）` };
    }

    // 实例 id：客户端用 `i` 表示；必须是正整数且不重复
    // （重复 id 会让 /repair、/refund 的幂等键失效）
    const id = Number(b.i);
    if (!isFinite(id) || id <= 0 || Math.floor(id) !== id) {
      return { ok: false, reason: `第 ${i + 1} 座建筑缺少合法的实例标识` };
    }
    if (seenIds.has(id)) {
      return { ok: false, reason: `建筑实例标识重复：${id}` };
    }
    seenIds.add(id);

    byType[type] = (byType[type] || 0) + 1;
    if (type === 'goldmine' && rawLv > mineLevel) mineLevel = rawLv;
  }

  // ── 数量上限（按 TH 等级）──────────────────────────────
  for (const type of Object.keys(byType)) {
    const cnt = byType[type];
    const cap = maxCountOf(type, thLevel);
    if (cnt > cap) {
      return {
        ok: false,
        reason: `${type} 数量超出当前市政厅等级上限（${cnt} > ${cap}，TH${thLevel}）`,
      };
    }
  }

  // ── 资源字段：只做范围夹取，不做拒绝 ─────────────────────
  // res 是"展示镜像"，铜板真值始终在 users.coins。夹到非负整数即可，
  // 不因此拒绝整份存档（否则老档里一个 NaN 就让人永远存不上档）。
  const res = {};
  if (data.res && typeof data.res === 'object' && !Array.isArray(data.res)) {
    for (const key of Object.keys(data.res)) {
      const v = Number(data.res[key]);
      res[key] = isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
    }
  }

  return {
    ok: true,
    data: { ...data, buildings: arr, res },
    thLevel: Math.max(1, thLevel),
    mineLevel,
    buildings: arr.length,
  };
}

/**
 * 从存档快速抽出进度（**只在校验通过后调用**）。
 * 与 sanitizeVillageSave 分开是为了让调用点读起来明确：
 * "先验，再取"。
 */
export function progressFromSave(data) {
  let thLevel = 1;
  let mineLevel = 0;
  const list = Array.isArray(data?.buildings) ? data.buildings : [];
  for (const b of list) {
    if (!b) continue;
    const lv = Math.floor(Number(b.l) || 0);
    if (b.y === 'townhall') thLevel = Math.max(thLevel, lv);
    if (b.y === 'goldmine') mineLevel = Math.max(mineLevel, lv);
  }
  return { thLevel: Math.max(1, Math.min(MAX_LEVEL, thLevel)), mineLevel };
}

/**
 * 双向锚定：取存档等级与服务端权威等级的较小值。
 *
 * 为什么取 min 而不是 max：存档是客户端可写的（哪怕有校验，也是"客户端交上来的"），
 * 权威列是服务端自己写的。安全语义要的是"任何一方说低就低"——
 * 这样客户端伪造无法抬高，服务端回过档（比如管理员清理）也能立刻生效。
 *
 * ⚠️ 关键边界：**权威列为 0 表示「尚未初始化」，必须视为"没有意见"**，
 *    退化为完全采信存档。否则老用户（升级前就玩到 TH3）会被压成 0 级 ——
 *    离线收益归零、学习加成为 0，等于凭空被回档。
 *    这个判断必须做在函数内部，不能指望调用方记得先 `|| null`
 *    （回归测试就是这么抓出漏写的：调用方传 0 进来，结果返回 0）。
 *
 * @param {number} saveLevel   存档里读出来的等级
 * @param {number} authLevel   users 表里的权威等级（0/null/undefined = 尚未记录，不参与锚定）
 */
export function anchorLevel(saveLevel, authLevel) {
  const s = Math.max(0, Math.floor(Number(saveLevel) || 0));
  // 未初始化（0）与缺失（null/undefined）同等对待：完全采信存档
  if (authLevel === null || authLevel === undefined) return s;
  const a = Math.max(0, Math.floor(Number(authLevel) || 0));
  if (a === 0) return s;
  return Math.min(s, a);
}
