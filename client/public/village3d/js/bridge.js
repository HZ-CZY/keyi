/* ============================================================
   bridge.js — 与「刻忆」宿主页的通信桥
   ============================================================

   游戏运行在 <iframe> 里，需要一个安全的方式从宿主拿到登录凭证，
   再调用宿主后端接口。本文件负责：

     1. postMessage 握手：iframe 发 village:ready
        → 宿主回 village:auth { token, user, balance, limits }
     2. 带 Authorization 的 fetch 封装（request 方法）
     3. 事件上报 / 钱包查询 / 离线结算 / 扣铜板的语义化接口

   ⚠️ 安全红线（三条，缺一不可）：
     · 发送 postMessage 必须指定 targetOrigin = location.origin，
       绝对不能写 '*'，否则 token 会泄漏给任何嵌入本页的站点。
     · 接收 message 必须校验 event.origin === location.origin。
     · token 只存内存，不写 localStorage / sessionStorage。

   独立运行（不经 iframe，如本地开发直接开 index.html）时：
     握手会超时，此时 hasToken() 恒为 false，
     工厂会退回 LocalAdapter，游戏仍可单机游玩。
   ============================================================ */

import { UNLIMITED_COINS } from './config.js';

/** 握手超时：宿主 8 秒内没回 auth 就认为不在宿主环境里 */
const HANDSHAKE_TIMEOUT_MS = 8000;

/** 允许上报的事件类型白名单（与服务端保持一致） */
const EVENT_TYPES = ['upgrade_done', 'train_done', 'battle_end'];

export class CloudBridge {
  constructor() {
    /** JWT，仅存内存 */
    this._token = null;
    /** 宿主回传的用户信息 */
    this.user = null;
    /** 宿主下发的标签页标识（一个账号只能在一个页面里用，见 authMiddleware） */
    this.tabId = '';
    /** 钱包快照：{ balance, todayStudyEarned, todayGameGranted } */
    this.wallet = null;
    /** 服务端下发的限制参数：{ offlineCapSec, minOfflineSec, ... } */
    this.limits = null;
    /** 宿主是否已回 auth */
    this.ready = false;
    /** 存档冲突回调（由 main.js 挂） */
    this.onConflict = null;
    /** 余额变化回调（由 ui.js 挂） */
    this.onWalletChanged = null;
    /** 登录失效回调（由 main.js 挂，用于提示并暂停写档） */
    this.onAuthLost = null;
    /** 事件上报的待发队列（宿主未就绪时暂存） */
    this._pendingEvents = [];
    /** 宿主要求立即存档的回调（由 main.js 挂） */
    this.onFlushRequest = null;
    /** listen() 是否已挂载（防止重复挂） */
    this._listening = false;
  }

  /**
   * 是否「无限资源」的管理员账号。
   *
   * 判据直接读宿主下发的钱包余额：服务端对管理员统一上报哨兵值
   * UNLIMITED_COINS（见 server/src/lib/coins.ts），所以不必再单独下发角色，
   * 通信协议一个字都不用改。
   *
   * ⚠️ 只在内存里判，绝不写进存档：宝石是写进云存档的客户端资源，
   *    把哨兵值塞进 res.gems 会随存档同步到别的设备。
   * 独立运行（不经 iframe）时 wallet 为 null → 恒为 false。
   */
  get unlimited() {
    return !!this.wallet && this.wallet.balance >= UNLIMITED_COINS;
  }

  /**
   * 挂载常驻监听：握手结束后，继续接收宿主的零散指令。
   * 处理三类：
   *   · village:flush       宿主在切后台/离页时通知游戏立即存档
   *   · village:wallet-push 宿主拉到最新余额后推下来（学习发币、别处消费等）
   *   · village:auth        宿主重复下发 auth（token 刷新）
   */
  listen() {
    if (!this.isEmbedded()) return;
    if (this._listening) return;
    this._listening = true;
    window.addEventListener('message', (ev) => {
      // ⚠️ 必须校验来源
      if (ev.origin !== location.origin) return;
      const msg = ev.data;
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'village:flush' && this.onFlushRequest) {
        try { this.onFlushRequest(); } catch (e) { /* 存档失败不影响离页 */ }
        return;
      }

      /* 宿主推下来的钱包快照。
         数据流：宿主 fetchWallet() → 这里 → onWalletChanged → main.js 写回 res.gold。
         没有这条链路时，玩家在学习页赚了铜板再回到游戏，HUD 还是旧数字。 */
      if (msg.type === 'village:wallet-push') {
        const p = msg.payload || {};
        if (typeof p.balance === 'number') {
          this.wallet = {
            balance: p.balance,
            todayStudyEarned: p.todayStudyEarned || 0,
            todayGameGranted: p.todayGameGranted || 0,
          };
          if (this.onWalletChanged) this.onWalletChanged(this.wallet);
        }
        return;
      }
    });
  }

  /* ------------------------------------------------------------
     状态查询
     ------------------------------------------------------------ */
  /** 是否在宿主 iframe 中且已授权 */
  hasToken() { return !!this._token; }

  /** 是否在线（浏览器层面） */
  isOnline() {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  }

  /** 是否在 iframe 中被宿主嵌入 */
  isEmbedded() {
    try { return window.parent && window.parent !== window; } catch (e) { return false; }
  }

  /* ------------------------------------------------------------
     ① 握手
     ------------------------------------------------------------ */
  /**
   * 发起握手。返回 Promise，resolve(true) 表示拿到 token。
   * 非 iframe 环境 / 宿主未响应 → resolve(false)，游戏退回单机模式。
   */
  handshake() {
    return new Promise((resolve) => {
      if (!this.isEmbedded()) { resolve(false); return; }

      // 宿主可能在 iframe 一挂载就发过 auth（早于本方法执行），
      // 那种「早到的回复」在这里补一次监听是收不到的，所以用重发兜底。
      let settled = false;
      let timer = null;
      let resendTimer = null;

      const finish = (ok) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMsg);
        clearTimeout(timer);
        clearInterval(resendTimer);
        resolve(ok);
      };

      const onMsg = (ev) => {
        // ⚠️ 必须校验来源，否则任意页面都能给我们发伪 token
        if (ev.origin !== location.origin) return;
        const msg = ev.data;
        if (!msg || msg.type !== 'village:auth') return;

        const p = msg.payload || {};
        this._token = p.token || null;
        this.user = p.user || null;
        /* 标签页标识由宿主下发：iframe 的 sessionStorage 与顶层是两份，
           自己生成会得到与宿主不同的值，那就等于把自己判成「另一个页面」。 */
        this.tabId = typeof p.tabId === 'string' ? p.tabId : '';
        this.wallet = p.balance !== undefined
          ? { balance: p.balance, todayStudyEarned: p.todayStudyEarned || 0, todayGameGranted: p.todayGameGranted || 0 }
          : null;
        this.limits = p.limits || null;
        this.ready = !!this._token;

        // 把等待中的事件补发
        this._flushPendingEvents();
        finish(this.ready);
      };

      // 先挂监听再发首包，避免「发完才挂」导致回复丢失
      window.addEventListener('message', onMsg);

      // 每 1.5 秒重发一次 ready，直到收到 auth 或整体超时。
      // 这样无论宿主的监听是早挂还是晚挂，都能收到至少一次 ready。
      //
      // ⚠️ 顺序要紧：必须先把 resendTimer 赋好，再发首包。
      //    因为宿主若已在监听，ping() 会同步把 auth 打回来 → onMsg 同步
      //    调用 finish() → 此时若 resendTimer 还是 null，clearInterval(null)
      //    就等于没清，这个每秒重发的定时器会一直活到页面关闭。
      resendTimer = setInterval(() => this._post('village:ready', { gameVersion: 1 }), 1500);
      this._post('village:ready', { gameVersion: 1 });

      timer = setTimeout(() => finish(false), HANDSHAKE_TIMEOUT_MS);
    });
  }

  /** 向宿主发消息（统一收口，强制指定 targetOrigin） */
  _post(type, payload) {
    if (!this.isEmbedded()) return;
    // ⚠️ 绝不能用 '*'，否则 token 泄漏
    window.parent.postMessage({ type, payload }, location.origin);
  }

  /* ------------------------------------------------------------
     ② fetch 封装
     ------------------------------------------------------------ */
  /**
   * 带 Bearer token 的请求。
   * 统一处理：401 → 通知宿主登录失效；非 JSON → 视为失败。
   * @returns {Promise<any|null>} 失败返回 null（调用方自行降级）
   */
  async request(method, path, body) {
    if (!this._token) return null;
    try {
      const res = await fetch(path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._token}`,
          /* 【2026-10-14】标签页标识（宿主通过 village:auth 下发）——
             服务端据此判定本页是否已被新开的页面接管。 */
          ...(this.tabId ? { 'X-KEYI-TAB': this.tabId } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (res.status === 401) {
        // token 过期 / 被封：暂停写档并通知宿主弹登录
        this._token = null;
        if (this.onAuthLost) this.onAuthLost();
        return null;
      }

      let json = null;
      try { json = await res.json(); } catch (e) { json = null; }

      if (!res.ok) {
        // 409 冲突单独标记，供 CloudAdapter 处理
        if (res.status === 409 && json) {
          return { ok: false, conflict: true, data: json.data, version: json.version };
        }
        return json;
      }
      return json;
    } catch (e) {
      // 网络异常：调用方按失败处理
      return null;
    }
  }

  /* ------------------------------------------------------------
     ③ 语义化接口
     ------------------------------------------------------------ */

  /** 拉取最新钱包快照：铜板余额 + 今日学习所得 + 今日游戏收益 */
  async fetchWallet() {
    const res = await this.request('GET', '/api/village/wallet');
    if (res && res.ok) {
      this.wallet = {
        balance: res.balance || 0,
        todayStudyEarned: res.todayStudyEarned || 0,
        todayGameGranted: res.todayGameGranted || 0,
      };
      if (this.onWalletChanged) this.onWalletChanged(this.wallet);
    }
    return this.wallet;
  }

  /**
   * 校正施工计时的服务器时钟。
   *
   * 施工工期锚定的是「服务器时间」：开工时记下完工时刻 endAt，
   * 之后 remaining = endAt − village.nowServer()。而 nowServer() =
   * 本机 Date.now() + offset，offset 就是这里从 /api/village/time 算出来的。
   *
   * 为什么必须走服务器：客户端自报时间的话，把设备时间往前调就能瞬间完工。
   *
   * 失败时保持 offset = 0（退化成纯本机时间），不影响游戏可玩性 ——
   * 断网时宁可用本机时间，也不能让工期直接卡死。
   *
   * @param {object} [village] 传入则顺便写进去（village.setServerTime）
   * @returns {Promise<boolean>} 是否校正成功
   */
  async syncServerTime(village) {
    const res = await this.request('GET', '/api/village/time');
    const now = res && Number(res.now);
    if (!isFinite(now) || now <= 0) return false;
    this.serverOffset = now - Date.now();
    if (village && typeof village.setServerTime === 'function') village.setServerTime(now);
    return true;
  }

  /**
   * 维修被打坏的建筑。
   * 金额由服务端按自己的维修价目表算，客户端只报「修哪一座」，
   * 改不了价格也刷不出钱（见 server 的 POST /api/village/repair）。
   * @param {number} instId 建筑实例 id
   */
  async repair(instId) {
    return this.request('POST', '/api/village/repair', { instId: Number(instId) });
  }

  /**
   * 未读的「被攻打战报」+ 待修建筑清单。
   *
   * 只返回 status='applied' 的记录 —— 圣水与建筑损坏得先落进存档，
   * 弹窗给的待修清单才对得上玩家看到的村庄。
   * @returns {Promise<{ok:boolean, reports:Array, damaged:Array, totalCost:number,
   *                    balance:number, version:number}|null>}
   */
  async fetchReports() {
    return this.request('GET', '/api/village/reports');
  }

  /** 标记战报已读（ids 省略 = 全部），避免每次进村重复弹 */
  async markReportsSeen(ids) {
    return this.request('POST', '/api/village/reports/seen', { ids: Array.isArray(ids) ? ids : null });
  }

  /**
   * 一键修复全部受损建筑。
   *
   * 服务端从便宜到贵依次修：铜板不够就「能修几座修几座」，
   * 返回 remaining / remainingIds 让客户端把本地损坏标记对齐。
   */
  async repairAll() {
    return this.request('POST', '/api/village/repair-all', {});
  }

  /**
   * 拉取部落开放状态：服务器时间 + 是否开放 + 下次开放时刻 + 今日时段表。
   *
   * 服务端才是权威（不在时段内，所有写操作返回 403 village_closed），
   * 这个接口只让客户端能「提前把人请出去 + 显示倒计时」。
   * 拿不到（断网/未登录）返回 null，调用方应维持现状而不是凭空关门。
   */
  async fetchVillageStatus() {
    const res = await this.request('GET', '/api/village/time');
    return res && res.ok ? res : null;
  }

  /**
   * 上报游戏事件（升级完成 / 训练完成 / 战斗结束）。
   * 只做审计与风控记录，不直接发币 —— 金额一律由服务端决定。
   */
  reportEvent(type, payload) {
    if (EVENT_TYPES.indexOf(type) < 0) return; // 白名单外直接丢弃

    // 宿主还没握手完就先攒着
    if (!this.ready) {
      if (this._pendingEvents.length < 50) this._pendingEvents.push({ type, payload });
      return;
    }
    // 高频事件不必等响应；失败也不影响游戏
    this.request('POST', '/api/village/events', { type, payload });
  }

  _flushPendingEvents() {
    const list = this._pendingEvents.splice(0);
    for (const e of list) this.reportEvent(e.type, e.payload);
  }

  /**
   * 消费铜板（宝石兑换 / 加速等）。
   * 幂等键由调用方生成并持久化，重试不会双扣。
   * @param {{ idemKey:string, kind:string, amount:number, ref?:string }} p
   */
  async spend(p) {
    return this.request('POST', '/api/village/withdraw', {
      idemKey: p.idemKey,
      kind: p.kind,
      amount: p.amount,
      ref: p.ref == null ? null : String(p.ref),
    });
  }

  /**
   * 拆除返还铜板。
   *
   * 为什么不复用 spend 传负数：服务端 /withdraw 对金额做的是「>0 且 ≤ 上限」校验，
   * 允许负数等于把扣费接口变成了发币接口，风险太大。返还是独立的语义
   * （必须对应一座真实存在过的建筑），单独开一条只读校验 + 定额发放的路更安全。
   *
   * @param {{ ref:string }} p ref = "{type}:{level}"，服务端按自己的造价表算 30%
   */
  async refund(p) {
    return this.request('POST', '/api/village/refund', {
      ref: String(p.ref),
      instId: Number(p.instId),
    });
  }

  /* ------------------------------------------------------------
     ③-b PVP：搜索对手 / 开打 / 结算
     ------------------------------------------------------------
     走 HTTP 直连而不是 postMessage：这三个接口都是"请求-响应"语义，
     没必要在宿主页中转一层，也就不用改 handshake 协议。
     ------------------------------------------------------------ */

  /**
   * 拉取可进攻的真人列表。
   * @returns {Promise<{ok, degraded, thSpread, myTh, items}|null>}
   *   失败返回 null —— 调用方会降级到 NPC 演练关卡。
   */
  async fetchOpponents() {
    const r = await this.request('GET', '/api/village/opponents');
    /* 503 PVP_DISABLED：对战整块下线（服务端 PVP_ENABLED=false）。
       这里返回 degraded 形态而不是错误，让调用方直接走 NPC 兜底分支 ——
       对玩家来说「暂时搜不到真人」和「对战没开放」是同一件事，不该弹错误提示。 */
    if (r && r.code === 'PVP_DISABLED') {
      return { ok: true, degraded: true, items: [], disabled: true };
    }
    return r;
  }

  /**
   * 锁定对手并生成村庄快照。
   * @param {number} defenderId
   * @returns {Promise<{snapshotId, defender, layout, loot, expiresAt}|null>}
   *   409 = 对手刚被抢走/护盾中，404 = 对手不存在，均返回 null 由调用方提示。
   */
  async startAttack(defenderId) {
    return this.request('POST', '/api/village/attack/start', {
      defenderId: Number(defenderId),
    });
  }

  /**
   * 换一批对手（服务端扣 10 铜板；匹配池为空时不扣）。
   * @returns {Promise<{ok, items, charged, balance, pvpLeft, pvpMax}|null>}
   */
  /**
   * 收取矿场产出的铜板。
   *
   * 为什么必须走服务端：铜板是账号级资产（users.coins），真源在服务端。
   * 客户端自己把预估数字写进余额 = 印钞机（改一行 JS 就能无限刷）。
   * 所以客户端只负责显示，真正的「该发多少」由服务端按时间算。
   */
  async claimMine() {
    return this.request('POST', '/api/village/mine/claim', {});
  }

  async rerollOpponents() {
    const r = await this.request('POST', '/api/village/opponents/reroll', {});
    /* 与 fetchOpponents 同一处理：整块下线时静默降级，不弹错误 */
    if (r && r.code === 'PVP_DISABLED') {
      return { ok: true, degraded: true, items: [], disabled: true };
    }
    return r;
  }

  /**
   * 上报战斗结果。
   *
   * ⚠️ 不传 stars —— 服务端按 pct + thDead 自己重算。
   *    客户端报星级等于把发币权交给客户端。
   *
   * @param {{snapshotId:number, pct:number, thDead:boolean, durationMs:number}} p
   */
  async finishAttack(p) {
    return this.request('POST', '/api/village/attack/finish', {
      snapshotId: Number(p.snapshotId),
      pct: Math.round(Number(p.pct) || 0),
      thDead: !!p.thDead,
      durationMs: Math.round(Number(p.durationMs) || 0),
    });
  }

  /** 离线收益结算（服务端按 last_seen_at 权威计算，8 小时封顶） */
  async claimOffline() {
    return this.request('POST', '/api/village/offline-claim', {});
  }

  /* ------------------------------------------------------------
     ④ 生成幂等键
     ------------------------------------------------------------ */
  static newIdemKey() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) {}
    // 退化实现（老浏览器）
    return 'idem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
}

/** 全局单例：main.js 与 ui.js 共用 */
export const bridge = new CloudBridge();
