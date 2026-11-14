/* ============================================================
   army.js — 部队训练与库存
   ============================================================ */

import { TROOPS } from './config.js';

export const ARMY_KEY = 'toonvillage.army.v1';

/**
 * 离线补算上限（现实秒）。
 *
 * 训练改为「按绝对时间推进」后，存档里只剩一个 `at` 时间戳，
 * 重进游戏时用 `now - at` 还原这段时间。理论上不设上限也能跑，
 * 但存档是客户端可改的 —— 把 at 写成 1970 年就能瞬间练满整条队列。
 * 12 小时足够覆盖「关掉页面 / 关掉浏览器 / 睡一觉」，又不给改档留太大空间。
 */
const MAX_OFFLINE_SEC = 12 * 3600;

export class Army {
  constructor(village) {
    this.village = village;
    /** 已训练待命的部队 */
    this.reserve = { barbarian: 0, archer: 0, giant: 0, wallbreaker: 0 };
    /** 训练队列（游戏秒） */
    this.queue = [];
    this.onChange = null;
    this.onToast = null;
    this._saveT = 0;
    /** 存档版本号（乐观并发），由存档适配器回填 */
    this._version = 0;
  }

  get housingUsed() {
    let n = 0;
    for (const k in this.reserve) n += this.reserve[k] * TROOPS[k].housing;
    for (const q of this.queue) n += TROOPS[q.type].housing;
    return n;
  }
  get housingFree() { return Math.max(0, this.village.housingTotal - this.housingUsed); }
  /** 是否至少有一支部队可以出征 */
  get hasTroops() {
    return Object.values(this.reserve).some((n) => n > 0);
  }
  get totalTroops() {
    return Object.values(this.reserve).reduce((a, b) => a + b, 0);
  }

  unlocked(type) {
    const info = this.village.barracksInfo;
    return info.level > 0 && info.unlock.includes(type);
  }

  canTrain(type) {
    const t = TROOPS[type];
    if (!t) return { ok: false, why: '未知兵种' };
    if (!this.unlocked(type)) return { ok: false, why: '需要更高等级的兵营' };
    if (t.housing > this.housingFree) return { ok: false, why: '军营容量不足' };
    /* 管理员资源无限：跳过圣水校验 */
    if (!this.village.unlimitedRes && this.village.res.elixir < t.cost) return { ok: false, why: '圣水不足' };
    return { ok: true };
  }

  train(type) {
    const chk = this.canTrain(type);
    if (!chk.ok) return chk;
    const t = TROOPS[type];
    if (!this.village.unlimitedRes) {
      this.village.res.elixir -= t.cost;
      /* 圣水是先扣的。必须把村庄档也标脏，否则下面的 flush 只推 army 档，
         村庄里的「圣水已扣」还停在内存里 —— 重进后圣水回来了、兵还在，
         等于白嫖。 */
      this.village._dirty = true;
    }
    /* at = 这一项「开始计时」的绝对时刻。存档会带上它，
       重进游戏时用 now - at 把离线时间补回来。 */
    this.queue.push({ type, left: t.trainTime, total: t.trainTime, at: Date.now() });
    this._emit();
    /* 【2026-11-06 修 P0 · 训练队列丢失】
       原来训练完只 _emit()，落档要等 tick 里那个「每 6 秒且 changed」的节流。
       而圣水是立刻扣的（village.res 变化会被村庄存档带走）——
       于是「点完训练马上退出部落」就成了「圣水扣了、兵没了」，
       反馈 325（何文辉）和 259（刘镇瑄）说的都是这个。
       队列和圣水必须在同一个动作里落地，所以这里把两份存档都立刻推上去。 */
    this.village.save();
    this.save(true);
    return { ok: true };
  }

  /** 取消队列中的某一项并返还圣水 */
  cancel(index) {
    const q = this.queue[index];
    if (!q) return { ok: false, why: '队列项不存在' };
    this.queue.splice(index, 1);
    this.village.add('elixir', Math.floor(TROOPS[q.type].cost * 0.5));
    this._emit();
    /* 同 train()：返还的圣水与队列必须一起落地，否则取消后退出 = 兵没了、圣水也没退 */
    this.village._dirty = true;
    this.village.save();
    this.save(true);
    return { ok: true };
  }

  /**
   * 推进训练队列。
   *
   * 【2026-10-19 按需求「退出部落小兵仍在后台训练」】
   * 原实现是「每帧把 left 减去本帧 dt」——它只在页面活着、且 rAF 在跑的时候
   * 才推进。切到别的页签 / 关掉部落 iframe / 干脆关掉浏览器，时间就白流，
   * 回来时队列停在原处。
   *
   * 现在改成**按墙钟推进**：队列项携带 `at`（上次结算到的绝对时刻），
   * 每次 tick 只结算 `now - at` 这一段时间。于是：
   *   · 页面在前台：等价于原来的逐帧推进（每帧结算几十毫秒）；
   *   · 页面在后台 / 已关闭：下次打开时 `now - at` 就是离线时长，
   *     一次把这段时间补进 left，连续练完多项；
   *   · 服务端不需要参与 —— 队列本来就存在 army 存档里（带 at）。
   *
   * 为什么不再用 dtReal：帧间隔只代表「渲染了多少」，不代表「过了多少时间」。
   * rAF 在后台会被浏览器节流到 1fps 甚至暂停，用 dt 就必然丢时间。
   */
  tick(dtReal) {
    const now = Date.now();
    const speed = this.village.barracksInfo.speed || 1;
    let changed = false;   // 数值有变化（决定是否需要落档）
    let uiTick = false;    // 值得重绘的粒度：跨整秒 或 队列增删
    let done = 0;
    let lastType = '';

    /* 只结算队首：后面的项还没开始计时，at 无意义 */
    const head = this.queue[0];
    if (head) {
      /* 老存档 / 老版本入队的项没有 at：从此刻开始算，不追溯 */
      if (!Number.isFinite(head.at)) head.at = now;

      /* 本次可用的「现实秒」预算，封顶 12 小时 */
      let budget = Math.max(0, (now - head.at) / 1000);
      if (budget > MAX_OFFLINE_SEC) budget = MAX_OFFLINE_SEC;
      /* 立刻把队首结算点推到 now —— 否则下一帧会把这同一段时间再算一次 */
      head.at = now;

      while (this.queue.length && budget > 0) {
        const q = this.queue[0];
        const need = q.left / speed;   // 练完这项还需要多少现实秒
        if (budget >= need) {
          /* 这一项在预算内练完了：扣掉耗时，继续看下一项 */
          budget -= need;
          q.left = 0;
          this.queue.shift();
          this.reserve[q.type] = (this.reserve[q.type] || 0) + 1;
          done++;
          lastType = q.type;
          changed = true;
          uiTick = true;
          if (this.onTrainDone) this.onTrainDone(q.type, 1);
          /* 新队首从现在开始计时（预算里剩下的部分已在上面扣过） */
          if (this.queue.length) this.queue[0].at = now;
        } else {
          const secBefore = Math.ceil(q.left);
          q.left -= budget * speed;
          budget = 0;
          changed = true;
          /* 只有「显示的秒数跨了」才通知 UI —— 保留 2026-10-14 的卡顿修复 */
          if (Math.ceil(q.left) !== secBefore) uiTick = true;
          break;
        }
      }

      /* 一次补算练完多个时不要逐个弹 toast（离线回来会刷屏） */
      if (done === 1) {
        if (this.onToast) this.onToast(`训练完成：${TROOPS[lastType].name}`, 'good');
      } else if (done > 1) {
        if (this.onToast) this.onToast(`训练完成 ${done} 个部队`, 'good');
      }
    }

    this._saveT += dtReal;
    if (this._saveT > 6) { this._saveT = 0; if (changed) this.save(); }
    if (uiTick) this._emit();
    return changed;
  }

  /** 出征：把待命部队冻结成这次战斗可用的数量 */
  takeForBattle() {
    return Object.assign({}, this.reserve);
  }

  /** 战斗结束：扣除已阵亡的部队，返回剩余 */
  applyCasualties(remaining) {
    for (const k in this.reserve) {
      this.reserve[k] = Math.max(0, Math.min(this.reserve[k], remaining[k] || 0));
    }
    this._emit();
    // 关键节点：立即落库，避免打完仗掉线丢部队
    this.save(true);
  }

  _emit() { if (this.onChange) this.onChange(this); }

  /** 存档：走村庄注入的适配器（本地 / 云端），异步 */
  save(immediate) {
    const payload = { reserve: this.reserve, queue: this.queue };
    const ret = this.village.adapter.save(ARMY_KEY, payload, this._version);
    if (ret && typeof ret.then === 'function') {
      ret.then((r) => {
        if (r && r.ok && typeof r.version === 'number') this._version = r.version;
      }).catch(() => {});
    }
    if (immediate && this.village.adapter.flush) {
      const f = this.village.adapter.flush();
      if (f && typeof f.catch === 'function') f.catch(() => {});
    }
    return ret;
  }

  /** 读档（异步）。@returns {Promise<boolean>} */
  async load() {
    try {
      const rec = await this.village.adapter.load(ARMY_KEY);
      let d = rec && rec.data !== undefined ? rec.data : rec;
      if (typeof d === 'string') d = JSON.parse(d);
      if (!d) return false;
      this._version = (rec && rec.version) || 0;
      Object.assign(this.reserve, d.reserve || {});
      this.queue = d.queue || [];
      this._emit();
      return true;
    } catch (e) { return false; }
  }

  clear() {
    this.reserve = { barbarian: 0, archer: 0, giant: 0, wallbreaker: 0 };
    this.queue = [];
    this._version = 0;
    try { this.village.adapter.clear(ARMY_KEY); } catch (e) {}
    this._emit();
  }
}
