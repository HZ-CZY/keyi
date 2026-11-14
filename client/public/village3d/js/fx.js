/* ============================================================
   fx.js — 进攻特效系统
   ------------------------------------------------------------
   旧版写法是「每个粒子 = new BoxGeometry + new MeshBasicMaterial」：
   一次爆炸 26 个粒子就是 26 个几何 + 26 个材质 + 26 个 draw call，
   而且全都要 GC。炮兵一直在开火，帧率就是这么掉下去的。

   这一版把特效做成**四类池**，运行期一个几何体、一个材质都不新建：

     ① 柔边粒子（Points · NormalBlending）—— 尘土 / 烟 / 灰
     ② 高光粒子（Points · AdditiveBlending）—— 火花 / 火焰 / 余烬
        ①② 各自只占 1 个 draw call：顶点色 + 逐点尺寸 + 逐点透明度，
           用 ShaderMaterial 写进 gl_PointSize / gl_PointCoord
     ③ 块状碎片（4 个 InstancedMesh，按石 / 木 / 铁 / 土分桶）
     ④ 冲击波环 + 焦痕贴片 + 点光闪光 + 投射物（箭 / 炮弹 / 迫击炮弹）

   由此得到两条可自动校验的不变量（render-check 会断言）：
     · 预热之后，运行期新建的几何体 / 材质数量必须恒为 0
     · 同屏粒子数不得超过当前画质档的预算

   投射物模拟也放在这里：battle 只负责「谁打谁、打多少血」，
   弹道、尾迹、落地影、命中回调全归 fx —— 伤害与表现解耦。
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';
import { GRAD_SOFT, mulberry32 } from './toon.js';
import { mergeGeos } from './shapes.js';

/* 池容量（按最高画质配置；低画质靠 budget 少生成，而不是缩池） */
const SOFT_MAX = 1100;
const GLOW_MAX = 800;
const DEBRIS_PER_BUCKET = 20;
const RING_MAX = 8;
const DECAL_MAX = 8;
const SHOT_MAX = 24;
const POPUP_MAX = 14;

/** 画质 → 粒子预算 */
const BUDGET = { high: 1, mid: 0.55, low: 0.25 };

/* ------------------------------------------------------------------
   柔边圆点着色器：逐点颜色 / 尺寸 / 透明度
   ------------------------------------------------------------------ */
function pointMaterial(additive) {
  return new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 } },
    vertexShader: /* glsl */`
      attribute float aSize;
      attribute float aAlpha;
      attribute vec3 aColor;
      uniform float uScale;
      varying float vA;
      varying vec3 vC;
      void main() {
        vA = aAlpha;
        vC = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = max(0.08, -mv.z);
        gl_PointSize = clamp(aSize * uScale / d, 1.0, 220.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      varying vec3 vC;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = dot(d, d) * 4.0;                 // 0 = 圆心，1 = 边缘
        if (r >= 1.0) discard;
        float a = 1.0 - r;
        a = a * a * (3.0 - 2.0 * a);               // 平滑衰减，边缘不硬
        if (a <= 0.003) discard;
        gl_FragColor = vec4(vC, a * vA);
      }`,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/* ------------------------------------------------------------------
   焦痕 / 落地影贴图（Canvas 生成，无外部资源）
   ------------------------------------------------------------------ */
let _scorchTex = null;
function scorchTexture() {
  if (_scorchTex) return _scorchTex;
  const C = document.createElement('canvas');
  C.width = C.height = 128;
  const g = C.getContext('2d');
  const rnd = mulberry32(20260928);
  const grd = g.createRadialGradient(64, 64, 3, 64, 64, 62);
  grd.addColorStop(0, 'rgba(26,18,12,0.82)');
  grd.addColorStop(0.42, 'rgba(38,28,20,0.58)');
  grd.addColorStop(0.78, 'rgba(48,36,26,0.22)');
  grd.addColorStop(1, 'rgba(48,36,26,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  // 把边缘啃碎，免得看起来像一块圆饼
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, r = 44 + rnd() * 22;
    g.beginPath();
    g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 5 + rnd() * 9, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  _scorchTex = new THREE.CanvasTexture(C);
  _scorchTex.colorSpace = THREE.SRGBColorSpace;
  return _scorchTex;
}

/* ============================================================
   Fx
   ============================================================ */
export class Fx {
  /**
   * @param {object} o
   * @param {THREE.Object3D} o.root 特效挂载点（battle 的 fxRoot）
   * @param {import('./engine.js').Engine} [o.engine] 取画质 / 相机 / 画布
   * @param {object} [o.rig] 摄像机 rig（屏幕震动）
   */
  constructor(o = {}) {
    this.root = o.root || new THREE.Group();
    this.engine = o.engine || null;
    this.rig = o.rig || (o.engine ? o.engine.rig : null);
    this.camera = o.engine ? o.engine.camera : null;

    /* 运行期新建几何 / 材质的次数 —— 必须冻结在预热值（自检断言） */
    this.allocGeo = 0;
    this.allocMat = 0;

    /* 复用的小对象，避免每帧 / 每粒子产生垃圾 */
    this._c = new THREE.Color();
    this._m = new THREE.Matrix4();
    this._p3 = new THREE.Vector3();
    this._s3 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();

    this._soft = this._makePoints(SOFT_MAX, false);
    this._glow = this._makePoints(GLOW_MAX, true);
    this._makeDebris();
    this._makeRings();
    this._makeDecals();
    this._makeShots();
    this._makeFlash();

    this.shots = [];
    this._popupPool = [];
    this._popupDom = null;
    this._flashT = 0;
    this._flashT0 = 1;
    this._flashPeak = 0;

    /* 预热结束：把此刻的分配计数记为基线 */
    this.warmAlloc = { geo: this.allocGeo, mat: this.allocMat };
    this._peaks = { soft: 0, glow: 0 };
  }

  /* ============================================================
     粒子池
     ============================================================ */
  _makePoints(max, additive) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(max * 3);
    const col = new Float32Array(max * 3);
    const siz = new Float32Array(max);
    const alp = new Float32Array(max);
    const D = THREE.DynamicDrawUsage;
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(D));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3).setUsage(D));
    geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1).setUsage(D));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alp, 1).setUsage(D));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.allocGeo++;

    this.allocMat++;
    const mat = pointMaterial(additive);
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = additive ? 9 : 8;
    this.root.add(pts);

    const items = new Array(max);
    for (let i = 0; i < max; i++) {
      items[i] = {
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, life0: 1, s0: 1, s1: 1, a0: 1, ap: 1,
        drag: 0, grav: 0, cr: 1, cg: 1, cb: 1,
      };
    }
    return { max, n: 0, items, geo, mat, pts, pos, col, siz, alp };
  }

  /** 生成一个粒子（内部） */
  _emit(sys, p) {
    if (sys.n >= sys.max) return null;
    const it = sys.items[sys.n];
    it.x = p.x; it.y = p.y; it.z = p.z;
    it.vx = p.vx || 0; it.vy = p.vy || 0; it.vz = p.vz || 0;
    it.life = p.life; it.life0 = p.life;
    it.s0 = p.s0; it.s1 = p.s1;
    it.a0 = p.a0 === undefined ? 1 : p.a0;
    it.ap = p.ap === undefined ? 1.2 : p.ap;
    it.drag = p.drag || 0;
    it.grav = p.grav || 0;
    this._c.set(p.color);
    it.cr = this._c.r; it.cg = this._c.g; it.cb = this._c.b;
    sys.n++;
    return it;
  }

  /* ============================================================
     对外：粒子类
     ============================================================ */

  /** 尘土：落地、脚步、塌落。柔边、向上飘、慢慢变大变淡 */
  dust(x, y, z, opt = {}) {
    const n = Math.max(1, Math.round((opt.n || 8) * this.budget));
    const spread = opt.spread === undefined ? 0.5 : opt.spread;
    const power = opt.power === undefined ? 1.4 : opt.power;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = power * (0.35 + Math.random() * 0.9);
      this._emit(this._soft, {
        x: x + (Math.random() - 0.5) * spread,
        y: y + Math.random() * spread * 0.4,
        z: z + (Math.random() - 0.5) * spread,
        vx: Math.cos(a) * sp, vy: 0.25 + Math.random() * power * 0.42, vz: Math.sin(a) * sp,
        life: (opt.life || 0.85) * (0.7 + Math.random() * 0.7),
        s0: (opt.s0 || 0.16) * (0.8 + Math.random() * 0.6),
        s1: (opt.s1 || 0.62) * (0.8 + Math.random() * 0.8),
        a0: opt.a0 === undefined ? 0.55 : opt.a0, ap: 1.5,
        drag: 2.4, grav: 0.5,
        color: opt.color === undefined ? 0xd9cdb4 : opt.color,
      });
    }
  }

  /** 烟：颜色更深、升得更快、寿命更长 */
  smoke(x, y, z, opt = {}) {
    const n = Math.max(1, Math.round((opt.n || 6) * this.budget));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (opt.power || 0.7) * (0.3 + Math.random() * 0.8);
      this._emit(this._soft, {
        x: x + (Math.random() - 0.5) * (opt.spread || 0.4),
        y: y + Math.random() * 0.2,
        z: z + (Math.random() - 0.5) * (opt.spread || 0.4),
        vx: Math.cos(a) * sp * 0.5, vy: 0.5 + Math.random() * (opt.rise || 1.1), vz: Math.sin(a) * sp * 0.5,
        life: (opt.life || 1.6) * (0.7 + Math.random() * 0.8),
        s0: (opt.s0 || 0.22) * (0.8 + Math.random() * 0.6),
        s1: (opt.s1 || 0.95) * (0.8 + Math.random() * 0.8),
        a0: opt.a0 === undefined ? 0.42 : opt.a0, ap: 1.1,
        drag: 1.5, grav: 0.9,
        color: opt.color === undefined ? 0x6e6a63 : opt.color,
      });
    }
  }

  /** 火花：加色、快、受重力、短命 */
  sparks(x, y, z, opt = {}) {
    const n = Math.max(1, Math.round((opt.n || 10) * this.budget));
    const power = opt.power === undefined ? 3.4 : opt.power;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = 0.15 + Math.random() * 1.0;
      const sp = power * (0.4 + Math.random() * 0.9);
      this._emit(this._glow, {
        x, y, z,
        vx: Math.cos(a) * sp, vy: el * sp * 0.9, vz: Math.sin(a) * sp,
        life: (opt.life || 0.34) * (0.6 + Math.random() * 0.9),
        s0: (opt.size || 0.1) * (0.7 + Math.random() * 0.7),
        s1: 0.015, a0: 1, ap: 1.6,
        drag: 3.2, grav: 13,
        color: opt.color === undefined ? 0xffd27a : opt.color,
      });
    }
  }

  /** 火球核心：加色、上升、变大较快 */
  fire(x, y, z, opt = {}) {
    const n = Math.max(1, Math.round((opt.n || 10) * this.budget));
    const R = opt.r || 0.5;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * R;
      this._emit(this._glow, {
        x: x + Math.cos(a) * r, y: y + Math.random() * R * 0.7, z: z + Math.sin(a) * r,
        vx: Math.cos(a) * 1.1, vy: 0.9 + Math.random() * 1.9, vz: Math.sin(a) * 1.1,
        life: (opt.life || 0.42) * (0.6 + Math.random() * 0.9),
        s0: R * (0.75 + Math.random() * 0.7), s1: R * 0.16,
        a0: 0.95, ap: 1.3, drag: 1.6, grav: 3.6,
        color: opt.color === undefined ? 0xff9a3a : opt.color,
      });
    }
  }

  /** 余烬：小火点慢慢飘，给残骸加「还在烧」的感觉 */
  embers(x, y, z, opt = {}) {
    const n = Math.max(1, Math.round((opt.n || 3) * this.budget));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this._emit(this._glow, {
        x: x + (Math.random() - 0.5) * 0.6, y: y + Math.random() * 0.4, z: z + (Math.random() - 0.5) * 0.6,
        vx: Math.cos(a) * 0.3, vy: 0.5 + Math.random() * 0.7, vz: Math.sin(a) * 0.3,
        life: (opt.life || 1.3) * (0.7 + Math.random() * 0.8),
        s0: 0.05 + Math.random() * 0.05, s1: 0.01,
        a0: 0.9, ap: 1.8, drag: 0.9, grav: -0.5,
        color: opt.color === undefined ? 0xff7a2a : opt.color,
      });
    }
  }

  /* ============================================================
     对外：结构类
     ============================================================ */

  /** 冲击波环：贴地扩散的一圈亮环 */
  ring(x, y, z, opt = {}) {
    const r = this._rings.find((v) => !v.alive);
    if (!r) return;
    r.alive = true;
    r.t = 0;
    r.dur = opt.dur || 0.5;
    r.r0 = opt.r0 === undefined ? 0.3 : opt.r0;
    r.r1 = opt.r1 === undefined ? 2.6 : opt.r1;
    r.a0 = opt.a0 === undefined ? 0.75 : opt.a0;
    r.mesh.visible = true;
    r.mesh.position.set(x, y === undefined ? 0.06 : y, z);
    r.mesh.scale.setScalar(r.r0);
    r.mat.opacity = r.a0;
    r.mat.color.setHex(opt.color === undefined ? 0xffe9b0 : opt.color);
  }

  /** 焦痕：留在地上的暗斑，慢慢褪 */
  scorch(x, z, opt = {}) {
    const d = this._decals.find((v) => !v.alive);
    if (!d) return;
    d.alive = true;
    d.t = 0;
    d.dur = opt.dur || 14;
    d.a0 = opt.a0 === undefined ? 0.85 : opt.a0;
    d.mesh.visible = true;
    d.mesh.position.set(x, 0.055, z);
    d.mesh.rotation.z = Math.random() * Math.PI * 2;
    d.mesh.scale.setScalar((opt.r || 1.5) * (0.85 + Math.random() * 0.3));
    d.mat.opacity = d.a0;
  }

  /** 块状碎片：带滚转、会弹地、寿命到了缩没 */
  debris(x, y, z, opt = {}) {
    const n = Math.max(1, Math.round((opt.n || 10) * this.budget));
    const power = opt.power === undefined ? 3.2 : opt.power;
    const keys = opt.buckets || ['stone', 'wood', 'metal', 'dirt'];
    for (let i = 0; i < n; i++) {
      const bk = this._debris[keys[(Math.random() * keys.length) | 0]] || this._debris.stone;
      if (!bk.free.length) continue;
      const idx = bk.free.pop();
      bk.alive.push(idx);
      const a = Math.random() * Math.PI * 2;
      const el = 0.25 + Math.random() * 0.95;
      const sp = power * (0.4 + Math.random() * 0.9);
      const d = bk.items[idx];
      d.x = x + (Math.random() - 0.5) * 0.3; d.y = y + Math.random() * 0.3; d.z = z + (Math.random() - 0.5) * 0.3;
      d.vx = Math.cos(a) * sp; d.vy = el * sp * 1.25; d.vz = Math.sin(a) * sp;
      d.wx = (Math.random() - 0.5) * 9; d.wy = (Math.random() - 0.5) * 9; d.wz = (Math.random() - 0.5) * 9;
      d.s = (opt.size || 0.14) * (0.6 + Math.random() * 0.9) * bk.size;
      d.life = 1.5 + Math.random() * 1.1;
      d.life0 = d.life;
      d.q.identity();
      bk.dirty = true;
    }
  }

  /** 炮口：加色闪光 + 少量烟 + 一次点光 */
  muzzle(x, y, z, dir, opt = {}) {
    this.fire(x, y, z, { n: opt.n || 5, r: 0.16, life: 0.14, color: 0xffe6a8 });
    this.sparks(x, y, z, { n: 5, power: 2.6, color: 0xffd27a, size: 0.07 });
    if (this.budget > 0.35) {
      this.smoke(x + dir.x * 0.25, y, z + dir.z * 0.25, {
        n: 3, power: 0.5, life: 0.85, s0: 0.1, s1: 0.42, a0: 0.4, color: 0xbfb6a8,
      });
    }
    this.flash(x, y, z, { intensity: opt.light === undefined ? 3.2 : opt.light, dist: 7 });
  }

  /** 一次性点光（爆炸 / 炮口提亮） */
  flash(x, y, z, opt = {}) {
    this._flash.position.set(x, y, z);
    this._flash.distance = opt.dist === undefined ? 12 : opt.dist;
    this._flashPeak = opt.intensity === undefined ? 5 : opt.intensity;
    this._flashT0 = opt.dur === undefined ? 0.12 : opt.dur;
    this._flashT = this._flashT0;
    this._flash.intensity = this._flashPeak;
  }

  /**
   * 组合爆炸：火球 + 冲击波 + 烟 + 碎屑 + 提亮 + 震动 + 焦痕。
   * 炸弹人自爆、炮弹溅射、迫击炮落地都走这一条。
   */
  explosion(x, y, z, opt = {}) {
    const R = opt.r === undefined ? 1.2 : opt.r;
    this.fire(x, y + 0.2, z, { n: opt.n || 16, r: R * 0.8, life: 0.5, color: opt.color || 0xff9a3a });
    this.fire(x, y + 0.2, z, { n: Math.round((opt.n || 16) * 0.5), r: R * 0.45, life: 0.28, color: 0xffe08a });
    this.ring(x, 0.07, z, { r0: R * 0.3, r1: R * 3.0, dur: 0.46 });
    this.smoke(x, y + 0.5, z, {
      n: opt.smoke === undefined ? 10 : opt.smoke, rise: 2.2, life: 1.9, s0: 0.3, s1: 1.5, a0: 0.5,
    });
    this.debris(x, y + 0.25, z, { n: opt.debris === undefined ? 12 : opt.debris, power: 3.6, size: 0.13 });
    this.sparks(x, y + 0.3, z, { n: opt.sparks === undefined ? 14 : opt.sparks, power: 5.2 });
    this.flash(x, y + 0.5, z, { intensity: opt.light || 7, dist: 14 });
    if (opt.scorch !== false) this.scorch(x, z, { r: R * 1.25 });
    if (opt.shake !== false) this.shake(opt.amp === undefined ? 0.22 : opt.amp, 0.34);
    if (opt.embers) this.embers(x, y + 0.2, z, { n: 4 });
  }

  /** 建筑塌落：比爆炸「土」得多 —— 灰云为主、火为辅、大量碎块 */
  collapse(x, y, z, opt = {}) {
    const R = opt.r === undefined ? 1.5 : opt.r;
    this.dust(x, 0.25, z, { n: 26, power: 3.0, spread: R * 1.5, s0: 0.3, s1: 1.6, life: 1.5, a0: 0.6 });
    this.smoke(x, y * 0.5 + 0.5, z, { n: 16, rise: 2.6, life: 2.6, s0: 0.4, s1: 2.0, a0: 0.5 });
    this.debris(x, y * 0.5 + 0.3, z, { n: 22, power: 4.6, size: 0.18, buckets: opt.buckets || ['stone', 'wood', 'dirt'] });
    this.fire(x, y * 0.4 + 0.3, z, { n: 8, r: R * 0.5, life: 0.55 });
    this.ring(x, 0.06, z, { r0: R * 0.4, r1: R * 2.6, dur: 0.55, a0: 0.6, color: 0xd8c9a8 });
    this.flash(x, y * 0.5 + 0.6, z, { intensity: 4.5, dist: 16 });
    this.scorch(x, z, { r: R * 1.1, a0: 0.7 });
    this.shake(opt.amp === undefined ? 0.3 : opt.amp, 0.5);
    if (opt.embers !== false) this.embers(x, 0.35, z, { n: 5, life: 2.2 });
  }

  /** 屏幕震动（转发给摄像机 rig；rig 缺失时静默忽略） */
  shake(amp, dur) {
    if (this.rig && this.rig.shake) this.rig.shake(amp, dur);
  }

  /* ============================================================
     投射物
     ============================================================ */
  _makeShots() {
    /* 几何一律沿 +Z 建，配合 Object3D.lookAt 让箭头指着飞行方向 */
    const shellGeo = mergeGeos([
      { geo: new THREE.CylinderGeometry(0.05, 0.058, 0.19, 8), rx: Math.PI / 2 },
      { geo: new THREE.SphereGeometry(0.058, 8, 6), z: 0.1 },
    ]);
    const arrowGeo = mergeGeos([
      { geo: new THREE.CylinderGeometry(0.011, 0.011, 0.4, 5), rx: Math.PI / 2 },
      { geo: new THREE.ConeGeometry(0.026, 0.1, 5), z: 0.24, rx: Math.PI / 2 },
      { geo: new THREE.BoxGeometry(0.055, 0.007, 0.006), z: -0.16, x: 0.017 },
      { geo: new THREE.BoxGeometry(0.007, 0.055, 0.006), z: -0.16, y: 0.017 },
    ]);
    const bombGeo = new THREE.SphereGeometry(0.13, 9, 7);
    this.allocGeo += 3;

    this.allocMat += 3;
    const pool = {
      shell: { geo: shellGeo, mat: new THREE.MeshBasicMaterial({ color: 0xffe9a8 }) },
      arrow: { geo: arrowGeo, mat: new THREE.MeshBasicMaterial({ color: 0xdccfae }) },
      bomb: { geo: bombGeo, mat: new THREE.MeshBasicMaterial({ color: 0x3f3f48 }) },
    };
    for (const k in pool) {
      pool[k].free = [];
      for (let i = 0; i < SHOT_MAX; i++) {
        const m = new THREE.Mesh(pool[k].geo, pool[k].mat);
        m.visible = false;
        m.position.set(0, -999, 0);
        this.root.add(m);
        pool[k].free.push(m);
      }
    }
    this._shotPool = pool;

    /* 迫击炮弹的落地影 */
    this.allocGeo++;
    this.allocMat++;
    this._blobMat = new THREE.MeshBasicMaterial({
      map: scorchTexture(), transparent: true, opacity: 0.4, depthWrite: false,
    });
    this._blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._blobMat);
    this._blob.rotation.x = -Math.PI / 2;
    this._blob.visible = false;
    this._blob.renderOrder = 2;
    this.root.add(this._blob);
  }

  takeShot(kind) {
    const p = this._shotPool[kind] || this._shotPool.shell;
    const m = p.free.pop();
    if (!m) return null;
    m.visible = true;
    m.scale.setScalar(1);
    return m;
  }

  releaseShot(kind, mesh) {
    const p = this._shotPool[kind] || this._shotPool.shell;
    if (!mesh) return;
    mesh.visible = false;
    mesh.position.set(0, -999, 0);
    p.free.push(mesh);
  }

  /**
   * 发射一发投射物：弹道、尾迹、落地影、命中回调都在这里。
   * @param {object} s { kind:'arrow'|'shell'|'bomb', from, to, speed, arc, payload, onHit, scale }
   */
  shoot(s) {
    const mesh = this.takeShot(s.kind);
    if (!mesh) return null;
    const from = s.from, to = s.to;
    const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const shot = {
      kind: s.kind || 'shell', mesh,
      from: new THREE.Vector3(from.x, from.y, from.z),
      to: new THREE.Vector3(to.x, to.y, to.z),
      t: 0,
      dur: Math.max(0.06, d / (s.speed || 22)),
      arc: s.arc || 0,
      trailT: 0,
      payload: s.payload,
      onHit: s.onHit,
    };
    mesh.position.copy(shot.from);
    if (s.scale) mesh.scale.setScalar(s.scale);
    this.shots.push(shot);
    return shot;
  }

  /* ============================================================
     飘字（伤害数字）
     ============================================================ */
  popup(x, y, z, text, kind) {
    if (this.budget < 0.5) return;                  // 低画质直接不显示，省 DOM
    const dom = this._ensurePopupDom();
    if (!dom) return;
    const p = this._popupPool.find((v) => !v.alive);
    if (!p) return;
    p.alive = true;
    p.t = 0;
    p.dur = 0.95;
    p.x = x; p.y = y; p.z = z;
    p.el.textContent = text;
    p.el.className = 'fx-pop fx-pop-' + (kind || 'dmg');
    p.el.style.opacity = '1';
    p.el.style.display = 'block';
    if (p.first) { dom.appendChild(p.el); p.first = false; }
  }

  _ensurePopupDom() {
    if (this._popupDom) return this._popupDom;
    if (typeof document === 'undefined') return null;
    const d = document.createElement('div');
    d.id = 'fx-pop-layer';
    document.body.appendChild(d);
    this._popupDom = d;
    for (let i = 0; i < POPUP_MAX; i++) {
      const el = document.createElement('div');
      el.className = 'fx-pop fx-pop-dmg';
      el.style.display = 'none';
      this._popupPool.push({ el, alive: false, t: 0, dur: 1, x: 0, y: 0, z: 0, first: true });
    }
    return d;
  }

  /* ============================================================
     主循环
     ============================================================ */
  get budget() {
    const q = this.engine ? this.engine.quality : 'high';
    return BUDGET[q] === undefined ? 1 : BUDGET[q];
  }

  update(dt) {
    dt = Math.min(0.05, Math.max(0, dt));
    this._updatePoints(this._soft, dt);
    this._updatePoints(this._glow, dt);
    this._updateDebris(dt);
    this._updateRings(dt);
    this._updateDecals(dt);
    this._updateShots(dt);
    this._updateFlash(dt);
    this._updatePopups(dt);
    if (this._soft.n > this._peaks.soft) this._peaks.soft = this._soft.n;
    if (this._glow.n > this._peaks.glow) this._peaks.glow = this._glow.n;
  }

  _updatePoints(sys, dt) {
    const items = sys.items, pos = sys.pos, col = sys.col, siz = sys.siz, alp = sys.alp;
    let n = 0;
    for (let i = 0; i < sys.n; i++) {
      const p = items[i];
      p.life -= dt;
      if (p.life <= 0) {                            // 交换删除，顺序无关
        sys.n--;
        items[i] = items[sys.n];
        items[sys.n] = p;
        i--;
        continue;
      }
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k; p.vz *= k;
      p.vy = p.vy * k + p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.05 && p.vy < 0) { p.y = 0.05; p.vy *= -0.22; p.vx *= 0.72; p.vz *= 0.72; }

      const u = 1 - p.life / p.life0;               // 年龄 0 → 1
      const fadeIn = u < 0.1 ? u / 0.1 : 1;
      pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z;
      col[n * 3] = p.cr; col[n * 3 + 1] = p.cg; col[n * 3 + 2] = p.cb;
      siz[n] = p.s0 + (p.s1 - p.s0) * u;
      alp[n] = p.a0 * fadeIn * Math.pow(1 - u, p.ap);
      n++;
    }
    sys.geo.setDrawRange(0, n);
    sys.geo.attributes.position.needsUpdate = true;
    sys.geo.attributes.aColor.needsUpdate = true;
    sys.geo.attributes.aSize.needsUpdate = true;
    sys.geo.attributes.aAlpha.needsUpdate = true;

    /* 逐点尺寸是「世界单位」，换算成像素要一个系数：视口高 / (2*tan(fov/2)) */
    if (this.engine && this.engine.renderer) {
      const cv = this.engine.renderer.domElement;
      const h = cv.height || 1;
      const fov = this.engine.camera.fov * Math.PI / 180;
      sys.mat.uniforms.uScale.value = h / (2 * Math.tan(fov / 2));
    }
  }

  _makeDebris() {
    const defs = {
      stone: { color: 0x8d8477, size: 1.0 },
      wood: { color: 0x7a4f2c, size: 1.15 },
      metal: { color: 0x6e747c, size: 0.7 },
      dirt: { color: 0x6b543c, size: 1.3 },
    };
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.allocGeo++;
    this._debris = {};
    this._debrisKeys = Object.keys(defs);
    for (const k in defs) {
      this.allocMat++;
      /* BoxGeometry 本来就是逐面独立顶点，法线天生平直，
         不需要（也不能）再传 flatShading —— MeshToonMaterial 从 r150 起
         已经移除该参数，传了只会得到一条无害但吵闹的 console 警告。 */
      const mat = new THREE.MeshToonMaterial({
        color: defs[k].color, gradientMap: GRAD_SOFT,
      });
      const im = new THREE.InstancedMesh(geo, mat, DEBRIS_PER_BUCKET);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = DEBRIS_PER_BUCKET;
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = false;
      im.renderOrder = 6;
      this.root.add(im);
      const items = [];
      for (let i = 0; i < DEBRIS_PER_BUCKET; i++) {
        items.push({
          x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0,
          wx: 0, wy: 0, wz: 0, s: 0.1, life: 0, life0: 1,
          q: new THREE.Quaternion(),
        });
      }
      this._debris[k] = { im, items, free: items.map((_, i) => i), alive: [], dirty: true, size: defs[k].size };
    }
  }

  _updateDebris(dt) {
    const M = this._m, S = this._s3, P = this._p3, q = this._q, e = this._e;
    for (const k of this._debrisKeys) {
      const b = this._debris[k];
      const al = b.alive;
      for (let ai = al.length - 1; ai >= 0; ai--) {
        const d = b.items[al[ai]];
        d.life -= dt;
        if (d.life <= 0) {
          d.y = -999;
          b.free.push(al[ai]);
          al.splice(ai, 1);
          b.dirty = true;
          continue;
        }
        d.vy -= 16 * dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        if (d.y < d.s * 0.5) { d.y = d.s * 0.5; d.vy *= -0.3; d.vx *= 0.62; d.vz *= 0.62; }
        e.set(d.wx * dt, d.wy * dt, d.wz * dt);
        d.q.multiply(q.setFromEuler(e));
        b.dirty = true;
      }
      if (!b.dirty) continue;
      b.dirty = false;
      for (let i = 0; i < DEBRIS_PER_BUCKET; i++) {
        const d = b.items[i];
        S.setScalar(d.y < -900 ? 0.0001 : d.s);
        P.set(d.x, d.y, d.z);
        M.compose(P, d.q, S);
        b.im.setMatrixAt(i, M);
      }
      b.im.instanceMatrix.needsUpdate = true;
    }
  }

  _makeRings() {
    this.allocGeo++;
    const geo = new THREE.RingGeometry(0.62, 1.0, 30);
    this._rings = [];
    for (let i = 0; i < RING_MAX; i++) {
      this.allocMat++;
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffe9b0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 7;
      this.root.add(m);
      this._rings.push({ mesh: m, mat, alive: false, t: 0, dur: 0.5, r0: 0.3, r1: 2.6, a0: 0.7 });
    }
  }

  _updateRings(dt) {
    for (const r of this._rings) {
      if (!r.alive) continue;
      r.t += dt;
      const u = r.t / r.dur;
      if (u >= 1) { r.alive = false; r.mesh.visible = false; continue; }
      const e = 1 - Math.pow(1 - u, 2.4);           // 先快后慢
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
      r.mat.opacity = r.a0 * Math.pow(1 - u, 1.5);
    }
  }

  _makeDecals() {
    this.allocGeo++;
    const geo = new THREE.PlaneGeometry(1, 1);
    this._decals = [];
    for (let i = 0; i < DECAL_MAX; i++) {
      this.allocMat++;
      const mat = new THREE.MeshBasicMaterial({
        map: scorchTexture(), transparent: true, opacity: 0, depthWrite: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 3;
      this.root.add(m);
      this._decals.push({ mesh: m, mat, alive: false, t: 0, dur: 14, a0: 0.8 });
    }
  }

  _updateDecals(dt) {
    for (const d of this._decals) {
      if (!d.alive) continue;
      d.t += dt;
      if (d.t >= d.dur) { d.alive = false; d.mesh.visible = false; continue; }
      const u = d.t / d.dur;
      d.mat.opacity = d.a0 * (u < 0.9 ? 1 : (1 - u) / 0.1);
    }
  }

  _makeFlash() {
    this.allocMat++;
    this._flash = new THREE.PointLight(0xffb060, 0, 12, 2);
    this.root.add(this._flash);
  }

  _updateFlash(dt) {
    if (this._flashT <= 0) {
      if (this._flash.intensity !== 0) this._flash.intensity = 0;
      return;
    }
    this._flashT -= dt;
    if (this._flashT <= 0) { this._flash.intensity = 0; return; }
    const u = this._flashT / this._flashT0;
    this._flash.intensity = this._flashPeak * u * u;
  }

  _updateShots(dt) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      const e = s.arc ? k : 1 - Math.pow(1 - k, 3);
      const px = s.from.x + (s.to.x - s.from.x) * e;
      const py = s.from.y + (s.to.y - s.from.y) * e + (s.arc ? Math.sin(k * Math.PI) * s.arc : 0);
      const pz = s.from.z + (s.to.z - s.from.z) * e;
      s.mesh.position.set(px, py, pz);
      if (s.kind === 'arrow') s.mesh.lookAt(s.to.x, s.to.y, s.to.z);

      /* 尾迹 */
      s.trailT -= dt;
      if (s.trailT <= 0 && this.budget > 0.3) {
        s.trailT = s.kind === 'arrow' ? 0.06 : 0.045;
        if (s.kind === 'arrow') {
          this._emit(this._soft, {
            x: px, y: py, z: pz, life: 0.2, s0: 0.05, s1: 0.15, a0: 0.28, ap: 1.4,
            drag: 2, grav: 0, color: 0xd8d0c0,
          });
        } else {
          this.smoke(px, py, pz, {
            n: 1, power: 0.16, life: 0.8, s0: 0.09, s1: 0.4, a0: 0.32, rise: 0.3, color: 0xa8a096,
          });
        }
      }
      /* 迫击炮的落地影：提前告诉玩家「要砸这儿」 */
      if (s.kind === 'bomb') {
        this._blob.visible = true;
        this._blob.position.set(px, 0.05, pz);
        const hi = Math.max(0.4, py);
        this._blob.scale.setScalar(0.6 + hi * 0.34);
        this._blobMat.opacity = Math.max(0.06, 0.42 - hi * 0.045);
      }

      if (k < 1) continue;
      if (s.kind === 'bomb') this._blob.visible = false;
      const cb = s.onHit;
      const payload = s.payload;
      this.releaseShot(s.kind, s.mesh);
      this.shots.splice(i, 1);
      if (cb) cb(payload, s.to);
    }
  }

  _updatePopups(dt) {
    if (!this._popupDom) return;
    const cam = this.camera;
    const cv = this.engine ? this.engine.renderer.domElement : null;
    if (!cam || !cv) return;
    const w = cv.clientWidth || 1, h = cv.clientHeight || 1;
    const v = this._s3;
    for (const p of this._popupPool) {
      if (!p.alive) continue;
      p.t += dt;
      const u = p.t / p.dur;
      if (u >= 1) {
        p.alive = false;
        p.el.style.display = 'none';
        continue;
      }
      v.set(p.x, p.y + u * 0.9, p.z).project(cam);
      p.el.style.left = ((v.x * 0.5 + 0.5) * w).toFixed(1) + 'px';
      p.el.style.top = ((-v.y * 0.5 + 0.5) * h).toFixed(1) + 'px';
      p.el.style.opacity = String(Math.max(0, 1 - u * u));
      p.el.style.transform = 'translate(-50%,-50%) scale(' + (0.85 + u * 0.35).toFixed(2) + ')';
    }
  }

  /* ============================================================
     自检 / 清理
     ============================================================ */
  stats() {
    let debris = 0;
    for (const k of this._debrisKeys) debris += this._debris[k].alive.length;
    return {
      budget: this.budget,
      soft: this._soft.n, softCap: this._soft.max,
      glow: this._glow.n, glowCap: this._glow.max,
      debris,
      rings: this._rings.filter((r) => r.alive).length,
      decals: this._decals.filter((d) => d.alive).length,
      shots: this.shots.length,
      popups: this._popupPool.filter((p) => p.alive).length,
      peakSoft: this._peaks.soft, peakGlow: this._peaks.glow,
      allocGeo: this.allocGeo, allocMat: this.allocMat,
      warmGeo: this.warmAlloc.geo, warmMat: this.warmAlloc.mat,
    };
  }

  /** 清空所有活动特效（切场景 / 结算时用） */
  clear() {
    for (const sys of [this._soft, this._glow]) {
      sys.n = 0;
      sys.geo.setDrawRange(0, 0);
    }
    for (const k of this._debrisKeys) {
      const b = this._debris[k];
      for (const idx of b.alive) { b.items[idx].y = -999; b.free.push(idx); }
      b.alive.length = 0;
      b.dirty = true;
    }
    for (const r of this._rings) { r.alive = false; r.mesh.visible = false; }
    for (const d of this._decals) { d.alive = false; d.mesh.visible = false; }
    for (const s of this.shots) this.releaseShot(s.kind, s.mesh);
    this.shots.length = 0;
    if (this._blob) this._blob.visible = false;
    this._flash.intensity = 0;
    this._flashT = 0;
    for (const p of this._popupPool) { p.alive = false; p.el.style.display = 'none'; }
  }

  dispose() {
    this.clear();
    if (this._popupDom && this._popupDom.parentNode) this._popupDom.parentNode.removeChild(this._popupDom);
    this._popupDom = null;
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}
