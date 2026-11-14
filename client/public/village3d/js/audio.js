/* ============================================================
   audio.js — 程序化音效（WebAudio 合成，零音频资源）
   ------------------------------------------------------------
   整个项目的一条原则是「不依赖任何外部美术/音频资源」，
   所以音效也不放 mp3，而是现场合成：
     · 音调类（点击/建造/收钱）→ Oscillator + 指数包络
     · 噪声类（爆炸/塌方/炮击）→ 白噪声 buffer + 低通扫频
   这样多一个音效只多几行代码，不增加任何体积。

   两条硬约束：
     1. **任何音频异常都不允许影响游戏** —— 所有分支都包在 try/catch 里，
        拿不到 AudioContext 就直接静默退化。
     2. iOS/Safari 必须由用户手势解锁，所以首次 pointerdown 时调 unlockAudio()。
   ============================================================ */

const KEY = 'toonvillage.sound.v1';

let ctx = null;
let master = null;
let enabled = true;

/** 同名音效的最小间隔（秒）—— 一帧里放 30 门炮会糊成噪音 */
const THROTTLE = {
  shot: 0.045, boom: 0.06, crumble: 0.08, coin: 0.05, tap: 0.05, build: 0.12, done: 0.15,
  arrow: 0.06, slash: 0.07,
};
const _last = Object.create(null);

/* ------------------------------------------------------------------ */
function ensure() {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.42;
    master.connect(ctx.destination);
  } catch (e) { ctx = null; }
  return ctx;
}

function ready(name) {
  if (!enabled) return null;
  const c = ensure();
  if (!c || c.state !== 'running') return null;
  const gap = THROTTLE[name];
  if (gap) {
    const now = c.currentTime;
    if (_last[name] !== undefined && now - _last[name] < gap) return null;
    _last[name] = now;
  }
  return c;
}

/** 单音（可扫频） */
function tone(freq, dur, o = {}) {
  const c = ready(o.name || 'tone');
  if (!c) return;
  try {
    const t0 = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, o.to), t0 + dur);
    const vol = o.vol === undefined ? 0.16 : o.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  } catch (e) { /* 静默 */ }
}

/** 噪声（爆炸 / 塌方 / 炮击） */
function noise(dur, o = {}) {
  const c = ready(o.name || 'noise');
  if (!c) return;
  try {
    const t0 = c.currentTime + (o.delay || 0);
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    const dec = o.decay === undefined ? 2 : o.decay;
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, dec);

    const src = c.createBufferSource();
    src.buffer = buf;
    const flt = c.createBiquadFilter();
    flt.type = o.filter || 'lowpass';
    flt.frequency.setValueAtTime(o.from || 1400, t0);
    flt.frequency.exponentialRampToValueAtTime(Math.max(60, o.to || 120), t0 + dur);
    const g = c.createGain();
    g.gain.value = o.vol === undefined ? 0.28 : o.vol;
    src.connect(flt); flt.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur);
  } catch (e) { /* 静默 */ }
}

/* ------------------------------------------------------------------
   对外：音效表
   ------------------------------------------------------------------ */
export const sfx = {
  /** 点按 / 选中 */
  tap() { tone(660, 0.05, { type: 'triangle', vol: 0.09, name: 'tap' }); },
  /** 放置建筑：两声上行，像"落定" */
  build() {
    tone(330, 0.09, { type: 'triangle', vol: 0.14, name: 'build' });
    tone(494, 0.12, { type: 'triangle', vol: 0.12, delay: 0.07, name: 'build' });
  },
  /** 升级完成 / 建造完成 */
  done() {
    tone(523, 0.1, { type: 'triangle', vol: 0.14, name: 'done' });
    tone(784, 0.16, { type: 'triangle', vol: 0.12, delay: 0.08, name: 'done' });
  },
  /** 收钱：金币叮 */
  coin() {
    tone(1180, 0.06, { type: 'square', vol: 0.09, name: 'coin' });
    tone(1560, 0.08, { type: 'square', vol: 0.07, delay: 0.045, name: 'coin' });
  },
  /** 部署部队 */
  deploy() { tone(180, 0.14, { type: 'sawtooth', to: 90, vol: 0.12 }); },
  /** 加农炮 / 箭塔开火 */
  shot(mortar) {
    if (mortar) {
      tone(120, 0.22, { type: 'sawtooth', to: 48, vol: 0.2 });
      noise(0.2, { name: 'shot', from: 600, to: 90, vol: 0.22 });
    } else {
      tone(300, 0.1, { type: 'square', to: 90, vol: 0.14, name: 'shot' });
      noise(0.12, { name: 'shot', from: 2600, to: 300, vol: 0.18 });
    }
  },
  /** 弓箭离弦：短促的高频扫频 + 一点气流噪声 */
  arrow() {
    tone(1350, 0.09, { type: 'triangle', to: 430, vol: 0.09, name: 'arrow' });
    noise(0.07, { name: 'arrow', from: 3400, to: 900, decay: 2.4, vol: 0.09, filter: 'highpass' });
  },
  /** 近战挥击：一段带通噪声，像劈风 */
  slash() {
    noise(0.11, { name: 'slash', from: 2400, to: 640, decay: 2.8, vol: 0.13, filter: 'bandpass' });
  },
  /** 爆炸（炸弹人 / 溅射命中） */
  boom() {
    noise(0.5, { name: 'boom', from: 1100, to: 60, decay: 1.4, vol: 0.34 });
    tone(70, 0.34, { type: 'sine', to: 38, vol: 0.22 });
  },
  /** 建筑倒塌 */
  crumble() {
    noise(0.62, { name: 'crumble', from: 1900, to: 120, decay: 1.1, vol: 0.24 });
  },
  /** 胜利 / 失败 */
  win() {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone(f, 0.2, { type: 'triangle', vol: 0.15, delay: i * 0.1 }));
  },
  lose() {
    [392, 330, 262].forEach((f, i) =>
      tone(f, 0.26, { type: 'triangle', vol: 0.15, delay: i * 0.13 }));
  },
  /** 错误 / 不可放置 */
  nope() { tone(150, 0.1, { type: 'square', vol: 0.1 }); },
};

/* ------------------------------------------------------------------
   开关 / 解锁
   ------------------------------------------------------------------ */
export function loadSoundPref() {
  try {
    const v = localStorage.getItem(KEY);
    if (v !== null) enabled = v === '1';
  } catch (e) { /* 存储被禁用 */ }
  return enabled;
}
export function setSound(on) {
  enabled = !!on;
  try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch (e) {}
  if (enabled) { unlockAudio(); sfx.tap(); }
  return enabled;
}
export function soundEnabled() { return enabled; }

/** iOS/Safari 要求在用户手势里创建/恢复 AudioContext */
export function unlockAudio() {
  const c = ensure();
  if (!c) return;
  try { if (c.state === 'suspended') c.resume(); } catch (e) { /* 静默 */ }
}
