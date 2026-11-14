/* ============================================================
   shapes.js — 精细几何工具箱
   ------------------------------------------------------------
   三渲二的「精细」不等于高面数，而是三层节奏：
     大块面（体块比例） → 中等结构（屋檐/拱券/梁柱/台阶） → 小装饰（铆钉/绳索/瓦楞）
   直角 → 切角能极大提升"被雕刻过"的感觉，且面数几乎不涨。

   坐标约定（重要）
   · chamferGeo / plateGeo：Y 是高度（会自带 rotateX）
   · archWallGeo：立面在 XY 平面，厚度沿 Z
   · beam：在任意两点之间拉一根方梁（自动 lookAt）
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';
import { part, mulberry32, GRAD_MAIN, GRAD_SOFT } from './toon.js';

export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/* ------------------------------------------------------------------
   1. 切角盒 —— 替代 BoxGeometry 的主力
   ------------------------------------------------------------------ */
/**
 * @param {number} w 宽（X）
 * @param {number} h 高（Y）
 * @param {number} d 深（Z）
 * @param {object} opt { bevel 倒角, corner 平面切角, bevelSeg }
 */
export function chamferGeo(w, h, d, opt = {}) {
  const lim = Math.min(w, d, h) * 0.5;
  let b = opt.bevel === undefined ? Math.min(w, h, d) * 0.09 : opt.bevel;
  b = Math.max(0.002, Math.min(b, lim - 0.002));
  const hw = w / 2 - b, hd = d / 2 - b;
  let cc = opt.corner === undefined ? 0 : opt.corner;
  cc = Math.max(0, Math.min(cc, hw - 0.002, hd - 0.002));

  const s = new THREE.Shape();
  if (cc > 0.002) {
    s.moveTo(-hw + cc, -hd); s.lineTo(hw - cc, -hd); s.lineTo(hw, -hd + cc);
    s.lineTo(hw, hd - cc);   s.lineTo(hw - cc, hd);  s.lineTo(-hw + cc, hd);
    s.lineTo(-hw, hd - cc);  s.lineTo(-hw, -hd + cc);
  } else {
    s.moveTo(-hw, -hd); s.lineTo(hw, -hd); s.lineTo(hw, hd); s.lineTo(-hw, hd);
  }
  s.closePath();

  const depth = Math.max(0.004, h - b * 2);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: true, bevelThickness: b, bevelSize: b,
    bevelSegments: opt.bevelSeg === undefined ? 1 : opt.bevelSeg,
    steps: 1, curveSegments: 1,
  });
  geo.translate(0, 0, -depth / 2);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/* ------------------------------------------------------------------
   2. 拱券墙 —— 立面挖洞（拱门 / 圆窗 / 城垛）
   ------------------------------------------------------------------ */
/**
 * 立面在 XY 平面（宽 X、高 Y），厚度沿 Z。
 * @param {number} w 墙宽
 * @param {number} h 墙高
 * @param {number} d 墙厚
 * @param {Array}  holes [{ x, y, w, h, arch, round }]
 *   x 水平中心（相对墙中心），y 洞底高度（相对墙底 -h/2），arch=true 半圆顶
 */
export function archWallGeo(w, h, d, holes = []) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -h / 2); s.lineTo(w / 2, -h / 2);
  s.lineTo(w / 2, h / 2);   s.lineTo(-w / 2, h / 2);
  s.closePath();

  for (const o of holes) {
    const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2;
    const y0 = -h / 2 + (o.y || 0);
    const y1 = y0 + o.h;
    const r = o.w / 2;
    const p = new THREE.Path();
    if (o.arch) {
      const ys = y1 - r;
      p.moveTo(x0, y0); p.lineTo(x0, ys);
      p.absarc(o.x, ys, r, Math.PI, 0, true);
      p.lineTo(x1, y0);
    } else if (o.round) {
      p.absarc(o.x, (y0 + y1) / 2, r * 0.5 + o.h * 0.5, 0, Math.PI * 2, false);
    } else {
      p.moveTo(x0, y0); p.lineTo(x0, y1); p.lineTo(x1, y1); p.lineTo(x1, y0);
    }
    p.closePath();
    s.holes.push(p);
  }

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: d, bevelEnabled: false, steps: 1, curveSegments: 10,
  });
  geo.translate(0, 0, -d / 2);
  return geo;
}

/* ------------------------------------------------------------------
   3. 两点梁 —— 斜撑、绳索、屋脊、旗杆全用它
   ------------------------------------------------------------------ */
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * 在 p1 → p2 之间拉一根截面 thick×thick 的方梁（或圆柱）
 * @param {number[]} p1 [x,y,z]
 * @param {number[]} p2 [x,y,z]
 */
export function beam(p1, p2, thick, color, opt = {}) {
  _a.set(p1[0], p1[1], p1[2]);
  _b.set(p2[0], p2[1], p2[2]);
  const len = _a.distanceTo(_b);
  if (len < 1e-4) return null;
  const geo = opt.round
    ? new THREE.CylinderGeometry(thick / 2, thick / 2, len, opt.seg || 6)
    : new THREE.BoxGeometry(thick, thick, len);
  const m = part(geo, color, Object.assign({ outline: false }, opt));
  if (opt.round) {
    // 圆柱默认沿 Y，需要把 Y 转到 p1→p2
    m.position.copy(_a).add(_b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(
      V3(0, 1, 0), _b.clone().sub(_a).normalize()
    );
  } else {
    m.position.copy(_a).add(_b).multiplyScalar(0.5);
    m.lookAt(_b);
  }
  return m;
}

/* ------------------------------------------------------------------
   4. 瓦顶（四坡 / 四角攒尖）
   ------------------------------------------------------------------ */
/**
 * 层叠瓦楞四坡屋顶。
 * 三渲二建筑的可读性 60% 来自屋顶，所以这里做三层信息：
 *   锥面（体量） + 分层瓦楞（节奏） + 檐口（压边）
 * 注意 spread 的取值：四坡锥底面是正方形（旋转 45°），若要馆口刚好比墙沿
 * 大出一点点，spread 应在 1.08~1.12；给 1.0 会让屋顶比墙还小，给 1.2 又会吞掉墙体。
 */
export function tileRoof(w, d, h, color, opt = {}) {
  const g = new THREE.Group();
  const layers = opt.layers || 6;
  const spread = opt.spread === undefined ? 1.09 : opt.spread;
  const trim = opt.trim || color;
  const R = 0.5 * Math.hypot(w, d) * spread;   // 底角到中心的距离
  const grad = opt.grad || GRAD_MAIN;

  // 主体（4 段锥，45° 对齐轴）
  g.add(part(new THREE.ConeGeometry(R, h, 4), color, { y: h / 2, ry: Math.PI / 4, grad }));

  // 瓦楞：每层外扩 9%，形成清晰的阶梯；奇偶层微调明暗，
  // 因为 45° 等距视角下单纯靠几何台阶几乎看不见，颜色交替才是瓦纹的可读性来源。
  const cA = new THREE.Color(color).getHex();
  const cB = new THREE.Color(color).multiplyScalar(0.9).getHex();
  const ringH = h / layers;
  for (let i = 0; i < layers; i++) {
    const t0 = i / layers, t1 = (i + 1) / layers;
    const rBot = R * (1 - t0);
    const rTop = R * (1 - t1);
    const out = 1.085 - i * 0.006;
    g.add(part(new THREE.CylinderGeometry(Math.max(0.02, rTop * out), rBot * out, ringH * 1.06, 4, 1, true),
      i % 2 ? cB : cA, { y: h * t0 + ringH * 0.53, ry: Math.PI / 4, grad }));
  }

  // 檐口：薄而挺，压住整圈
  g.add(part(new THREE.CylinderGeometry(R * 1.055, R * 1.1, 0.105, 4), trim, {
    y: 0.052, ry: Math.PI / 4, grad,
  }));
  // 檐口下沿（深色薄环，投出"檐影"）
  g.add(part(new THREE.CylinderGeometry(R * 1.0, R * 0.94, 0.06, 4), opt.under || 0x6d3a33, {
    y: -0.028, ry: Math.PI / 4, grad: GRAD_SOFT, outline: false, shadow: false,
  }));

  // 四条斜脊（贴着坡面的瓦脊，不是天线）
  if (opt.ridge !== false) {
    const rc = opt.ridgeColor || 0x8a4038;
    const k = 0.705 * R;                     // 底角在轴上的分量
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      const ex = Math.cos(a) * k * 1.02, ez = Math.sin(a) * k * 1.02;
      const bm = beam([ex, 0.09, ez], [0, h * 0.88, 0], 0.1, rc, {});
      if (bm) g.add(bm);
      // 脊头（底角的瓦当）
      g.add(part(chamferGeo(0.16, 0.1, 0.16, { bevel: 0.028, corner: 0.03 }), rc, {
        x: ex * 1.01, y: 0.1, z: ez * 1.01, ry: a, outline: false,
      }));
    }
  }

  return g;
}

/* ------------------------------------------------------------------
   5. 栏杆 / 栅栏
   ------------------------------------------------------------------ */
/**
 * 沿一段直线铺栏杆（上横杆 + 竖柱）
 */
export function railing(p1, p2, h, color, opt = {}) {
  const g = new THREE.Group();
  const n = opt.n || Math.max(2, Math.round(Math.hypot(p2[0] - p1[0], p2[2] - p1[2]) / 0.3));
  const t = opt.thick || 0.055;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const x = p1[0] + (p2[0] - p1[0]) * k, z = p1[2] + (p2[2] - p1[2]) * k;
    const y = p1[1] + (p2[1] - p1[1]) * k;
    g.add(part(new THREE.BoxGeometry(t, h, t), color, { x, y: y + h / 2, z, outline: false }));
  }
  const tm = beam([p1[0], p1[1] + h, p1[2]], [p2[0], p2[1] + h, p2[2]], t * 1.3, color, opt.railOpt || {});
  if (tm) g.add(tm);
  if (opt.mid) {
    const md = beam([p1[0], p1[1] + h * 0.5, p1[2]], [p2[0], p2[1] + h * 0.5, p2[2]], t * 0.9, color, {});
    if (md) g.add(md);
  }
  return g;
}

/** 环形栏杆（塔顶平台用） */
export function railingRing(r, h, n, color, opt = {}) {
  const g = new THREE.Group();
  const t = opt.thick || 0.06;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    g.add(part(new THREE.BoxGeometry(t, h, t), color, {
      x: Math.cos(a) * r, y: (opt.y || 0) + h / 2, z: Math.sin(a) * r, outline: false,
    }));
  }
  // 上下横杆（用 N 段折线近似圆周）
  for (const yy of [h, opt.mid ? h * 0.5 : null]) {
    if (yy === null) continue;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const bm = beam(
        [Math.cos(a0) * r, (opt.y || 0) + yy, Math.sin(a0) * r],
        [Math.cos(a1) * r, (opt.y || 0) + yy, Math.sin(a1) * r],
        t * 1.25, color, {}
      );
      if (bm) g.add(bm);
    }
  }
  return g;
}

/* ------------------------------------------------------------------
   6. 楼梯 / 台阶
   ------------------------------------------------------------------ */
/** 朝 +Z 方向的台阶，共 n 级 */
export function stairs(w, n, rise, run, color, opt = {}) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    g.add(part(new THREE.BoxGeometry(w, rise, run * (n - i)), color, {
      y: rise / 2 + i * rise, z: (run * (n - i)) / 2, outline: false,
    }));
  }
  if (opt.side) {
    for (const sx of [-1, 1]) {
      g.add(part(new THREE.BoxGeometry(0.07, n * rise * 0.92, 0.07), opt.side, {
        x: sx * (w / 2 + 0.05), y: n * rise * 0.45, z: 0.14, outline: false,
      }));
    }
  }
  return g;
}

/* ------------------------------------------------------------------
   7. 砖石墙带 —— 给墙面加横向石带 / 转角石
   ------------------------------------------------------------------ */
/**
 * 沿墙体四周加装饰条
 * @param {number} y 条带中心高度
 */
export function band(w, d, y, thick, hh, color, opt = {}) {
  const g = new THREE.Group();
  const o = opt.out || 0.03;
  g.add(part(new THREE.BoxGeometry(w + o * 2, hh, d + o * 2), color, { y, outline: false }));
  return g;
}

/** 转角石（四角的小方柱，让建筑有"砌石"的锚点） */
export function quoins(w, d, h, y0, size, color, opt = {}) {
  const g = new THREE.Group();
  const n = opt.n || 3;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    for (let i = 0; i < n; i++) {
      const hh = h / n;
      // 交错尺寸，像真的砌石
      const ss = size * (i % 2 === 0 ? 1 : 0.78);
      g.add(part(new THREE.BoxGeometry(ss, hh * 0.86, ss), color, {
        x: sx * (w / 2 - ss / 2 + 0.015),
        y: y0 + hh * (i + 0.5),
        z: sz * (d / 2 - ss / 2 + 0.015),
        outline: false,
      }));
    }
  }
  return g;
}

/* ------------------------------------------------------------------
   8. 圆周布置助手
   ------------------------------------------------------------------ */
/**
 * 沿圆周均匀放 N 个物件
 * @param {number} n 数量
 * @param {number} r 半径
 * @param {(x:number,z:number,i:number,a:number)=>Object3D} fn
 */
export function ring(n, r, fn, opt = {}) {
  const g = new THREE.Group();
  const a0 = opt.a0 || 0;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    const o = fn(Math.cos(a) * r, Math.sin(a) * r, i, a);
    if (o) g.add(o);
  }
  return g;
}

/** 左右对称放置 */
export function mirrorX(fn) {
  const g = new THREE.Group();
  const a = fn(-1); const b = fn(1);
  if (a) g.add(a);
  if (b) g.add(b);
  return g;
}

/* ------------------------------------------------------------------
   9. 铆钉 / 灯 / 小装饰
   ------------------------------------------------------------------ */
/** 沿一段直线铺铆钉 */
export function rivets(p1, p2, n, r, color, opt = {}) {
  const g = new THREE.Group();
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    g.add(part(new THREE.SphereGeometry(r, 6, 4), color, {
      x: p1[0] + (p2[0] - p1[0]) * k,
      y: p1[1] + (p2[1] - p1[1]) * k,
      z: p1[2] + (p2[2] - p1[2]) * k,
      grad: GRAD_SOFT, outline: false, shadow: false,
    }));
  }
  return g;
}

/** 挂灯（暖光小球 + 金属盖） */
export function lantern(x, y, z, opt = {}) {
  const g = new THREE.Group();
  g.add(part(new THREE.BoxGeometry(0.06, 0.06, 0.06), 0x6b5a45, { y: 0.14, outline: false }));
  g.add(part(new THREE.CylinderGeometry(0.035, 0.055, 0.06, 6), 0x8a7a5c, { y: 0.09, outline: false }));
  g.add(part(new THREE.SphereGeometry(0.075, 8, 6), opt.color || 0xffd98a, {
    y: 0, emissive: opt.color || 0xffb347, emissiveIntensity: 1.0, outline: false, shadow: false,
  }));
  g.add(part(new THREE.CylinderGeometry(0.05, 0.035, 0.04, 6), 0x8a7a5c, { y: -0.08, outline: false }));
  g.position.set(x, y, z);
  return g;
}

/* ------------------------------------------------------------------
   10. 绳索 / 缆
   ------------------------------------------------------------------ */
export function rope(p1, p2, r, color = 0xb09a72, sag = 0) {
  const g = new THREE.Group();
  const seg = 6;
  let prev = p1;
  for (let i = 1; i <= seg; i++) {
    const k = i / seg;
    const x = p1[0] + (p2[0] - p1[0]) * k;
    const z = p1[2] + (p2[2] - p1[2]) * k;
    const y = p1[1] + (p2[1] - p1[1]) * k - Math.sin(k * Math.PI) * sag;
    const m = beam(prev, [x, y, z], r, color, { round: true, seg: 5 });
    if (m) g.add(m);
    prev = [x, y, z];
  }
  return g;
}

/* ------------------------------------------------------------------
   11. 几何合并 —— 把多个零件烘成一个几何体，供 InstancedMesh 使用
   ------------------------------------------------------------------ */
/**
 * @param {Array} items [{ geo, x, y, z, rx, ry, rz, sx, sy, sz }]
 * @returns {THREE.BufferGeometry} 非索引、含 position / normal / uv
 */
export function mergeGeos(items) {
  const parts = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();

  for (const it of items) {
    const g = it.geo.index ? it.geo.toNonIndexed() : it.geo.clone();
    e.set(it.rx || 0, it.ry || 0, it.rz || 0);
    q.setFromEuler(e);
    v.set(it.x || 0, it.y || 0, it.z || 0);
    sc.set(it.sx || 1, it.sy || 1, it.sz || 1);
    m.compose(v, q, sc);
    g.applyMatrix4(m);
    if (!g.attributes.normal) g.computeVertexNormals();
    parts.push(g);
  }

  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  let o = 0;
  for (const p of parts) {
    const c = p.attributes.position.count;
    pos.set(p.attributes.position.array.subarray(0, c * 3), o * 3);
    nor.set(p.attributes.normal.array.subarray(0, c * 3), o * 3);
    if (p.attributes.uv) uv.set(p.attributes.uv.array.subarray(0, c * 2), o * 2);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

/* ------------------------------------------------------------------
   12. 接地阴影贴片（fake AO）
   ------------------------------------------------------------------ */
let _aoTex = null;
export function aoTexture() {
  if (_aoTex) return _aoTex;
  const C = document.createElement('canvas');
  C.width = C.height = 128;
  const g = C.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(48,36,60,0.55)');
  grd.addColorStop(0.55, 'rgba(48,36,60,0.26)');
  grd.addColorStop(1, 'rgba(48,36,60,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  _aoTex = new THREE.CanvasTexture(C);
  _aoTex.colorSpace = THREE.SRGBColorSpace;
  return _aoTex;
}

/** 圆角方形接地阴影（贴近建筑占地轮廓，比纯圆更贴合） */
export function aoPatch(w, d) {
  const mat = new THREE.MeshBasicMaterial({
    map: aoTexture(), transparent: true, depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.rotation.x = -Math.PI / 2;
  m.scale.set(w * 1.5, d * 1.5, 1);
  m.renderOrder = 1;
  m.userData.noOutline = true;
  return m;
}

/* ==================================================================
   13. 砌体构造 —— 「石头垒起来」的体积感
   ------------------------------------------------------------------
   为什么加这一组：
     原来的 wall() 是「一块切角盒子 + 几条装饰带」。远看没问题，
     近看就是一块塑料 —— 看不出砌筑、看不出收分、看不出年代。
     建筑精细度真正缺的不是面数，是**构造层次**：
       砌缝（谁压在谁上面）→ 收分（下重上轻）→ 压顶（收头）
       → 檐下（屋顶怎么搁在墙上）→ 做旧（时间痕迹）
     这一组把上面五件事变成可复用的几何原语。

   统一纪律（不然 draw call 会反弹）：
     · 全部走顶点色共享材质（part 的默认行为），不新增材质
     · 除压顶外全部 outline:false —— 小件的描边壳会把几何量翻倍，
       而且 0.02 量级的缝线配 2.6px 描边会糊成黑边
   ================================================================== */

/**
 * 砌石墙身：把一面墙拆成 n 层，层间夹一道深色勾缝，整体自上而下收分。
 * @param {object} opt { n 层数, batter 总收分, seamH 缝厚, seamColor, corner, bevel, seed }
 */
export function courseStack(w, h, d, color, opt = {}) {
  const g = new THREE.Group();
  const n = Math.max(2, Math.round(opt.n || 5));
  const batter = opt.batter === undefined ? 0.05 : opt.batter;
  const seamH = opt.seamH === undefined ? 0.02 : opt.seamH;
  const seamC = opt.seamColor === undefined
    ? new THREE.Color(color).multiplyScalar(0.74).getHex()
    : opt.seamColor;
  const corner = opt.corner || 0;
  const bevel = opt.bevel === undefined ? 0.022 : opt.bevel;
  const rnd = mulberry32(0x9e37 + (opt.seed || 0) * 2246822519);
  const ch = h / n;
  const shrink = Math.min(w, d) * 0.998;

  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const k = 1 - (batter * t) / shrink;              // 上窄下宽
    const hh = ch * (1 + (rnd() - 0.5) * 0.06);       // 每层高略有出入，去机械感
    g.add(part(chamferGeo(w * k, hh, d * k, { bevel, corner: corner * k }), color, {
      y: ch * (i + 0.5), outline: false,
    }));
    if (i < n - 1) {
      g.add(part(new THREE.BoxGeometry(w * k + 0.01, seamH, d * k + 0.01), seamC, {
        y: ch * (i + 1) - seamH * 0.5, outline: false, shadow: false,
      }));
    }
  }
  return g;
}

/**
 * 墙压顶：底层外挑做出滴水线，上层内收收头。
 * 没有它，墙是一块「切平的方块」；有了它，墙才"收得住"。
 */
export function coping(w, d, y, color, opt = {}) {
  const g = new THREE.Group();
  const o = opt.out === undefined ? 0.06 : opt.out;
  const h1 = opt.h1 === undefined ? 0.05 : opt.h1;
  const h2 = opt.h2 === undefined ? 0.04 : opt.h2;
  const corner = opt.corner || 0.035;
  g.add(part(chamferGeo(w + o * 2, h1, d + o * 2, { bevel: 0.014, corner }), color, { y: y + h1 / 2 }));
  g.add(part(chamferGeo(w + o * 0.6, h2, d + o * 0.6, { bevel: 0.012, corner }), opt.colorTop || color, {
    y: y + h1 + h2 / 2, outline: false,
  }));
  return g;
}

/**
 * 沿矩形四边均匀布点 —— 檐下托块 / 露头椽 / 瓦当 全靠它。
 * 回调收到 (x, z, ang, i, edge)：ang 是「朝外」的 y 轴旋转角，
 * 所以回调里的零件只要朝 +Z 建模即可自动朝外。
 */
export function perimeterRow(w, d, step, fn) {
  const g = new THREE.Group();
  const edges = [
    { nx: 0, nz: 1, tx: 1, tz: 0, half: d / 2, tlen: w },
    { nx: 0, nz: -1, tx: 1, tz: 0, half: d / 2, tlen: w },
    { nx: 1, nz: 0, tx: 0, tz: 1, half: w / 2, tlen: d },
    { nx: -1, nz: 0, tx: 0, tz: 1, half: w / 2, tlen: d },
  ];
  for (const e of edges) {
    const n = Math.max(1, Math.round(e.tlen / step));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      const x = e.nx * e.half + e.tx * t * e.tlen;
      const z = e.nz * e.half + e.tz * t * e.tlen;
      const ang = Math.atan2(e.nx, e.nz);
      const o = fn(x, z, ang, i, e);
      if (o) g.add(o);
    }
  }
  return g;
}

/** 檐下托块（一层层把屋顶"托"起来的小石头） */
export function corbelRow(w, d, y, color, opt = {}) {
  const step = opt.step || 0.34;
  const size = opt.size || 0.11;
  const hh = opt.h || 0.1;
  return perimeterRow(w, d, step, (x, z, ang, i) => part(
    chamferGeo(size * (i % 2 ? 0.82 : 1), hh, size), color,
    {
      x, z, y: y + hh / 2, ry: ang,
      outline: false, shadow: false, grad: GRAD_SOFT,
    }
  ));
}

/**
 * 露头椽（从檐下探出来的一排木椽头）。
 * 这是"屋顶是有结构的"这句话最直观的证据 —— 少了它，
 * 屋顶看着就像一顶扣上去的帽子。
 */
export function rafterRow(w, d, y, color, opt = {}) {
  const step = opt.step || 0.24;
  const out = opt.out || 0.16;
  const tw = opt.thick || 0.055;
  const hh = opt.h || 0.07;
  const drop = opt.drop === undefined ? 0.05 : opt.drop;
  return perimeterRow(w, d, step, (x, z, ang, i) => {
    const nx = Math.sin(ang), nz = Math.cos(ang);
    const m = beam([x, y + hh * 0.5, z],
      [x + nx * out, y + hh * 0.5 - drop, z + nz * out], tw, color, {});
    return m;
  });
}

/** 檐口瓦当 + 滴水（一排半圆瓦头，压住檐口） */
export function eaveTiles(w, d, y, color, opt = {}) {
  const step = opt.step || 0.19;
  const r = opt.r || 0.055;
  const out = opt.out || 0.035;
  const drop = opt.drop || 0.055;
  return perimeterRow(w, d, step, (x, z, ang, i) => {
    const nx = Math.sin(ang), nz = Math.cos(ang);
    const grp = new THREE.Group();
    // 瓦当（圆头）
    grp.add(part(new THREE.CylinderGeometry(r, r, 0.035, 6), opt.colorHead || color, {
      rx: Math.PI / 2, z: 0.01, outline: false, shadow: false, grad: GRAD_SOFT,
    }));
    // 滴水（下垂的三角尖）
    grp.add(part(new THREE.ConeGeometry(r * 0.9, drop, 4), opt.colorDrip || color, {
      rx: Math.PI, y: -drop * 0.6, outline: false, shadow: false,
    }));
    grp.position.set(x + nx * out, y, z + nz * out);
    grp.rotation.y = ang;
    return grp;
  });
}

/**
 * 外墙做旧：墙脚溅泥带。
 * 三渲二最怕"塑料感"，而塑料感一半来自"太干净"。
 * 四条高度不等的深色薄片，成本极低（4 个盒 = 48 面），但立刻有了年代。
 */
export function stainBand(w, d, y0, h, color, opt = {}) {
  const g = new THREE.Group();
  const t = opt.t || 0.016;
  const o = opt.out || 0.008;
  const hs = opt.hs || [1.0, 0.68, 0.84, 0.58];
  const faces = [
    { x: 0, z: (d / 2 + o), w: w + o * 2, d: t, k: 0 },
    { x: 0, z: -(d / 2 + o), w: w + o * 2, d: t, k: 1 },
    { x: (w / 2 + o), z: 0, w: t, d: d + o * 2, k: 2 },
    { x: -(w / 2 + o), z: 0, w: t, d: d + o * 2, k: 3 },
  ];
  for (const f of faces) {
    const hh = h * hs[f.k % hs.length];
    g.add(part(new THREE.BoxGeometry(f.w, hh, f.d), color, {
      x: f.x, z: f.z, y: y0 + hh / 2, outline: false, shadow: false,
    }));
  }
  return g;
}

/**
 * 垂直水渍 / 苔痕：贴在墙面上的一条上窄下宽的深色片。
 * 单块成本 12 面，撒几块就能把"新盖的"变成"在这儿立了很久的"。
 */
export function streak(w, h, color, opt = {}) {
  const g = new THREE.Group();
  const t = opt.t || 0.012;
  const taper = opt.taper === undefined ? 0.45 : opt.taper;
  const seg = opt.seg || 3;
  let y = 0;
  for (let i = 0; i < seg; i++) {
    const k = i / seg;
    const hh = (h / seg) * (1 + (opt.jitter ? (opt.jitter[i % 4] - 0.5) * 0.4 : 0));
    const ww = w * (1 - k * taper);
    g.add(part(new THREE.BoxGeometry(ww, hh, t), color, {
      y: y + hh / 2, z: (opt.z || 0) + i * 0.002, outline: false, shadow: false,
    }));
    y += hh;
  }
  return g;
}
