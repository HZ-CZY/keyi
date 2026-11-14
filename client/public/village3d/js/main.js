/* ============================================================
   main.js — 编排层：输入 / 放置 / 战斗流程 / 主循环
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';
import { Engine } from './engine.js';
import { Village } from './village.js';
import { Army } from './army.js';
import { Battle } from './battle.js';
import { BattleQuiz } from './quiz.js';
import { CoinBonus } from './bonus.js';
import { UI } from './ui.js';
import {
  BUILDINGS, GRID, upCost, worldToGrid, gridToWorld, fmtNum, maxCount,
  UNLIMITED_COINS,
} from './config.js';
import { buildModel } from './models.js';
import { sfx, loadSoundPref, setSound, soundEnabled, unlockAudio } from './audio.js';
import { bridge } from './bridge.js';
import { Villagers } from './villagers.js';
import { createStorageAdapter, CLOUD_KEYS } from './storage.js';

/** 画质偏好仍然留在本地（与账号无关的显示设置） */
const QUALITY_KEY = 'toonvillage.quality.v1';

class Game {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.engine = new Engine(this.canvas);
    this.village = new Village(this.engine);
    this.army = new Army(this.village);
    /* 村民 NPC：纯氛围，不参与玩法。数量随市政厅等级增长，
       让「升市政厅」多一个看得见的好处（见 villagers.js）。 */
    this.villagers = new Villagers(this.engine, this.village);
    this.ui = new UI({ village: this.village, army: this.army, actions: this._actions() });

    this.place = null;          // { type, movingId, gx, gz, wallCount, wallCost }
    this.battle = null;
    this._battleHandled = false;
    this._preBattleCam = null;

    /* 输入状态 */
    this.pointers = new Map();
    this.gestured = false;
    this.pinch = null;
    this.lastPaintCell = null;
    this.tapMarker = null;
    this._t = 0;
    /* 帧率看门狗：长时间低帧就自动降一档画质，避免持续卡顿。
       _noAutoQuality 供自检脚本关掉，保证性能测量可复现。 */
    this._noAutoQuality = false;
    this._watch = { low: 0, done: false };

    /** 玩家账号铜板余额（云端模式才有效） */
    this.balance = null;
    /** 是否运行在云端存档模式 */
    this.cloudMode = false;

    /* 部落铜板彩蛋：随机时段冒一枚，答对 +5 铜板（每天上限 25，见 bonus.js） */
    this.bonus = new CoinBonus({
      engine: this.engine,
      village: this.village,
      ui: this.ui,
      bridge,
      isBusy: () => !!this.battle,
    });
    void this.bonus.init();

    this._setupEvents();
    // 启动是异步的：云端存档需要先握手拿 token 再拉存档
    this._boot().catch((e) => {
      console.error('[boot] 启动失败：', e);
      this.ui.loaderProgress(100, '启动失败，请刷新重试');
    });
  }

  /**
   * 拉未读战报 —— 有就弹模态，处理完之前不放行（2026-10-14 按需求）。
   *
   * 判定用「有战报」或「有损坏」二者之一：有人只抢了铜板没打坏建筑（0 星），
   * 那种情况弹窗只展示战报、点「知道了」即可，不需要修复。
   */
  async checkRaidReports() {
    let r = null;
    try { r = await bridge.fetchReports(); } catch (e) { r = null; }
    if (!r || !r.ok) return;
    const hasReports = Array.isArray(r.reports) && r.reports.length > 0;
    const hasDamage = Array.isArray(r.damaged) && r.damaged.length > 0;
    if (!hasReports && !hasDamage) return;
    this.ui.showRaidModal(r);
  }

  /* ============================================================
     启动
     ============================================================ */
  async _boot() {
    this.ui.loaderProgress(12, '正在生成村庄地形…');

    const quality = localStorage.getItem(QUALITY_KEY) || 'high';
    this._quality = quality;
    this.engine.applyQuality(quality);
    loadSoundPref();                       // 音效开关（本地偏好，仍走 localStorage）
    this.ui.loaderProgress(30, '正在连接账号…');

    /* ── ① 与宿主握手，拿 token ── */
    let authed = false;
    try {
      authed = await bridge.handshake();
    } catch (e) { authed = false; }

    /* ── ①-b 校正服务器时钟（施工计时的权威时间轴）──
       必须在读档之前：load() 要用它把存档里的「完工时刻」还原成剩余时间，
       否则本机时钟不准 → 离线进度算错。拿不到就退化为本机时间，不阻塞开局。 */
    if (authed) {
      try { await bridge.syncServerTime(this.village); } catch (e) { /* 降级本机时间 */ }
    }

    /* ── ② 选定存档适配器（云端 / 本地） ── */
    const adapter = createStorageAdapter(bridge);
    this.village.adapter = adapter;
    this.army.village = this.village;      // army 通过 village.adapter 取用
    this.cloudMode = adapter.name === 'cloud';

    if (this.cloudMode) {
      this.ui.loaderProgress(45, '正在同步云端存档…');
      // 云端：一次性把 3 个 key 拉下来
      const ok = await adapter.bootstrap(CLOUD_KEYS);
      if (!ok) {
        // 云端拉取失败 → 降级本地，保证还能玩
        this.cloudMode = false;
        this.village.adapter = createStorageAdapter(null);
      }
    }
    this.ui.loaderProgress(62, '正在构建建筑模型…');

    /* ── ③ 载入存档或开新档 ── */
    let loaded = false;
    let hadSave = false;          // 云端/本地是否「存在」存档（即使解析失败也算有）
    try {
      hadSave = await this.village.hasSave();
      if (hadSave) {
        loaded = await this.village.load();
        if (loaded) await this.army.load();
      }
    } catch (e) {
      console.error('[boot] 读档失败：', e);
      loaded = false;
    }
    if (!loaded) {
      /* ⚠️【2026-10-19 数据安全修复】「有存档但读档失败」时，绝不 clearSave()。
         为什么危险：CloudAdapter.clear() 会用当前 baseVersion 把 data=null 推给服务端，
                     而服务端 version 此刻正好匹配得上 → UPDATE 直接成功 →
                     玩家苦心经营的村庄被永久清空，且不可恢复。
         正确做法：本次只降级为本机镜像开局，云端存档原样保留、等下次重试；
                   仅当「云端本来就没有存档」（新用户开荒）时，才允许正常开新档写云端。 */
      if (hadSave && this.cloudMode) {
        console.warn('[boot] 存档读取失败：已保留云端存档，本次改用本机镜像开局');
        this.village.adapter = createStorageAdapter(null);
        this.cloudMode = false;
        try {
          this.ui.toast('云端存档读取失败，已保留原存档不覆盖，请稍后重试', 'warn');
        } catch (e) { /* toast 尚未就绪也不应阻塞开局 */ }
      } else {
        await this.village.clearSave();
      }
      this.army.clear();
      this.village.newGame();
    }

    /* 【2026-10-14】管理员：读档结束后把权威余额回灌一次。
       顺序是 ① 握手（auth 下发哨兵值余额）→ ③ 读档，而存档里的 res.gold
       是几十铜板的旧快照，会把哨兵值盖掉 —— 于是建造军营（200 铜板）时
       本地预校验判「铜板不足」，实际却根本不该拦。 */
    if (bridge.unlimited) this.village.res.gold = UNLIMITED_COINS;
    this.ui.loaderProgress(84, '正在铺装城墙…');

    /* ── ④ 回调接线 ── */
    this.village.onChange = () => this.ui.renderHUD();
    this.village.onToast = (m, k) => this.ui.toast(m, k);
    this.army.onChange = () => this.ui.renderHUD();
    this.army.onToast = (m, k) => this.ui.toast(m, k);

    // 关键节点上报（只做审计：发币金额由服务端决定，客户端上报的数字不可信）
    this.village.onUpgradeDone = (type, level) => {
      bridge.reportEvent('upgrade_done', { buildingType: type, level });
    };
    this.army.onTrainDone = (type, count) => {
      bridge.reportEvent('train_done', { troop: type, count });
    };

    // 存档冲突提示（别的设备改过）
    bridge.onConflict = () => {
      this.ui.toast('云端存档已在其他设备更新，已同步最新进度', '');
    };
    // 登录失效：暂停写档，避免用空档覆盖云端
    bridge.onAuthLost = () => {
      this.cloudMode = false;
      this.ui.toast('登录已过期，进度暂存本地，请重新登录', 'bad');
    };
    // 余额变化 → 回填村庄镜像 + 刷新 HUD
    bridge.onWalletChanged = (w) => {
      this.balance = w ? w.balance : null;
      /* 把服务端权威余额写回村庄镜像。
         这是铜板在客户端唯一的「加钱」入口（经 add() 走会被拦），
         因为它是服务端下发的权威值，不是游戏自产。 */
      if (w && typeof w.balance === 'number') this.village.res.gold = w.balance;
      this.ui.renderHUD();
    };

    // 存档里的余额镜像同样是宿主/服务端口径，游戏侧也要能反过来通知宿主
    this.village.onWalletChanged = (bal) => {
      this.balance = bal;
      this.ui.renderHUD();
    };

    /* 被攻打战报：未读就弹模态把路拦住，处理完才放行（2026-10-14 按需求）。
       必须放在读档之后 —— 待修清单要从存档的 dmg 里取；
       未登录 / 本地单机模式直接跳过（没有「被攻打」这回事）。 */
    if (bridge.hasToken()) {
      try { await this.checkRaidReports(); } catch (e) { /* 拉不到就不拦人 */ }
    }

    // 网络恢复 → 立刻重试遗留的铜板消费 + 重新校准服务器时钟
    window.addEventListener('online', () => {
      this.village.onNetworkBack();
      bridge.fetchWallet().catch(() => {});
      bridge.syncServerTime(this.village).catch(() => {});
    });

    // 宿主要求立即存档（切后台 / 关闭页面）
    bridge.onFlushRequest = () => {
      this.village.save(true);
      this.army.save(true);
    };
    bridge.listen();

    this.ui.renderHUD();
    this.ui.loaderProgress(100, '准备就绪');

    /* 开放时间守卫：不在时段内就把人请出去（服务端同时会拒绝写操作） */
    this._startOpenHoursWatch();

    /* 被打坏的建筑提示：PVP 结算会在存档里留 dmg 标记，
       进游戏先提醒一句，否则玩家只会看到几座「变黑的房子」不知道要干嘛。 */
    if (this.village.damagedCount) {
      /* 2026-10-14：损坏还附带「免战」—— 修好之前别人打不到你，
         这句必须一起说，否则玩家只会看到几座黑房子，不知道自己现在是安全的。 */
      setTimeout(() => this.ui.toast(
        `你有 ${this.village.damagedCount} 座建筑被打坏：停产且不能升级，修好前别人打不到你`,
        'warn'), 1500);
    }

    if (this.cloudMode) {
      // 拉一次钱包 + 结算离线收益（不阻塞开场动画）
      bridge.fetchWallet().catch(() => {});
      bridge.claimOffline().then((r) => {
        if (r && r.ok && this.cloudMode) this._applyOffline(r);
      }).catch(() => {});
      /* 【2026-11-06】升级落地对账：把「扣了铜板但存档没落地」的消费补回来。
         正常情况下服务端没有待补记录，这里就是一次空查询（几十毫秒）。
         真补上时服务端会 version+1，必须把新版本写回本地，否则紧接着的
         POST /save 会 409 并弹「其他设备改过」。 */
      bridge.request('POST', '/api/village/reconcile', {})
        .then((r) => {
          if (!r || !r.ok) return;
          if (typeof r.version === 'number') this.village._version = r.version;
          /* 服务端补好的等级要同步进本地内存，否则下一次 save 会拿旧等级
             把服务端刚补的覆盖回去。这里只改 l 字段，不动场景模型 ——
             视觉上的等级外观在重进村庄后自然刷新。 */
          if (Array.isArray(r.applied) && r.applied.length) {
            for (const a of r.applied) {
              /* 内存里字段叫 level，序列化时才写成 l —— 这里两个都兜一下 */
              const b = this.village.byId && this.village.byId.get(a.i);
              if (b) { b.level = a.l; b.work = null; }
            }
            this.village._dirty = true;
          }
          if (r.upgraded > 0) this.ui.toast(`已为你补回 ${r.upgraded} 项未落地的升级`, 'good');
          if (r.refunded > 0) this.ui.toast(`已退回 ${r.refunded} 铜板（升级未生效）`, 'good');
          if (r.upgraded > 0 || r.refunded > 0) {
            this.village.save(true);
            bridge.fetchWallet().catch(() => {});
          }
        })
        .catch(() => {});
    }

    /* 离页 / 切后台：强制把待写存档推上去，避免丢档 */
    const flushNow = () => {
      if (!this.village) return;
      /* 【2026-11-06 加固】先 save() 再 flush()。
         只 flush 的话，最多有 6 秒的改动还躺在内存里没进 adapter
         （自动存档是每 6 秒一次），这部分照样会丢 —— 而丢的往往正是
         刚扣完铜板的升级状态。save() 会同步标脏，flush() 才有东西可推。 */
      try { this.village.save(); } catch (e) { /* 存档序列化失败不影响离页 */ }
      if (this.village.adapter && this.village.adapter.flush) {
        this.village.adapter.flush();
      }
    };
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushNow();
    });
    window.addEventListener('pagehide', flushNow);

    // 开场镜头
    this.engine.rig.targetGoal.set(0, 0, 0);
    this.engine.rig.distGoal = 96;
    this.engine.rig.snap();
    setTimeout(() => { this.engine.rig.distGoal = 50; this.ui.hideLoader(); }, 180);
    setTimeout(() => {
      /* 首次进入先弹 4 步引导；看过的人直接落到欢迎提示上 */
      if (this.ui.showGuide()) return;
      if (loaded) this.ui.toast('欢迎回来，村长！', 'good');
      else this.ui.toast('点击「商店」开始建造你的村庄', '');
    }, 1200);

    /* 主循环 */
    let lastReserve = '';
    let lightT = 0;
    this.engine.onUpdate((dt) => {
      this._t += dt;
      this._qualityWatch(dt);

      /* 打烊期间冻结游戏逻辑（覆盖层同时挡住所有点击），
         时段的开始/结束由 _startOpenHoursWatch 的轮询负责恢复。 */
      if (this._closed) return;

      /* 每 10 分钟与服务端对一次时钟。
         长时间挂机时本机时钟会漂移，工期跟着偏；校正后 setServerTime()
         会立刻重算所有在施工地的剩余时间。没登录（本地模式）就跳过。 */
      this._clockT = (this._clockT || 0) + dt;
      if (this._clockT > 600) {
        this._clockT = 0;
        if (bridge.hasToken()) bridge.syncServerTime(this.village).catch(() => {});
      }

      /* 轻量 UI 刷新：每 0.25 秒 */
      lightT += dt;
      if (lightT > 0.25) { lightT = 0; this.ui.tickLight(); }

      if (this.battle) {
        if (!this.battle.over) {
          this.battle.update(dt);
          this.ui.updateBattleHUD(this.battle);
          const key = JSON.stringify(this.battle.reserve) + '|' + this.battle.selected;
          if (key !== lastReserve) {
            lastReserve = key;
            this.ui.renderTroopDock(this.battle);
          }
        } else if (!this._battleHandled && this.battle.result) {
          this._finishBattle(this.battle.result);
        }
      } else {
        this.village.tick(dt);
        this.army.tick(dt);
        this.village.animate(this._t, dt);
        /* 放在 else 分支里：战斗场景用的是另一个 Engine，
           村民不该出现在别人村里，也不该在打仗时继续散步。 */
        this.villagers.update(dt);
      }

      // 放置预览跟随
      if (this.place && this.place.type !== 'wall' && this.place.gx !== undefined) {
        this._refreshGhost();
      }
      // 部署环提示
      if (this.battle && this._deployHint) {
        const r = this._deployHint;
        r.material.opacity = 0.35 + Math.sin(this._t * 4) * 0.2;
      }
    });

    this.engine.start();
  }

  /* ============================================================
     帧率看门狗
     ------------------------------------------------------------
     连续 5 秒低于 36 帧就自动降一档画质（精细 → 均衡 → 流畅），
     每次会话只触发一次，而且一定 toast 告知 —— 不会偷偷把画面变糊。
     开场前 6 秒不计：首帧要编译着色器、上传贴图，天生掉帧。
     ============================================================ */
  _qualityWatch(dt) {
    const p = this.engine.perf;
    if (!p || this._watch.done || this._noAutoQuality) return;
    if (this._t < 6 || this._quality === 'low') return;
    if (p.fps > 0 && p.fps < 36) {
      this._watch.low += dt;
      if (this._watch.low >= 5) {
        this._watch.done = true;
        const nxt = this._quality === 'high' ? 'mid' : 'low';
        const label = { mid: '均衡', low: '流畅' }[nxt];
        this.setQuality(nxt, true);
        this.ui.toast('帧率偏低，已自动切到「' + label + '」（设置里可改回）', 'warn');
      }
    } else {
      this._watch.low = 0;
    }
  }

  /* ============================================================
     动作给 UI 调用
     ============================================================ */
  _actions() {
    return {
      startPlace: (t) => this.startPlace(t),
      placeConfirm: () => this.confirmPlace(),
      placeCancel: () => this.cancelPlace(),
      startMove: (id) => this.startMove(id),
      focusBuilding: (id) => this.focusBuilding(id),
      startBattle: (spec) => this.startBattle(spec),
      quitBattle: () => { if (this.battle) { this.battle.end('quit'); } },
      setQuality: (q) => this.setQuality(q),
      getQuality: () => this._quality,
      getPerf: () => this.engine.perf,
      getSound: () => soundEnabled(),
      setSound: (v) => setSound(v),
      resetGame: () => this.resetGame(),
      showGuide: () => this.ui.showGuide(true),
    };
  }

  setQuality(q, silent) {
    this._quality = q;
    this.engine.applyQuality(q);
    try { localStorage.setItem(QUALITY_KEY, q); } catch (e) {}
    if (!silent) {
      this.ui.toast('画质已切换：' + ({ low: '流畅', mid: '均衡', high: '精细' }[q]), 'good');
    }
  }

  resetGame() {
    // clearSave 是异步的（云端要发 DELETE 类请求），必须等它完成再刷新，
    // 否则页面先 reload，清档请求还没发出去，重新进入又会读回旧档。
    Promise.resolve(this.village.clearSave())
      .catch(() => {})
      .then(() => {
        this.army.clear();
        location.reload();
      });
  }

  focusBuilding(id) {
    const b = this.village.byId.get(id);
    if (!b) return;
    const { x, z } = this.village.worldPosOf(b);
    this.engine.rig.focusOn(x, z, Math.min(this.engine.rig.distGoal, 42));
  }

  /* ============================================================
     放置流程
     ============================================================ */
  /* ============================================================
     开放时间（打烊页）
     ------------------------------------------------------------
     服务端是权威：不在开放时段内，所有写操作返回 403 village_closed。
     客户端这里负责把人「请出去」并说明原因：
       ① 启动时查一次，不在时段内直接盖打烊页；
       ② 每 30 秒复查 —— 时段结束把人踢出来，时段开始自动恢复；
       ③ 打烊期间冻结游戏循环（覆盖层同时挡住所有点击）。
     ============================================================ */
  _startOpenHoursWatch() {
    this._checkOpenHours();
    if (this._openTimer) clearInterval(this._openTimer);
    this._openTimer = setInterval(() => this._checkOpenHours(), 30000);
  }

  async _checkOpenHours() {
    let st = null;
    try { st = await bridge.fetchVillageStatus(); } catch (e) { st = null; }
    /* 拿不到状态（断网/未登录）→ 维持现状，不误伤：
       宁可让人能玩，也不要因为一次请求失败凭空关门。 */
    if (!st) return;
    this._openStatus = st;
    if (st.open) {
      if (this._closed) this._hideClosed();
      /* 【2026-11-06 按需求】打烊前 2 分钟提醒。
         反馈 154（刘镇瑄）：没注意时间，刚点进攻就退出了，兵白派。
         服务端在开放中时 nextOpenAt 指向的就是「本场结束」，直接拿来算剩余。 */
      this._warnClosingSoon(st);
      return;
    }
    if (!this._closed) this._showClosed(st);
    else this._renderClosed(st);
  }

  _warnClosingSoon(st) {
    const endAt = Number(st.nextOpenAt) || 0;
    if (!endAt) return;
    /* 同一场只提醒一次。用「结束时刻」当 key，下一场自然是新 key。 */
    if (this._closeWarnedFor === endAt) return;
    const base = (this.village && this.village.nowServer) ? this.village.nowServer() : (st.now || Date.now());
    const left = endAt - base;
    if (left <= 0 || left > 120000) return;
    this._closeWarnedFor = endAt;
    const mins = Math.max(1, Math.ceil(left / 60000));
    this.ui.toast(`部落还有 ${mins} 分钟打烊，出兵抓紧`, 'warn');
  }

  _showClosed(st) {
    this._closed = true;
    /* 收尾：取消正在放置的建筑、关掉开着的面板，避免打烊页下面还挂着半截操作 */
    try { if (this.cancelPlace) this.cancelPlace(); } catch (e) {}
    try { if (this.ui.closeSheet) this.ui.closeSheet(); } catch (e) {}
    this._renderClosed(st);
    if (this._closeTick) clearInterval(this._closeTick);
    /* 每秒刷新倒计时。倒计时用 village.nowServer() 推算（服务器时间轴），
       所以改设备时间也不会把倒计时改花。 */
    this._closeTick = setInterval(() => this._renderClosed(this._openStatus), 1000);
  }

  _hideClosed() {
    this._closed = false;
    if (this._closeTick) { clearInterval(this._closeTick); this._closeTick = null; }
    if (this._closedLayer) this._closedLayer.style.display = 'none';
  }

  _renderClosed(st) {
    if (!st) return;
    let el = this._closedLayer;
    if (!el) {
      el = document.createElement('div');
      el.id = 'village-closed';
      el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:linear-gradient(180deg,#16203f 0%,#0b1024 100%);color:#e9edff;overflow:auto;box-sizing:border-box;padding:22px;font-family:inherit;-webkit-overflow-scrolling:touch';
      document.body.appendChild(el);
      this._closedLayer = el;
    }
    el.style.display = 'block';

    /* 剩余时间：优先用服务器时间轴，未锚定时退回响应里的 now */
    const base = (this.village && this.village.nowServer) ? this.village.nowServer() : (st.now || Date.now());
    const left = Math.max(0, (st.nextOpenAt || 0) - base);
    const pad = (n) => String(n).padStart(2, '0');
    const clock = `${pad(Math.floor(left / 3600000))}:${pad(Math.floor(left / 60000) % 60)}:${pad(Math.floor(left / 1000) % 60)}`;
    const at = st.nextOpenAt ? new Date(st.nextOpenAt) : null;
    const atText = at ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : '—';
    const wins = Array.isArray(st.windows) ? st.windows : [];

    el.innerHTML = `
      <div style="max-width:420px;margin:6vh auto 0;text-align:center">
        <div style="font-size:56px;line-height:1">⛺</div>
        <h1 style="font-size:22px;font-weight:800;margin:14px 0 6px">部落打烊啦</h1>
        <p style="font-size:14px;color:#9aa6d0;margin:0 0 18px">部落只在课间开放，休息一下吧～</p>
        <div style="background:rgba(255,255,255,.08);border-radius:16px;padding:16px;margin-bottom:14px">
          <div style="font-size:12px;color:#9aa6d0;margin-bottom:6px">距离下次开放</div>
          <div style="font-size:32px;font-weight:800;letter-spacing:1px;font-variant-numeric:tabular-nums">${clock}</div>
          <div style="font-size:12px;color:#9aa6d0;margin-top:8px">下一场：${atText}</div>
        </div>
        <div style="background:rgba(255,255,255,.06);border-radius:16px;padding:14px;text-align:left">
          <div style="font-size:12px;color:#9aa6d0;margin-bottom:8px">开放时间</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${wins.map((w) => `<span style="font-size:12px;padding:4px 8px;border-radius:8px;background:rgba(255,255,255,.10)">${w}</span>`).join('')}
          </div>
        </div>
        <p style="font-size:12px;color:#7b86ad;margin-top:16px;line-height:1.6">
          施工中的建筑会照常计时，开放后来收就行。<br>本页会自动刷新，到点自动进入。
        </p>
      </div>`;
  }

  startPlace(type) {
    if (this.battle) return;
    const d = BUILDINGS[type];
    if (!d) return;

    /* 军营前置：需要先有兵营（军营等级不得超过兵营等级，
       权威判断在 village.place()/upgrade()，这里只是提前给个提示） */
    if (type === 'armycamp' && this.village.barracksInfo.level < 1) {
      this.ui.toast('需要先建造兵营', 'warn');
      return;
    }

    // 城墙：连续涂刷模式
    if (type === 'wall') {
      this.place = { type, movingId: null, wallCount: 0, wallCost: 0 };
      this.ui.hideSelect();
      this.ui.showPlaceBar('放置城墙', '滑动手指连续放置');
      this.ui.setPlaceHint(`已放置 0 段 · 花费 0`);
      this.engine.gridOverlay.visible = true;
      this.lastPaintCell = null;
      return;
    }

    if (this.village.freeBuilders === 0 && d.up[0].t > 0) {
      this.ui.toast('没有空闲的建筑工人', 'warn');
      return;
    }
    if (type !== 'townhall' && this.village.countOf(type) >= maxCount(type, this.village.thLevel)) {
      this.ui.toast(`${d.name}已达上限`, 'warn');
      return;
    }

    this.place = { type, movingId: null };
    this.engine.gridOverlay.visible = true;
    this.ui.hideSelect();
    this.ui.showPlaceBar(d.name, '拖动调整位置');

    // 生成半透明预览模型
    this._makeGhost(type, 1);

    // 默认摆在村庄中心附近
    const g = worldToGrid(this.engine.rig.target.x, this.engine.rig.target.z);
    this._setPlaceCell(clampCell(g.gx - Math.floor(d.size[0] / 2)), clampCell(g.gz - Math.floor(d.size[1] / 2)));
  }

  startMove(id) {
    if (this.battle) return;
    const b = this.village.byId.get(id);
    if (!b) return;
    this.place = { type: b.type, movingId: id };
    this.engine.gridOverlay.visible = true;
    this.ui.hideSelect();
    this.ui.showPlaceBar(BUILDINGS[b.type].name, '拖动到新位置');
    this._makeGhost(b.type, b.level);
    this._setPlaceCell(b.gx, b.gz);
  }

  _makeGhost(type, level) {
    if (this.ghost) { this.engine.previewRoot.remove(this.ghost); this.ghost = null; }
    const g = buildModel(type, level);
    g.traverse((o) => {
      if (o.isMesh && !o.userData.isOutline) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.62;
        o.material.depthWrite = false;
        o.castShadow = false;
      }
      if (o.userData.isOutline) o.visible = false;
    });
    this.ghost = g;
    this.engine.previewRoot.add(g);
  }

  _setPlaceCell(gx, gz) {
    if (!this.place) return;
    const d = BUILDINGS[this.place.type];
    gx = Math.max(0, Math.min(GRID - d.size[0], Math.round(gx)));
    gz = Math.max(0, Math.min(GRID - d.size[1], Math.round(gz)));
    this.place.gx = gx; this.place.gz = gz;
    const chk = this.village.canPlace(this.place.type, gx, gz, this.place.movingId || -1);
    this.place.valid = chk.ok;
    this.engine.showFootprint(gx, gz, d.size[0], d.size[1], chk.ok);
    if (!chk.ok) this.ui.setPlaceHint(chk.why);
    else this.ui.setPlaceHint('拖动调整位置');
  }

  _refreshGhost() {
    if (!this.ghost || !this.place) return;
    const d = BUILDINGS[this.place.type];
    const cx = this.place.gx + (d.size[0] - 1) / 2;
    const cz = this.place.gz + (d.size[1] - 1) / 2;
    const { x, z } = gridToWorld(cx, cz);
    this.ghost.position.set(x, 0.02, z);
  }

  confirmPlace() {
    if (!this.place) return;
    const p = this.place;
    const d = BUILDINGS[p.type];

    /* 城墙是「拖动连续刷」的，不在这里落单座建筑。
       ⚠️ 但**移动**城墙必须放行（p.movingId 有值）——
       否则玩家点「移动」拖到新位置后，这里会 toast 一句「本次放置 0 段城墙」
       然后取消，城墙一动不动，看起来就是「城墙不能移动」。 */
    if (p.type === 'wall' && !p.movingId) {
      this.ui.toast(`本次放置 ${p.wallCount} 段城墙`, p.wallCount ? 'good' : '');
      this.cancelPlace();
      return;
    }
    if (!p.valid) {
      const chk = this.village.canPlace(p.type, p.gx, p.gz, p.movingId || -1);
      this.ui.toast(chk.why || '无法放置', 'warn');
      return;
    }

    let r;
    if (p.movingId) r = this.village.move(p.movingId, p.gx, p.gz);
    else r = this.village.place(p.type, p.gx, p.gz);

    if (!r.ok) { this.ui.toast(r.why || '无法放置', 'warn'); return; }

    sfx.build();
    this.ui.toast(p.movingId ? '已移动' : `开始建造 ${d.name}`, 'good');
    this._checkQuests();
    this.cancelPlace();
    if (r.id) this.focusBuilding(r.id);
  }

  cancelPlace() {
    this.place = null;
    this.lastPaintCell = null;
    if (this.ghost) { this.engine.previewRoot.remove(this.ghost); this.ghost = null; }
    this.engine.hideFootprint();
    this.engine.gridOverlay.visible = false;
    this.ui.hidePlaceBar();
    this.ui.renderHUD();
  }

  /* 城墙涂刷 */
  _paintWall(clientX, clientY) {
    if (!this.place || this.place.type !== 'wall') return;
    const p = this.engine.screenToGround(clientX, clientY);
    if (!p) return;
    const g = worldToGrid(p.x, p.z);
    if (g.gx === this.lastPaintCell?.gx && g.gz === this.lastPaintCell?.gz) return;
    this.lastPaintCell = g;

    if (this.village.occupantAt(g.gx, g.gz)) return;
    if (this.village.countOf('wall') >= maxCount('wall', this.village.thLevel)) {
      this.ui.toast('城墙已达当前市政厅上限', 'warn');
      return;
    }
    if (this.village.freeBuilders === 0) { this.ui.toast('没有空闲的建筑工人', 'warn'); return; }
    const cost = upCost('wall', 1);
    if (!this.village.canAfford(cost)) { this.ui.toast('铜板不足', 'warn'); return; }

    const r = this.village.place('wall', g.gx, g.gz);
    if (r.ok) {
      this.place.wallCount++;
      this.place.wallCost += cost.gold;
      this.ui.setPlaceHint(`已放置 ${this.place.wallCount} 段 · 花费 ${fmtNum(this.place.wallCost)}`);
      this._checkQuests();
    }
  }

  /* ============================================================
     输入
     ============================================================ */
  _setupEvents() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    /* 桌面滚轮缩放。缺了它，鼠标用户只能平移，缩放完全没手感。
       指数映射保证「每格滚轮 ≈ 同样比例」，且在两端夹紧避免一格飞到底。 */
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.pow(1.0018, e.deltaY);
      this.engine.rig.zoomBy(Math.min(1.25, Math.max(0.8, f)));
    }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    /* 阻止画布滚动/回弹，但要放行面板内部的滚动。
       之前全局 preventDefault，导致 iPad 上底部面板的内容滚不动。 */
    document.addEventListener('touchmove', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('.sheet-inner, .sel-panel, .toast-stack, .modal-card')) return;
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    c.addEventListener('pointerdown', (e) => {
      unlockAudio();            // iOS：AudioContext 必须在用户手势里创建/恢复
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, {
        x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY,
        t: performance.now(), moved: false,
        rot: e.button === 2,        // 右键拖动 = 旋转视角（桌面）
      });
      if (this.pointers.size === 1) this.gestured = false;
      if (this.pointers.size >= 2) {
        this.gestured = true;
        this._beginPinch();
      }
      // 放置模式下按住即开始涂墙
      /* ⚠️ `!this.place.movingId`：移动单座城墙时 place.type 也是 'wall'，
         若这里不排除，拖动会变成「沿途不停新画墙」而不是移动那一段。 */
      if (this.pointers.size === 1 && this.place && this.place.type === 'wall'
          && !this.place.movingId) {
        this._paintWall(e.clientX, e.clientY);
      }
    });

    c.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 9) p.moved = true;

      if (this.pointers.size >= 2) { this._updatePinch(); return; }

      /* 移动城墙时不走涂墙，交给下面的普通拖动分支处理 */
      if (this.place && this.place.type === 'wall' && !this.place.movingId) {
        this._paintWall(e.clientX, e.clientY); return;
      }

      if (this.place) {
        const gp = this.engine.screenToGround(e.clientX, e.clientY);
        if (gp) {
          const g = worldToGrid(gp.x, gp.z);
          const d = BUILDINGS[this.place.type];
          this._setPlaceCell(g.gx - Math.floor(d.size[0] / 2), g.gz - Math.floor(d.size[1] / 2));
        }
        return;
      }

      if (p.rot) {
        /* 右键拖动：横向转视角、纵向调俯角，和双指旋转是同一套 rig 目标值 */
        this.engine.rig.rotateBy(dx * 0.0075);
        this.engine.rig.tiltBy(dy * 0.0042);
        return;
      }
      if (p.moved) this.engine.rig.panByPixels(dx, dy);
    });

    const up = (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (!p) return;
      const quick = performance.now() - p.t < 520;
      if (!p.moved && quick && !this.gestured) this._onTap(e.clientX, e.clientY);
      if (this.pointers.size === 0) this.gestured = false;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);

    window.addEventListener('keydown', (e) => {
      /* 战报弹窗期间吞掉所有键盘输入 —— 遮罩只能拦住指针事件，
         键盘是挂在 window 上的，必须在这里主动挡（弹窗处理完才放行）。 */
      if (this.ui.blocking) return;
      if (e.key === 'Escape') {
        if (this.place) this.cancelPlace();
        else this.ui.closeSheet();
      }
    });
  }

  _beginPinch() {
    const pts = Array.from(this.pointers.values()).slice(0, 2);
    this.pinch = {
      d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      a: Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x),
    };
  }

  _updatePinch() {
    const pts = Array.from(this.pointers.values()).slice(0, 2);
    if (pts.length < 2) return;
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const a = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
    if (!this.pinch) { this.pinch = { d, a }; return; }
    if (d > 4 && this.pinch.d > 4) this.engine.rig.zoomBy(this.pinch.d / d);
    let da = a - this.pinch.a;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    if (Math.abs(da) < 0.3) this.engine.rig.rotateBy(-da);
    this.pinch = { d, a };
  }

  _onTap(cx, cy) {
    const p = this.engine.screenToGround(cx, cy);
    if (!p) return;

    /* 战斗：部署 */
    if (this.battle) {
      if (this.battle.over) return;
      /* 没选兵种时自动挑一个数量最多的，避免"点了地面毫无反应"的挫败感 */
      if (!this.battle.selected) {
        const pick = Object.keys(this.battle.reserve)
          .filter((k) => this.battle.reserve[k] > 0)
          .sort((a, b) => this.battle.reserve[b] - this.battle.reserve[a])[0];
        if (!pick) { this.ui.toast('没有可部署的部队了', 'warn'); return; }
        this.battle.select(pick);
        this.ui.renderTroopDock(this.battle);
      }
      const r = this.battle.deploy(p.x, p.z, this.battle.selected);
      if (!r.ok) this._deployFail(p, r.why);
      else { sfx.deploy(); this._deployMarker(p); }
      return;
    }

    /* 放置模式：点地面不做提交（用 ✓ 按钮），只允许选择性的微调 */
    if (this.place) {
      const g = worldToGrid(p.x, p.z);
      const d = BUILDINGS[this.place.type];
      this._setPlaceCell(g.gx - Math.floor(d.size[0] / 2), g.gz - Math.floor(d.size[1] / 2));
      return;
    }

    /* 普通：选中建筑 */
    const g = worldToGrid(p.x, p.z);
    const b = this.village.occupantAt(g.gx, g.gz);
    if (b) {
      sfx.tap();
      this.engine.showSelectRing(b.gx, b.gz, BUILDINGS[b.type].size[0], BUILDINGS[b.type].size[1]);
      this.ui.showSelect(b);
    } else {
      this.engine.hideSelectRing();
      this.ui.hideSelect();
    }
  }

  _deployMarker(p) {
    const geo = new THREE.RingGeometry(0.3, 0.5, 20);
    const mat = new THREE.MeshBasicMaterial({ color: 0x5ee08a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, 0.06, p.z);
    this.engine.scene.add(m);
    let t = 0;
    const anim = (dt) => {
      t += dt;
      m.scale.setScalar(1 + t * 3);
      mat.opacity = Math.max(0, 0.9 - t * 2.2);
      if (t > 0.42) {
        this.engine.scene.remove(m);
        geo.dispose(); mat.dispose();
        const i = this.engine._updaters.indexOf(anim);
        if (i >= 0) this.engine._updaters.splice(i, 1);
      }
    };
    this.engine._updaters.push(anim);
  }

  _deployFail(p, why) {
    sfx.nope();
    this.ui.toast(why, 'warn');
    const geo = new THREE.RingGeometry(0.3, 0.5, 20);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, 0.06, p.z);
    this.engine.scene.add(m);
    let t = 0;
    const anim = (dt) => {
      t += dt;
      mat.opacity = Math.max(0, 0.9 - t * 2.4);
      if (t > 0.42) {
        this.engine.scene.remove(m);
        geo.dispose(); mat.dispose();
        const i = this.engine._updaters.indexOf(anim);
        if (i >= 0) this.engine._updaters.splice(i, 1);
      }
    };
    this.engine._updaters.push(anim);
  }

  /* ============================================================
     战斗
     ============================================================ */
  /**
   * @param {object} spec NPC：{ mode:'npc', tierIndex }
   *                      PVP：{ mode:'pvp', userId }
   */
  async startBattle(spec) {
    if (this.battle) return;
    if (!this.army.hasTroops) { this.ui.toast('没有可以出征的部队', 'warn'); return; }

    const isPvp = spec && spec.mode === 'pvp';
    let opts = { mode: 'npc' };

    if (isPvp) {
      /* 先跟服务端"锁定"对手：拿到村庄快照，同时占用这次出征的配额。
         失败（断网 / 409 对手刚被抢走 / 404）就不进战斗 ——
         让玩家留在村庄换一个，而不是打一场结算不了的空仗。 */
      this.ui.toast('正在锁定对手…', '');
      const r = await bridge.startAttack(spec.userId);
      if (!r || !r.ok) {
        this.ui.toast((r && r.error) || '对手已被抢走，请换一个', 'warn');
        return;
      }
      opts = {
        mode: 'pvp',
        snapshotId: r.snapshotId,
        layout: r.layout,
        lootElixir: r.loot && r.loot.elixir,
        name: r.defender && r.defender.name,
        th: r.defender && r.defender.th,
      };
    }

    // 隐藏自己的村庄
    this.engine.buildingRoot.visible = false;
    this.engine.wallField.group.visible = false;
    this.engine.hideSelectRing();
    this.ui.hideSelect();

    this._preBattleCam = {
      tx: this.engine.rig.targetGoal.x, tz: this.engine.rig.targetGoal.z, dist: this.engine.rig.distGoal,
    };

    this.battle = new Battle(
      this.engine, this.village, this.army,
      isPvp ? 0 : (spec && spec.tierIndex) || 0,
      opts
    );
    this._battleHandled = false;

    this.engine.rig.focusOn(0, 0, 46);
    this.engine.rig.snap();

    this.ui.setBattleMode(true);
    this.bonus?.hide();   // 开战先收起地图上的彩蛋，别挡部署

    /* 自动选中一个可出战的兵种：省掉「先点兵种」那一下，
       也让「点地面部署」这条主操作路径永远可用 */
    const first = Object.keys(this.battle.reserve).find((k) => this.battle.reserve[k] > 0);
    if (first) this.battle.select(first);
    this.ui.renderTroopDock(this.battle);

    this.ui.toast(`进攻 ${this.battle.tier.name} · 点选兵种后点空地部署`, '');

    /* 答题强化面板：边打边答，答对越多部队越强（每题 +5%，上限 +50%） */
    this.quiz = new BattleQuiz(this.battle, this.ui, bridge);
    void this.quiz.start();
  }

  async _finishBattle(res) {
    this._battleHandled = true;

    const battleRef = this.battle;
    const isPvp = battleRef && battleRef.mode === 'pvp';

    /* PVP：先把结果交给服务端结算，再用它返回的权威值覆盖客户端自算的收益。
       顺序很重要 —— 必须先拿到服务端数字，才能往本地加圣水，
       否则加进去了服务端却判失败，本地就多出一笔凭空的圣水。 */
    if (isPvp) {
      const r = await bridge.finishAttack({
        snapshotId: battleRef.opts.snapshotId,
        pct: Math.round(res.pct || 0),
        thDead: !!(battleRef.th && battleRef.th.dead),
        durationMs: Date.now() - battleRef.startedAt,
      });
      if (r && r.ok) {
        res.elixir = r.elixirGained;
        res.coinsGained = r.coinsGained;
        res.defenderShort = r.defenderShort;
        res.capped = r.capped;
      } else {
        // 结算失败：不给资源，也不本地加
        res.elixir = 0;
        res.coinsGained = 0;
        this.ui.toast((r && r.error) || '结算失败，本次不计收益', 'warn');
      }
      res.pvp = true;
    }

    /* 结算。
       ⚠️ 铜板不在这里加！「金币=铜板」之后战斗掠夺金币就是印钞机 —— 打一场
          tier5（loot=1719）能凭空拿上千铜板。铜板改由服务端结算后下发
          （NPC 由 battle_end 事件按星级发放，PVP 从对手钱包真实转移），
          客户端上报的金额一个都不采用。
       圣水是游戏内资源，保留原有掠夺逻辑，安全。 */
    const gotElixir = this.village.add('elixir', res.elixir);
    this.village.res.gems += res.gems;
    this.village.stat.battles++;
    if (res.stars > 0) this.village.stat.raidsWon++;
    this.village.stat.stars += res.stars;
    this.army.applyCasualties(res.survivors);
    this.village.save(true);
    this.army.save(true);

    /* NPC 路径：上报战斗结果，服务端校验 tier 是否已解锁、星级是否合理，
       再按自己的规则发铜板 —— 客户端上报的数字不作为发币依据。
       PVP 不走这里，它已经在上面的 /attack/finish 结清了。 */
    if (!isPvp && battleRef) {
      bridge.reportEvent('battle_end', {
        tier: battleRef.tierIndex + 1,
        // 种子与 battle.js 的算法保持一致（987654 + tierIndex * 7919），
        // 服务端据此校验玩家打的是不是合法敌阵
        seed: 987654 + battleRef.tierIndex * 7919,
        stars: res.stars,
        pct: Math.round(res.pct || 0),
      });
    }

    // 战斗奖励的铜板由服务端结算，稍后回来刷新一次余额显示
    if (bridge.hasToken()) {
      setTimeout(() => { bridge.fetchWallet().catch(() => {}); }, 1200);
    }

    res.gold = 0;             // 结果卡上不再展示「掠夺金币」
    res.elixir = gotElixir;

    const newQ = this._checkQuests();

    // 收尾
    const b = this.battle;
    this.battle = null;
    if (this.quiz) {
      this.quiz.destroy();
      this.quiz = null;
    }
    this.engine.buildingRoot.visible = true;
    this.engine.wallField.group.visible = true;
    this.ui.setBattleMode(false);

    setTimeout(() => {
      b.dispose();
      const c = this._preBattleCam;
      if (c) this.engine.rig.focusOn(c.tx, c.tz, c.dist);
      this.engine.rig.snap();
      this.ui.renderHUD();

      this.ui.showResult(res, () => {
        for (const q of newQ) this.ui.toast(`任务完成：${q.name} +${q.reward} 宝石`, 'reward');
        this.ui.renderHUD();
      });
    }, 700);
  }

  /* ============================================================
     离线收益
     ============================================================ */
  /**
   * 应用服务端返回的离线结算结果。
   * 服务端依据 last_seen_at 与存档里的建筑等级权威计算（8 小时封顶），
   * 客户端只负责把结果加进本地资源并给个提示。
   *
   * ⚠️ 离线收益不再发金币/铜板。granted.gold 服务端恒返回 0（且 add('gold') 已被
   *    硬拦）。产能全部折算成圣水 —— 铜板唯一来源是学习与战斗奖励。
   *    coinsGranted 是「当日有学习行为」的小额回访补贴，走服务端 coins_ledger，
   *    与本地的 res.gold 镜像无关，只更新展示用的 this.balance。
   * @param {{granted?:{gold:number,elixir:number}, coinsGranted?:number, capped?:boolean}} r
   */
  _applyOffline(r) {
    const g = r.granted || {};
    const elixir = Math.floor(g.elixir || 0);
    const coins = Math.floor(r.coinsGranted || 0);
    if (elixir <= 0 && coins <= 0) return;

    if (elixir > 0) this.village.add('elixir', elixir);
    if (coins > 0) {
      this.balance = (this.balance || 0) + coins;
      this.village.res.gold = this.balance;   // 服务端补贴，属权威值 → 可直接镜像
    }

    this.village.save(true);
    this.ui.renderHUD();

    const parts = [];
    if (elixir > 0) parts.push(`圣水 +${elixir}`);
    if (coins > 0) parts.push(`铜板 +${coins}`);
    const tail = r.capped ? '（已达上限）' : '';
    this.ui.toast(`离线收益：${parts.join(' · ')}${tail}`, 'reward');
  }

  /* ============================================================
     任务
     ============================================================ */
  _checkQuests() {
    const newly = this.village.checkQuests();
    if (newly.length) {
      for (const q of newly) this.ui.toast(`任务完成：${q.name} +${q.reward} 宝石`, 'reward');
      this.ui.renderHUD();
    }
    return newly;
  }
}

const clampCell = (v) => Math.max(0, Math.min(GRID - 1, v));

/* 启动 */
window.addEventListener('error', (e) => {
  const l = document.getElementById('loader-tip');
  if (l) l.textContent = '加载出错：' + (e.message || '未知错误');
});

function boot() {
  try {
    window.__game = new Game();
  } catch (err) {
    const l = document.getElementById('loader-tip');
    if (l) l.textContent = '初始化失败：' + err.message;
    console.error(err);
  }
}

/* 立刻向宿主报到 —— 必须在 new Game() 之前。
   原因：宿主的 8 秒「加载超时」计时器是从 iframe 挂载就开始跑的，而
   Game 的构造 + _boot()（握手、拉云存档、构建模型）可能不止 8 秒。
   早报到能让宿主确认「iframe 已经活了、JS 没报错」，把 8 秒用在真正的
   握手等待上，而不是白白耗在资源加载上。 */
function signalReady() {
  try {
    if (!window.parent || window.parent === window) return;   // 非 iframe，无需报到
    window.parent.postMessage({ type: 'village:ready', payload: { gameVersion: 1 } }, location.origin);
  } catch (e) { /* 跨域等异常忽略，header 缺失时宿主后面还会超时兜底 */ }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { signalReady(); boot(); });
} else {
  signalReady();
  boot();
}
