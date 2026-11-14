/* ============================================================
   optimize.js — 网格合并（draw call 优化）
   ------------------------------------------------------------
   问题出在 part() 的写法：每个零件 = 「可见网格 + 反壳描边网格」。
   一座精细建筑约 110 个 Mesh ≈ 110 次 draw call（阴影 pass 还要
   再来一遍）。40 座建筑就是 4000+，iPad 必跪。

   思路：把不会被动画单独驱动的网格，按「材质 + 渲染状态」合并。
   这里的关键概念是**静态岛**：
     · 动画只发生在 userData.anims / turret / muzzle 声明的节点上
     · 于是把装配树按这些锚点切成若干子树，每棵子树就是一个静态岛
     · 岛内所有网格的相对变换可以烘进几何体（岛根坐标系）
     · 岛根本身保持独立，动画照常旋转/缩放，子树跟着走
   合并后一座建筑的 draw call 从 ~110 降到十几。

   为什么可以放心：
     合并只是「把 N 个网格的顶点变换到同一坐标系后拼成一个
     BufferGeometry」，没有任何三角形被丢弃。
     optimizeTree() 会返回合并前后的三角形数 —— 两者必须严格相等，
     这是一个可以自动校验的不变量（渲染自检会把它报出来）。
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';
import { outlineState } from './toon.js';

const isOutline = (o) => !!(o && o.userData && o.userData.isOutline);

/* ------------------------------------------------------------------
   1. 找出所有「动画锚点」 —— 这些节点各自成为一座静态岛的根
   ------------------------------------------------------------------ */
function collectAnchors(root, extra) {
  const set = new Set();
  if (extra) for (const b of extra) if (b && b.isObject3D) set.add(b);

  root.traverse((o) => {
    const ud = o.userData;
    if (!ud) return;

    if (ud.anims) {
      for (const a of ud.anims) {
        if (!a || !a.obj) continue;
        set.add(a.obj);
        /* 烟 / 水汽这类动画动的是「一组小球轮替上升」，
           真正会位移的是 a.obj 的子节点，所以子节点也必须独立 */
        if ((a.type === 'smoke' || a.type === 'drip') && a.obj.children) {
          for (const c of a.obj.children) set.add(c);
        }
      }
    }
    if (ud.turret) set.add(ud.turret);
    if (ud.muzzle) set.add(ud.muzzle);
  });
  return set;
}

/* ------------------------------------------------------------------
   2. 收集一座岛内的所有可合并网格（连同「岛根 → 网格」的矩阵）
   ------------------------------------------------------------------ */
function collectIsland(islandRoot, anchors) {
  const items = [];
  const identity = new THREE.Matrix4();

  const visit = (node, mat) => {
    // node 自身的描边壳：相对 node 是单位矩阵，所以直接用 mat
    for (const c of node.children) {
      if (isOutline(c)) items.push({ mesh: c, matrix: mat });
    }
    for (const child of node.children) {
      if (isOutline(child)) continue;
      if (anchors.has(child)) continue;          // 这是另一座岛的根，不并入本岛
      const cm = new THREE.Matrix4().multiplyMatrices(mat, child.matrix);
      if (child.isMesh) items.push({ mesh: child, matrix: cm });
      visit(child, cm);
    }
  };

  visit(islandRoot, identity);
  return items;
}

/* ------------------------------------------------------------------
   3. 几何烘焙 / 拼接
   ------------------------------------------------------------------ */
function bake(geo, matrix) {
  if (!geo || !geo.attributes || !geo.attributes.position) return null;
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(matrix);          // 位置 + 法线（法线走逆转置矩阵，非等比缩放也正确）
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

function concat(geos) {
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;

  /* 顶点色是「零件颜色」的唯一载体（part() 不再为每种颜色建材质），
     合并时必须一起搬过来，否则整座岛会变成黑色。
     只要有任意一段带 color，输出就统一带 color；缺的那几段补白（1,1,1 在线性
     空间等价于「不改变底色」，与没有顶点色的旧行为一致）。 */
  let hasColor = false;
  for (const g of geos) {
    if (g.attributes.color) { hasColor = true; break; }
  }

  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const col = hasColor ? new Float32Array(n * 3) : null;
  if (col) col.fill(1);

  let o = 0;
  for (const g of geos) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, c * 3), o * 3);
    nor.set(g.attributes.normal.array.subarray(0, c * 3), o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, c * 2), o * 2);
    if (col && g.attributes.color) {
      col.set(g.attributes.color.array.subarray(0, c * 3), o * 3);
    }
    o += c;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** 单个几何体的三角形数 */
function trisOf(geo) {
  if (!geo || !geo.attributes || !geo.attributes.position) return 0;
  return geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
}

/** 三角形数 —— 合并的不变量就靠它守 */
function triStats(root) {
  let tris = 0, meshes = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    if (!g.attributes || !g.attributes.position) return;
    meshes++;
    tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  });
  return { tris: Math.round(tris), meshes };
}

/* ------------------------------------------------------------------
   4. 主入口
   ------------------------------------------------------------------ */
/**
 * 就地优化一棵模型树。
 * @param {THREE.Object3D} root
 * @param {object}  [opts]
 * @param {Set}     [opts.breaks]  额外的岛根（例如兵种的四肢关节）
 * @param {boolean} [opts.enabled] false 时只统计不做合并
 * @returns {{meshesBefore:number, meshesAfter:number, trisBefore:number,
 *            trisAfter:number, merged:number, ok:boolean}}
 */
export function optimizeTree(root, opts = {}) {
  const before = triStats(root);
  const stats = {
    meshesBefore: before.meshes, meshesAfter: before.meshes,
    trisBefore: before.tris, trisAfter: before.tris,
    merged: 0, rescued: 0, ok: true,
  };
  if (opts.enabled === false || !root) return stats;

  root.updateMatrixWorld(true);                    // 先把 local matrix 全部算出来
  const anchors = collectAnchors(root, opts.breaks);

  /* 枚举静态岛：root 自己永远是一座岛；锚点各自成岛 */
  const islands = [root];
  const scan = (node) => {
    for (const child of node.children) {
      if (isOutline(child)) continue;
      if (anchors.has(child)) islands.push(child);
      scan(child);
    }
  };
  scan(root);

  for (const island of islands) {
    const items = collectIsland(island, anchors);
    if (items.length < 2) continue;
    const islTrisBefore = triStats(island).tris;

    /* 按「材质 + 渲染状态」分组：状态不一致就不能合，否则会改掉阴影/排序 */
    const groups = new Map();
    for (const it of items) {
      const m = it.mesh.material;
      if (!m || Array.isArray(m)) continue;
      const key = [
        m.uuid,
        it.mesh.castShadow ? 1 : 0,
        it.mesh.receiveShadow ? 1 : 0,
        it.mesh.renderOrder,
        it.mesh.visible ? 1 : 0,
        isOutline(it.mesh) ? 'o' : 's',
      ].join('|');
      let g = groups.get(key);
      if (!g) { g = { mat: m, sample: it.mesh, list: [] }; groups.set(key, g); }
      g.list.push(it);
    }

    /* ---- 先抢救「留守零件」，再动手摘 ----
       合并的做法是把成员网格从树上摘下来、换成 1 个合并网格。但零件是可以
       嵌套的：part() 造出来的网格底下挂着它的反壳描边。如果某个描边壳在
       本岛里是「独苗」（整座岛只有它用这个描边色），它自己不成组、不参与
       合并，可它的父网格却会被摘走 —— 父节点一走，它也一起离开了装配树，
       三角形就凭空少了。这正是 render-check 里合并前后三角形数对不上的根因。

       对策：开摘之前，把「祖先里有人会被摘掉」的零件 attach 到岛根上。
       attach 会保住世界变换，所以画面完全一致，只是不再挂在原来的父节点下。 */
    const doomed = new Set();
    for (const g of groups.values()) {
      if (g.list.length < 2) continue;
      for (const it of g.list) doomed.add(it.mesh);
    }
    let rescued = 0;
    for (const it of items) {
      if (doomed.has(it.mesh) || !it.mesh.parent) continue;
      let p = it.mesh.parent;
      let atRisk = false;
      while (p && p !== island) {
        if (doomed.has(p)) { atRisk = true; break; }
        p = p.parent;
      }
      if (atRisk) { island.attach(it.mesh); rescued++; }
    }
    if (rescued) stats.rescued += rescued;

    for (const g of groups.values()) {
      if (g.list.length < 2) continue;

      const geos = [];
      let expect = 0;
      let failed = 0;
      for (const it of g.list) {
        const geo = bake(it.mesh.geometry, it.matrix);
        if (geo) { geos.push(geo); expect += trisOf(it.mesh.geometry); } else { failed++; }
      }
      /* 只要有任何一个网格烘焙失败，这一组就整体放弃合并 ——
         否则下面会把全部成员从树上摘掉，而它的几何体并没有进合并结果，
         三角形就凭空少了（这正是「合并前后三角形数必须相等」这条不变量要抓的事）。 */
      if (failed > 0) {
        console.warn('[optimize] 岛内有 ' + failed + ' 个网格无法烘焙（几何体缺 position），'
          + '本组放弃合并以免丢三角形');
        continue;
      }
      if (geos.length < 2) continue;

      const mergedGeo = concat(geos);
      mergedGeo.userData.__owned = true;

          /* 逐组审计：这一组搬进去的三角形必须和搬出来的完全一致。
             整棵树的总数对不上时，靠这条能直接指到是哪座岛、哪个材质出的问题。 */
      const got = trisOf(mergedGeo);
      if (Math.round(got) !== Math.round(expect)) {
        console.warn('[optimize] 组内三角形数不一致：', Math.round(expect), '→', Math.round(got),
          '· 岛根', island.name || island.type,
          '· 材质', g.mat && g.mat.name ? g.mat.name : (g.mat && g.mat.type),
          '· 成员', g.list.length,
          '· 顶点', geos.reduce((n, x) => n + x.attributes.position.count, 0));
      }

      const mesh = new THREE.Mesh(mergedGeo, g.mat);
      mesh.castShadow = g.sample.castShadow;
      mesh.receiveShadow = g.sample.receiveShadow;
      mesh.renderOrder = g.sample.renderOrder;
      mesh.userData.noOutline = true;                 // 合并网格自己不再挂描边壳
      mesh.userData.isOutline = isOutline(g.sample);
      mesh.visible = g.sample.visible && (!mesh.userData.isOutline || outlineState.on);

      for (const it of g.list) if (it.mesh.parent) it.mesh.parent.remove(it.mesh);
      island.add(mesh);
      stats.merged++;
    }

    const islTrisAfter = triStats(island).tris;
    if (islTrisAfter !== islTrisBefore) {
      console.warn('[optimize] 岛内三角形数不一致：', islTrisBefore, '→', islTrisAfter,
        '· 岛根', island.name || island.type, '· 待合并零件', items.length);
    }
  }

  const after = triStats(root);
  stats.meshesAfter = after.meshes;
  stats.trisAfter = after.tris;
  /* 不变量：三角形一个都不能少、一个都不能多 */
  stats.ok = stats.trisAfter === stats.trisBefore;
  if (!stats.ok) {
    console.warn('[optimize] 三角形数不一致：', stats.trisBefore, '→', stats.trisAfter);
  }
  return stats;
}
