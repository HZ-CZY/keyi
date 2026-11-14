/* ============================================================
   toon.js — 三渲二（Cel Shading）渲染核心
   ------------------------------------------------------------
   技术组成：
   1. MeshToonMaterial + 阶梯 gradientMap（把连续光照量化成 N 个色阶）
   2. flatShading 平直着色，让低模产生硬朗的面
   3. 反壳描边（Inverted Hull）：背面外扩一个纯色壳，得到恒定描边
      描边宽度按「屏幕空间」换算，缩放镜头时不会变粗变细
   4. 三段式打光：环境光 + 主光（暖）+ 补光（冷）
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';

/* ------------------------------------------------------------------
   色阶渐变图
   ------------------------------------------------------------------ */
const _gradCache = new Map();

/**
 * 生成 N 段阶梯渐变的 DataTexture，供 MeshToonMaterial 使用。
 * 每一段的亮度分布可通过 bias 数组微调（0~1，越小暗部面积越大）。
 */
export function gradientMap(steps = 4, bias = null) {
  const key = steps + '|' + (bias ? bias.join(',') : '');
  if (_gradCache.has(key)) return _gradCache.get(key);

  const data = new Uint8Array(4 * steps);
  for (let i = 0; i < steps; i++) {
    const t = bias ? bias[i] : (i + 1) / steps;
    const v = Math.round(255 * Math.min(1, Math.max(0, t)));
    data[i * 4 + 0] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  _gradCache.set(key, tex);
  return tex;
}

/* 预设：4 阶偏亮（主体建筑用） / 3 阶偏暗（地面、远景用） */
export const GRAD_MAIN = gradientMap(4, [0.46, 0.66, 0.85, 1.0]);
export const GRAD_SOFT = gradientMap(3, [0.58, 0.82, 1.0]);
export const GRAD_DARK = gradientMap(3, [0.30, 0.50, 0.74]);

/* ------------------------------------------------------------------
   材质缓存
   ------------------------------------------------------------------ */
const _matCache = new Map();

/**
 * 取一个 toon 材质（带缓存，避免重复编译着色器）
 * @param {number} color 十六进制颜色
 * @param {object} opt   { grad, emissive, emissiveIntensity, transparent, opacity, flat, side, depthWrite }
 */
export function toonMat(color, opt = {}) {
  const grad = opt.grad || GRAD_MAIN;
  const key = [
    color, grad.uuid, opt.emissive || 0, opt.emissiveIntensity || 0,
    opt.transparent ? 1 : 0, opt.opacity === undefined ? 1 : opt.opacity,
    opt.side || 0, opt.depthWrite === false ? 0 : 1,
  ].join('|');
  if (_matCache.has(key)) return _matCache.get(key);

  const m = new THREE.MeshToonMaterial({
    color: color,
    gradientMap: grad,
  });
  if (opt.emissive !== undefined) {
    m.emissive = new THREE.Color(opt.emissive);
    m.emissiveIntensity = opt.emissiveIntensity === undefined ? 1 : opt.emissiveIntensity;
  }
  if (opt.transparent) { m.transparent = true; m.opacity = opt.opacity === undefined ? 0.6 : opt.opacity; }
  if (opt.side !== undefined) m.side = opt.side;
  if (opt.depthWrite === false) m.depthWrite = false;
  _matCache.set(key, m);
  return m;
}

/* ------------------------------------------------------------------
   顶点色共享材质（draw call 的关键一招）
   ------------------------------------------------------------
   背景：optimizeTree() 只能把「同一个材质实例」的网格合成一个。
   如果每个零件都用自己的颜色去 toonMat()，材料缓存会给出十几个
   不同材质，于是一座静态岛被切成十几个网格 —— 零件越多，切得越碎。
   兵种细化之后就是这个问题：60 个网格里有 57 个是主体零件，
   而它们其实只是颜色不同。

   做法：把颜色烘进几何体的 color 属性，所有主体零件共用 **同一个**
   vertexColors 材质。于是「颜色不同」不再产生材质差异，
   一整座静态岛（六座关节岛）各自只剩 1 个主体网格。

   注意两点：
   1. 自发光 / 半透明零件不能走这条路 —— 它们要单独调 emissive、
      opacity，必须保留独立材质（走 param 分支里的 toonMat）。
   2. 顶点色以「线性空间」写入。MeshToonMaterial 会把
      material.color 从 sRGB 转到线性，顶点色则不转换，
      所以这里必须自己转，否则颜色会整体偏亮。
   ------------------------------------------------------------------ */
const _vcCache = new Map();

/**
 * 取顶点色版 toon 材质（按 grad / side / depthWrite 分档，各自只有一份）。
 * @param {object} opt 与 part() 的 opt 同源
 */
export function vcToonMat(opt = {}) {
  const grad = opt.grad || GRAD_MAIN;
  const key = [grad.uuid, opt.side || 0, opt.depthWrite === false ? 0 : 1].join('|');
  if (_vcCache.has(key)) return _vcCache.get(key);

  const m = new THREE.MeshToonMaterial({
    color: 0xffffff,          // 顶点色会乘上来，底色必须留白
    gradientMap: grad,
    vertexColors: true,
  });
  if (opt.side !== undefined) m.side = opt.side;
  if (opt.depthWrite === false) m.depthWrite = false;
  _vcCache.set(key, m);
  return m;
}

const _vcColor = new THREE.Color();

/**
 * 把单一颜色铺满几何体的 color 属性（就地加属性，返回同一个几何体）。
 * 索引几何也能用 —— 顶点色是按顶点存的，与索引无关。
 */
export function paintGeo(geo, color) {
  const pos = geo && geo.attributes && geo.attributes.position;
  if (!pos) return geo;
  const n = pos.count;
  _vcColor.set(color);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _vcColor.r;
    arr[i * 3 + 1] = _vcColor.g;
    arr[i * 3 + 2] = _vcColor.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/* ------------------------------------------------------------------
   反壳描边
   ------------------------------------------------------------------ */
/** 全局共享的描边宽度 uniform（世界单位 / 屏幕单位系数） */
export const outlineUniform = { value: 0.0016 };

/* 描边开关：反壳描边占了一半的几何量，弱机型直接关掉最划算。
   放在这里是为了让「之后新建」的模型也自动遵守当前画质。 */
export const outlineState = { on: true };

const _outlineMatCache = new Map();

/** 取描边材质（BackSide + 法线外扩），支持 InstancedMesh */
export function outlineMat(color = 0x30243c) {
  if (_outlineMatCache.has(color)) return _outlineMatCache.get(color);

  const m = new THREE.ShaderMaterial({
    uniforms: {
      uThickness: outlineUniform,
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: /* glsl */`
      uniform float uThickness;
      void main() {
        vec3 p = position;
        vec3 n = normal;
        #ifdef USE_INSTANCING
          mat3 im = mat3(instanceMatrix);
          p = (instanceMatrix * vec4(p, 1.0)).xyz;
          n = normalize(im * n);
        #endif
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // 按视距放缩，保证屏幕上的描边粗细恒定
        mv.xyz += n * uThickness * max(0.001, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }
    `,
    side: THREE.BackSide,
  });
  _outlineMatCache.set(color, m);
  return m;
}

/**
 * 根据画布高度、相机 fov 计算描边 uniform，
 * 使描边在屏幕上恒为 px 像素宽。
 */
export function tuneOutline(px, fovDeg, canvasHeight) {
  const halfTan = Math.tan((fovDeg * Math.PI / 180) / 2);
  // 屏幕 1px 对应的世界宽度（距相机 z=1 处）= 2*tan(fov/2)/H
  outlineUniform.value = (2 * halfTan / Math.max(1, canvasHeight)) * px;
}

/* ------------------------------------------------------------------
   几何 / 网格构造助手
   ------------------------------------------------------------------ */

/**
 * 创建一个 toon 网格。
 * 尺寸请直接烘进几何体（BoxGeometry(w,h,d)），不要用 scale，
 * 否则描边会被非等比缩放拉变形。
 *
 * flat（默认开）：把索引几何转成非索引并重算法线，得到低模硬边切面 —— 三渲二的关键质感。
 *        注意 MeshToonMaterial 在 r150 之后已经不支持 flatShading 参数了，
 *        「平直法线」只能靠 toNonIndexed() + computeVertexNormals() 做出来。
 * 注意：可见网格用「平直法线」，描边壳仍用「原始平滑法线」，
 *       否则硬边处的外扩壳会裂开露出缝隙。
 *
 * 颜色：默认走「顶点色 + 共享材质」（见上方说明），
 *       于是同岛零件能被合并成一个网格；传 vc:false 可以退回独立材质。
 */
export function part(geo, color, opt = {}) {
  /* 自发光 / 半透明零件必须独立材质：它们要单独改 emissive、opacity */
  const vc = opt.vc !== false && opt.emissive === undefined && !opt.transparent;

  let meshGeo = geo;
  if (opt.flat !== false && geo.index && !geo.userData.__flatDone) {
    const ng = geo.toNonIndexed();
    ng.computeVertexNormals();
    ng.userData.__flatDone = true;
    meshGeo = ng;
  }

  const mat = vc ? vcToonMat(opt) : toonMat(color, opt);
  if (vc) paintGeo(meshGeo, color);      // 颜色烘进几何体，材质全省了

  const m = new THREE.Mesh(meshGeo, mat);
  if (opt.x || opt.y || opt.z) m.position.set(opt.x || 0, opt.y || 0, opt.z || 0);
  if (opt.rx || opt.ry || opt.rz) m.rotation.set(opt.rx || 0, opt.ry || 0, opt.rz || 0);
  if (opt.sx || opt.sy || opt.sz) m.scale.set(opt.sx || 1, opt.sy || 1, opt.sz || 1);
  if (opt.shadow !== false) { m.castShadow = true; m.receiveShadow = false; }
  m.userData.noOutline = opt.outline === false;
  if (opt.outline !== false) m.add(partOutline(geo, opt.outlineColor));
  return m;
}

/** 仅创建描边壳 */
export function partOutline(geo, color) {
  const o = new THREE.Mesh(geo, outlineMat(color));
  o.castShadow = false;
  o.receiveShadow = false;
  o.userData.isOutline = true;
  o.frustumCulled = true;
  o.visible = outlineState.on;
  return o;
}

/** 快捷盒体 */
export function box(w, h, d, color, opt = {}) {
  return part(new THREE.BoxGeometry(w, h, d), color, opt);
}
/** 快捷圆柱（低边数 → 卡通感） */
export function cyl(rt, rb, h, color, opt = {}) {
  const seg = opt.seg || 10;
  return part(new THREE.CylinderGeometry(rt, rb, h, seg), color, opt);
}
/** 快捷圆锥 */
export function cone(r, h, color, opt = {}) {
  return part(new THREE.ConeGeometry(r, h, opt.seg || 8), color, opt);
}
/** 快捷球体 */
export function ball(r, color, opt = {}) {
  return part(new THREE.SphereGeometry(r, opt.seg || 10, opt.seg2 || 7), color, opt);
}
/** 快捷圆环（屋顶、桶箍用） */
export function torus(r, tube, color, opt = {}) {
  return part(new THREE.TorusGeometry(r, tube, 5, opt.seg || 12), color, opt);
}

/** 把一组对象放进 Group 并统一处理 */
export function group(...children) {
  const g = new THREE.Group();
  children.forEach((c) => c && g.add(c));
  return g;
}

/* ------------------------------------------------------------------
   销毁
   ------------------------------------------------------------------ */
export function disposeTree(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      // 几何体可能是共享的（缓存几何），这里只销毁明确标记的
      if (o.geometry && o.geometry.userData.__owned) o.geometry.dispose();
    }
  });
}

/* ------------------------------------------------------------------
   确定性随机（用于按种子生成敌方村庄）
   ------------------------------------------------------------------ */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------
   小工具
   ------------------------------------------------------------------ */
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const dist2 = (ax, az, bx, bz) => {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
};
export const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));

/** 缓动 */
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
