/* ============================================================
   ui.js — HUD / 面板 / 交互层
   ============================================================ */

import {
  BUILDINGS, TROOPS, QUESTS, RAID_TIERS,
  maxCount, upCost, fmtTime, fmtNum, UNLIMITED_COINS,
} from './config.js';
import { sfx, soundEnabled, setSound } from './audio.js';
import { COMPO } from './battle.js';
import { maxHp } from './village.js';
import { bridge } from './bridge.js';

const $ = (id) => document.getElementById(id);
const h = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };

const ICO_GOLD = '<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="9" fill="#ffd75e" stroke="#a9741a" stroke-width="2"/><path d="M12 7v10M9.4 9.6h4a1.8 1.8 0 010 3.6h-4M9.4 13.2h4.6" fill="none" stroke="#a9741a" stroke-width="1.6" stroke-linecap="round"/></svg>';
const ICO_ELIXIR = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 3c3.4 4.2 6 7.3 6 10.2A6 6 0 016 13.2C6 10.3 8.6 7.2 12 3z" fill="#e487ff" stroke="#7a2c96" stroke-width="2" stroke-linejoin="round"/></svg>';
const ICO_GEM = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M7 4h10l4 6-9 10L3 10z" fill="#63e6a8" stroke="#1e7a52" stroke-width="2" stroke-linejoin="round"/></svg>';
const ICO_X = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
/** 「换一批」的花费 —— ⚠️ 必须与服务端 village.ts 的 OPPONENT_REROLL_COST 一致。
    这里只用于按钮文案和本地预校验，真正的扣费只认服务端。 */
const REROLL_COST = 10;
const ICO_STAR = (on) => `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 2.6l3 6.1 6.7 1-4.9 4.7 1.2 6.7L12 18l-6 3.1 1.2-6.7L2.3 9.7l6.7-1z" fill="${on ? '#ffc63d' : 'rgba(0,0,0,.12)'}" stroke="${on ? '#b07a12' : 'rgba(0,0,0,.15)'}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

export class UI {
  constructor({ village, army, actions }) {
    this.village = village;
    this.army = army;
    this.act = actions;
    /** 战报弹窗是否正在阻断操作（main.js 的 keydown 会读它） */
    this.blocking = false;

    this.sheet = $('sheet');
    this.sheetInner = $('sheet-inner');
    this.scrim = $('scrim');
    this.sel = $('sel');
    this.place = $('place');
    this.dock = $('dock');
    this.toasts = $('toasts');
    this.queue = $('queue');
    this.battleHud = $('battle-hud');
    this.result = $('result');
    this.loader = $('loader');

    this._selectedId = null;
    this._placeMode = null;
    this._sheetKind = null;

    this._bindStatic();
  }

  /* ============================================================
     静态绑定
     ============================================================ */
  _bindStatic() {
    $('btn-setting').addEventListener('click', () => this.openSettings());
    $('place-ok').addEventListener('click', () => this.act.placeConfirm && this.act.placeConfirm());
    $('place-no').addEventListener('click', () => this.act.placeCancel && this.act.placeCancel());
    this.dock.addEventListener('click', (e) => {
      const btn = e.target.closest('.dock-btn');
      if (!btn) return;
      const a = btn.dataset.act;
      if (a === 'shop') this.openShop();
      else if (a === 'army') this.openArmy();
      else if (a === 'attack') this.openAttack();
      else if (a === 'edit') this.openEdit();
      else if (a === 'daily') this.openQuests();
      this._bump(btn);
    });
    this.scrim.addEventListener('click', () => this.closeSheet());
    $('btn-quit-battle').addEventListener('click', () => this.act.quitBattle && this.act.quitBattle());
  }

  _bump(btn) {
    btn.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(.86)' }, { transform: 'scale(1)' }],
      { duration: 240, easing: 'cubic-bezier(.3,.9,.3,1.4)' }
    );
  }

  /* ============================================================
     HUD
     ============================================================ */
  renderHUD() {
    this.renderResources();
    this.renderQueue();
    this._refreshSheetIfOpen();
  }

  /** 只刷新资源数字（高频调用，不重建 DOM） */
  renderResources() {
    const v = this.village;
    const caps = v.caps;
    const set = (id, txt) => { const e = $(id); if (e && e.textContent !== txt) e.textContent = txt; };

    /* 铜板无上限（真源在服务端 users.coins），不显示 "/cap"，进度条也不用画。
       管理员是「无限资源」（bridge.unlimited）：三种资源都渲染成 ∞ ——
       显示那个九位数（或存档里几十的旧快照）既没意义，又会跟「能随便建」
       的实际行为对不上。判据与前端 formatCoins 一致。 */
    const unl = v.unlimitedRes;
    set('res-gold', (unl || v.res.gold >= UNLIMITED_COINS) ? '∞' : fmtNum(v.res.gold));
    set('cap-gold', '');
    set('res-elixir', unl ? '∞' : fmtNum(v.res.elixir));
    set('cap-elixir', unl ? '' : '/' + fmtNum(caps.elixir));
    set('res-gem', unl ? '∞' : fmtNum(v.res.gems));
    set('builder-count', `${v.freeBuilders}/${v.builders ? v.builders.length : 1}`);

    const bg = $('bar-gold'), be = $('bar-elixir');
    if (bg) bg.style.width = '0%';
    if (be) be.style.width = unl ? '0%' : Math.min(100, (v.res.elixir / caps.elixir) * 100) + '%';

    /* 铜板不再有满仓概念，去掉 full 脉冲以免误导 */
    const pg = document.querySelector('.pill-gold');
    const pe = document.querySelector('.pill-elixir');
    if (pg) pg.classList.remove('full');
    if (pe) pe.classList.toggle('full', v.res.elixir >= caps.elixir - 1);
  }

  /** 高频轻量刷新：资源、建造进度、选中面板倒计时、训练进度 */
  tickLight() {
    this.renderResources();
    this._tickQueue();
    this._tickSelectPanel();
    this._tickTraining();
    this._tickPerf();
  }

  /** 设置面板打开时的实时性能读数（帧率 / draw call / 三角面） */
  _tickPerf() {
    if (this._sheetKind !== 'settings' || !this.act.getPerf) return;
    const p = this.act.getPerf() || {};
    const set = (id, t) => { const e = $(id); if (e && e.textContent !== t) e.textContent = t; };
    set('pf-fps', String(p.fps || 0));
    set('pf-draw', String(p.draw || 0));
    set('pf-tris', ((p.tris || 0) / 1000).toFixed(0) + 'k');
  }

  _tickQueue() {
    const v = this.village;
    const works = v.buildings.filter((b) => b.work);
    const sig = works.map((b) => b.id).join(',');
    if (sig !== this._queueSig) { this._queueSig = sig; this.renderQueue(); return; }
    works.forEach((b) => {
      const el = this.queue.querySelector(`.q-item[data-id="${b.id}"]`);
      if (!el) return;
      const pct = Math.max(0, Math.min(100, 100 - (b.work.left / Math.max(1, b.work.total)) * 100));
      const bar = el.querySelector('.qbar > i');
      const small = el.querySelector('.meta small');
      if (bar) bar.style.width = pct + '%';
      const label = b.work.isNew ? '建造中' : `升级至 ${b.work.to} 级`;
      const txt = `${label} · ${fmtTime(b.work.left)}`;
      if (small && small.textContent !== txt) small.textContent = txt;
    });
  }

  _tickSelectPanel() {
    if (!this.sel.classList.contains('show')) return;
    const b = this.village.byId.get(this._selectedId);
    if (!b) { this.hideSelect(); return; }
    if (b.work) {
      const note = this.sel.querySelector('.sel-note');
      const txt = `施工中：${fmtTime(b.work.left)} 后完成`;
      if (note && note.textContent !== txt) note.textContent = txt;
      const btn = this.sel.querySelector('[data-a="rush"] .cost');
      if (btn) {
        const g = Math.max(1, Math.ceil(b.work.left / 60));
        /* 管理员显示 ∞，普通玩家显示当前秒完成所需宝石数。
           这里改用 innerHTML 而不是 textContent：图标 ICO_GEM 是内联 SVG，
           用 textContent 赋值会把第一次渲染出来的图标抹掉（既有小瑕疵，顺手修）。 */
        const label = this.village.unlimitedRes ? '∞' : String(g);
        if (btn.textContent.indexOf(label) < 0) btn.innerHTML = `${ICO_GEM} ${label}`;
      }
    }
  }

  _tickTraining() {
    if (this._sheetKind !== 'army') return;
    const a = this.army;
    const items = this.sheetInner.querySelectorAll('.tq-item');
    if (items.length !== a.queue.length) return;   // 数量变化时交给完整重建
    a.queue.forEach((q, i) => {
      const fill = items[i] && items[i].querySelector('.fill');
      if (fill) fill.style.height = Math.max(0, 100 - (q.left / Math.max(1, q.total)) * 100) + '%';
    });
  }

  renderQueue() {
    const v = this.village;
    const works = v.buildings.filter((b) => b.work);
    /* 【2026-10-14 性能修复】签名没变就不重建 DOM。
       renderHUD() 每帧都会调到这里，原先等于每帧重写一次队列的 innerHTML。
       倒计时由 _tickQueue 做局部更新（它在签名变化时反过来调本方法）。
       额外比对 children.length：防止 DOM 被别处清空后签名「看起来没变」而不重建。 */
    const sig = works.map((b) => b.id).join(',');
    if (sig === this._queueSig && this.queue.children.length === works.length) return;
    this._queueSig = sig;
    const html = works.map((b) => {
      const d = BUILDINGS[b.type];
      const pct = Math.max(0, Math.min(100, 100 - (b.work.left / Math.max(1, b.work.total)) * 100));
      const label = b.work.isNew ? '建造中' : `升级至 ${b.work.to} 级`;
      return `<div class="q-item" data-id="${b.id}">
        <div class="thumb">${d.emoji}</div>
        <div class="meta"><b>${d.name}</b><small>${label} · ${fmtTime(b.work.left)}</small></div>
        <div class="qbar"><i style="width:${pct}%"></i></div>
      </div>`;
    }).join('');
    this.queue.innerHTML = html;
    this.queue.querySelectorAll('.q-item').forEach((el) => {
      el.addEventListener('click', () => {
        const id = +el.dataset.id;
        this.act.focusBuilding && this.act.focusBuilding(id);
        this.showSelect(this.village.byId.get(id));
      });
    });
  }

  /* ============================================================
     Toast
     ============================================================ */
  toast(msg, kind = '') {
    const t = h(`<div class="toast ${kind}">${msg}</div>`);
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), 2150);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild.remove();
  }

  /* ============================================================
     选中面板
     ============================================================ */
  showSelect(b) {
    if (!b) return this.hideSelect();
    this._selectedId = b.id;
    const d = BUILDINGS[b.type];
    const lv = b.level;
    const maxLv = d.up.length;
    const next = lv + 1;
    const cost = lv >= maxLv ? null : upCost(b.type, next);
    const affordable = cost ? this.village.canAfford(cost) : false;
    const col = this.village.collectable(b.id);
    /* 是否被攻打损坏（停产 + 不能升级，只能维修）。
       ⚠️ 这里必须定义：showSelect 下面多处用到 damaged，
       2026-09-30 加入「维修」功能时漏了这行，导致点任意建筑直接抛
       ReferenceError: damaged is not defined —— 升级面板整个弹不出来。
       判据统一走 village.isDamaged()，不要读 this.village.damaged（那是内部 Set）。 */
    const damaged = this.village.isDamaged(b.id);

    /* 统计块 */
    const stats = [];
    stats.push(['等级', `${lv}${lv >= maxLv ? ' · 满级' : ' / ' + maxLv}`]);
    stats.push(['耐久', fmtNum(d.up[Math.max(0, lv - 1)].hp)]);
    if (d.prod) {
      const p = d.prod[Math.min(Math.max(1, lv), d.prod.length) - 1];
      if (b.type === 'mine') {
        /* 矿场：产量按「天」说更直观（玩家关心的是一天能收多少）；
           「已存」必须给**全局**数 —— 单座矿场不知道自己会被别的矿场挤满，
           真正决定停产的是「总已存 / 总容量」。 */
        stats.push(['产出', `${fmtNum(p.rate * 24)}/天`]);
        stats.push(['总已存', `${fmtNum(this.village.mineStored)} / ${fmtNum(this.village.mineCap)}`]);
        stats.push(['铜板库', `${this.village.mineStoreCount} 座`]);
      } else {
        stats.push(['产出', `${fmtNum(p.rate)}/时`]);
        stats.push(['已存', `${fmtNum(b.stored)} / ${fmtNum(p.cap)}`]);
      }
    }
    if (d.store) {
      const s = d.store[Math.min(Math.max(1, lv), d.store.length) - 1];
      stats.push(['容量', '+' + fmtNum(s.cap)]);
    }
    if (d.def) {
      const s = d.def[Math.min(Math.max(1, lv), d.def.length) - 1];
      stats.push(['伤害', `${s.dps}/秒`]);
      stats.push(['射程', s.range.toFixed(1)]);
      if (s.splash) stats.push(['溅射', s.splash.toFixed(1)]);
    }
    if (d.army) {
      const a = d.army[Math.min(Math.max(1, lv), d.army.length) - 1];
      if (a.housing !== undefined) stats.push(['容量', a.housing]);
      if (a.speed !== undefined) stats.push(['训练速度', '×' + a.speed.toFixed(2)]);
    }
    /* 加成建筑（学识矿脉）：展示当前等级与满级时的加成幅度，
       让玩家一眼看出「升这一级值不值」 */
    if (d.effect && d.effect.perLevel) {
      const cur = d.effect.perLevel[Math.min(Math.max(1, lv), d.effect.perLevel.length) - 1] || 0;
      const full = d.effect.perLevel[d.effect.perLevel.length - 1] || 0;
      stats.push([d.effect.label || '加成', '+' + Math.round(cur * 100) + '%']);
      stats.push(['满级加成', '+' + Math.round(full * 100) + '%']);
      /* 多座累加后的总加成，让玩家知道当前全村实际收益 */
      const total = this.village.studyCoinBonus;
      stats.push(['全村合计', '+' + Math.round(total * 100) + '%']);
    }

    const statsHtml = stats.slice(0, 6).map(([k, v]) =>
      `<div class="stat"><small>${k}</small><b>${v}</b></div>`).join('');

    /* 按钮 */
    let btns = '';
    if (b.work) {
      const g = Math.max(1, Math.ceil(b.work.left / 60));
      btns = `<button class="gbtn gem" data-a="rush">宝石秒完成 <span class="cost">${ICO_GEM} ${this.village.unlimitedRes ? '∞' : g}</span></button>`;
    } else {
      if (damaged) {
        /* 损坏：主按钮只给「维修」（停产 + 不能升级，修好才恢复）。
           价格与后端同一口径（累计造价 8%）；铜板不够就置灰，点了也会被拦。 */
        const rc = this.village.repairCostOf(b.type, b.level);
        const rich = this.village.res.gold >= rc;
        btns += `<button class="gbtn up" data-a="repair" ${rich ? '' : 'disabled'}>
          🔧 维修 <span class="cost">${ICO_GOLD}${fmtNum(rc)}</span></button>`;
      } else {
        if (col) {
          btns += `<button class="gbtn coll" data-a="collect">收取 ${fmtNum(col.amount)}</button>`;
        }
        if (cost) {
          const price = cost.gold ? `${ICO_GOLD}${fmtNum(cost.gold)}` : `${ICO_ELIXIR}${fmtNum(cost.elixir)}`;
          btns += `<button class="gbtn up" data-a="upgrade" ${affordable ? '' : 'disabled'}>
          升级 <span class="cost">${price} · ${fmtTime(cost.time)}</span></button>`;
        } else {
          btns += `<button class="gbtn up" disabled>已满级</button>`;
        }
      }
      btns += `<button class="gbtn move" data-a="move">移动</button>`;
      if (b.type !== 'townhall' && b.type !== 'builderhut') {
        btns += `<button class="gbtn" style="background:linear-gradient(160deg,#ff9c9c,#d94a4a);flex:0 0 54px" data-a="demolish">拆</button>`;
      }
    }

    let note = d.desc;
    if (damaged) note = '⚠️ 已被攻打损坏：停产且无法升级，维修后才能恢复。';
    else if (b.work) note = `施工中：${fmtTime(b.work.left)} 后完成`;
    else if (lv >= maxLv) note = '该建筑已达最高等级。';
    else if (cost && !affordable) {
      /* 区分到底缺哪一种资源：军营造价是「铜板 + 圣水」，原先一律写
         「铜板不足」，缺圣水时玩家会以为铜板出了问题。 */
      const short = this.village.lackReason(cost);
      note = short === '圣水不足'
        ? '圣水不足：圣水由圣水收集器产出，记得去收取。'
        : short === '铜板与圣水不足'
          ? '铜板与圣水都不够，先去学习赚点铜板吧。'
          : '铜板不足，先去学习赚点铜板吧。';
    }
    /* 矿场专项：存满停产时必须明说，否则玩家看它「不动了」会当成 bug。
       放在这一串 if 之后 = 优先级最低，被损坏/施工等更紧急的状态盖掉才合理。

       【2026-11-06 补】容量为 0（一座铜板库都没有）要单独说。
       原判断 mineStored >= mineCap 在双方都是 0 时恒成立，于是没建库的玩家
       看到的是「铜板库已存满」—— 他压根没有库，只会更困惑。
       这是反馈里「矿场不产铜板」5 条的直接来源。 */
    if (b.type === 'mine' && !damaged && !b.work) {
      if (!(this.village.mineCap > 0)) {
        note = '⚠️ 还没有铜板库：产出的铜板无处存放，先建一座铜板库。';
      } else if (this.village.mineStored >= this.village.mineCap - 0.5) {
        note = '⚠️ 铜板库已存满 —— 矿场暂停产出，收取后恢复。';
      }
    }

    this.sel.className = 'sel-panel show';
    this.sel.innerHTML = `
      <div class="sel-head">
        <div class="ico-box">${d.emoji}</div>
        <div class="t"><b>${d.name}${lv > 0 ? ` <span style="color:#7d6ba8">Lv.${lv}</span>` : ''}</b>
          <span>${d.tag} · 占地 ${d.size[0]}×${d.size[1]}</span></div>
        <button class="sel-close" data-a="close">${ICO_X}</button>
      </div>
      <div class="sel-stats">${statsHtml}</div>
      <div class="sel-actions">${btns}</div>
      <div class="sel-note">${note}</div>
    `;
    this.sel.querySelectorAll('[data-a]').forEach((el) => {
      el.addEventListener('click', () => {
        const a = el.dataset.a;
        if (a === 'close') this.hideSelect();
        else if (a === 'upgrade') this._try(() => this.village.upgrade(b.id));
        else if (a === 'repair') this._repair(b.id);
        else if (a === 'rush') this._try(() => this.village.rush(b.id));
        else if (a === 'collect') this._collect(b.id);
        else if (a === 'move') this.act.startMove && this.act.startMove(b.id);
        else if (a === 'demolish') this._confirmDemolish(b.id);
      });
    });
  }

  _try(fn) {
    const r = fn();
    if (r && !r.ok) this.toast(r.why || '无法执行', 'warn');
    return r;
  }

  /**
   * 维修（异步：金额由服务端算，必须等回包才知道扣了多少）。
   * 修好后重开面板，按钮从「维修」变回「升级」。
   */
  async _repair(id) {
    const r = await this.village.repair(id);
    if (r && r.ok) {
      this.toast(`维修完成 · -${fmtNum(r.cost)} 铜板`, 'good');
      const b = this.village.byId.get(id);
      if (b) this.showSelect(b); else this.hideSelect();
    } else {
      this.toast((r && r.why) || '维修失败，请稍后再试', 'warn');
    }
  }

  /* ============================================================
     被攻打战报（2026-10-14 按需求）
     ------------------------------------------------------------
     玩家上线后先看战报、先把被打坏的建筑修好，才能进村庄游玩。
     弹层是全屏遮罩：盖住画布与 HUD，把指针事件全部吃掉；
     键盘是挂在 window 上的，遮罩拦不住，由 main.js 的 keydown
     检查 ui.blocking 主动挡住。
     两个出口 ——
       · 一键修复：服务端批量修，铜板不够则「能修几座修几座」
       · 退出部落：通知宿主回首页，去学习赚铜板
     ============================================================ */
  /** 相对时间文案（战报用的「几分钟前」） */
  _ago(ts) {
    const s = Math.max(0, Math.floor(Date.now() / 1000 - (Number(ts) || 0)));
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    return Math.floor(s / 86400) + ' 天前';
  }

  hideRaidModal() {
    const el = document.getElementById('raidModal');
    if (el) el.remove();
    this.blocking = false;
  }

  showRaidModal(data) {
    const damaged = Array.isArray(data && data.damaged) ? data.damaged : [];
    const reports = Array.isArray(data && data.reports) ? data.reports : [];
    const totalCost = Math.max(0, Math.floor(Number(data && data.totalCost) || 0));
    const balance = Math.max(0, Math.floor(Number(data && data.balance) || 0));
    const short = Math.max(0, totalCost - balance);
    /* 攻击者名字来自玩家自定义昵称，必须转义后再拼进 HTML */
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    this.hideRaidModal();
    const el = document.createElement('div');
    el.id = 'raidModal';
    el.className = 'raid-modal';

    /* 战报行：攻击者 / 星级 / 损毁率 / 被抢走的铜板与圣水
       【2026-11-06 反击】每行右侧给一个「打回去」，直接进进攻流程。
       反馈 #81（吴芊语）、#86（隆煊祺）、#17（周凯鑫）说的是同一件事：
       被打了只知道名字，找不到人也没法还手。 */
    const rows = reports.map((r) => {
      const stars = Math.max(0, Math.min(3, Math.floor(Number(r.stars) || 0)));
      let st = '';
      for (let i = 0; i < 3; i++) st += ICO_STAR(i < stars);
      const canHit = Number(r.attackerId) > 0;
      return '<div class="raid-row">'
        + '<div class="raid-who"><b>' + esc(r.attacker) + '</b><small>' + this._ago(r.at) + '</small></div>'
        + '<div class="raid-stars">' + st + '</div>'
        + '<div class="raid-loss">损毁 ' + Math.round(Number(r.pct) || 0) + '% · 被抢 '
        + ICO_GOLD + fmtNum(Number(r.coins) || 0) + ' · ' + ICO_ELIXIR + fmtNum(Number(r.elixir) || 0)
        + '</div>'
        + (canHit
          ? '<button class="raid-back" data-back="' + Number(r.attackerId) + '" data-name="'
            + esc(r.attacker) + '">打回去</button>'
          : '')
        + '</div>';
    }).join('');

    /* 待修清单按「建筑 + 等级」聚合 —— 逐座列出来会刷屏 */
    const groups = new Map();
    for (const d of damaged) {
      const k = d.type + '@' + d.level;
      const g = groups.get(k) || { type: d.type, level: d.level, n: 0, cost: 0 };
      g.n++;
      g.cost += Math.max(0, Math.floor(Number(d.cost) || 0));
      groups.set(k, g);
    }
    const listHtml = Array.from(groups.values()).map((g) => {
      const def = BUILDINGS[g.type];
      const name = (def && def.emoji ? def.emoji + ' ' : '') + ((def && def.name) || g.type);
      return '<li><span class="rn">' + esc(name) + ' ' + g.level + ' 级 ×' + g.n
        + '</span><span class="rc">' + ICO_GOLD + fmtNum(g.cost) + '</span></li>';
    }).join('');

    const body = damaged.length
      ? '<div class="raid-repair">'
        + '<div class="raid-repair-head">⚠️ ' + damaged.length + ' 座建筑受损，修复需 '
        + ICO_GOLD + fmtNum(totalCost) + '</div>'
        + '<ul class="raid-repair-list">' + listHtml + '</ul>'
        + (short > 0
          ? '<div class="raid-short">铜板不足：现有 ' + fmtNum(balance) + '，还差 ' + fmtNum(short) + '</div>'
          : '')
        + '</div>'
      : '<div class="raid-safe">✅ 本次没有建筑受损，部落安好</div>';

    el.innerHTML = '<div class="raid-panel">'
      + '<div class="raid-title">🛡️ 部落战报</div>'
      + '<div class="raid-sub">'
      + (reports.length > 1
        ? '你不在的时候，部落被打了 ' + reports.length + ' 次'
        : '你不在的时候，有人来打你的部落')
      + '</div>'
      + (rows ? '<div class="raid-list">' + rows + '</div>' : '')
      + body
      + '<div class="raid-actions">'
      + (damaged.length
        ? '<button id="raidFix" class="gbtn up">一键修复<span class="cost">'
          + ICO_GOLD + fmtNum(totalCost) + '</span></button>'
        : '<button id="raidOk" class="gbtn up">知道了</button>')
      + '<button id="raidExit" class="gbtn raid-exit">'
      + (short > 0 ? '去赚铜板（退出部落）' : '暂不修复，退出部落')
      + '</button>'
      + '</div></div>';

    (document.getElementById('app') || document.body).appendChild(el);
    this.blocking = true;

    /* 【2026-11-06 反击】点「打回去」→ 标记已读 + 关弹窗 + 直接进进攻流程。
       带上 attackerId 走 pvp，和从对手列表打是同一条路径，不再单独写一套。 */
    el.querySelectorAll('[data-back]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const uid = Number(btn.dataset.back);
        const name = btn.dataset.name || '对手';
        if (!uid) return;
        if (btn.disabled) return;
        btn.disabled = true;
        bridge.markReportsSeen().catch(() => {});
        this.hideRaidModal();
        if (this.act && typeof this.act.startBattle === 'function') {
          this.toast('出征反击「' + name + '」', 'good');
          this.act.startBattle({ mode: 'pvp', userId: uid });
        } else {
          this.toast('现在还不能出征', 'warn');
        }
      });
    });

    /* 一键修复 */
    const fixBtn = el.querySelector('#raidFix');
    if (fixBtn) {
      fixBtn.addEventListener('click', async () => {
        if (fixBtn.disabled) return;
        fixBtn.disabled = true;
        const r = await bridge.repairAll();
        if (!r || !r.ok) {
          this.toast((r && r.error) || '修复失败，请稍后再试', 'warn');
          fixBtn.disabled = false;
          return;
        }
        const fixed = this.village.applyRepairAll(r.remainingIds || []);
        /* 同步版本号，免得紧接着的 POST /save 因为落后而 409 */
        if (typeof r.version === 'number') this.village._version = r.version;
        if (typeof r.balance === 'number') {
          this.village.res.gold = r.balance;
          if (this.village.onWalletChanged) this.village.onWalletChanged(r.balance);
        }
        this.renderHUD();
        if (Number(r.remaining) > 0) {
          /* 铜板只够修一部分：留在弹窗里，重新拉一次拿到最新余额与清单 */
          this.toast('已修复 ' + fixed + ' 座，还有 ' + r.remaining + ' 座（铜板不足）', 'warn');
          let again = null;
          try { again = await bridge.fetchReports(); } catch (e) { again = null; }
          if (again && again.ok) this.showRaidModal(again);
          else fixBtn.disabled = false;
          return;
        }
        try { await bridge.markReportsSeen(null); } catch (e) { /* 标记失败也放行 */ }
        this.toast('全部修复完成 · -' + fmtNum(Number(r.cost) || 0) + ' 铜板', 'good');
        this.hideRaidModal();
      });
    }

    /* 「知道了」：只被抢了铜板/圣水、没有建筑受损的情况 */
    const okBtn = el.querySelector('#raidOk');
    if (okBtn) {
      okBtn.addEventListener('click', async () => {
        okBtn.disabled = true;
        try { await bridge.markReportsSeen(null); } catch (e) { /* 忽略 */ }
        this.hideRaidModal();
      });
    }

    /* 退出部落：回首页去学习赚铜板 */
    const exitBtn = el.querySelector('#raidExit');
    if (exitBtn) {
      exitBtn.addEventListener('click', () => {
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'village:exit' }, location.origin);
            return;
          }
        } catch (e) { /* 跨域 → 退回首页 */ }
        location.href = '/';
      });
    }
  }

  async _collect(id) {
    /* 矿场产铜板 —— 必须由服务端结算发放。
       为什么不在客户端直接入账：见 village.js add() 的硬性红线 ——
       客户端能算出的铜板数就是一台印钞机（改一行 JS 就能无限刷）。
       这里只负责「请服务端算一次，再把权威结果同步回本地」。 */
    const mb = this.village.byId.get(id);
    const md = mb && BUILDINGS[mb.type];
    const mp = md && md.prod && md.prod[Math.min(Math.max(1, mb.level), md.prod.length) - 1];
    if (mp && mp.res === 'gold') {
      const r = await bridge.claimMine();
      if (!r || !r.ok) { this.toast((r && r.error) || '收取失败，请稍后再试', 'warn'); return; }
      const got = Number(r.granted) || 0;
      this.village.settleMine(id, got);
      if (typeof r.balance === 'number') {
        this.village.res.gold = r.balance;   // 服务端才是余额真源
        this.village._emitChange();
      }
      if (got > 0) { this.toast(`+${fmtNum(got)} 铜板`, 'good'); sfx.coin(); }
      else if (!(this.village.mineCap > 0)) this.toast('产出的铜板没地方存：先建一座铜板库', 'warn');
      else this.toast('还没有产出，再等等吧', 'warn');
      return;
    }

    const r = this.village.collect(id);
    if (!r) return;
    const name = r.res === 'gold' ? '铜板' : '圣水';
    if (r.wasted > 0) this.toast(`仓库已满，${name} 溢出 ${fmtNum(r.wasted)}`, 'warn');
    else if (r.amount > 0) this.toast(`+${fmtNum(r.amount)} ${name}`, 'good');
    if (r.amount > 0) sfx.coin();
  }

  _confirmDemolish(id) {
    const b = this.village.byId.get(id);
    if (!b) return;
    const d = BUILDINGS[b.type];
    const spent = upCost(b.type, Math.max(1, b.level));
    const gBack = Math.floor((spent.gold || 0) * 0.3);
    const eBack = Math.floor((spent.elixir || 0) * 0.3);
    const parts = [];
    if (gBack > 0) parts.push(`铜板 ${fmtNum(gBack)}`);
    if (eBack > 0) parts.push(`圣水 ${fmtNum(eBack)}`);
    const back = parts.length ? parts.join('、') : '无';
    this._modal(`
      <h2>拆除 ${d.name}</h2>
      <div class="sub">返还 30% 已投入资源</div>
      <div class="loot-box" style="margin-bottom:16px"><small>返还</small><b style="font-size:17px">${back}</b></div>
      <div class="sel-actions">
        <button class="gbtn" style="background:#e9e2f2;color:#5a4f6b" data-r="no">取消</button>
        <button class="gbtn" style="background:linear-gradient(160deg,#ff9c9c,#d94a4a)" data-r="yes">确认拆除</button>
      </div>
    `, (r) => {
      if (r === 'yes') {
        const res = this.village.demolish(id);
        if (res.ok) { this.toast('已拆除', 'good'); this.hideSelect(); }
        else this.toast(res.why, 'warn');
      }
    });
  }

  hideSelect() {
    this._selectedId = null;
    this.sel.className = 'sel-panel';
  }

  /* ============================================================
     放置操作条
     ============================================================ */
  showPlaceBar(name, hint) {
    $('place-name').textContent = name;
    $('place-hint').textContent = hint || '拖动调整位置';
    this.place.classList.remove('hidden');
    this.dock.classList.add('hide');
  }
  hidePlaceBar() {
    this.place.classList.add('hidden');
    this.dock.classList.remove('hide');
    this.hideSelect();
  }
  setPlaceHint(txt) { $('place-hint').textContent = txt; }

  /* ============================================================
     底部面板
     ============================================================ */
  openSheet(kind, html, opts = {}) {
    this._sheetKind = kind;
    this.sheetInner.innerHTML = `<div class="sheet-grab"></div>` + html;
    this.sheet.classList.add('open');
    if (opts.scrim !== false) this.scrim.classList.remove('hidden');
    if (opts.wide !== false) this.dock.classList.add('hide');
    this._bindSheet(kind);
  }
  closeSheet() {
    this.sheet.classList.remove('open');
    this.scrim.classList.add('hidden');
    this.dock.classList.remove('hide');
    this._sheetKind = null;
    this._bindSheetCallbacks = null;
  }
  _refreshSheetIfOpen() {
    /* 【2026-10-14 性能修复】renderHUD 是高频入口（训练/施工进度都会触发），
       原先每次都重建整个面板。这里合并到最多 150ms 一次 —— 面板内容对
       延迟本来就不敏感，而玩家主动操作后的即时刷新走 click 回调里的直接
       调用（_renderArmy / _renderShop），不受此限制。 */
    const now = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    if (now - (this._sheetRefreshAt || 0) < 150) return;
    this._sheetRefreshAt = now;
    if (this._sheetKind === 'army') this._renderArmy();
    if (this._sheetKind === 'shop') this._renderShop();
    if (this._sheetKind === 'quests') this._renderQuests();
  }

  _bindSheet(kind) {
    // 关闭按钮
    this.sheetInner.querySelectorAll('[data-close]').forEach((el) =>
      el.addEventListener('click', () => this.closeSheet()));
    this._bindSheetCallbacks && this._bindSheetCallbacks();
  }

  /* ---------------- 商店 ---------------- */
  openShop() { this._renderShop(); }

  _renderShop() {
    const v = this.village;
    const th = v.thLevel;
    const cats = [
      /* 核心：市政厅 + 建筑工人小屋。
         工人小屋必须在商店里 —— 它 = 一名工人（见 village.js builderCount），
         MAXCNT.builderhut 两座是硬上限。初始村庄送 1 座，第 2 座得玩家自己花
         150 铜板补；以前 cats 里漏了它，玩家永远凑不齐 2 个工人。 */
      ['核心', ['townhall', 'builderhut']],
      ['资源', ['mine', 'elixircollector', 'goldstorage', 'elixirstorage']],
      ['加成', ['goldmine']],
      ['军事', ['barracks', 'armycamp']],
      ['防御', ['cannon', 'archertower', 'mortar', 'wall']],
    ];
    /* 商店标题顺带解释工人来源：没有工人小屋时明确提示，不然玩家
       看着一片「没有空闲的建筑工人」会一头雾水，不知道该干什么。 */
    const builderHint = v.builders.length === 0
      ? '需要先建造建筑工人小屋'
      : `空闲工人 ${v.freeBuilders}`;
    let body = `<div class="sheet-title"><h2>商店</h2><p>市政厅 ${th} 级 · ${builderHint}</p></div>`;

    for (const [cat, types] of cats) {
      body += `<div class="sheet-section">${cat}</div><div class="shop-grid">`;
      for (const t of types) {
        const d = BUILDINGS[t];
        const have = v.countOf(t);
        const cap = maxCount(t, th);
        const cost = upCost(t, 1);
        /* cap === 0 表示「当前市政厅等级还没开放这种建筑」，
           它和「已达上限」是两回事：前者玩家要做的是去升市政厅，
           后者才是拆/换。以前两种情况都写「已达 0 座上限」，玩家
           完全不知道该怎么办 —— 直接给出解锁所需等级。 */
        const atCap = cap > 0 && have >= cap;
        let lockWhy = (t === 'armycamp' && v.barracksInfo.level < 1) ? '需要先建造兵营' : '';
        /* 矿场产出的铜板存在「铜板库」里 —— 没有库就等于没有仓，
           建了也收不到一粒铜板。与其让玩家花 220 铜板买个教训，
           不如直接拦住并说明原因（和「军营需要兵营」同一套处理）。 */
        if (!lockWhy && t === 'mine' && v.mineCap <= 0) lockWhy = '需要先建造铜板库';
        if (!lockWhy && cap === 0) {
          let unlockAt = 0;
          for (let L = 1; L <= BUILDINGS[t].up.length; L++) {
            if (maxCount(t, L) > 0) { unlockAt = L; break; }
          }
          lockWhy = unlockAt ? `市政厅 ${unlockAt} 级解锁` : '暂未开放';
        }
        const price = cost.gold ? `<span class="gold">${ICO_GOLD}${fmtNum(cost.gold)}</span>`
                                 : `<span class="elixir">${ICO_ELIXIR}${fmtNum(cost.elixir)}</span>`;
        const tag = d.unique ? '唯一' : `${have}/${cap}`;
        body += `<div class="card ${atCap || lockWhy ? 'disabled' : ''}" data-t="${t}">
          <div class="ctag">${tag}</div>
          <div class="ci">${d.emoji}</div>
          <div class="cn">${d.name}${d.up.length > 1 ? `<span class="cl">Lv1</span>` : ''}</div>
          <div class="cdesc">${d.desc}</div>
          <div class="cprice">${price}<span style="font-size:11px;color:#6b6178;font-weight:700">· ${fmtTime(cost.time)}</span></div>
          ${lockWhy ? `<div class="lockmsg">${lockWhy}</div>` : (atCap ? `<div class="lockmsg">已达 ${cap} 座上限</div>` : '')}
        </div>`;
      }
      body += `</div>`;
    }
    body += `<div style="height:6px"></div>`;
    this.openSheet('shop', body);

    this.sheetInner.querySelectorAll('.card').forEach((el) => {
      el.addEventListener('click', () => {
        const t = el.dataset.t;
        this.closeSheet();
        this.act.startPlace && this.act.startPlace(t);
      });
    });
  }

  /* ---------------- 军队 ---------------- */
  /* 打开时清空签名：面板可能已被商店/任务顶掉，必须无条件重建一次 */
  openArmy() { this._armySig = null; this._renderArmy(); }

  _renderArmy() {
    const v = this.village;
    const a = this.army;
    const info = v.barracksInfo;
    const used = a.housingUsed, total = v.housingTotal;

    /* 【2026-10-14 性能修复】面板内容只由下面这几项决定：
       兵营等级/速度、容量与待命数、队列构成、各兵种是否可训练。
       签名没变就整段跳过 —— 不重建 innerHTML，也不重新绑定 click。
       队列进度条由 _tickTraining 每 0.25 秒局部刷新（同 _tickQueue 的思路）。
       ⚠️ 刻意不含「剩余秒数」：否则每秒都要重建一次。
       ⚠️ openArmy() 会清空签名，保证面板被商店/任务顶掉后再打开必定重建。 */
    const sig = [
      info.level, info.speed, used, total, a.totalTroops,
      a.queue.map((q) => q.type).join(','),
      Object.keys(TROOPS).map((k) => (a.unlocked(k) ? (a.canTrain(k).ok ? 1 : 2) : 0)).join(''),
    ].join('|');
    if (sig === this._armySig) return;
    this._armySig = sig;

    let body = `<div class="sheet-title"><h2>军队</h2><p>兵营 ${info.level} 级 · 训练速度 ×${info.speed.toFixed(2)}</p></div>`;
    body += `<div class="army-summary">
      <div class="as"><small>军营容量</small><b>${used} / ${total}</b></div>
      <div class="as"><small>待命部队</small><b>${a.totalTroops}</b></div>
      <div class="as"><small>训练队列</small><b>${a.queue.length}</b></div>
    </div>`;

    body += `<div class="sheet-section">训练部队</div><div class="troop-grid">`;
    for (const k in TROOPS) {
      const t = TROOPS[k];
      const unlock = a.unlocked(k);
      const can = a.canTrain(k);
      body += `<div class="troop-card" data-k="${k}" style="${unlock ? '' : 'opacity:.5'}">
        <div class="ci">${t.emoji}</div>
        <div class="cn">${t.name} <span style="font-size:10px;color:#6b6178">容量${t.housing}</span></div>
        <div class="cm">${t.desc}</div>
        <div class="cprice">${ICO_ELIXIR}${t.cost}<span style="font-size:10.5px;color:#6b6178;margin-left:4px">${fmtTime(t.trainTime)}</span></div>
        ${unlock ? (can.ok ? '' : `<div class="lockmsg">${can.why}</div>`) : `<div class="lockmsg">需兵营 ${t.unlockBarracks} 级</div>`}
      </div>`;
    }
    body += `</div>`;

    body += `<div class="sheet-section">训练队列（点击取消）</div>`;
    if (!a.queue.length) body += `<div style="color:#6b6178;font-size:13px;font-weight:600;padding:4px 4px 12px">队列为空</div>`;
    else {
      body += `<div class="train-queue">`;
      a.queue.forEach((q, i) => {
        const pct = Math.max(0, 100 - (q.left / Math.max(1, q.total)) * 100);
        body += `<div class="tq-item" data-i="${i}">
          <div class="fill" style="height:${pct}%"></div>
          <span style="position:relative">${TROOPS[q.type].emoji}</span>
          <div class="x">×</div>
        </div>`;
      });
      body += `</div>`;
    }
    this.openSheet('army', body);

    this.sheetInner.querySelectorAll('.troop-card').forEach((el) => {
      el.addEventListener('click', () => {
        const r = this.army.train(el.dataset.k);
        if (!r.ok) this.toast(r.why, 'warn');
        else this._bump(el);
        this._renderArmy();
      });
    });
    this.sheetInner.querySelectorAll('.tq-item').forEach((el) => {
      el.addEventListener('click', () => {
        this.army.cancel(+el.dataset.i);
        this._renderArmy();
      });
    });
  }

  /* ---------------- 进攻 ---------------- */
  /** 把某一档敌村的建筑+城墙总血量折算成「大约需要多少个野蛮人」。
   *  野蛮人 dps 14，按一场仗 90 秒有效输出估算 —— 只是量级参考，
   *  目的是让玩家在出征前就知道这仗是轻松还是送死，而不是进去才发现。 */
  _tierNeed(tierId) {
    const cfg = COMPO[Math.min(tierId, COMPO.length - 1)];
    if (!cfg) return 0;
    let hp = maxHp('townhall', cfg.th);
    for (const group of [cfg.def, cfg.res]) {
      for (const k in group) hp += group[k] * maxHp(k, cfg.th);
    }
    if (cfg.walls) {
      const R = 4 + cfg.th;
      hp += Math.round(8 * R * 0.97) * maxHp('wall', cfg.th);   // 一圈墙，扣掉 3 格城门
    }
    return Math.max(1, Math.ceil(hp / (14 * 90)));
  }

  /**
   * 对手的「类型:等级」清单 → 建议兵力。
   *
   * 与 _tierNeed 的区别：那个是按 NPC 档位的固定配置 COMPO 猜，
   * 这个是按对手**真实存在**的建筑算。客户端自带 maxHp()，
   * 所以不需要服务端把血量表镜像一份过来。
   *
   * @param {string} compo 形如 "cannon:3,townhall:2,wall:1"
   */
  _needFrom(compo) {
    if (!compo) return 0;
    let hp = 0;
    for (const seg of String(compo).split(',')) {
      const [y, l] = seg.split(':');
      if (!BUILDINGS[y]) continue;                 // 未知类型跳过
      hp += maxHp(y, Math.max(1, Math.min(5, Number(l) || 1)));
    }
    return Math.max(1, Math.ceil(hp / (14 * 90)));  // 野蛮人 dps 14 × 90 秒
  }

  /**
   * 结果卡上的铜板数字。
   * PVP 当场就知道确切数字（真实转移已完成）；NPC 要等服务端按星级结算。
   */
  _coinText(res) {
    if (res.pvp) return res.coinsGained ? '+' + res.coinsGained : '无';
    /* NPC 演练自 2026-09-30 起不发铜板（服务端 NPC_BATTLE_COIN_REWARD=false）。
       这里必须直接写「无」而不是「结算中…」—— 后者会让玩家一直等一笔不会来的钱。 */
    return '无';
  }

  /**
   * 结果卡上的铜板说明。
   * PVP 的两种「没拿满」必须分开解释 —— 否则玩家会以为系统吞了他的钱。
   */
  _coinNote(res) {
    const wrap = (t) => `<div class="sel-note" style="margin-bottom:10px">${t}</div>`;
    if (res.pvp) {
      if (res.defenderShort) return wrap('对手铜板不足，实得少于应得');
      if (res.capped) return wrap('今日战斗铜板已达上限');
      if (res.coinsGained) return wrap('铜板已从对方部落转移');
      return '';
    }
    /* 明确告知 NPC 演练不发币，并指出铜板的真正来源。
       不写这句的话，玩家打完一场「胜 3 星」却一分钱没有，会觉得是 bug。 */
    if (res.stars >= 1) {
      return wrap('演练关卡不计铜板 · 铜板通过学习获取');
    }
    return '';
  }

  /** HTML 转义。对手名来自 users.username，必须转义 —— 否则一个叫
   *  `<img onerror=...>` 的账号就能打穿所有人的进攻面板。 */
  _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async openAttack() {
    const v = this.village;
    const th = v.thLevel;
    const a = this.army;
    let body = `<div class="sheet-title"><h2>进攻</h2><p>出征的部队若存活会返回军营</p></div>`;
    if (!a.hasTroops) {
      body += `<div class="row-item" style="border-color:#ffd0d0;background:#fff6f6">
        <div class="ri">⚠️</div><div class="rt"><b>还没有可以出征的部队</b>
        <small>先去「军队」训练几个野蛮人吧</small></div></div>`;
    } else {
      const list = Object.keys(a.reserve).filter((k) => a.reserve[k] > 0)
        .map((k) => `${TROOPS[k].emoji}${a.reserve[k]}`).join('  ');
      body += `<div class="row-item"><div class="ri">🎒</div>
        <div class="rt"><b>待命部队</b><small>${list}</small></div>
        <div class="rr">${a.totalTroops} 个</div></div>`;
    }

    body += `<div class="sheet-section">选择对手</div><div id="opp-box">
      <div style="color:#8a7f97;font-size:13px;font-weight:600;padding:4px 4px 12px">搜索其他部落…</div>
    </div>`;
    this.openSheet('attack', body);

    /* 真人列表是异步拉的。先占个位渲染出来，避免点开面板有半秒空白；
       拿不到（断网 / 401 / 没人可打）就降级回 NPC 演练关卡。 */
    const list = await bridge.fetchOpponents();
    const box = this.sheetInner.querySelector('#opp-box');
    if (!box) return;   // 玩家已经把面板关了

    /* 今日真人进攻次数（2026-10-14 新增日限）。
       用完了就不再列真人 —— 否则玩家点下去只会拿到一句 429，白跑一趟。 */
    const pvpLeft = list && list.ok && list.pvpLeft != null ? Number(list.pvpLeft) : NaN;
    const pvpMax = Number((list && list.pvpMax) || 2);

    if (!list || !list.ok || !Array.isArray(list.items) || list.items.length === 0) {
      /* 三种降级原因分开措辞：
         disabled  = 对战整块还没开放（服务端 503），不是玩家的错，别写成「加载失败」
         ok        = 真没人可打（新服冷启动），说清是"暂时"的
         其它      = 真的拉取失败了 */
      const note = list && list.disabled
        ? '对战功能暂未开放，以下为演练关卡'
        : (list && list.ok
            ? '暂时没有匹配的部落，以下为演练关卡'
            : '对手列表加载失败，以下为演练关卡');
      this._renderNpcTiers(box, th, a, note);
    } else if (pvpLeft === 0) {
      this._renderNpcTiers(box, th, a, `今日进攻真人的次数已用完（每天 ${pvpMax} 次），以下为演练关卡`);
    } else {
      this._renderOpponents(box, list.items, a, pvpLeft, pvpMax);
    }
  }

  /** 真人对手列表 */
  _renderOpponents(box, items, a, pvpLeft, pvpMax) {
    /* 豁免账号（2026-11-14）：服务端下发超大上限，这里只改文案，避免显示 999998/999999 */
    const pvpExempt = pvpMax >= 10000;
    const quota = Number.isFinite(pvpLeft) && pvpLeft > 0
      ? (pvpExempt
          ? `<div style="color:#5b4b8a;font-size:12px;font-weight:700;padding:0 4px 10px">
           今日真人进攻 <b>不限次数</b> · 真人防守有护盾，会被抢走铜板
         </div>`
          : `<div style="color:#5b4b8a;font-size:12px;font-weight:700;padding:0 4px 10px">
           今日还可进攻真人 <b>${pvpLeft}</b> / ${pvpMax} 次 · 真人防守有护盾，会被抢走铜板
         </div>`)
      : '';
    let html = quota;
    for (const o of items) {
      const need = this._needFrom(o.compo);
      const ratio = need > 0 ? (a.totalTroops || 0) / need : 2;
      const chip = ratio >= 1.6 ? ['轻松', '#1f8a5c', '#e8f7ef']
        : ratio >= 1.0 ? ['势均力敌', '#a06a12', '#fdf5e4']
        : ['兵力不足', '#c0392b', '#fdecea'];
      html += `<div class="row-item" data-uid="${Number(o.userId)}">
        <div class="ri">🏛️</div>
        <div class="rt"><b>${this._esc(o.name)} · 市政厅 ${Number(o.th)} 级
          <span style="font-size:11px;font-weight:800;padding:2px 7px;border-radius:8px;color:${chip[1]};background:${chip[2]};vertical-align:1px">${chip[0]}</span></b>
          <small>${Number(o.buildingCnt)} 座建筑 · 城墙 ${Number(o.wallCnt)} 段</small>
          <div style="display:flex;gap:8px;margin-top:5px;font-size:11.5px;font-weight:700;color:#6b6178">
            <span style="display:flex;align-items:center;gap:3px">${ICO_ELIXIR}${fmtNum(o.lootElixir)}</span>
            <span style="display:flex;align-items:center;gap:3px">${ICO_GOLD}${Number(o.lootCoins)}</span>
            <span style="color:#8a7f97">建议兵力 ≈ ${need}</span>
          </div>
        </div>
        <div class="rr">出发 ›</div>
      </div>`;
    }
    html += `<button class="gbtn" id="reroll" style="width:100%;margin-top:10px">
      换一批 · ${ICO_GOLD}${REROLL_COST}</button>`;
    box.innerHTML = html;

    box.querySelectorAll('[data-uid]').forEach((el) => {
      el.addEventListener('click', () => {
        if (!a.hasTroops) { this.toast('没有可以出征的部队', 'warn'); return; }
        const name = el.querySelector('.rt b') ? el.querySelector('.rt b').textContent : '这个对手';
        this._confirmBattle(`对手：${name}`, () => {
          this.closeSheet();
          this.act.startBattle && this.act.startBattle({ mode: 'pvp', userId: +el.dataset.uid });
        });
      });
    });
    const rr = box.querySelector('#reroll');
    if (rr) rr.addEventListener('click', () => this._reroll());
  }

  /**
   * 换一批对手 —— 服务端收 REROLL_COST 铜板。
   *
   * 不重新 openAttack()：那会把整个面板重建、丢失当前滚动位置，
   * 也会多打一次免费的 /opponents。这里只替换列表区。
   * 金额与余额都以服务端回包为准（客户端算不了账）。
   */
  async _reroll() {
    const box = this.sheetInner && this.sheetInner.querySelector('#opp-box');
    if (!box) return;
    const v = this.village;
    const a = this.army;
    // 本地先挡一下，省掉一次注定失败的往返（服务端仍会独立校验）
    if ((Number(v.res.gold) || 0) < REROLL_COST) {
      this.toast(`铜板不足，换一批需要 ${REROLL_COST} 铜板`, 'warn');
      return;
    }
    const r = await bridge.rerollOpponents();
    if (!r || !r.ok) {
      this.toast((r && r.error) || '换一批失败，请稍后再试', 'warn');
      return;
    }
    // 服务端才是钱的真源：用它的余额覆盖本地镜像
    if (typeof r.balance === 'number') {
      v.res.gold = r.balance;
      v._emitChange();
    }
    if (Number(r.charged) > 0) this.toast(`换一批 · -${Number(r.charged)} 铜板`, '');
    if (!Array.isArray(r.items) || r.items.length === 0) {
      this._renderNpcTiers(box, v.thLevel, a, '暂时没有匹配的部落，以下为演练关卡');
    } else {
      this._renderOpponents(box, r.items, a, r.pvpLeft, r.pvpMax);
    }
  }

  /** 降级：NPC 演练关卡（原 RAID_TIERS 列表，逻辑一行未改） */
  _renderNpcTiers(box, th, a, note) {
    box.innerHTML = note
      ? `<div style="color:#8a7f97;font-size:12px;font-weight:600;padding:0 4px 10px">${this._esc(note)}</div>`
      : '';
    let html = '';
    for (const t of RAID_TIERS) {
      const locked = th < t.minTH;
      const bonus = t.loot;
      const need = this._tierNeed(t.id);
      const ratio = need > 0 ? (a.totalTroops || 0) / need : 2;
      const chip = locked ? null
        : ratio >= 1.6 ? ['轻松', '#1f8a5c', '#e8f7ef']
        : ratio >= 1.0 ? ['势均力敌', '#a06a12', '#fdf5e4']
        : ['兵力不足', '#c0392b', '#fdecea'];
      const chipHtml = chip
        ? ` <span style="font-size:11px;font-weight:800;padding:2px 7px;border-radius:8px;color:${chip[1]};background:${chip[2]};vertical-align:1px">${chip[0]}</span>`
        : '';
      html += `<div class="row-item ${locked ? 'done' : ''}" data-tier="${t.id}" style="${locked ? 'pointer-events:none' : ''}">
        <div class="ri">${['🏚️', '⛺', '🏰', '🌋', '🖤'][t.id]}</div>
        <div class="rt"><b>${t.name} · 市政厅 ${t.th} 级${chipHtml}</b><small>${t.desc}</small>
          <div style="display:flex;gap:8px;margin-top:5px;font-size:11.5px;font-weight:700;color:#6b6178">
            <span style="display:flex;align-items:center;gap:3px">${ICO_ELIXIR}${fmtNum(bonus)}</span>
            <span style="color:#8a7f97">演练不计铜板</span>
            <span style="color:#8a7f97">建议兵力 ≈ ${need}</span>
          </div>
        </div>
        <div class="rr">${locked ? `需市政厅 ${t.minTH} 级` : '出发 ›'}</div>
      </div>`;
    }
    box.insertAdjacentHTML('beforeend', html);

    box.querySelectorAll('[data-tier]').forEach((el) => {
      el.addEventListener('click', () => {
        if (!a.hasTroops) { this.toast('没有可以出征的部队', 'warn'); return; }
        const name = el.querySelector('.rt b') ? el.querySelector('.rt b').textContent : '这个关卡';
        this._confirmBattle(`关卡：${name}`, () => {
          this.closeSheet();
          this.act.startBattle && this.act.startBattle({ mode: 'npc', tierIndex: +el.dataset.tier });
        });
      });
    });
  }

  /**
   * 出征二次确认。
   *
   * 【2026-11-06 按需求】原来点一下「出发」就直接进战斗，误触一次：
   *   · PVP 会先锁定对手、扣掉当天进攻次数；
   *   · 已经派出去的兵打了就打了，阵亡不返还。
   * 反馈 285（吕心怡）说的「不小心点到进攻，退出来兵全没了」就是这个。
   * 这里只加一道确认，不改任何战斗逻辑。
   */
  _confirmBattle(label, onYes) {
    this._modal(`
      <h2>确认出征</h2>
      <div class="sub">派出后阵亡的部队不会返还</div>
      <div style="font-size:13px;color:#7b86ad;margin:10px 0 16px">${this._esc(String(label || ''))}</div>
      <div class="sel-actions">
        <button class="gbtn" style="background:#e9e2f2;color:#5a4f6b;flex:1" data-r="no">再想想</button>
        <button class="gbtn" style="background:linear-gradient(160deg,#ffb36b,#e8791d);color:#fff;flex:1" data-r="yes">出发</button>
      </div>
    `, (r) => { if (r === 'yes') onYes(); });
  }

  /* ---------------- 编辑 ---------------- */
  openEdit() {
    let body = `<div class="sheet-title"><h2>编辑村庄</h2><p>重排布局，不会消耗资源</p></div>`;
    body += `<div class="sheet-section">操作提示</div>`;
    const tips = [
      ['👆', '单指拖动', '平移视角'],
      ['🤏', '双指张合', '缩放镜头'],
      ['🔄', '双指旋转', '旋转视角'],
      ['🏠', '点击建筑', '升级 / 移动 / 拆除'],
      ['🧱', '放置城墙', '拖拽可连续放置'],
    ];
    for (const [i, t, d] of tips) {
      body += `<div class="row-item" style="cursor:default"><div class="ri">${i}</div>
        <div class="rt"><b>${t}</b><small>${d}</small></div></div>`;
    }
    body += `<div class="sheet-section">画质</div><div id="q-opts" style="display:flex;gap:8px"></div>`;
    this.openSheet('edit', body);

    const qBox = this.sheetInner.querySelector('#q-opts');
    const cur = this.act.getQuality ? this.act.getQuality() : 'high';
    [['low', '流畅'], ['mid', '均衡'], ['high', '精细']].forEach(([k, label]) => {
      const b = h(`<button class="gbtn ${k === cur ? 'up' : ''}" style="${k === cur ? '' : 'background:#e9e2f2;color:#5a4f6b'}">${label}</button>`);
      b.addEventListener('click', () => {
        this.act.setQuality && this.act.setQuality(k);
        this.openEdit();
      });
      qBox.appendChild(b);
    });
  }

  /* ---------------- 任务 ---------------- */
  openQuests() {
    this._renderQuests();
  }

  _renderQuests() {
    const v = this.village;
    let body = `<div class="sheet-title"><h2>任务</h2><p>完成任务可获得宝石</p></div>`;
    for (const q of QUESTS) {
      const done = v.doneQuests.has(q.id);
      const p = v.questProgress(q);
      const pct = Math.min(100, (p / q.goal) * 100);
      body += `<div class="row-item ${done ? 'done' : ''}" style="cursor:default">
        <div class="ri">${q.emoji}</div>
        <div class="rt"><b>${q.name}${done ? ' ✓' : ''}</b><small>${q.desc} · ${p}/${q.goal}</small>
          <div class="quest-bar"><i style="width:${pct}%"></i></div></div>
        <div class="rr" style="display:flex;align-items:center;gap:3px;color:${done ? '#1f8a5c' : '#6b6178'}">
          ${ICO_GEM}${q.reward}</div>
      </div>`;
    }
    body += `<div class="sheet-section">战绩</div>
      <div class="army-summary">
        <div class="as"><small>出征次数</small><b>${v.stat.battles}</b></div>
        <div class="as"><small>获胜</small><b>${v.stat.raidsWon}</b></div>
        <div class="as"><small>累计星数</small><b>${v.stat.stars}</b></div>
      </div><div style="height:6px"></div>`;
    this.openSheet('quests', body);
  }

  /* ---------------- 新手引导 ---------------- */
  /** 首次进入弹 4 步引导。已看过且非强制时返回 false，调用方据此决定还弹不弹欢迎提示。 */
  showGuide(force) {
    const KEY = 'toonvillage.guide.v1';
    let seen = false;
    try { seen = localStorage.getItem(KEY) === '1'; } catch (e) {}
    if (seen && !force) return false;

    const steps = [
      ['🏡', '这是你的村庄',
        '拖动屏幕平移视角；滚轮或双指张合缩放；右键拖动或双指旋转换个角度看。'],
      ['📚', '铜板来自学习',
        '建造和升级都花铜板，而铜板只能靠学习卡片和复习赚取。先建「学识矿脉」能把学习收益再放大。'],
      ['🏛️', '再升市政厅',
        '点任意建筑即可升级；市政厅等级决定其它建筑的等级上限和新建筑解锁。'],
      ['⚔️', '最后去掠夺',
        '「军队」训练士兵，「进攻」选对手。摧毁 50% 得一星，拆掉市政厅得两星，星级越高铜板奖励越多。'],
    ];

    let i = 0;
    const render = () => {
      const [ico, title, desc] = steps[i];
      const last = i === steps.length - 1;
      const dots = steps.map((_, k) => '<i style="width:' + (k === i ? 18 : 6)
        + 'px;height:6px;border-radius:3px;display:inline-block;background:'
        + (k === i ? '#4a7fd6' : 'rgba(0,0,0,.14)') + '"></i>').join('');
      this._modal(`
        <h2>${title}</h2>
        <div class="sub">${desc}</div>
        <div style="font-size:46px;line-height:1.15;margin:8px 0 6px">${ico}</div>
        <div style="display:flex;gap:6px;justify-content:center;margin-bottom:16px">${dots}</div>
        <div class="sel-actions">
          ${i > 0 ? '<button class="gbtn" style="background:#e9e2f2;color:#5a4f6b" data-r="prev">上一步</button>' : ''}
          <button class="gbtn up" data-r="next">${last ? '知道啦，开打' : '下一步'}</button>
        </div>
      `, (r) => {
        if (r === 'prev') { i = Math.max(0, i - 1); render(); return; }
        if (r !== 'next') return;
        if (i < steps.length - 1) { i++; render(); return; }
        try { localStorage.setItem(KEY, '1'); } catch (e) {}
        sfx.done();
        this.toast('先点「商店」建一座圣水收集器，攒够圣水就能升学识矿脉', 'good');
      });
    };
    render();
    return true;
  }

  /* ---------------- 设置 ---------------- */
  openSettings() {
    const cur = this.act.getQuality ? this.act.getQuality() : 'high';
    let body = `<div class="sheet-title"><h2>设置</h2><p>刻忆觉醒 · 三渲二村庄</p></div>`;
    body += `<div class="sheet-section">画质（影响 iPad 发热与流畅度）</div>
      <div style="display:flex;gap:8px" id="set-q"></div>`;
    body += `<div class="sheet-section">性能 · 实时</div>
      <div class="army-summary">
        <div class="as"><small>帧率</small><b id="pf-fps">–</b></div>
        <div class="as"><small>Draw Call</small><b id="pf-draw">–</b></div>
        <div class="as"><small>三角面</small><b id="pf-tris">–</b></div>
      </div>
      <div style="font-size:11.5px;color:#6b6178;font-weight:600;padding:0 4px 10px">
        帧率掉到 40 以下就切「均衡」：低画质会自动关掉描边与阴影，几何量减半。
      </div>`;
    body += `<div class="sheet-section">音效</div>
      <div style="display:flex;gap:8px" id="set-s"></div>`;
    body += `<div class="sheet-section">帮助</div>
      <div class="row-item" data-a="guide"><div class="ri">🧭</div>
        <div class="rt"><b>操作说明 / 新手引导</b><small>随时重看开局那 4 步</small></div><div class="rr">›</div></div>`;
    body += `<div class="sheet-section">数据</div>
      <div class="row-item" data-a="save"><div class="ri">💾</div>
        <div class="rt"><b>立即保存</b><small>进度自动保存在本设备</small></div><div class="rr">›</div></div>
      <div class="row-item" data-a="reset"><div class="ri">🗑️</div>
        <div class="rt"><b>重置游戏</b><small>清空村庄与部队，重新开始</small></div><div class="rr" style="color:#e8452f">重置</div></div>`;
    body += `<div class="sheet-section">关于</div>
      <div class="row-item" style="cursor:default"><div class="ri">🎨</div>
        <div class="rt"><b>三渲二渲染</b><small>阶梯色阶光照 + 平直着色 + 反壳描边，全部几何体程序化生成，无任何外部贴图资源。</small></div></div>
      <div style="height:8px"></div>`;
    this.openSheet('settings', body);

    const qBox = this.sheetInner.querySelector('#set-q');
    [['low', '流畅'], ['mid', '均衡'], ['high', '精细']].forEach(([k, label]) => {
      const b = h(`<button class="gbtn ${k === cur ? 'up' : ''}" style="${k === cur ? '' : 'background:#e9e2f2;color:#5a4f6b'}">${label}</button>`);
      b.addEventListener('click', () => { this.act.setQuality && this.act.setQuality(k); this.openSettings(); });
      qBox.appendChild(b);
    });

    /* 音效开关：默认开，关掉后 localStorage 记住 */
    const sBox = this.sheetInner.querySelector('#set-s');
    const sOn = this.act.getSound ? this.act.getSound() : soundEnabled();
    [['on', '开启'], ['off', '关闭']].forEach(([k, label]) => {
      const on = (k === 'on') === !!sOn;
      const b = h(`<button class="gbtn ${on ? 'up' : ''}" style="${on ? '' : 'background:#e9e2f2;color:#5a4f6b'}">${label}</button>`);
      b.addEventListener('click', () => {
        if (this.act.setSound) this.act.setSound(k === 'on');
        else setSound(k === 'on');
        this.openSettings();
      });
      sBox.appendChild(b);
    });

    this.sheetInner.querySelectorAll('[data-a]').forEach((el) => {
      el.addEventListener('click', () => {
        const a = el.dataset.a;
        if (a === 'save') { this.village.save(true); this.army.save(true); this.toast('已保存', 'good'); }
        if (a === 'guide') {
          this.closeSheet();
          if (this.act.showGuide) this.act.showGuide(); else this.showGuide(true);
        }
        if (a === 'reset') {
          this._modal(`
            <h2>重置游戏？</h2><div class="sub">村庄、部队、任务进度都会被清空</div>
            <div class="sel-actions">
              <button class="gbtn" style="background:#e9e2f2;color:#5a4f6b" data-r="no">取消</button>
              <button class="gbtn" style="background:linear-gradient(160deg,#ff9c9c,#d94a4a)" data-r="yes">确认重置</button>
            </div>`, (r) => { if (r === 'yes') this.act.resetGame && this.act.resetGame(); });
        }
      });
    });
  }

  /* ============================================================
     模态
     ============================================================ */
  _modal(inner, cb) {
    const card = $('result-card');
    card.className = 'modal-card';
    card.innerHTML = `<div style="text-align:center">${inner}</div>`;
    this.result.classList.remove('hidden');
    card.querySelectorAll('[data-r]').forEach((el) => {
      el.addEventListener('click', () => {
        this.result.classList.add('hidden');
        cb && cb(el.dataset.r);
      });
    });
  }
  hideModal() { this.result.classList.add('hidden'); }

  showResult(res, onClose) {
    const stars = [0, 1, 2].map((i) => `<div class="st">${ICO_STAR(i < res.stars)}</div>`).join('');
    const title = res.stars === 3 ? '完美胜利！' : res.stars >= 1 ? '进攻成功' : '进攻失败';
    const sub = res.stars >= 3 ? '全村夷为平地' : res.stars === 2 ? '市政厅已被摧毁' : res.stars === 1 ? '摧毁了一半以上的建筑' : '下次换个兵种组合试试';

    const surv = Object.keys(res.survivors).filter((k) => res.survivors[k] > 0)
      .map((k) => `${TROOPS[k].emoji}×${res.survivors[k]}`).join(' ');
    /* 【2026-11-06 按需求】战报只写了「返回军营」，没写死了多少。
       打输的时候 survivors 全空，玩家看到的就只有一行「进攻失败」，
       不知道自己损失了几个兵 —— 反馈 116（郑茂林）要的就是这个数。 */
    const lost = Object.keys(res.deployed || {}).map((k) => {
      const n = (res.deployed[k] || 0) - (res.survivors[k] || 0);
      return n > 0 ? `${TROOPS[k].emoji}×${n}` : '';
    }).filter(Boolean).join(' ');

    const card = $('result-card');
    card.className = 'modal-card';
    card.innerHTML = `
      <h2>${title}</h2>
      <div class="sub">${sub}</div>
      <div class="result-stars">${stars}</div>
      <div class="loot-grid">
        <div class="loot-box"><small>摧毁度</small><b>${res.pct}%</b></div>
        <div class="loot-box gem"><small>宝石</small><b>+${res.gems}</b></div>
        <div class="loot-box elixir"><small>掠夺圣水</small><b>+${fmtNum(res.elixir)}</b></div>
        <div class="loot-box gold"><small>${res.pvp ? '掠夺铜板' : '铜板奖励'}</small><b>${this._coinText(res)}</b></div>
      </div>
      ${this._coinNote(res)}
      ${surv ? `<div class="sel-note" style="margin-bottom:14px">返回军营：${surv}</div>` : ''}
      ${lost ? `<div class="sel-note" style="margin-bottom:14px;color:#c0392b">阵亡：${lost}</div>` : ''}
      <button class="gbtn up" data-r="ok" style="width:100%;height:46px">返回村庄</button>
    `;
    if (res.stars >= 1) sfx.win(); else sfx.lose();
    this.result.classList.remove('hidden');
    card.querySelector('[data-r="ok"]').addEventListener('click', () => {
      this.result.classList.add('hidden');
      onClose && onClose();
    });
  }

  /* ============================================================
     战斗 HUD
     ============================================================ */
  setBattleMode(on) {
    this.battleHud.classList.toggle('hidden', !on);
    this.dock.classList.toggle('hide', on);
    $('hud').style.opacity = on ? '0' : '1';
    $('hud').style.pointerEvents = on ? 'none' : 'auto';
    this.queue.style.opacity = on ? '0' : '1';
    if (!on) this.closeSheet();
  }

  renderTroopDock(battle) {
    const dock = $('troop-dock');
    let html = '';
    for (const k in TROOPS) {
      const n = battle.reserve[k] || 0;
      const t = TROOPS[k];
      const sel = battle.selected === k;
      html += `<div class="troop-slot ${n > 0 ? '' : 'empty'} ${sel ? 'sel' : ''}" data-k="${k}">
        <div class="ti">${t.emoji}</div>
        <div class="tn">${t.name}</div>
        ${n > 0 ? `<div class="tc">${n}</div>` : ''}
      </div>`;
    }
    dock.innerHTML = html;
    dock.querySelectorAll('.troop-slot').forEach((el) => {
      el.addEventListener('click', () => {
        const k = el.dataset.k;
        if ((battle.reserve[k] || 0) <= 0) return;
        battle.select(k);
        this.renderTroopDock(battle);
      });
    });
  }

  updateBattleHUD(battle) {
    $('bst-dmg').textContent = Math.round(battle.pct) + '%';
    $('bst-bar').style.width = battle.pct + '%';
    const s = Math.max(0, Math.ceil(battle.time));
    const timeEl = $('bst-time');
    timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    // 最后 30 秒变红：不用一直盯着计时器也知道要收尾了
    timeEl.classList.toggle('low', s <= 30);
    const st = $('bst-stars').children;
    for (let i = 0; i < 3; i++) st[i].classList.toggle('on', i < battle.stars);
  }

  /* ============================================================
     加载页
     ============================================================ */
  loaderProgress(pct, tip) {
    const b = $('loader-bar');
    if (b) b.style.width = Math.max(4, pct) + '%';
    if (tip) $('loader-tip').textContent = tip;
  }
  hideLoader() {
    const l = this.loader;
    if (!l) return;
    l.classList.add('out');
    setTimeout(() => l.remove(), 600);
  }
}
