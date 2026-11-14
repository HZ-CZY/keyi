/* ============================================================
   village.js — 村庄状态 / 经济 / 建造队列 / 存档
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';
import {
  GRID, TIME_SCALE, BUILDINGS, QUESTS,
  SAVE_KEY, BUILDERS_TOTAL, upCost, maxCount, gridToWorld, totalStudyBonus,
} from './config.js';
import { buildModel, makeCollectBubble, variantOf } from './models.js';
import { sfx } from './audio.js';
import { bridge } from './bridge.js';

/** 建筑等级 → 最大血量 */
export function maxHp(type, level) {
  const d = BUILDINGS[type];
  const u = d.up[Math.min(level, d.up.length) - 1];
  return u.hp;
}

let _uid = 1;

/**
 * 简易存储适配器（无云端时使用）：把 localStorage 包成与 CloudAdapter 一致的 async 接口。
 * 真正的适配器在 main.js 里注入；这里只是兜底，避免单独打开 index.html 时崩溃。
 */
export const plainAdapter = {
  name: 'local',
  async load(key) {
    try {
      const raw = localStorage.getItem(key);
      return { key, data: raw ? JSON.parse(raw) : null, version: 0 };
    } catch (e) { return { key, data: null, version: 0 }; }
  },
  async save(key, data) {
    try { localStorage.setItem(key, typeof data === 'string' ? data : JSON.stringify(data)); return { ok: true, version: 0 }; }
    catch (e) { return { ok: false, version: 0 }; }
  },
  async clear(key) { try { localStorage.removeItem(key); } catch (e) {} },
  async flush() { return { ok: true }; },
};

export class Village {
  constructor(engine) {
    this.engine = engine;

    /** 存档适配器：由 main.js 注入（云端或本地）。默认走本地，保证可独立运行。 */
    this.adapter = plainAdapter;
    /** 云端存档版本号（乐观并发用），本地模式下恒为 0 */
    this._version = 0;

    /**
     * 服务器时钟锚点：{ serverMs, perfMs }。
     *
     * 施工计时以服务器时间为权威（见 nowServer / _startWork）：开工记「完工时刻」endAt，
     * 之后 remaining = endAt − nowServer()。
     *
     * ⚠️ 为什么不用 Date.now()：
     *    Date.now() 直接读设备时钟，玩家把 iPad 时间往前调 2 小时就能瞬间完工。
     *    这里改用**单调时钟** performance.now()（页面打开后的流逝时间，改设备时间不影响），
     *    只把它的「起点」锚定到服务器时间：
     *        nowServer() = serverMs + (performance.now() − perfMs)
     *    这样既在服务器时间轴上，又不受设备时钟改动影响。
     *    页面重开后 performance.now() 归零 → main.js 重新取一次服务器时间重新锚定，
     *    endAt 是绝对服务器时刻，所以关掉页面期间的工期照样算（离线也在走）。
     *
     * 没锚定成功（断网/未登录）时退化为 Date.now() —— 宁可不准，也不能让工期卡死。
     */
    this._clock = { serverMs: 0, perfMs: 0, valid: false };

    /**
     * 资源。
     *
     * ⚠️ 经济模型（2026-09-29 统一）：`gold` 现在是平台真实的「铜板」镜像，
     *    真源是服务端 users.coins，这里只用于 UI 渲染 + 本地乐观预校验。
     *    字段名保留 `gold` 不改 —— `load()` 里是严格版本校验（d.v !== 1 即丢弃），
     *    改字段名会让所有老档的 res 归零、玩家进度全丢。
     *
     *    `elixir` / `gems` 仍是纯游戏内资源，与服务端铜板无关。
     * @type {{gold:number, elixir:number, gems:number}}
     */
    this.res = { gold: 30, elixir: 100, gems: 250 };

    /**
     * 待确认的铜板消费队列（乐观扣款用）。
     *
     * 为什么要有它：点击建造后本地先扣、再异步通知服务端。若此刻断网/杀进程，
     * 这笔钱就「本地已扣、服务端未记」。把队列写进存档，下次进入重放同一 idemKey，
     * 服务端凭 (user_id, idem_key) 主键做幂等，重试既不会漏扣也不会双扣。
     *
     * @type {Array<{idemKey:string, kind:string, amount:number, ref:string, ts:number}>}
     */
    this._pendingSpends = [];
    /** 断网时置位：暂停重试，等网络恢复或下次进入 */
    this._spendBlocked = false;

    /** @type {Array<{id:number,type:string,level:number,gx:number,gz:number,stored:number,work:null|{to:number,left:number,total:number,builder:number}}>} */
    this.buildings = [];
    this.byId = new Map();
    /** 占用表：格 → 建筑 id，-1 为空 */
    this.occ = new Int32Array(GRID * GRID).fill(-1);
    /**
     * 工人占用：null 或 building id。
     *
     * ⚠️ 数组长度**不是** BUILDERS_TOTAL，而是「工人小屋数量」——见 syncBuilders()。
     *    没建工人小屋就没有工人，也就什么都建不了（place/upgrade 都会拦）。
     *    这个长度在每次增删建筑后由 syncBuilders() 校正，所以中途建/拆小屋都生效。
     */
    this.builders = new Array(BUILDERS_TOTAL).fill(null);

    /** 统计 */
    this.stat = { built: 0, raidsWon: 0, stars: 0, defenseCount: 0, battles: 0 };
    this.doneQuests = new Set();

    /**
     * 被打坏的建筑 id 集合（2026-09-30 新增）。
     *
     * 服务端 PVP 结算时按破坏率算好，写进存档的 dmg 字段；客户端只读不改。
     * 损坏的后果：停产、不能升级、外观焦黑；必须花铜板维修（POST /api/village/repair）
     * 才能恢复。老档没有 dmg 字段 → 空集合，等于都没坏。
     * @type {Set<number>}
     */
    this.damaged = new Set();

    /** 模型缓存 */
    this.models = new Map();     // id -> Group
    this.bubbles = new Map();    // id -> Sprite

    this.onChange = null;        // 状态变化回调（UI 刷新）
    this.onToast = null;
    /** 铜板余额变化回调（宿主 HUD 用） */
    this.onWalletChanged = null;
    this._saveT = 0;
    this._dirty = false;
  }

  /* ============================================================
     派生属性
     ============================================================ */
  get townHall() {
    return this.buildings.find((b) => b.type === 'townhall') || null;
  }
  get thLevel() {
    const t = this.townHall;
    return t ? t.level : 1;
  }
  /**
   * 各资源存储上限。
   *
   * ⚠️ gold（铜板）不再有上限：真源是服务端 users.coins，村庄里的储金建筑只是
   *    「游戏内建筑」的象征，不该约束玩家真实资产。返回 Infinity 让所有
   *    `Math.min(cap, x)` 与进度条计算自然退化为「无上限」。
   *    圣水保留原有上限机制。
   */
  get caps() {
    const th = this.thLevel;
    const base = [2000, 5000, 10000, 20000, 36000][Math.min(th, 5) - 1];
    let gold = Infinity, elixir = base;
    for (const b of this.buildings) {
      const d = BUILDINGS[b.type];
      if (!d || !d.store) continue;
      /* 【2026-10-11 修复】施工中的建筑 level 是 0，于是
           d.store[Math.min(0, len) - 1] === d.store[-1] === undefined，
         下一行取 s.res 直接抛
           TypeError: undefined is not an object (evaluating 's.res')
         后果是玩家一进部落就卡在「加载出错」，且因为崩溃时存不了档、
         施工永远完不成，形成永久锁死（用户反馈「还是进不去」即此）。
         修法与 ui.js / barracksInfo / armycamp 保持一致：把等级夹到 [1, len]。
         施工中的建筑按 1 级容量计入（它本来也还没有产出，不影响平衡）。 */
      const lv = Math.max(1, Math.min(Number(b.level) || 1, d.store.length));
      const s = d.store[lv - 1];
      if (!s) continue;
      if (s.res === 'gold') gold = Infinity; else elixir += s.cap;
    }
    return { gold, elixir };
  }

  /* ============================================================
     矿场（2026-10-14 新增）
     ------------------------------------------------------------
     机制：各座矿场**各自累积**，但共享一个总容量。
       总容量 = Σ(每座铜板库的容量)
       总已存 = Σ(每座矿场的 stored)
       总已存 >= 总容量 → 全部矿场一起停产（收取后恢复）
     为什么不是「每座矿场一个独立池」：那样建 3 座矿场就有 3 份容量，
     与「铜板库 1 级只能存 2 天」的设定直接冲突 —— 库才是仓，
     矿场只是往仓里堆东西的机器。
     ============================================================ */

  /** 已建成的矿场（排除施工中；损坏的仍在列表里，由 tick 另行停产） */
  get mineList() {
    return this.buildings.filter((b) => b.type === 'mine' && b.level > 0 && !b.work);
  }

  /** 铜板库座数（UI 展示用） */
  get mineStoreCount() {
    return this.buildings.filter((b) => b.type === 'goldstorage' && b.level > 0).length;
  }

  /**
   * 矿场待收池的**总容量** = Σ 每座铜板库的容量。
   *
   * ⚠️ 等级必须夹到 [1, store.length] —— 施工中的建筑 level 是 0，
   *    `store[-1]` 是 undefined，取 .cap 会抛
   *    TypeError: undefined is not an object。
   *    这正是 2026-10-11「部落一进就白屏」那个 bug 的形态，
   *    当时就栽在 caps getter 的同一处，这里严格照同样的写法夹紧。
   */
  get mineCap() {
    let cap = 0;
    for (const b of this.buildings) {
      const d = BUILDINGS[b.type];
      if (!d || !d.store) continue;
      const lv = Math.max(1, Math.min(Number(b.level) || 1, d.store.length));
      const s = d.store[lv - 1];
      if (s && s.res === 'gold') cap += s.cap;
    }
    return cap;
  }

  /** 所有矿场已累积的待收总量 */
  get mineStored() {
    let n = 0;
    for (const b of this.mineList) n += b.stored;
    return n;
  }

  /** 村庄提供的「学习铜板加成」倍率（本地镜像，权威值在服务端） */
  get studyCoinBonus() {
    return totalStudyBonus(this.buildings);
  }
  get freeBuilders() {
    return this.builders.filter((b) => b === null).length;
  }
  get busyBuilders() {
    return this.builders.length - this.freeBuilders;
  }
  /** 工人总数 = 已建成的工人小屋数量（施工中的不算，建好才上岗） */
  get builderCount() {
    return this.buildings.filter((b) => b.type === 'builderhut' && b.level > 0).length;
  }
  /**
   * 把 builders 数组长度对齐到当前工人小屋数量。
   *
   * 为什么需要「对齐」而不是每次重建数组：工人占用里存的是 building id，
   * 已经开工的工程必须保住它的工人。拆小屋时如果直接截断数组，
   * 正在施工的那座建筑就失去了 builder 指向，完成后 freeBuilders 会错乱。
   * 所以这里是「按需扩/缩」：多退少补，保留仍在施工的占用。
   */
  syncBuilders() {
    /* ⚠️ 用 want = builderCount，**不能**写成 Math.max(1, builderCount)。
       写成后者的话，0 座小屋也有 1 个工人，「要有工人小屋才能建」这条规则就废了。 */
    const want = this.builderCount;
    if (this.builders.length === want) return;

    if (this.builders.length < want) {
      // 扩：空位补 null
      while (this.builders.length < want) this.builders.push(null);
      return;
    }
    // 缩：从尾部开始移除空闲工位，保住施工中的（有 id 的）
    while (this.builders.length > want) {
      let removed = false;
      for (let i = this.builders.length - 1; i >= 0; i--) {
        if (this.builders[i] === null) {
          this.builders.splice(i, 1);
          removed = true;
          break;
        }
      }
      /* 全在忙则拆不下去，宁可多留工位。
         但这样长度就与小屋数量不符了 —— 下次 syncBuilders 会再试一次，
         等施工结束、工位空出来自然会收敛。不会长期不一致。 */
      if (!removed) break;
    }
  }
  /** 军营提供的总容量 */
  get housingTotal() {
    let n = 0;
    for (const b of this.buildings) {
      const d = BUILDINGS[b.type];
      if (!d.army || d.army[0].housing === undefined) continue;
      /* 被打坏的军营不提供容量（修好才恢复） */
      if (this.damaged.has(b.id)) continue;
      /* 施工中的军营 level 还是 0 → d.army[-1] 是 undefined，直接取 .housing 会抛错。
         （老 bug：建军营后马上开「军队」面板必崩。）按 1 级夹住，施工期先给基础容量。 */
      const lv = Math.max(1, Math.min(b.level, d.army.length));
      n += d.army[lv - 1].housing;
    }
    return n;
  }
  /** 兵营提供的训练加速与已解锁兵种 */
  get barracksInfo() {
    let best = 0;
    let speed = 0;
    for (const b of this.buildings) {
      if (b.type !== 'barracks') continue;
      /* 被打坏的兵营不提供训练速度与兵种解锁（修好才恢复） */
      if (this.damaged.has(b.id)) continue;
      best = Math.max(best, b.level);
      /* 施工中的兵营 level 是 0，army[-1] 不存在 —— 老代码在这里必抛错。
         施工期不计入训练速度（best 也仍是 0，所以「军营要先有兵营」不会被提前放行）。 */
      if (b.level < 1) continue;
      speed += BUILDINGS.barracks.army[Math.min(b.level, 3) - 1].speed;
    }
    if (speed === 0) speed = 1;
    const unlock = best > 0 ? BUILDINGS.barracks.army[best - 1].unlock : [];
    return { level: best, speed, unlock };
  }
  /**
   * 服务器时间（毫秒）。施工计时的唯一时间轴。
   *
   * 基于单调时钟 performance.now() 推进，只把起点锚定到服务器时间 ——
   * 所以「改设备时间」对它完全无效（详见构造函数里 _clock 的注释）。
   */
  nowServer() {
    const c = this._clock;
    if (c.valid) return c.serverMs + (performance.now() - c.perfMs);
    return Date.now(); // 未锚定（断网/未登录）：退化为本机时间
  }

  /**
   * 用服务器时间重新锚定时钟。由 main.js（启动 / 网络恢复 / 每 10 分钟）调用。
   * @param {number} serverMs 服务端返回的毫秒时间戳
   * @returns {boolean} 是否接受
   */
  setServerTime(serverMs) {
    const t = Number(serverMs);
    if (!isFinite(t) || t <= 0) return false;
    /* 已经锚定过就别把时间往回拨：重锚定会引入一次网络往返误差（RTT/2），
       而单调时钟本身不会漂 —— 只要往前推，绝不后退。
       只有在还没锚定、或服务器时间确实往前走了较多时才采纳。 */
    if (this._clock.valid) {
      const cur = this.nowServer();
      if (t <= cur) return true; // 服务器没更晚，保持原锚点
    }
    this._clock = { serverMs: t, perfMs: performance.now(), valid: true };
    /* 立刻按新时间轴重算所有在施工地的剩余时间：
       否则要等下一帧 tick 才刷新，看起来像「卡了一下」。 */
    for (const b of this.buildings) {
      if (!b.work) continue;
      const leftMs = b.work.endAt - this.nowServer();
      b.work.left = Math.max(0, leftMs / 1000);
      if (leftMs <= 0) this._finishWork(b);
    }
    return true;
  }

  countOf(type) {
    return this.buildings.filter((b) => b.type === type).length;
  }

  /** 这座建筑是否被打坏（损坏的建筑停产、不能升级） */
  isDamaged(id) { return this.damaged.has(id); }

  /**
   * 维修费（铜板）= 该建筑「重造到当前等级」累计造价的 8%。
   *
   * ⚠️ 必须与服务端 repairCost() 的口径完全一致（同样从造价表求和、同样 8%），
   *    否则会出现「客户端显示 104、服务端扣 100」——虽然服务端是权威、不会扣错，
   *    但玩家看到的价格就是假的。改造价表时两边自动同步（都从同一张表求和）。
   */
  repairCostOf(type, level) {
    const d = BUILDINGS[type];
    if (!d) return 0;
    const lv = Math.max(1, Math.min(Math.floor(Number(level) || 1), d.up.length));
    let acc = 0;
    for (let i = 1; i <= lv; i++) acc += (d.up[i - 1] && d.up[i - 1].g) || 0;
    return Math.max(1, Math.floor(acc * 0.08));
  }

  /** 全村待维修的建筑数（HUD 提示用） */
  get damagedCount() { return this.damaged.size; }

  /**
   * 维修一座被打坏的建筑。
   *
   * 金额由**服务端**按自己的价目表算，客户端只报「修哪一座」；
   * 这里先做一次本地预校验只是为了让「铜板不足」立刻有反馈，
   * 真正的扣费与清除标记都在服务端完成（客户端不可能白修）。
   * @returns {Promise<{ok:boolean, why?:string, cost?:number}>}
   */
  async repair(id) {
    const b = this.byId.get(id);
    if (!b) return { ok: false, why: '建筑不存在' };
    if (!this.damaged.has(id)) return { ok: false, why: '这座建筑没有损坏' };
    const cost = this.repairCostOf(b.type, b.level);
    if (!this.unlimitedRes && this.res.gold < cost) return { ok: false, why: '铜板不足' };
    let r = null;
    try { r = await bridge.repair(id); } catch (e) { r = null; }
    if (!r || !r.ok) return { ok: false, why: (r && r.error) || '维修失败，请检查网络' };
    /* 服务端已经改过存档并 +1 版本：把版本号同步过来，
       免得紧接着的 save() 因为 baseVersion 落后而 409（会弹"其他设备改过"）。 */
    if (typeof r.version === 'number') this._version = r.version;
    if (typeof r.balance === 'number') this.res.gold = r.balance;
    this.damaged.delete(id);
    this._dirty = true;
    this.rebuildModel(id);
    this._emitChange();
    this.save(true);   // 维修同样扣了铜板，必须立即落地
    return { ok: true, cost: typeof r.cost === 'number' ? r.cost : cost };
  }

  /* ============================================================
     网格
     ============================================================ */
  inBounds(gx, gz, w, h) {
    return gx >= 0 && gz >= 0 && gx + w <= GRID && gz + h <= GRID;
  }
  idx(gx, gz) { return gz * GRID + gx; }
  occupantAt(gx, gz) {
    if (gx < 0 || gz < 0 || gx >= GRID || gz >= GRID) return null;
    const id = this.occ[this.idx(gx, gz)];
    return id === -1 ? null : (this.byId.get(id) || null);
  }
  /**
   * 一键修复之后把本地状态对齐。
   *
   * 服务端已经改过存档、清了 dmg，这里只做两件事：
   *   ① 本地 damaged 集合里，不在 remainingIds 中的一律清掉（= 已修好）
   *   ② 对这些建筑重建模型（把「冒烟/破损」外观换回正常）
   * ⚠️ 不碰铜板：余额另有同步链路（onWalletChanged / 服务端回传）。
   * @param {number[]} remainingIds 服务端回传的「仍未修复」建筑 id
   * @returns {number} 本次恢复的建筑数
   */
  applyRepairAll(remainingIds) {
    const keep = new Set((Array.isArray(remainingIds) ? remainingIds : []).map(Number));
    const fixed = [];
    for (const id of Array.from(this.damaged)) {
      if (!keep.has(id)) { this.damaged.delete(id); fixed.push(id); }
    }
    for (const id of fixed) this.rebuildModel(id);
    if (fixed.length) { this._dirty = true; this._emitChange(); }
    return fixed.length;
  }

  /** 能否放置（ignoreId 用于移动自身） */
  canPlace(type, gx, gz, ignoreId = -1) {
    const d = BUILDINGS[type];
    if (!d) return { ok: false, why: '未知建筑' };
    const [w, h] = d.size;
    gx = Math.round(gx); gz = Math.round(gz);
    if (!this.inBounds(gx, gz, w, h)) return { ok: false, why: '超出村庄边界' };
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const o = this.occupantAt(gx + i, gz + j);
        if (o && o.id !== ignoreId) return { ok: false, why: '这里有别的建筑' };
      }
    }
    return { ok: true, gx, gz };
  }
  _occupy(b, val) {
    const [w, h] = BUILDINGS[b.type].size;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        this.occ[this.idx(b.gx + i, b.gz + j)] = val;
      }
    }
  }
  _clearOcc(b) {
    const [w, h] = BUILDINGS[b.type].size;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = this.idx(b.gx + i, b.gz + j);
        if (this.occ[k] === b.id) this.occ[k] = -1;
      }
    }
  }

  /* ============================================================
     资源
     ============================================================ */
  /**
   * 资源写入。
   *
   * 🚫 硬性红线：铜板（res.gold）**绝不**通过本方法增加。
   *    本方法是「游戏内自产」的通用入口（收取气泡、任务奖励、返还…）。
   *    铜板统一后，任何让游戏自产铜板的路径都是印钞机。铜板的合法来源只有两条：
   *      ① 学习所得（服务端 cards.ts 发放，带学识矿脉加成）
   *      ② 战斗奖励（服务端按星级发放，带日上限）
   *    铜板余额的回填只走两条路：`_flushSpend` 用服务端返回的 balance 覆盖，
   *    或 `onWalletChanged` 推送。两条都不经过这里。
   *
   *    留这个断言是因为「以后随手加一行 add('gold', ...)」是极易犯的错，
   *    开发期直接抛错，比上线后被动发现印钞漏洞便宜得多。
   */
  add(res, amount) {
    if (res === 'gold' && amount > 0) {
      const err = '[village] 禁止用 add() 增加铜板，铜板只能由服务端发放';
      console.error(err + `（amount=${amount}）`);
      if (this.onToast) this.onToast('内部错误：非法铜板来源', 'bad');
      return 0;
    }
    const cap = this.caps;
    const before = this.res[res];
    if (cap[res] !== undefined) this.res[res] = Math.min(cap[res], this.res[res] + amount);
    else this.res[res] += amount;
    return this.res[res] - before;
  }
  canAfford(cost) {
    /* 管理员资源无限：任何造价都视为付得起。
       不短路的话，军营这种 200 铜板的建筑会被本地预校验直接拦下 ——
       因为存档里的 res.gold 快照可能只有几十（见 main.js 读档后的回灌）。 */
    if (this.unlimitedRes) return true;
    return this.res.gold >= (cost.gold || 0) && this.res.elixir >= (cost.elixir || 0);
  }

  /**
   * 资源扣费（本地即时生效）。
   *
   * 铜板部分是「乐观扣款」：这里先把 res.gold 减掉，真正的服务端扣费由
   * `_spendCoins()` 异步补上，失败再回滚。圣水是纯游戏内资源，只在本地下账。
   *
   * @param {{gold?:number, elixir?:number}} cost
   * @param {{kind:string, ref:string}} meta 服务端记账所需：kind=build|upgrade，ref="{type}:{level}"
   */
  pay(cost, meta) {
    const gold = cost.gold || 0;
    const elixir = cost.elixir || 0;
    /* 管理员资源无限：本地一分不扣。
       铜板仍照发一次 _spendCoins —— 服务端是唯一能推进权威进度列
       （users.village_th_level / village_mine_level）的地方，跳过它会让
       管理员的建筑等级涨不上去，反而被读档时的锚定压回原级；
       服务端对管理员本就是免费、且返回哨兵值余额。 */
    if (this.unlimitedRes) {
      if (gold > 0 && meta) this._spendCoins(gold, meta.kind, meta.ref);
      return;
    }
    this.res.gold -= gold;
    this.res.elixir -= elixir;
    if (gold > 0 && meta) this._spendCoins(gold, meta.kind, meta.ref);
  }

  /* ------------------------------------------------------------
     铜板消费（乐观扣 + 后台同步 + 失败回滚）
     ------------------------------------------------------------ */
  /**
   * 发起一笔真实的铜板消费。
   *
   * 时序：
   *   1. 生成 idemKey 并入队（入队即持久化，见 serialize）
   *   2. 异步 POST /api/village/withdraw
   *   3a. 成功 → 以服务端返回的权威余额回填 res.gold，出队
   *   3b. 400 铜板不足 → 回滚本地扣款，出队并提示
   *   3c. 401 → 交给 bridge.onAuthLost（会暂停写档），回滚，出队
   *   3d. 网络异常(null) → 不回滚不出队，等下次重试
   *
   * @param {number} amount 铜板数（已按 upCost 算出，非玩家输入）
   * @param {string} kind   build | upgrade
   * @param {string} ref    "{type}:{level}"，服务端据此查表核对真实造价
   */
  _spendCoins(amount, kind, ref) {
    const item = {
      idemKey: bridge.constructor.newIdemKey(),
      kind, amount, ref,
      ts: Date.now(),
    };
    this._pendingSpends.push(item);
    this._dirty = true;
    this._flushSpend(item);
  }

  /** 结算队列里的全部待办（进游戏时、网络恢复时调用） */
  retryPendingSpends() {
    if (this._spendBlocked) return;
    for (const item of this._pendingSpends.slice()) this._flushSpend(item);
  }

  _flushSpend(item) {
    // 未登录 / 单机模式：没有铜板真源可同步，本地记账即可
    if (!bridge.hasToken()) {
      this._removePending(item.idemKey);
      return;
    }

    bridge.spend({ idemKey: item.idemKey, kind: item.kind, amount: item.amount, ref: item.ref })
      .then((res) => {
        if (res && res.ok) {
          /* 成功：服务端返回的是权威余额，直接覆盖本地镜像。
             duplicated:true 表示这次动作之前已经处理过（重试命中幂等），余额同样可信。 */
          if (typeof res.balance === 'number') {
            this.res.gold = res.balance;
            this._emitChange();
          }
          this._removePending(item.idemKey);
          this._dirty = true;
          /* 【2026-11-06 修 P0 · 吞铜板】这里必须 immediate=true。
             云端 adapter.save 默认只标脏并重置 30 秒合并计时器，真正上传
             要等窗口走完。扣费是**服务端立即生效**的，而建筑等级只存在
             这份存档里 —— 玩家在 30 秒内退出/切页（升级后随手关掉是最常见
             的操作），就成了「铜板扣了、建筑没升级」。
             实测案例：刘雨芯 2026-11-02 15:50 升迫击炮 -840，存档未落地，
             连续追了 4 次反馈。改成立即 flush 后，钱与等级同时落库。 */
          this.save(true);
          if (this.onWalletChanged) this.onWalletChanged(this.res.gold);
          return;
        }

        if (res && res.error === '铜板不足') {
          // 服务端判定没钱：本地乐观扣款作废，把钱还回去
          this.res.gold += item.amount;
          this._removePending(item.idemKey);
          this._dirty = true;
          this._emitChange();
          if (this.onToast) this.onToast('铜板不足，建造已取消', 'warn');
          return;
        }

        /* 其它非 2xx（含 400 非法金额、429 限流）：不回滚也不出队。
           这类多是我们自己的 bug 或临时限流，直接回滚会让玩家白赚，
           留着队列下次重试更安全 —— 服务端幂等键保证不会双扣。 */
        this._spendBlocked = true;
        if (this.onToast) this.onToast('铜板同步稍后重试', 'warn');
      })
      .catch(() => {
        // bridge.request 内部已把网络异常吞成 null，这里只是兜底
      });
  }

  _removePending(idemKey) {
    const i = this._pendingSpends.findIndex((x) => x.idemKey === idemKey);
    if (i >= 0) this._pendingSpends.splice(i, 1);
    this._dirty = true;
  }

  /** 网络恢复后清除阻断标记并重试（由 main.js 的 online 事件调用） */
  onNetworkBack() {
    this._spendBlocked = false;
    this.retryPendingSpends();
  }

  /* ============================================================
     放置 / 升级 / 拆除 / 移动
     ============================================================ */
  /**
   * 建造。返回 {ok, why?, id?}
   */
  place(type, gx, gz) {
    const d = BUILDINGS[type];
    if (!d) return { ok: false, why: '未知建筑' };
    if (type === 'townhall' && this.townHall) return { ok: false, why: '市政厅只能有一座' };
    if (type !== 'townhall' && !this.townHall) return { ok: false, why: '请先建造市政厅' };
    /* 军营前置：军营等级不得超过兵营等级（见 upgrade 的同款判断）。
       建军营 = 目标 1 级，所以必须已有 1 座「已建成」的兵营（level ≥ 1；
       正在施工的兵营 level 还是 0，不算数）。 */
    if (type === 'armycamp' && this.barracksInfo.level < 1) {
      return { ok: false, why: '需要先建造兵营' };
    }
    /* 工人小屋是「建造权」本身：一座小屋 = 一名工人。
       没有小屋 → 一个工人都没有 → 什么都建不了（下面那条 freeBuilders 判断）。

       ⚠️ 但**工人小屋自己必须豁免**，否则就是鸡生蛋：
          初始村庄虽自带 1 座，但玩家可以把 2 座都拆掉，之后就永远建不回来了
          —— 那是把账号锁死，比任何经济数值失衡都严重。
          豁免后最坏情况是「花 150 铜板补一座小屋」，总能自救。

       另外：小屋建造耗时 t=0，所以它不受 freeBuilders 限制（下面的判断带 t>0）。 */
    if (this.builderCount === 0 && type !== 'builderhut') {
      return { ok: false, why: '需要先建造建筑工人小屋' };
    }
    if (this.countOf(type) >= maxCount(type, this.thLevel)) {
      return { ok: false, why: `${d.name}已达当前市政厅上限（${maxCount(type, this.thLevel)}座）` };
    }
    const chk = this.canPlace(type, gx, gz);
    if (!chk.ok) return chk;
    if (this.freeBuilders === 0 && d.up[0].t > 0) return { ok: false, why: '没有空闲的建筑工人' };
    const cost = upCost(type, 1);
    if (!this.canAfford(cost)) return { ok: false, why: this.lackReason(cost) };

    this.pay(cost, { kind: 'build', ref: `${type}:1` });
    const b = {
      id: _uid++, type, level: 0, gx: chk.gx, gz: chk.gz,
      stored: 0, work: null, hp: 1,
    };
    this.buildings.push(b);
    this.byId.set(b.id, b);
    this._occupy(b, b.id);

    if (d.up[0].t > 0) {
      this._startWork(b, 1);
    } else {
      b.level = 1;
      b.hp = maxHp(type, 1);
      /* t=0 的建筑（工人小屋是唯一一个）瞬间完工，不会走 _finishWork，
         所以工人数组的同步必须在这里补一次。漏了的话玩家新建小屋后
         要等下次读档才多出工人，看起来像「白花了 150 铜板」。 */
      this.syncBuilders();
    }
    this.stat.built++;
    this._dirty = true;
    this.rebuildModel(b.id);
    this._emitChange();
    /* 立即落库：铜板已经在服务端扣掉了，如果存档还在 30 秒合并窗口里等着，
       玩家这时候关掉 App 就会出现「钱扣了、建筑没了」。这一步是刚需，不是优化。 */
    this.save(true);
    return { ok: true, id: b.id };
  }

  _startWork(b, toLevel) {
    const bi = this.builders.indexOf(null);
    const cost = upCost(b.type, toLevel);
    /* 工期锚定服务器时间：存「完工时刻 endAt」而不是「剩余秒数」。
       好处：①关掉页面/切后台也在走，回来直接是完工状态；
             ②改设备时间无效（时间轴来自 nowServer()）；
             ③多设备切换不会因为各自计时而打架。
       left/total 仍是「秒」，只给 UI 渲染用（fmtTime 按真实秒格式化）。 */
    b.work = {
      to: toLevel,
      left: cost.time,
      total: cost.time,
      endAt: this.nowServer() + cost.time * 1000,
      builder: bi,
      isNew: b.level === 0,
    };
    if (bi >= 0) this.builders[bi] = b.id;
    b.hp = maxHp(b.type, Math.max(1, b.level));
    return b.work;
  }

  upgrade(id) {
    const b = this.byId.get(id);
    if (!b) return { ok: false, why: '建筑不存在' };
    const d = BUILDINGS[b.type];
    if (b.work) return { ok: false, why: '正在施工中' };
    if (b.level >= d.up.length) return { ok: false, why: '已经是最高等级' };
    /* 损坏的建筑不能升级：必须先花钱维修（这是「被打了要付出代价」的核心压力） */
    if (this.damaged.has(id)) return { ok: false, why: '建筑已损坏，需要先维修' };
    if (this.freeBuilders === 0) return { ok: false, why: '没有空闲的建筑工人' };
    /* 军营等级不得超过兵营等级：军营要升到 N 级，兵营至少得先有 N 级。
       （正在施工的兵营 level 仍按现值算，所以「兵营升级中」不会提前放行。） */
    if (b.type === 'armycamp' && this.barracksInfo.level < b.level + 1) {
      return { ok: false, why: `需要兵营达到 ${b.level + 1} 级` };
    }
    const cost = upCost(b.type, b.level + 1);
    if (!this.canAfford(cost)) return { ok: false, why: this.lackReason(cost) };
    // 部分建筑的等级受市政厅限制（防御建筑不得超过市政厅等级）
    if (d.tag === '防御' && b.level + 1 > this.thLevel) {
      return { ok: false, why: `需要市政厅达到 ${b.level + 1} 级` };
    }
    if (b.type !== 'townhall' && b.level + 1 > this.thLevel + 1) {
      return { ok: false, why: `需要市政厅达到 ${b.level} 级` };
    }
    this.pay(cost, { kind: 'upgrade', ref: `${b.type}:${b.level + 1}` });
    this._startWork(b, b.level + 1);
    this._dirty = true;
    this._emitChange();
    this.save(true);   // 同上：扣了钱就必须立刻落地
    return { ok: true };
  }

  /**
   * 管理员是否「资源无限」（铜板 / 圣水 / 宝石）。
   *
   * 判据来自 bridge.unlimited（宿主下发的铜板余额是哨兵值，见
   * server/src/lib/coins.ts 与 client/src/lib/coins.ts）。
   * 独立运行、未登录、或普通账号时恒为 false。
   *
   * ⚠️ 本判据只负责「校验放过 + 本地不扣」，**不去改 res 的真实值**：
   *    圣水与宝石是要写进云存档的字段，灌哨兵值会随存档同步到别的设备。
   */
  get unlimitedRes() {
    return bridge.unlimited === true;
  }

  /**
   * 资源不足时的提示文案（区分铜板 / 圣水）。
   *
   * 原先 place/upgrade 缺任何资源都返回「铜板不足」，但军营这类建筑的
   * 造价是「铜板 + 圣水」（barracks 造价 {g:200, e:17}），缺圣水时
   * 照样显示「铜板不足」，玩家会以为铜板出了问题。
   */
  lackReason(cost) {
    const needG = (cost.gold || 0) > this.res.gold;
    const needE = (cost.elixir || 0) > this.res.elixir;
    if (needG && needE) return '铜板与圣水不足';
    if (needE) return '圣水不足';
    return '铜板不足';
  }

  /** 宝石秒完成 */
  rush(id) {
    const b = this.byId.get(id);
    if (!b || !b.work) return { ok: false, why: '没有正在进行的工程' };
    const cost = Math.max(1, Math.ceil(b.work.left / 60));
    /* 【2026-10-14】管理员宝石无限：跳过校验与扣减。
       ⚠️ res.gems 的真实值保持不动 —— 它是要写进云存档的字段，
          塞一个九位数的哨兵值会被同步到其它设备，等于真把宝石改了。
          「无限」只体现在「消耗不生效」这一层。 */
    const free = this.unlimitedRes;
    if (!free) {
      if (this.res.gems < cost) return { ok: false, why: `需要 ${cost} 宝石` };
      this.res.gems -= cost;
    }
    b.work.left = 0;
    this._finishWork(b);
    this._dirty = true;
    this._emitChange();
    return { ok: true, cost, free };
  }

  _finishWork(b) {
    const w = b.work;
    if (!w) return;
    if (w.builder >= 0) this.builders[w.builder] = null;
    b.level = w.to;
    b.hp = maxHp(b.type, b.level);
    b.stored = 0;
    b.work = null;
    /* 工人小屋造好了 → 工人 +1，必须在这里同步数组长度，
       否则「新建的小屋要等下次读档才生效」，玩家会以为白建了。 */
    this.syncBuilders();
    this.rebuildModel(b.id);
    sfx.done();
    if (this.onToast) this.onToast(`${BUILDINGS[b.type].name} 升至 ${b.level} 级`, 'good');

    /* 关键节点：立即落库 + 上报事件（只做审计，发币金额由服务端决定） */
    this._dirty = true;
    this.save(true);
    if (this.onUpgradeDone) this.onUpgradeDone(b.type, b.level);
  }

  move(id, gx, gz) {
    const b = this.byId.get(id);
    if (!b) return { ok: false, why: '建筑不存在' };
    if (b.work) return { ok: false, why: '施工中无法移动' };
    const chk = this.canPlace(b.type, gx, gz, b.id);
    if (!chk.ok) return chk;
    this._clearOcc(b);
    b.gx = chk.gx; b.gz = chk.gz;
    this._occupy(b, b.id);
    this._dirty = true;
    this.rebuildModel(b.id);
    this._emitChange();
    return { ok: true };
  }

  demolish(id) {
    const b = this.byId.get(id);
    if (!b) return { ok: false, why: '建筑不存在' };
    if (b.type === 'townhall') return { ok: false, why: '市政厅无法拆除' };
    if (b.type === 'builderhut') return { ok: false, why: '建筑工人小屋无法拆除' };
    if (b.work) return { ok: false, why: '施工中无法拆除' };
    const spent = upCost(b.type, Math.max(1, b.level));
    const back = { gold: Math.floor((spent.gold || 0) * 0.3), elixir: Math.floor((spent.elixir || 0) * 0.3) };
    this._clearOcc(b);
    this.buildings = this.buildings.filter((x) => x.id !== id);
    this.byId.delete(id);
    this.destroyModel(id);
    /* 拆掉已损坏的建筑 → 顺带清掉损坏标记，别在存档里留悬空 id
       （服务端的维修接口只认存档里真实存在的建筑，留着也无害，但会脏数据）。 */
    this.damaged.delete(id);
    /* 拆掉工人小屋 → 工人 -1。syncBuilders 会保住正在施工的工位，
       只回收空闲的那个，所以不会出现「拆了小屋，正在盖的楼卡死」。 */
    this.syncBuilders();
    this.add('elixir', back.elixir);
    if (back.gold > 0) this._refundCoins(back.gold, b.type, b.level, id);
    this._dirty = true;
    this._emitChange();
    this.save(true);   // 拆除会改存档结构，同样立即落地
    return { ok: true, back };
  }

  /**
   * 拆除返还铜板。
   *
   * ⚠️ 不能像旧版那样只做本地 `add('gold', back.gold)`。
   *    「金币=铜板」之后，本地加钱等于凭空印钱 —— 反复「造了拆、拆了造」
   *    虽然每次净亏 70%，但只要本地镜像涨了、服务端没记，就产生了裂缝：
   *    一旦玩家借这笔虚增余额去消费，服务端会判定铜板不足，体验直接错乱。
   *
   * 所以返还必须走服务端 `/refund`：金额由服务端按同一张造价表 ×30% 自己算，
   * 客户端只提供「拆了哪座、当时几级」，改不了金额。
   */
  _refundCoins(amount, type, level, instId) {
    if (!bridge.hasToken()) return;   // 单机模式：没有真源，本地记账即可
    /* ⚠️ 必须带 instId（建筑实例 id）。
       服务端靠 (user_id, inst_id) 唯一索引判断「这座是否已退过」；
       少了它服务端直接 400，白丢返还。 */
    bridge.refund({ ref: `${type}:${level}`, instId })
      .then((res) => {
        if (res && res.ok && typeof res.balance === 'number') {
          this.res.gold = res.balance;
          this._emitChange();
          if (this.onWalletChanged) this.onWalletChanged(this.res.gold);
        } else if (!res) {
          // 网络异常：本地先记上，下次进游戏由服务端余额覆盖（差额极小，不阻塞玩法）
        }
      })
      .catch(() => {});
  }

  /* ============================================================
     收取资源
     ============================================================ */
  collect(id) {
    const b = this.byId.get(id);
    if (!b) return null;
    const d = BUILDINGS[b.type];
    if (!d.prod) return null;
    const p = d.prod[Math.min(b.level, d.prod.length) - 1];
    if (!b.level || b.work) return null;
    /* ⚠️ 矿场产的是铜板 —— 铜板绝不能由客户端发放。
       见本文件 add() 里的硬性红线：客户端能算出的铜板数就是一台印钞机
       （改一下 JS 就能无限刷）。所以这里**不落账**，只把「该发多少」
       交给 ui.js 去调服务端 POST /mine/claim 结算，由服务端按时间自己算。 */
    if (p.res === 'gold') {
      const amt = Math.floor(b.stored);
      if (amt <= 0) return null;
      return { res: 'gold', amount: amt, wasted: 0, deferred: true };
    }
    const amount = Math.floor(b.stored);
    if (amount <= 0) return null;
    const got = this.add(p.res, amount);
    b.stored -= amount;
    if (b.stored < 0) b.stored = 0;
    this._dirty = true;
    this._emitChange();
    return { res: p.res, amount: got, wasted: amount - got };
  }

  /**
   * 服务端结算铜板成功后，扣减本地的预估累积量。
   *
   * 为什么用「扣减」而不是「清零」：本地是按帧累加的预估，与服务端按
   * 时间算的结果一定存在秒级偏差。清零会在「服务端算出 0」时把玩家
   * 看得见的那点存量抹掉（气泡消失却没钱到账）；扣减则只认服务端真发出去的数。
   */
  settleMine(id, granted) {
    const b = this.byId.get(id);
    if (!b) return;
    b.stored = Math.max(0, b.stored - (Number(granted) || 0));
    this._dirty = true;
    this._emitChange();
  }

  /** 是否可收取 */
  collectable(id) {
    const b = this.byId.get(id);
    if (!b || !b.level || b.work) return null;
    const d = BUILDINGS[b.type];
    if (!d.prod) return null;
    const p = d.prod[Math.min(b.level, d.prod.length) - 1];
    /* 阈值：原本是「攒到单座上限的 12% 才冒气泡」。矿场沿用同一个
       比例（它的 p.cap 恰是「1 座同等级铜板库」的容量），
       但「是否已满」必须看**全局** —— 单座矿场不知道自己会不会
       被别的矿场挤满，真正决定停产的是「总已存 vs 总容量」。 */
    if (b.stored < p.cap * 0.12) return null;
    const full = b.type === 'mine'
      ? this.mineStored >= this.mineCap - 0.5
      : b.stored >= p.cap - 0.5;
    return { res: p.res, amount: Math.floor(b.stored), full };
  }

  /* ============================================================
     每帧：生产 + 建造计时
     ============================================================ */
  tick(dtReal) {
    const dt = dtReal * TIME_SCALE;
    let changed = false;

    for (const b of this.buildings) {
      const d = BUILDINGS[b.type];
      // 生产（被打坏的建筑停产，修好才恢复）
      if (d.prod && b.level > 0 && !b.work && !this.damaged.has(b.id)) {
        const p = d.prod[Math.min(b.level, d.prod.length) - 1];
        /* 矿场走「各自累积 + 共享总容量」；其余建筑（圣水收集器）仍是
           「单座一个池」。差别的原因：矿场产的是账号级资产（铜板），
           必须由铜板库统一封顶，否则建几座就多几份容量。 */
        if (b.type === 'mine') {
          const room = this.mineCap - this.mineStored;
          if (room > 0) {
            b.stored += Math.min((p.rate / 3600) * dt, room);
            changed = true;
          }
        } else if (b.stored < p.cap) {
          b.stored = Math.min(p.cap, b.stored + (p.rate / 3600) * dt);
          changed = true;
        }
      }
      // 施工：剩余时间由「完工时刻 − 服务器当前时间」现算，不靠帧累加。
      // 帧累加会在切后台/掉帧时丢时间；这样做关掉页面也在走。
      if (b.work) {
        const leftMs = b.work.endAt - this.nowServer();
        b.work.left = Math.max(0, leftMs / 1000);
        if (leftMs <= 0) this._finishWork(b);
        changed = true;
      }
    }

    // 气泡与实际储存同步（每 0.25 秒一次，省性能）
    this._bubT = (this._bubT || 0) + dtReal;
    if (this._bubT > 0.22) { this._bubT = 0; this._syncBubbles(); }

    // 自动存档
    this._saveT += dtReal;
    if (this._saveT > 6) {
      this._saveT = 0;
      if (this._dirty) this.save();
      /* 顺手重试遗留的铜板消费。
         场景：玩家断网点建造 → 本地已扣但没同步上，关掉页面走了。
         下次进入读档恢复队列，这里每 6 秒试一次，网络一通就自动补上。
         服务端幂等键保证重试不会双扣。 */
      if (this._pendingSpends.length && !this._spendBlocked) this.retryPendingSpends();
    }

    if (changed) this._dirty = true;
    return changed;
  }

  /* ============================================================
     任务
     ============================================================ */
  questProgress(q) {
    const s = this.stat;
    switch (q.id) {
      case 'q_build3': return Math.min(s.built, q.goal);
      case 'q_th2':    return this.thLevel >= 2 ? 1 : 0;
      case 'q_raid':   return Math.min(s.raidsWon, q.goal);
      case 'q_star5':  return Math.min(s.stars, q.goal);
      case 'q_def6':   return Math.min(this.buildings.filter((b) => BUILDINGS[b.type].tag === '防御' && b.type !== 'wall').length, q.goal);
      case 'q_th3':    return this.thLevel >= 3 ? 1 : 0;
      default: return 0;
    }
  }
  /** 返回本次新完成的任务 */
  checkQuests() {
    const newly = [];
    for (const q of QUESTS) {
      if (this.doneQuests.has(q.id)) continue;
      if (this.questProgress(q) >= q.goal) {
        this.doneQuests.add(q.id);
        this.res.gems += q.reward;
        newly.push(q);
      }
    }
    if (newly.length) { this._dirty = true; this._emitChange(); }
    return newly;
  }

  /* ============================================================
     模型渲染
     ============================================================ */
  worldPosOf(b) {
    const [w, h] = BUILDINGS[b.type].size;
    const cx = b.gx + (w - 1) / 2;
    const cz = b.gz + (h - 1) / 2;
    return gridToWorld(cx, cz);
  }

  rebuildAll() {
    for (const id of Array.from(this.models.keys())) this.destroyModel(id);
    for (const b of this.buildings) this.rebuildModel(b.id);
    this.syncWalls();
  }

  /**
   * 把已损坏的建筑画成焦黑。
   * 材质必须 clone 之后再改 —— 同类建筑的模型可能共享材质实例，
   * 直接改会让「没被打坏的邻居」一起变黑。
   */
  _applyDamageLook(g) {
    const burn = (m) => {
      const c = m.clone();
      try {
        if (c.color) c.color.multiplyScalar(0.34);
        if (c.emissive) c.emissive.multiplyScalar(0.2);
        if (typeof c.roughness === 'number') c.roughness = Math.min(1, c.roughness + 0.25);
      } catch (e) { /* 材质类型不支持就只保留下沉，不影响游戏 */ }
      return c;
    };
    g.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      o.material = Array.isArray(o.material) ? o.material.map(burn) : burn(o.material);
    });
    g.position.y -= 0.12;   // 轻微下沉，远看也更像「塌了」
  }

  rebuildModel(id) {
    const b = this.byId.get(id);
    if (!b) return;
    this.destroyModel(id);
    if (b.type === 'wall') { this.syncWalls(); return; }

    const lv = Math.max(1, b.level);
    /* 变体按建筑 id 定：同类型的不同建筑长得不一样，重建又能复现 */
    const g = buildModel(b.type, lv, { variant: variantOf(id) });
    /* 被打坏的建筑画成焦黑（见 _applyDamageLook） */
    if (this.damaged.has(b.id)) this._applyDamageLook(g);
    const { x, z } = this.worldPosOf(b);
    g.position.set(x, 0, z);
    g.userData.buildingId = id;
    this.engine.buildingRoot.add(g);
    this.models.set(id, g);

    // 施工中的建筑：半透明 + 升降动画
    if (b.work) {
      g.traverse((o) => {
        if (o.isMesh && !o.userData.isOutline) {
          if (!o.material.userData.__orig) {
            o.material = o.material.clone();
            o.material.userData.__orig = true;
          }
          o.material.transparent = true;
          o.material.opacity = 0.55;
        }
      });
      g.userData.rising = true;
    }

    // 资源气泡
    const d = BUILDINGS[b.type];
    if (d.prod) {
      const sp = makeCollectBubble(d.prod[0].res);
      sp.position.set(x, 3.1, z);
      sp.visible = false;
      this.engine.buildingRoot.add(sp);
      this.bubbles.set(id, sp);
    }
    this.syncWalls();
  }

  destroyModel(id) {
    const g = this.models.get(id);
    if (g) {
      this.engine.buildingRoot.remove(g);
      g.traverse((o) => { if (o.isMesh) o.geometry && o.geometry.dispose && o.geometry.dispose(); });
      this.models.delete(id);
    }
    const sp = this.bubbles.get(id);
    if (sp) { this.engine.buildingRoot.remove(sp); sp.material.dispose(); this.bubbles.delete(id); }
  }

  syncWalls() {
    const walls = this.buildings.filter((b) => b.type === 'wall' && b.level > 0);
    this.engine.wallField.rebuild(walls.map((w) => ({ gx: w.gx, gz: w.gz, level: w.level })));
  }

  _syncBubbles() {
    for (const b of this.buildings) {
      const sp = this.bubbles.get(b.id);
      if (!sp) continue;
      const info = this.collectable(b.id);
      sp.visible = !!info;
    }
  }

  /** 每帧驱动模型动画 */
  animate(t, dt) {
    for (const [id, g] of this.models) {
      const b = this.byId.get(id);
      // 施工中：上下浮动
      if (b && b.work && g.userData.rising) {
        g.position.y = Math.sin(t * 2.4) * 0.06 + 0.06;
      } else if (g.position.y !== 0 && !g.userData.rising) {
        g.position.y = 0;
      }
      const anims = g.userData.anims;
      if (anims) {
        for (const a of anims) {
          const o = a.obj;
          if (!o) continue;
          const p = t * (a.speed || 1) + (a.phase || 0);
          switch (a.type) {
            case 'spinY': o.rotation.y = p; break;
            case 'spinX': o.rotation.x = p; break;
            case 'bob':   o.position.y = (a.base || 0) + Math.sin(p) * (a.amp || 0.1); break;
            case 'pulse': {
              const s = 1 + Math.sin(p) * (a.amp || 0.03);
              o.scale.set(s, 1, s);
              break;
            }
            case 'flicker': {
              const s = 1 + Math.sin(p * 1.7) * (a.amp || 0.2) * 0.5 + Math.sin(p * 3.1) * (a.amp || 0.2) * 0.5;
              o.scale.set(s, 1 / Math.max(0.4, s), s);
              break;
            }
            case 'flag': o.rotation.z = Math.sin(p) * (a.amp || 0.3); break;
            case 'smoke': {
              /* 烟：三团球轮替上升，越高越大越淡。
                 这个分支以前是缺的，于是烟囱上方永远糊着一坨静止的灰球 */
              const kids = o.children;
              for (let i = 0; i < kids.length; i++) {
                const c = kids[i];
                if (c.userData.baseY === undefined) c.userData.baseY = c.position.y;
                const k = (p * 0.5 + i * 0.33) % 1;
                c.position.y = c.userData.baseY + k * 0.95;
                c.scale.setScalar(0.6 + k * 1.2);
                if (c.material) c.material.opacity = Math.max(0, (0.72 - i * 0.18) * (1 - k));
              }
              break;
            }
            case 'drip': {
              /* 滴液：从管口滴落 → 缩小消失 → 回到起点 */
              const k = (p * 0.55) % 1;
              o.position.y = (a.base || 0) - k * (a.amp || 0.2);
              o.scale.setScalar(Math.max(0.15, 1 - k * 0.7));
              break;
            }
          }
        }
      }
      // 气泡上下浮动
      const sp = this.bubbles.get(id);
      if (sp && sp.visible) {
        sp.position.y = 3.1 + Math.sin(t * 2.2 + id) * 0.16;
      }
    }
  }

  /* ============================================================
     事件
     ============================================================ */
  _emitChange() { if (this.onChange) this.onChange(this); }

  /* ============================================================
     初始村庄
     ============================================================ */
  newGame() {
    /* 新号给两座建筑：市政厅 + 一座建筑工人小屋。
       坐标取网格正中：市政厅 4×4、GRID 44 → (44-4)/2 = 20；小屋 2×2 放它右下角。

       ⚠️ 工人小屋是必需的，不是送的福利：
          `place()` 会检查 builderCount，没有小屋就一个工人都没有，
          连第一座小屋自己都建不了 —— 所以它必须在初始村庄里。
          而它又不能拆（demolish 里挡着），否则玩家拆掉小屋会把自己锁死。

       初始资源 0 铜板 / 100 圣水。圣水够建一座兵营(17)或军营(21)，
       但军营还额外要求「先有兵营」（军营等级不得超过兵营等级）。
       铜板全靠学习赚 —— 1 级建筑 90~280 铜板（按定位分档）是刻意的长线目标。 */
    const layout = [
      ['townhall', 20, 20],
      ['builderhut', 25, 25],
    ];
    for (const [type, gx, gz] of layout) {
      const d = BUILDINGS[type];
      const b = {
        id: _uid++, type, level: 1, gx, gz, stored: 0, work: null, hp: maxHp(type, 1),
      };
      this.buildings.push(b);
      this.byId.set(b.id, b);
      this._occupy(b, b.id);
    }
    this.rebuildAll();
    /* 初始布局里已有 1 座工人小屋 → 校正出 1 个工人。
       不校正的话 builders 长度还是 BUILDERS_TOTAL，与新规则不符。 */
    this.syncBuilders();
    this._emitChange();
    // 新档给生产建筑预置约 40% 的初始储量（原来是写死 400，缩放后改为按各自 cap 计算）
    for (const b of this.buildings) {
      const d = BUILDINGS[b.type];
      if (!d.prod) continue;
      const p = d.prod[Math.min(b.level, d.prod.length) - 1];
      b.stored = Math.floor((p.cap || 0) * 0.4);
    }
  }
  /* ============================================================
     存档
     ============================================================ */
  serialize() {
    return JSON.stringify({
      v: 1,
      t: Date.now(),
      res: this.res,
      stat: this.stat,
      quests: Array.from(this.doneQuests),
      builders: this.builders,
      /** 被打坏的建筑 id（服务端写入；客户端只负责原样存回去） */
      dmg: [...this.damaged],
      /**
       * 待确认的铜板消费（乐观扣款的幂等凭据）。
       * 字段名用 `sp` 而不是 `pending` —— 存档是玩家可见的 JSON，
       * 名字存在就好，不必自解释。老档没有这个字段，load() 里缺省成 []。
       */
      sp: this._pendingSpends,
      buildings: this.buildings.map((b) => ({
        i: b.id, y: b.type, l: b.level, x: b.gx, z: b.gz,
        s: Math.round(b.stored * 10) / 10,
        w: b.work ? { to: b.work.to, end: b.work.endAt, total: b.work.total, b: b.work.builder } : null,
      })),
    });
  }

  /**
   * 存档。走适配器（本地或云端），因此是异步的。
   * 云端模式下 adapter.save 只标脏 + 重置合并计时器，不会立刻发请求。
   * @param {boolean} [immediate] true = 立即 flush（用于升级完成等关键节点）
   */
  save(immediate) {
    const payload = JSON.parse(this.serialize());
    this._dirty = false;
    const ret = this.adapter.save(SAVE_KEY, payload, this._version);
    if (ret && typeof ret.then === 'function') {
      ret.then((r) => {
        if (r && r.ok && typeof r.version === 'number') this._version = r.version;
      }).catch(() => {});
    }
    // 关键节点：不等合并窗口，立刻推上去
    if (immediate && this.adapter.flush) {
      const f = this.adapter.flush();
      if (f && typeof f.catch === 'function') f.catch(() => {});
    }
    return ret;
  }

  /** 云端存档版本号（供其他模块读取） */
  get version() { return this._version; }

  /** 是否有存档（异步，因为云端读取是网络 IO） */
  async hasSave() {
    try {
      const r = await this.adapter.load(SAVE_KEY);
      return !!(r && r.data);
    } catch (e) { return false; }
  }

  async clearSave() {
    try {
      await this.adapter.clear(SAVE_KEY);
      this._version = 0;
      this._dirty = false;
    } catch (e) {}
  }

  /** 读档（异步）。@returns {Promise<boolean>} 是否成功载入 */
  async load() {
    let rec;
    try {
      rec = await this.adapter.load(SAVE_KEY);
    } catch (e) { return false; }

    // 兼容两种返回：{ key, data, version } 或直接是字符串
    let d = rec && rec.data !== undefined ? rec.data : rec;
    if (typeof d === 'string') {
      try { d = JSON.parse(d); } catch (e) { return false; }
    }
    if (!d || d.v !== 1) return false;

    this._version = (rec && rec.version) || 0;

    this.res = Object.assign({ gold: 0, elixir: 0, gems: 0 }, d.res);
    this.stat = Object.assign(this.stat, d.stat);
    this.doneQuests = new Set(d.quests || []);
    /* 待确认消费队列：老档没有 sp 字段 → 空数组，行为与从前完全一致 */
    this._pendingSpends = Array.isArray(d.sp) ? d.sp.filter(
      (x) => x && typeof x.idemKey === 'string' && typeof x.amount === 'number'
    ) : [];
    this._spendBlocked = false;
    this.buildings = [];
    this.byId.clear();
    this.occ.fill(-1);
    /* builders 的真正长度在读完 buildings 之后由 syncBuilders() 校正
       —— 它取决于存档里有几座工人小屋。这里先给个能跑的初值。 */
    this.builders = new Array(BUILDERS_TOTAL).fill(null);

    let maxId = 0;
    for (const s of d.buildings || []) {
      /* 存档可能来自旧版本 / 被手改过：未知建筑类型直接跳过，
         否则 BUILDINGS[b.type].size 会在后面的 rebuildAll 里抛异常白屏 */
      if (!BUILDINGS[s.y]) continue;
      const b = { id: s.i, type: s.y, level: s.l, gx: s.x, gz: s.z, stored: s.s || 0, work: null, hp: 1 };
      this.buildings.push(b);
      this.byId.set(b.id, b);
      this._occupy(b, b.id);
      b.hp = maxHp(b.type, Math.max(1, b.level));
      maxId = Math.max(maxId, b.id);
    }
    _uid = maxId + 1;

    /* 工人数组长度 = 存档里的工人小屋数量。
       必须在恢复「谁在施工」之前校正，否则老档（builders 长度可能是旧的固定 2）
       与新档（1 座小屋 → 1 个工人）会对不上，施工中的工程会指向越界工位。 */
    this.syncBuilders();

    for (const s of d.buildings || []) {
      if (!s.w) continue;
      const b = this.byId.get(s.i);
      if (!b) continue;
      b.work = { to: s.w.to, left: s.w.left, total: s.w.total, builder: s.w.b, isNew: b.level === 0 };
      /* 老档只存了 left（剩余秒数），没有完工时刻 endAt —— 迁移成
         「读档这一刻 + 剩余秒数」，让它在本次打开之后继续走完。
         （等于老档的工期在关页面期间不推进，与迁移前行为一致，不占玩家便宜。） */
      if (typeof s.w.end === 'number' && s.w.end > 0) {
        b.work.endAt = s.w.end;
      } else {
        b.work.endAt = this.nowServer() + Math.max(0, Number(s.w.left) || 0) * 1000;
      }
      b.work.left = Math.max(0, (b.work.endAt - this.nowServer()) / 1000);
      if (s.w.b >= 0 && s.w.b < this.builders.length) this.builders[s.w.b] = b.id;
    }
    (d.builders || []).forEach((v, i) => { if (i < this.builders.length) this.builders[i] = v; });

    /* 建筑损坏：只认存档里真实存在的建筑 id。
       （服务端合并时已经过滤过一轮，这里再夹一次 —— 玩家可能在两次读档间拆了建筑。） */
    const aliveIds = new Set(this.buildings.map((b) => b.id));
    this.damaged = new Set((Array.isArray(d.dmg) ? d.dmg : [])
      .map(Number).filter((x) => aliveIds.has(x)));

    this.rebuildAll();
    this._emitChange();
    return true;
  }
}
