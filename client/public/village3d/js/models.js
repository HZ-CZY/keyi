/* ============================================================
   models.js — 模型总入口
   ------------------------------------------------------------
   分工：
     shapes.js        纯几何原语（切角体 / 拱券 / 梁 / 瓦顶 / 栏杆）
     parts.js         通用建筑零件（台基 / 墙 / 窗 / 门 / 木箱 / 旗帜…）
     models-civic.js  民用建筑（市政厅 / 资源 / 军事设施 / 工人小屋）
     models-def.js    防御建筑（加农炮 / 迫击炮 / 箭塔）
     models-units.js  兵种
     models.js        分发 + 接地阴影 + 资源气泡
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';
import { BUILDINGS, TILE } from './config.js';
import { aoPatch } from './shapes.js';
import { optimizeTree } from './optimize.js';
import { mulberry32 } from './toon.js';
import * as CIVIC from './models-civic.js';
import * as DEF from './models-def.js';
import { TROOP_MAKERS, TROOP_VARIANTS, variantRnd } from './models-units.js';

/* ---------------- 建筑分发表 ---------------- */
const MAKERS = {
  townhall:        CIVIC.mTownhall,
  goldmine:        CIVIC.mGoldMine,
  elixircollector: CIVIC.mElixirCollector,
  mine:            CIVIC.mMine,
  goldstorage:     CIVIC.mGoldStorage,
  elixirstorage:   CIVIC.mElixirStorage,
  barracks:        CIVIC.mBarracks,
  armycamp:        CIVIC.mArmyCamp,
  builderhut:      CIVIC.mBuilderHut,

  cannon:          DEF.mCannon,
  mortar:          DEF.mMortar,
  archertower:     DEF.mArcherTower,
};

/* ============================================================
   建筑变体
   ------------------------------------------------------------
   为什么建筑也要变体：同屏三座金矿如果长得一模一样，玩家立刻
   就看出"这是同一个模型摆了三次"。变体不是换贴图，是换**摆位**：
   杂物放左边还是右边、旗子什么色、半木构架分几格、做旧种子。
   实现上就是把一个「已播种的随机源」交给 maker —— 同一个
   (type, level, variant) 永远得到同一个样子，所以是可校验的。
   ============================================================ */
export const BUILD_VARIANTS = 3;

/** 字符串 → 32 位哈希 */
function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/**
 * 由「实例钥匙」推出变体号。
 * village / battle 各自用自己的建筑 id 当钥匙，于是同一类型的不同实例
 * 会落到不同变体上，而每次重建又都能复现。
 */
export function variantOf(key) {
  return hash32(String(key)) % BUILD_VARIANTS;
}

/** 建筑用的确定性随机源（每次调用都是全新的，避免序列被上一次消耗） */
function buildingRnd(type, lv, vi) {
  return mulberry32(hash32(type) * 31 + lv * 7919 + vi * 104729 + 0x9e3779b9);
}

/**
 * 生成建筑模型
 * @param {string} type
 * @param {number} level 1..5
 * @param {object} [opts] { variant } 变体号（0..2），不传则用 0
 * @returns {THREE.Group}  原点在地面、水平居中于占地中心
 */
export function buildModel(type, level = 1, opts = {}) {
  const fn = MAKERS[type];
  const root = new THREE.Group();
  const lv = Math.max(1, Math.min(5, Math.round(level) || 1));
  const vi = opts.variant === undefined ? 0 : ((opts.variant | 0) % BUILD_VARIANTS + BUILD_VARIANTS) % BUILD_VARIANTS;

  if (fn) {
    const inner = fn(lv, buildingRnd(type, lv, vi));
    root.add(inner);

    /* 关键一步：动画声明与瞄准锚点都挂在 maker 返回的那层 Group 上，
       而消费方（village.animate / battle 的索敌与炮口）读的是 root。
       之前没有上提，于是「旗帜飘、滑轮转、搅拌臂转、炮塔转向、
       炮弹从炮口出膛」这一整套全是死的。 */
    const ud = inner.userData;
    if (ud.anims) root.userData.anims = ud.anims;
    if (ud.turret) root.userData.turret = ud.turret;
    if (ud.muzzle) root.userData.muzzle = ud.muzzle;
  }

  /* 接地阴影：让建筑明确「压」在草地上，而不是浮着 */
  const def = BUILDINGS[type];
  if (def && type !== 'wall') {
    const [w, h] = def.size;
    const ao = aoPatch(w * TILE, h * TILE);
    ao.position.y = 0.035;
    root.add(ao);
  }

  root.userData.type = type;
  root.userData.level = lv;
  root.userData.variant = vi;
  root.userData.animT = 0;
  /* 网格合并：~110 draw call → 十几（详见 optimize.js） */
  root.userData.opt = optimizeTree(root);
  return root;
}

/* ============================================================
   兵种：原型缓存 + 共享克隆
   ------------------------------------------------------------
   为什么不像建筑那样每次现造：
     · 一个兵种现在是 ~30 个零件 + 静态岛合并，一次约 10~20ms。
       一波 12 个兵连续点下去就是明显的卡顿。
     · 不共享的话 28 个单位各自持有一份烘焙几何，显存纯浪费。
   做法：每种兵种预建 TROOP_VARIANTS 个确定性变体原型（几何 + 材质），
   部署时只做一次「结构克隆」——几何与材质全部共享，只重建
   userData 里的对象引用（Three 自带的 Object3D.clone() 会用
   JSON 深拷贝 userData，遇到循环引用直接抛错，所以必须自己写）。
   ============================================================ */
const _troopProto = new Map();

/** 造一个兵种原型（并做静态岛合并） */
function makeTroopProto(type, vi) {
  const g = new THREE.Group();
  const mk = TROOP_MAKERS[type];
  if (mk) mk(g, variantRnd(vi));

  /* 接地阴影：单位的真实投影在 2048 的阴影图上只有 1px，基本看不见；
     一块软贴片才真的把脚「压」在地上（Clash 系也是这么干的）。 */
  const M = g.userData.parts && g.userData.parts.M;
  const d = M ? M.H * 0.78 : 0.7;
  const ao = aoPatch(d, d * 0.8);
  ao.position.y = 0.02;
  g.add(ao);

  /* 只有 parts.joints 里的 6 个关节要切成岛根，其余（膝 / 肘 / 手 /
     脚 / 躯干细节）全部烘进所属岛，不多花 draw call。 */
  const J = g.userData.parts && g.userData.parts.joints;
  const breaks = new Set();
  if (J) for (const k in J) { const v = J[k]; if (v && v.isObject3D) breaks.add(v); }

  g.userData.opt = optimizeTree(g, { breaks });

  /* 打「原型共享」标记：这些几何体被所有克隆体共用，谁都不能 dispose。
     battle.dispose() 会按这个标记跳过 —— 否则打完一场之后，
     下一场里同兵种的模型会变成空壳（几何已被释放）。 */
  g.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.userData.__protoshare = true; });
  return g;
}

/** 取（或首次构建）某兵种某变体的原型 */
function getTroopProto(type, vi) {
  const key = type + '#' + vi;
  let p = _troopProto.get(key);
  if (!p) { p = makeTroopProto(type, vi); _troopProto.set(key, p); }
  return p;
}

/** 结构克隆：几何 / 材质共享，Object3D 引用重建 */
function cloneShared(src, map) {
  const dst = src.isMesh
    ? new THREE.Mesh(src.geometry, src.material)
    : (src.isPoints ? new THREE.Points(src.geometry, src.material) : new THREE.Group());
  dst.position.copy(src.position);
  dst.quaternion.copy(src.quaternion);
  dst.scale.copy(src.scale);
  dst.name = src.name;
  dst.castShadow = src.castShadow;
  dst.receiveShadow = src.receiveShadow;
  dst.visible = src.visible;
  dst.renderOrder = src.renderOrder;
  dst.frustumCulled = src.frustumCulled;
  if (src.isMesh) dst.userData = Object.assign({}, src.userData);   // isOutline / noOutline
  map.set(src, dst);
  for (const c of src.children) dst.add(cloneShared(c, map));
  return dst;
}

/** 把原型的 userData.parts 重建成克隆体的引用 */
function remapParts(proto, clone, map) {
  const sp = proto.userData.parts;
  if (!sp) return;
  const P = Object.assign({}, sp);
  const r = (o) => (o && o.isObject3D ? (map.get(o) || o) : o);
  for (const k in P) P[k] = r(P[k]);
  if (sp.elbows) { P.elbows = {}; for (const k in sp.elbows) P.elbows[k] = r(sp.elbows[k]); }
  if (sp.hands) { P.hands = {}; for (const k in sp.hands) P.hands[k] = r(sp.hands[k]); }
  if (sp.joints) { P.joints = {}; for (const k in sp.joints) P.joints[k] = r(sp.joints[k]); }
  if (sp.anchor) {
    P.anchor = sp.anchor.map((a) => ({ name: a.name, island: map.get(a.island), v: a.v }));
  }
  P.base = Object.assign({}, sp.base);
  clone.userData.parts = P;
}

/**
 * 生成兵种模型
 * @param {string} type barbarian / archer / giant / wallbreaker
 * @param {object} [opts] { variant } 指定变体号；不传则随机
 * @returns {THREE.Group} 原点在脚底
 */
export function buildTroop(type, opts = {}) {
  const vi = opts.variant === undefined
    ? Math.floor(Math.random() * TROOP_VARIANTS)
    : ((opts.variant % TROOP_VARIANTS) + TROOP_VARIANTS) % TROOP_VARIANTS;

  const proto = getTroopProto(type, vi);
  const map = new Map();
  const g = cloneShared(proto, map);
  remapParts(proto, g, map);

  if (proto.userData.spark) {
    const s = map.get(proto.userData.spark);
    if (s) g.userData.spark = s;
  }
  g.userData.baseY = 0;
  g.userData.variant = vi;
  g.userData.opt = proto.userData.opt;    // 原型构建时的合并统计（自检用）
  return g;
}

/* ============================================================
   资源气泡（收集提示）
   ============================================================ */
const _bubbleCache = new Map();
export function bubbleTexture(kind) {
  if (_bubbleCache.has(kind)) return _bubbleCache.get(kind);
  const C = document.createElement('canvas');
  C.width = C.height = 128;
  const g = C.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  // 圆底
  g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,.94)'; g.fill();
  g.lineWidth = 7; g.strokeStyle = '#30243c'; g.stroke();

  g.save();
  g.translate(64, 66);
  if (kind === 'gold') {
    g.fillStyle = '#ffc63d'; g.beginPath(); g.arc(0, 0, 28, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#a9741a'; g.lineWidth = 5; g.stroke();
    g.fillStyle = '#a9741a'; g.font = 'bold 38px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('G', 0, 2);
  } else if (kind === 'elixir') {
    g.fillStyle = '#d76bff';
    g.beginPath();
    g.moveTo(0, -30); g.bezierCurveTo(24, -6, 28, 8, 0, 28);
    g.bezierCurveTo(-28, 8, -24, -6, 0, -30);
    g.fill();
    g.strokeStyle = '#7a2c96'; g.lineWidth = 5; g.stroke();
  } else {
    g.fillStyle = '#4bdd97';
    g.beginPath(); g.moveTo(-16, -20); g.lineTo(16, -20); g.lineTo(24, -4); g.lineTo(0, 24); g.lineTo(-24, -4); g.closePath();
    g.fill(); g.strokeStyle = '#1f8a5c'; g.lineWidth = 5; g.stroke();
  }
  g.restore();

  const tex = new THREE.CanvasTexture(C);
  tex.colorSpace = THREE.SRGBColorSpace;
  _bubbleCache.set(kind, tex);
  return tex;
}

export function makeCollectBubble(kind) {
  const mat = new THREE.SpriteMaterial({
    map: bubbleTexture(kind), transparent: true, depthTest: false, depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(1.15, 1.15, 1.15);
  s.renderOrder = 900;
  s.userData.kind = kind;
  return s;
}
