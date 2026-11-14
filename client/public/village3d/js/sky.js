/* ============================================================
   sky.js — 昼夜与天气（2026-10-19）
   ------------------------------------------------------------
   目标：村子不再是永恒的「正午晴天」，而是跟着现实时间走：
     黎明 → 上午 → 正午 → 下午 → 黄昏 → 夜晚，
     再叠加 晴 / 多云 / 雨 三种天气。

   为什么按**真实时间**而不是游戏内循环：
     这是个「每天来学习、顺手看一眼村子」的产品，村子应该和你
     所在的世界同步 —— 晚上打开就是夜景，早上打开就是晨光。
     游戏内循环会让「半夜打开却是大中午」，反而出戏。

   为什么天气要**确定性生成**：
     同一时刻所有玩家、所有设备看到的必须是同一种天气，
     否则「我这边下雨他那边晴」会破坏世界感。所以不用 Math.random，
     而是用「日期 + 8 小时时段」做哈希种子 —— 结果稳定、无需服务端。

   性能：
     · 环境参数每 0.5 秒重算一次，颜色用指数插值过渡（约 1.5 秒完成）；
     · 雨是**一条 LineSegments**（850 滴雨丝、1700 顶点、1 次 draw call），
       下雨时只多这一次绘制，不下雨时整组 visible=false。
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';

/* ------------------------------------------------------------------
   一、昼夜关键帧
   ------------------------------------------------------------------
   每个关键帧描述「该时刻的天空与光」。中间时刻线性插值，24 点回到 0 点。
   sun  —— 太阳/月光的颜色（夜里换成冷蓝月光）
   si   —— 主光强度
   ai   —— 环境光强度（不能太低，否则三渲二的暗部会糊成黑块）
   top/mid/bot —— 天空穹顶三段色
   fog  —— 雾色 / 近端 / 远端
   ------------------------------------------------------------------ */
const KEYS = [
  { h: 0.0,  sun: 0x8ea6d6, si: 0.30, ai: 0.52, top: 0x0b1830, mid: 0x16294a, bot: 0x233a5c, fog: 0x1a2c48, fn: 55, ff: 155 },
  { h: 5.0,  sun: 0x9fb0d8, si: 0.34, ai: 0.56, top: 0x1b2a48, mid: 0x33406b, bot: 0x6b5a72, fog: 0x4a4a66, fn: 58, ff: 160 },
  { h: 6.6,  sun: 0xffb98a, si: 1.00, ai: 0.76, top: 0x3a5a8c, mid: 0x8a7fa0, bot: 0xf0b48a, fog: 0xc9a8a0, fn: 66, ff: 180 },
  { h: 8.0,  sun: 0xffe6c0, si: 2.00, ai: 0.96, top: 0x3f9ada, mid: 0x8ed0ef, bot: 0xcfe6d8, fog: 0xa8e2f7, fn: 74, ff: 200 },
  { h: 12.0, sun: 0xfff8e6, si: 2.45, ai: 1.06, top: 0x2f9fe0, mid: 0x8fd8f5, bot: 0xdff2f0, fog: 0x9fdcf5, fn: 78, ff: 210 },
  { h: 16.0, sun: 0xfff0cf, si: 2.28, ai: 1.00, top: 0x3f9ed8, mid: 0x9ad6ef, bot: 0xe8eccf, fog: 0xa8e0f2, fn: 76, ff: 205 },
  { h: 18.4, sun: 0xff9a5c, si: 1.45, ai: 0.86, top: 0x2f4f7f, mid: 0x8a6a8f, bot: 0xffb27a, fog: 0xe0a98c, fn: 68, ff: 185 },
  { h: 20.0, sun: 0x9aa6cf, si: 0.52, ai: 0.62, top: 0x152238, mid: 0x263a5c, bot: 0x4a4a6a, fog: 0x2a3450, fn: 58, ff: 160 },
  { h: 24.0, sun: 0x8ea6d6, si: 0.30, ai: 0.52, top: 0x0b1830, mid: 0x16294a, bot: 0x233a5c, fog: 0x1a2c48, fn: 55, ff: 155 },
];

/** 时段文案（HUD 用） */
function phaseOf(h) {
  if (h < 5) return { key: 'night', label: '深夜', icon: '🌙' };
  if (h < 7) return { key: 'dawn', label: '黎明', icon: '🌅' };
  if (h < 11) return { key: 'morning', label: '上午', icon: '☀️' };
  if (h < 14) return { key: 'noon', label: '正午', icon: '🔆' };
  if (h < 17.5) return { key: 'afternoon', label: '下午', icon: '☀️' };
  if (h < 19.5) return { key: 'dusk', label: '黄昏', icon: '🌇' };
  return { key: 'night', label: '夜晚', icon: '🌙' };
}

const WEATHER_META = {
  clear:  { label: '晴',   icon: '☀️' },
  cloudy: { label: '多云', icon: '⛅' },
  rain:   { label: '雨',   icon: '🌧️' },
};

/* ------------------------------------------------------------------
   二、确定性天气
   ------------------------------------------------------------------
   用「年-月-日 + 8 小时时段」算出 0~1 的伪随机数：
     0 ~ 0.16 → 雨   0.16 ~ 0.46 → 多云   其余 → 晴
   即：晴约 54%、多云约 30%、雨约 16%。
   同一时段所有人一致；到点自动换天，无需后端。
   ------------------------------------------------------------------ */
function hash01(str) {
  /* FNV-1a 变体：短字符串足够均匀，且完全确定 */
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 10000) / 10000;
}

function weatherAt(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const slot = Math.floor(date.getHours() / 8);   // 一天 3 个时段：0-8 / 8-16 / 16-24
  const r = hash01(`${y}-${m}-${d}#${slot}`);
  if (r < 0.16) return 'rain';
  if (r < 0.46) return 'cloudy';
  return 'clear';
}

/* ------------------------------------------------------------------
   三、环境插值
   ------------------------------------------------------------------ */
function lerpKey(h) {
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (h >= KEYS[i].h && h <= KEYS[i + 1].h) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  }
  const span = b.h - a.h || 1;
  const t = Math.min(1, Math.max(0, (h - a.h) / span));
  return {
    sun: new THREE.Color(a.sun).lerp(new THREE.Color(b.sun), t),
    si: a.si + (b.si - a.si) * t,
    ai: a.ai + (b.ai - a.ai) * t,
    top: new THREE.Color(a.top).lerp(new THREE.Color(b.top), t),
    mid: new THREE.Color(a.mid).lerp(new THREE.Color(b.mid), t),
    bot: new THREE.Color(a.bot).lerp(new THREE.Color(b.bot), t),
    fog: new THREE.Color(a.fog).lerp(new THREE.Color(b.fog), t),
    fn: a.fn + (b.fn - a.fn) * t,
    ff: a.ff + (b.ff - a.ff) * t,
  };
}

/* ------------------------------------------------------------------
   四、雨
   ------------------------------------------------------------------ */
class Rain {
  constructor() {
    const N = 850;
    this.N = N;
    this.pos = new Float32Array(N * 6);
    this.speed = new Float32Array(N);
    this.len = new Float32Array(N);
    /* 相对坐标：以村庄中心为原点的一个 60×60 的雨柱 */
    for (let i = 0; i < N; i++) {
      this._respawn(i, true);
      this.speed[i] = 26 + Math.random() * 12;
      this.len[i] = 0.7 + Math.random() * 0.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xbcd8ee,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      /* 让雾也能作用于雨：远处雨丝自然变淡 */
      fog: true,
    });
    this.mesh = new THREE.LineSegments(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
  }

  _respawn(i, init) {
    const x = (Math.random() - 0.5) * 60;
    const z = (Math.random() - 0.5) * 60;
    const y = init ? Math.random() * 30 : 26 + Math.random() * 6;
    const o = i * 6;
    this.pos[o] = x;     this.pos[o + 1] = y;     this.pos[o + 2] = z;
    /* 雨丝略往一个方向斜（视觉上像有风） */
    this.pos[o + 3] = x + 0.10;
    this.pos[o + 4] = y - 0.9;
    this.pos[o + 5] = z + 0.04;
  }

  /** @param {number} dt 真实秒  @param {{x:number,z:number}} at 跟随的村庄中心 */
  update(dt, at, intensity) {
    this.mesh.visible = intensity > 0.02;
    if (!this.mesh.visible) return;
    this.mesh.material.opacity = 0.28 + 0.34 * intensity;
    this.mesh.position.set(at.x, 0, at.z);

    const fall = dt * 1.0;
    for (let i = 0; i < this.N; i++) {
      const o = i * 6;
      const dy = this.speed[i] * fall;
      this.pos[o + 1] -= dy;
      this.pos[o + 4] -= dy;
      if (this.pos[o + 1] < -0.5) this._respawn(i, false);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------
   五、SkySystem
   ------------------------------------------------------------------ */
export class SkySystem {
  /** @param {import('./engine.js').Engine} engine */
  constructor(engine) {
    this.engine = engine;
    this.scene = engine.scene;
    this.renderer = engine.renderer;
    this.sun = engine.sun;
    this.ambient = engine.ambient;
    this.fill = engine.fill;
    this.dome = engine.skyDome;
    this.fog = engine.scene.fog;

    /* 当前值（向 target 插值）；初始化为「现在」的目标值，避免开场闪一下 */
    this.cur = null;
    this.target = null;
    this._acc = 0;
    this.hour = 12;
    this.weather = 'clear';
    this.phase = phaseOf(12);
    this.rain = new Rain();
    this.scene.add(this.rain.mesh);

    /* HUD 元素（index.html 里的天气胶囊） */
    this.elIcon = document.getElementById('weather-icon');
    this.elLabel = document.getElementById('weather-label');

    this.target = this._sample();
    this.cur = this._cloneState(this.target);
    this._apply(this.cur);
    this._paintHud();
  }

  _cloneState(s) {
    return {
      sun: s.sun.clone(), top: s.top.clone(), mid: s.mid.clone(),
      bot: s.bot.clone(), fog: s.fog.clone(),
      si: s.si, ai: s.ai, fn: s.fn, ff: s.ff, rain: s.rain,
    };
  }

  /** 按「当前真实时间 + 当前天气」算出目标环境 */
  _sample() {
    const now = new Date();
    const h = now.getHours() + now.getMinutes() / 60;
    this.hour = h;
    this.weather = weatherAt(now);
    this.phase = phaseOf(h);

    const k = lerpKey(h);

    /* 天气叠加：不是简单乘一个系数，而是把天空/雾往「灰」里拉，
       这样雨天才有阴天的质感，而不是单纯的「变暗」。 */
    if (this.weather === 'cloudy') {
      const grey = new THREE.Color(0x9aa7b4);
      k.top.lerp(grey, 0.30); k.mid.lerp(grey, 0.34); k.bot.lerp(grey, 0.30);
      k.fog.lerp(grey, 0.30);
      k.si *= 0.78;
      k.ai *= 1.02;
      k.fn *= 0.90;
      k.ff *= 0.92;
    } else if (this.weather === 'rain') {
      const slate = new THREE.Color(0x6f7d8c);
      k.top.lerp(slate, 0.55); k.mid.lerp(slate, 0.58); k.bot.lerp(slate, 0.55);
      k.fog.lerp(slate, 0.55);
      /* 主光压到 52%：阴雨天的太阳是"亮着的白幕"，不是深夜。
         再低（试过 46%）会让三渲二的明暗面拉不开、建筑发灰。 */
      k.si *= 0.52;
      k.ai *= 0.94;
      k.fn *= 0.62;
      k.ff *= 0.72;
      /* 夜里下雨不该被"提亮"：环境光取两者较小值 */
      k.ai = Math.min(k.ai, 0.66);
    }

    k.rain = this.weather === 'rain' ? 1 : 0;
    return k;
  }

  /** 把一组参数写到场景里 */
  _apply(s) {
    const u = this.dome && this.dome.material && this.dome.material.uniforms;
    if (u) {
      u.top.value.copy(s.top);
      u.mid.value.copy(s.mid);
      u.bottom.value.copy(s.bot);
    }
    this.sun.color.copy(s.sun);
    this.sun.intensity = s.si;
    this.ambient.intensity = s.ai;
    this.fill.intensity = 0.62 * (0.45 + 0.55 * Math.min(1, s.ai));
    if (this.fog) {
      this.fog.color.copy(s.fog);
      this.fog.near = s.fn;
      this.fog.far = s.ff;
    }
    this.renderer.setClearColor(s.fog, 1);
    /* 太阳高度：白天高、夜里低（只动 y，x/z 仍由主循环跟随镜头，
       避免阴影片区跟着变来变去） */
    this.engine.sunHeight = 34 + 12 * Math.min(1, s.si / 2.45);
  }

  _paintHud() {
    const w = WEATHER_META[this.weather] || WEATHER_META.clear;
    /* 夜里优先显示月相图标，白天显示天气图标 */
    const night = this.phase.key === 'night';
    if (this.elIcon) this.elIcon.textContent = night && this.weather !== 'rain' ? '🌙' : w.icon;
    const phaseLabel = this.weather === 'rain' ? '雨' : this.phase.label;
    if (this.elLabel) this.elLabel.textContent = this.weather === 'clear' ? this.phase.label : `${this.phase.label} · ${w.label}`;
    const pill = document.getElementById('weather-pill');
    if (pill) {
      pill.dataset.weather = this.weather;
      pill.dataset.phase = this.phase.key;
      pill.title = `现在 ${this.phase.label}${this.weather === 'clear' ? '' : ' · ' + w.label}`;
    }
    /* 【2026-10-19】把时辰/天气写到 <body> 上，CSS 据此换主题：
       底部 Dock 在夜间切成深色玻璃、黄昏切暖色，不必再由 JS 逐个改类名。
       打桩环境（Node 测试）没有 body，跳过即可。 */
    if (typeof document !== 'undefined' && document.body) {
      document.body.dataset.phase = this.phase.key;
      document.body.dataset.weather = this.weather;
    }
    /* 雨声：交给 audio.js 的可选接口（没有就静默跳过） */
    if (this.engine.onWeather) this.engine.onWeather(this.weather, this.phase.key);
    void phaseLabel;
  }

  /**
   * 每帧调用。
   * @param {number} dt 真实秒
   * @param {{x:number,z:number}} at 镜头焦点（雨幕跟随）
   */
  update(dt, at) {
    this._acc += dt;

    /* 每 0.5 秒重算一次「目标」（时间在走、天气可能换段） */
    if (this._acc >= 0.5) {
      this._acc = 0;
      const before = `${this.weather}|${this.phase.key}`;
      this.target = this._sample();
      if (`${this.weather}|${this.phase.key}` !== before) this._paintHud();
    }

    /* 指数插值：约 1.5 秒完成 95% 的过渡，避免整点换天时「啪」地变色 */
    const k = 1 - Math.exp(-dt * 2.0);
    const c = this.cur, t = this.target;
    if (!t) return;
    c.sun.lerp(t.sun, k);
    c.top.lerp(t.top, k);
    c.mid.lerp(t.mid, k);
    c.bot.lerp(t.bot, k);
    c.fog.lerp(t.fog, k);
    c.si += (t.si - c.si) * k;
    c.ai += (t.ai - c.ai) * k;
    c.fn += (t.fn - c.fn) * k;
    c.ff += (t.ff - c.ff) * k;
    c.rain += (t.rain - c.rain) * k;

    this._apply(c);
    this.rain.update(dt, at || { x: 0, z: 0 }, c.rain);
  }
}
