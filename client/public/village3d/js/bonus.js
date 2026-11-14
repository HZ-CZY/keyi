/* ============================================================
   bonus.js — 部落铜板彩蛋（2026-10-19）
   ------------------------------------------------------------
   · 村庄里每隔 1~2.5 分钟随机冒出一枚铜板，停留 30 秒；
   · 点开答一道四选一，答对 +5 铜板；答错这枚就没收；
   · 每天最多 5 次（25 铜板），次数由服务端按流水统计，客户端只做展示；
   · 战斗进行中不生成（避免挡住部署），已经出现的会在开战时收起。

   金币用 HTML 覆盖层而不是 3D 模型：每帧把世界坐标投影到屏幕，
   点击判定交给按钮自己 —— 不依赖 raycast，手机上也好点。
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';
import { gridToWorld } from './config.js';

const $ = (id) => document.getElementById(id);

/** 出现后停留多久 */
const STAY_MS = 30_000;
/** 两次出现的间隔 */
const GAP_MIN = 60_000;
const GAP_MAX = 150_000;
/** 候选落点（村庄外围，尽量不挡视线；被占用会跳过） */
const SPOTS = [
  [7, 7], [32, 7], [7, 32], [32, 32],
  [20, 6], [6, 20], [33, 20], [20, 33],
  [12, 12], [27, 27], [12, 27], [27, 12],
];

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export class CoinBonus {
  /**
   * @param {object} opts
   * @param {object} opts.engine
   * @param {object} opts.village
   * @param {object} opts.ui
   * @param {object} opts.bridge
   * @param {() => boolean} opts.isBusy 战斗等场景返回 true（不生成）
   */
  constructor({ engine, village, ui, bridge, isBusy }) {
    this.engine = engine;
    this.village = village;
    this.ui = ui;
    this.bridge = bridge;
    this.isBusy = isBusy || (() => false);

    this.el = $('coin-bonus');
    this.modal = $('bonus-modal');
    this.card = $('bonus-card');

    this.remaining = 0;
    this.active = false;
    this.pos = null;
    this._hideAt = 0;
    this._nextAt = 0;
    this._timer = null;
    this._raf = 0;
    this._open = false;
    this._answered = false;
    this._busyQuiz = false;

    this._v = new THREE.Vector3();

    this.el?.addEventListener('click', () => this._openQuiz());
    this.modal?.addEventListener('click', (e) => {
      if (e.target === this.modal) this._finishRound();  // 点遮罩放弃本次
    });
  }

  async init() {
    if (!this.el) return;
    /* 等握手拿到 token（云端模式才有彩蛋；离线/未登录直接不出现） */
    for (let i = 0; i < 20 && !this.bridge.hasToken(); i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!this.bridge.hasToken()) return;

    const st = await this.bridge.request('GET', '/api/village/bonus/status');
    this.remaining = st ? Number(st.remaining) || 0 : 0;
    if (this.remaining <= 0) return;   // 今天领满了，不再生成

    this._schedule(18_000 + Math.random() * 42_000);   // 第一枚 18~60 秒后出现
    this._timer = window.setInterval(() => this._tick(), 1000);
    this._raf = requestAnimationFrame(() => this._loop());
  }

  /** 战斗开始等场景调用：把当前金币收起来（下次再随机） */
  hide() {
    if (!this.active) return;
    this.active = false;
    this.el?.classList.remove('show');
    this._schedule(GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN));
  }

  /* ── 内部 ───────────────────────────────────────────────── */

  _schedule(ms) {
    this._nextAt = Date.now() + ms;
  }

  _tick() {
    if (this._open) return;
    const now = Date.now();
    if (this.active) {
      if (now >= this._hideAt) this.hide();
      return;
    }
    if (this.remaining <= 0 || this.isBusy()) return;
    if (now >= this._nextAt) this._spawn();
  }

  _pickSpot() {
    const free = SPOTS.filter(([gx, gz]) => !this.village.occupantAt(gx, gz));
    const pool = free.length ? free : SPOTS;
    const [gx, gz] = pool[Math.floor(Math.random() * pool.length)];
    return gridToWorld(gx, gz);
  }

  _spawn() {
    this.pos = this._pickSpot();
    this.active = true;
    this._hideAt = Date.now() + STAY_MS;
    this.el.classList.add('show');
    this._updatePos();
  }

  _loop() {
    this._updatePos();
    this._raf = requestAnimationFrame(() => this._loop());
  }

  _updatePos() {
    if (!this.active || !this.pos) return;
    const v = this._v.set(this.pos.x, 1.0, this.pos.z).project(this.engine.camera);
    /* 相机看向别处时（z > 1）先藏起来，免得金币贴到屏幕边缘乱飘 */
    if (v.z > 1) {
      this.el.style.opacity = '0';
      return;
    }
    this.el.style.opacity = '1';
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    this.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
  }

  async _openQuiz() {
    if (this._busyQuiz || !this.active) return;
    this._busyQuiz = true;
    this._open = true;
    /* 先收金币（它已经"被点开"了），避免答题时还挂在地图上 */
    this.active = false;
    this.el.classList.remove('show');

    const res = await this.bridge.request('GET', '/api/village/quiz');
    const it = res && Array.isArray(res.items) ? res.items[0] : null;
    if (!it) {
      this.ui.toast('还没有可出的题，先去学几张卡', 'warn');
      this._finishRound();
      return;
    }
    this._current = it;
    this._answered = false;
    this._renderQuestion(it);
    this._busyQuiz = false;
  }

  _renderQuestion(it) {
    this.card.innerHTML = `
      <h3 class="bonus-title">🪙 铜板彩蛋</h3>
      <p class="bonus-q">${it.qHtml || esc(it.q)}</p>
      <div class="bonus-opts">
        ${it.options
          .map((t, i) => `<button type="button" class="bonus-opt" data-i="${i}">${esc(t)}</button>`)
          .join('')}
      </div>
      <p class="bonus-foot">答对 +5 铜板 · 今日还剩 ${this.remaining} 次</p>`;
    this.modal.classList.remove('hidden');
    this.card.querySelectorAll('.bonus-opt').forEach((b) => {
      b.addEventListener('click', () => this._answer(Number(b.dataset.i)));
    });
  }

  async _answer(pick) {
    if (this._answered || !this._current) return;
    this._answered = true;
    const it = this._current;
    const ok = pick === it.answer;
    const opts = this.card.querySelectorAll('.bonus-opt');
    opts.forEach((b, i) => {
      b.disabled = true;
      if (i === it.answer) b.classList.add('ok');
      else if (i === pick) b.classList.add('no');
    });

    const foot = this.card.querySelector('.bonus-foot');

    if (!ok) {
      if (foot) foot.textContent = '答错了，这枚铜板溜走了…';
      window.setTimeout(() => this._finishRound(), 1400);
      return;
    }

    const r = await this.bridge.request('POST', '/api/village/bonus/claim');
    if (r && r.ok) {
      this.remaining = Number(r.remaining) || 0;
      if (foot) foot.textContent = `+${r.gained} 铜板 · 今日还剩 ${this.remaining} 次`;
      this.ui.toast(`铜板 +${r.gained}`, 'reward');
      /* 余额刷新：走宿主已有的钱包同步，HUD 才会跟着变 */
      this.bridge.fetchWallet().then(() => this.ui.renderHUD()).catch(() => {});
      window.setTimeout(() => this._finishRound(), 1100);
    } else {
      if (foot) foot.textContent = (r && r.error) || '领取失败，稍后再试';
      this.ui.toast((r && r.error) || '领取失败', 'warn');
      window.setTimeout(() => this._finishRound(), 1400);
    }
  }

  _finishRound() {
    this._open = false;
    this._answered = false;
    this._busyQuiz = false;
    this._current = null;
    this.modal?.classList.add('hidden');
    this.el?.classList.remove('show');
    this.active = false;
    if (this.remaining > 0) {
      this._schedule(GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN));
    }
  }

  destroy() {
    if (this._timer) window.clearInterval(this._timer);
    if (this._raf) cancelAnimationFrame(this._raf);
    this._timer = null;
    this._raf = 0;
  }
}
