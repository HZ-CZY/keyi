/* ============================================================
   build-kit.js — 建筑的「统一构造语言」
   ------------------------------------------------------------
   为什么单独抽出来：
     民用（models-civic）和防御（models-def）是两套模型，但
     「墙该怎么砌、窗该怎么凹、屋顶该怎么搁上去」必须是同一套规则，
     否则两边的等级反馈会不一致 —— 加农炮每级涨 27%，迫击炮只涨 2.6%，
     这种问题正是"各写各的"造成的。

     这个模块把 level-style.js 的等级表翻译成 shapes / parts 的调用，
     并补上 maker 里反复要用的几个构件（台身 / 台阶 / 石墩 / 瞭望塔）。

   使用约定：
     · maker 收 (lv, R)，R 是**已播种**的随机源 → 变体可复现
     · 零件的动画声明在自己身上，用 add() 挂上去时自动登记到建筑根
       （models.js 只上提根的 anims，直接 g.add(flag(...)) 会让旗子静止）
     · 新构件一律走 part() 的顶点色共享材质，且除压顶外 outline:false，
       否则精细化的代价会直接变成 draw call
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';
import { part, ball, GRAD_MAIN, GRAD_SOFT, mulberry32 } from './toon.js';
import { PALETTE } from './config.js';
import { chamferGeo, beam, stairs } from './shapes.js';
import { wall, window2, roof } from './parts.js';
import { LV_STYLE } from './level-style.js';

export { LV_STYLE };

/** 缺省随机源：maker 被直接调用（不传 R）时用，保证结果仍然确定 */
export const FALLBACK_RND = mulberry32(0x5eed0001);

/** 按 R() 从数组里取一个 —— R 是播种过的，所以结果确定 */
export function pickR(R, arr) {
  return arr[Math.min(arr.length - 1, (R() * arr.length) | 0)];
}

/** 变体抖动（±amt） */
export function jit(R, amt) { return (R() - 0.5) * 2 * amt; }

/**
 * 把 obj 挂到建筑上，并把它**自己声明的**动画登记到建筑根。
 * 为什么需要：village.animate 只读模型根的 userData.anims，而
 * flag() / smoke() / brazier() 这些零件把 anims 声明在自己身上 ——
 * 直接 g.add(flag(...)) 的话，所有旗帜其实一直是静止的。
 */
export function add(g, obj) {
  if (!obj) return obj;
  g.add(obj);
  const list = obj.userData && obj.userData.anims;
  if (list && list.length) g.userData.anims = (g.userData.anims || []).concat(list);
  return obj;
}

/** 登记一条动画（给就地创建的对象用） */
export function anim(g, obj, type, opt = {}) {
  g.userData.anims = (g.userData.anims || []).concat([Object.assign({ obj, type }, opt)]);
  return obj;
}

/**
 * 统一墙身：LV_STYLE → wall()。
 * @param {object} st  LV_STYLE(lv)
 * @param {object} opt 覆盖项，见 parts.wall()；coping / stain 默认跟等级
 */
export function styledWall(w, h, d, color, st, opt = {}) {
  const masonry = opt.masonry !== false;
  return wall(w, h, d, color, {
    courses: opt.courses === undefined ? (masonry ? st.courses : 0) : opt.courses,
    batter: opt.batter === undefined ? st.batter : opt.batter,
    corner: opt.corner || 0,
    bevel: opt.bevel,
    seed: opt.seed || 0,
    plinth: opt.plinth,
    plinthH: opt.plinthH,
    plinthColor: opt.plinthColor,
    bands: opt.bands,
    bandColor: opt.bandColor,
    seamColor: opt.seamColor,
    quoins: opt.quoins,
    quoinN: opt.quoinN || st.quoinN,
    quoinSize: opt.quoinSize,
    quoinColor: opt.quoinColor,
    coping: opt.coping === undefined ? st.coping : opt.coping,
    copingColor: opt.copingColor,
    stain: opt.stain === undefined ? st.stain : opt.stain,
    stainH: opt.stainH,
    stainColor: opt.stainColor,
  });
}

/**
 * 统一屋顶：LV_STYLE → roof()，并补齐「屋顶是怎么搁上去的」。
 * wallW / wallD 必须给准（默认按檐口内收 0.24 推），
 * 否则椽头长度算错 —— 短了看不见，长了会穿墙。
 */
export function styledRoof(w, d, h, st, opt = {}) {
  return roof(w, d, h, {
    color: opt.color || st.roof.color,
    trim: opt.trim || st.roof.trim,
    ridgeColor: opt.ridgeColor || st.roof.ridge,
    layers: opt.layers || 6,
    spread: opt.spread,
    ridge: opt.ridge !== false,
    finial: opt.finial,
    finialColor: opt.finialColor,
    wallW: opt.wallW === undefined ? w - 0.24 : opt.wallW,
    wallD: opt.wallD === undefined ? d - 0.24 : opt.wallD,
    corbels: opt.corbels === undefined ? st.corbels : opt.corbels,
    corbelY: opt.corbelY,
    corbelStep: opt.corbelStep,
    rafters: opt.rafters === undefined ? st.rafters : opt.rafters,
    rafterY: opt.rafterY,
    rafterStep: opt.rafterStep,
    rafterColor: opt.rafterColor,
    eaveTiles: opt.eaveTiles === undefined ? st.eaveTiles : opt.eaveTiles,
    eaveY: opt.eaveY,
    eaveStep: opt.eaveStep,
    eaveHead: opt.eaveHead,
    eaveDrip: opt.eaveDrip,
    moss: opt.moss === undefined ? st.moss : opt.moss,
    mossSeed: opt.mossSeed,
    stone: opt.stone,
  });
}

/** 统一窗：LV_STYLE 决定窗棂花样 / 窗楣形式 / 百叶 */
export function styledWindow(w, h, st, opt = {}) {
  const o = Object.assign({ muntin: st.muntin, lintel: st.lintel }, opt);
  if (o.shutters === undefined) o.shutters = st.shutters;
  return window2(w, h, o);
}

/**
 * 石砌台身（承重基座）。返回 { g, top }：
 * top = 台面高度（含压顶），上层直接落在 top 上，别再手算。
 */
export function podium(w, d, h, color, st, opt = {}) {
  const g = styledWall(w, h, d, color, st, {
    corner: opt.corner === undefined ? Math.min(w, d) * 0.06 : opt.corner,
    plinth: false,
    stain: opt.stain,
    coping: opt.coping !== false,
    quoins: opt.quoins,
    quoinSize: opt.quoinSize,
    quoinColor: opt.quoinColor,
    seed: opt.seed || 0,
  });
  const cap = opt.coping === false ? 0 : 0.09;
  return { g, top: h + cap };
}

/** 门口台阶：按台面高度自动定级数，最上一级刚好齐台面 */
export function entryStairs(y0, w, color, opt = {}) {
  const sh = opt.sh || 0.17;
  const n = Math.max(1, Math.round(y0 / sh));
  const g = stairs(w, n, y0 / n, opt.sd || 0.19, color, { side: opt.side });
  if (opt.z) g.position.z = opt.z;
  if (opt.ry) g.rotation.y = opt.ry;
  return g;
}

/** 一圈石墩（柱础 / 界桩） */
export function stonePiers(r, n, h, color, opt = {}) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (opt.phase === undefined ? Math.PI / 4 : opt.phase);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const w = opt.w || 0.2;
    g.add(part(chamferGeo(w, h, w, { bevel: 0.03, corner: 0.03 }), color, { x, y: h / 2, z }));
    if (opt.cap !== false) {
      g.add(part(chamferGeo(w * 1.18, 0.05, w * 1.18, { bevel: 0.015 }),
        opt.capColor || PALETTE.stoneLight, { x, y: h + 0.02, z, outline: false }));
    }
    if (opt.ball) {
      // 用 toon.ball() 而不是裸 SphereGeometry —— 全站球体分段统一，
      // 否则同一颗「球饰」在水库 / 金库里是多边形数不同的两种东西。
      g.add(ball(w * 0.5, opt.ballColor || color, { x, y: h + 0.12, z }));
    }
  }
  return g;
}

/**
 * 石砌垛口：一圈「凸一段、缺一段」的矮墙块。
 * 这是炮位最直白的防御语言 —— 有了它，炮台才是「工事」而不是「石头台子」。
 * @returns {THREE.Group}
 */
export function merlons(r, n, h, color, opt = {}) {
  const g = new THREE.Group();
  const w = opt.w || 0.24;
  const t = opt.t === undefined ? w * 0.66 : opt.t;
  for (let i = 0; i < n; i++) {
    if (i % 2 && opt.alt !== false) continue;      // 隔一个空一个 → 垛口
    const a = (i / n) * Math.PI * 2 + (opt.phase || 0);
    g.add(part(chamferGeo(w, h, t, { bevel: 0.024, corner: 0.03 }), color, {
      x: Math.cos(a) * r, y: h / 2, z: Math.sin(a) * r, ry: -a,
    }));
    if (opt.cap !== false) {
      g.add(part(chamferGeo(w * 1.16, 0.045, t * 1.3, { bevel: 0.014 }), opt.capColor || PALETTE.stoneLight, {
        x: Math.cos(a) * r, y: h + 0.02, z: Math.sin(a) * r, ry: -a, outline: false,
      }));
    }
  }
  return g;
}

/**
 * 木构瞭望塔 —— 兵营 / 营地的「等级高度」来源。
 * 四柱 + 双道横梁 + 收分斜撑 + 挑出的板台 + 围栏 + 小草披。
 */
export function watchtower(w, h, color, opt = {}) {
  const g = new THREE.Group();
  const tw = opt.tw || 0.085;
  const beamC = opt.beam || PALETTE.timberDark;
  // 斜撑与横梁是两种构件：默认同色，但允许分别指定（兵营的斜撑偏亮）
  const braceC = opt.brace || beamC;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(part(chamferGeo(tw, h, tw, { bevel: 0.02 }), color, {
      x: sx * w / 2, y: h / 2, z: sz * w / 2, outline: false,
    }));
    const bm = beam([sx * w * 0.72, 0.06, sz * w * 0.72], [sx * w * 0.42, h * 0.62, sz * w * 0.42],
      tw * 0.55, braceC, {});
    if (bm) g.add(bm);
  }
  for (const t of [0.46, 0.84]) {
    for (const [px, pz, bw, bd] of [
      [0, w / 2 + tw / 2, w + tw * 2, 0.055], [0, -(w / 2 + tw / 2), w + tw * 2, 0.055],
      [w / 2 + tw / 2, 0, 0.055, w + tw * 2], [-(w / 2 + tw / 2), 0, 0.055, w + tw * 2],
    ]) {
      g.add(part(new THREE.BoxGeometry(bw, 0.055, bd), beamC, { x: px, y: h * t, z: pz, outline: false }));
    }
  }
  const pw = w * 1.34;
  g.add(part(chamferGeo(pw, 0.075, pw, { bevel: 0.02, corner: 0.03 }), PALETTE.timberLight, {
    y: h * 0.88, outline: false,
  }));
  const railH = opt.railH === undefined ? 0.24 : opt.railH;
  const railY = h * 0.88 + railH;
  for (const [px, pz, bw, bd] of [
    [0, pw / 2, pw, 0.04], [0, -pw / 2, pw, 0.04],
    [pw / 2, 0, 0.04, pw], [-pw / 2, 0, 0.04, pw],
  ]) {
    g.add(part(new THREE.BoxGeometry(bw, 0.05, bd), PALETTE.timber, { x: px, y: railY, z: pz, outline: false }));
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(part(new THREE.BoxGeometry(0.055, railH, 0.055), PALETTE.timber, {
      x: sx * pw / 2, y: h * 0.88 + railH / 2, z: sz * pw / 2, outline: false,
    }));
  }
  const R = 0.5 * Math.hypot(pw, pw) * 1.1;
  const rh = opt.rh || 0.36;
  g.add(part(new THREE.ConeGeometry(R, rh, 4), opt.roofColor || PALETTE.thatch, {
    y: railY + rh / 2, ry: Math.PI / 4, grad: GRAD_MAIN,
  }));
  g.add(part(new THREE.ConeGeometry(R * 1.06, 0.06, 4), opt.roofTrim || PALETTE.thatchDark, {
    y: railY + 0.02, ry: Math.PI / 4, outline: false,
  }));
  return g;
}

/** 石砌圆台：一圈收分的石鼓（炮台 / 塔基的地面语言） */
export function stoneDrum(rBot, h, opt = {}) {
  const g = new THREE.Group();
  const n = Math.max(2, Math.round(opt.n || 3));
  const seg = opt.seg || 14;
  const ch = h / n;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1 || 1);
    const r = rBot * (1 - (opt.batter === undefined ? 0.12 : opt.batter) * t);
    g.add(part(new THREE.CylinderGeometry(r * 0.99, r, ch * 0.94, seg), opt.color || PALETTE.stoneMid, {
      y: ch * (i + 0.5), grad: GRAD_SOFT,
    }));
    if (i < n - 1) {
      g.add(part(new THREE.TorusGeometry(r * 1.005, opt.seam || 0.022, 4, seg + 6), opt.seamColor || PALETTE.mortar, {
        y: ch * (i + 1), rx: Math.PI / 2, outline: false,
      }));
    }
  }
  return g;
}
