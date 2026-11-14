/* ============================================================
   parts.js — 通用建筑零件库
   ------------------------------------------------------------
   每个零件都是「可辨识的建筑构件」而不是抽象几何体：
   台基 / 墙身 / 窗 / 拱门 / 烟囱 / 瓦顶 / 木箱 / 木桶 / 旗帜 /
   武器架 / 盾牌 / 招牌 / 火盆 / 石堆 …
   建筑由这些零件拼装，风格自然统一，也便于逐级加装饰。
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';
import { part, toonMat, mulberry32, GRAD_MAIN, GRAD_SOFT, GRAD_DARK, box, cyl, ball, torus } from './toon.js';
import { PALETTE } from './config.js';
import {
  chamferGeo, archWallGeo, beam, tileRoof, railing, railingRing, stairs,
  quoins, ring, rivets, lantern, rope,
  courseStack, coping, corbelRow, rafterRow, eaveTiles, stainBand, streak,
} from './shapes.js';
import { LV_STYLE } from './level-style.js';

/* ------------------------------------------------------------------
   台基
   ------------------------------------------------------------------ */
/**
 * 石砌台基。
 * 注意：corner 只给「小切角」。给大了整个台基会变成八角/圆形，
 * 建筑会失去"落在一块方正地基上"的稳重感。
 */
export function base(w, d, opt = {}) {
  const g = new THREE.Group();
  const h = opt.h || 0.26;
  const c = opt.corner === undefined ? Math.min(w, d) * 0.06 : opt.corner;
  const out = opt.out === undefined ? 1.06 : opt.out;
  // 下层裙边（外扩，做出台阶感）
  g.add(part(chamferGeo(w * out, h * 0.52, d * out, { bevel: 0.045, corner: c * out }),
    opt.colorLow || PALETTE.stoneDark, { y: h * 0.26 }));
  // 台身
  g.add(part(chamferGeo(w, h * 0.6, d, { bevel: 0.04, corner: c }),
    opt.color || PALETTE.stoneMid, { y: h * 0.52 + h * 0.3 }));
  // 顶面石板（稍亮，给台基一个明确的"面"）
  g.add(part(chamferGeo(w * 0.99, 0.04, d * 0.99, { bevel: 0.018, corner: c * 0.9 }),
    opt.colorTop || PALETTE.stoneLight, { y: h * 1.12 + 0.02, outline: false }));
  return g;
}

/* ------------------------------------------------------------------
   墙身
   ------------------------------------------------------------------ */
/**
 * @param {object} opt
 *   courses   砌石层数（>0 时用分层砌石替代单块切角盒）
 *   batter    总收分（顶部比底部窄多少，世界单位）
 *   seed      勾缝/层高的确定性扰动种子
 *   plinth    勒脚高度比例（默认 0.14，传 false 关掉）
 *   bands     砌石横带数, quoin* 转角石
 *   coping    顶部压顶（外挑滴水 + 内收收头）
 *   stain     墙脚溅泥（三渲二去塑料感的关键一笔）
 */
export function wall(w, h, d, color, opt = {}) {
  const g = new THREE.Group();
  const plinthH = opt.plinth === false ? 0 : h * (opt.plinthH === undefined ? 0.14 : opt.plinthH);

  /* 墙身：courses > 0 走「砌石分层 + 勾缝 + 收分」，否则退回原来的单块切角盒 */
  if (opt.courses) {
    const cs = courseStack(w, Math.max(0.05, h - plinthH), d, color, {
      n: opt.courses,
      batter: opt.batter,
      corner: opt.corner || 0,
      seamColor: opt.seamColor,
      seed: opt.seed || 0,
    });
    cs.position.y = plinthH;
    g.add(cs);
  } else {
    g.add(part(chamferGeo(w, h, d, { bevel: opt.bevel || 0.05, corner: opt.corner || 0 }), color, { y: h / 2 }));
  }

  /* 勒脚：略外扩的一圈深色石带，把墙"压"在地上 */
  if (plinthH > 0) {
    g.add(part(chamferGeo(w * 1.05, plinthH, d * 1.05, { bevel: 0.035 }), opt.plinthColor || PALETTE.stoneDark, {
      y: plinthH / 2, outline: false,
    }));
  }
  for (let i = 0; i < (opt.bands || 0); i++) {
    g.add(part(chamferGeo(w * 1.012, 0.055, d * 1.012, { bevel: 0.02 }), opt.bandColor || PALETTE.stoneLight, {
      y: h * (0.3 + i * 0.28), outline: false,
    }));
  }
  if (opt.quoins) {
    g.add(quoins(w, d, h * 0.92, h * 0.04, opt.quoinSize || Math.min(w, d) * 0.2,
      opt.quoinColor || PALETTE.stoneLight, { n: opt.quoinN || 3 }));
  }

  /* 压顶：墙的收头。没有它墙就是一块「被切平的方块」 */
  if (opt.coping) {
    g.add(coping(w, d, h, opt.copingColor || opt.bandColor || PALETTE.stoneLight, {
      out: opt.copingOut === undefined ? 0.055 : opt.copingOut,
      corner: 0.03,
    }));
  }

  /* 做旧：墙脚一圈溅泥。四边高度不等，避免出现"围裙" */
  if (opt.stain) {
    g.add(stainBand(w, d, 0, h * (opt.stainH === undefined ? 0.3 : opt.stainH),
      opt.stainColor || 0x7d6b51, { hs: opt.stainHs }));
  }
  return g;
}

/* ------------------------------------------------------------------
   窗
   ------------------------------------------------------------------ */
/**
 * 带洞口进深的窗（默认朝向 +Z）。
 * ------------------------------------------------------------
 * v1 的问题：玻璃和窗框都**浮在墙外**，是"贴上去的一块板"，
 * 侧面看立刻穿帮，正面看也没有凹陷感 —— 这是"塑料感"的半壁江山。
 * v2 改成九件套：
 *   ① 洞口暗部（衬在玻璃背后的深色板）
 *   ② 窗套 / 洞口侧壁（四片，把洞口框出进深 depth）
 *   ③ 玻璃（退进 recess）
 *   ④ 内框（四根细木条收边）
 *   ⑤ 窗棂（cross 十字 / grid 九宫 / lattice 菱格）
 *   ⑥ 窗台（挑出板 + 内收滴水板）
 *   ⑦ 窗楣（flat 平楣 / arch 拱券 / pediment 三角山花）
 *   ⑧ 木百叶窗板（可选）
 *   ⑨ 窗台花箱（可选）
 * 单窗零件数由 7 提到 ~19，且是**有立体进深**的 19。
 *
 * @param {object} opt
 *   frame 窗框色, stone 窗套色, t 窗套宽, recess 玻璃退进, surround 窗套外凸,
 *   muntin 窗棂花样, lintel 窗楣形式, glowI 夜间发光强度,
 *   shutters 木百叶, flowerBox 花箱
 */
export function window2(w, h, opt = {}) {
  const g = new THREE.Group();
  const fr = opt.frame || PALETTE.timberDark;
  const st = opt.stone || opt.sill || PALETTE.stoneLight;
  const t = opt.t || Math.max(0.05, Math.min(w, h) * 0.17);
  const surround = opt.surround === undefined ? 0.075 : opt.surround;
  const rec = opt.recess === undefined ? 0.10 : opt.recess;
  const pattern = opt.muntin || 'cross';
  const lintel = opt.lintel || 'flat';
  const glowI = opt.glowI === undefined ? 0 : opt.glowI;
  const hw = w / 2, hh = h / 2;
  const zOut = surround;          // 窗套外表面
  const zIn = -rec;               // 玻璃所在平面
  const zc = (zOut + zIn) / 2;
  const depth = zOut - zIn;

  /* ① 洞口暗部 */
  g.add(part(new THREE.BoxGeometry(w + t * 2.2, h + t * 2.2, 0.02), opt.revealColor || 0x463a30, {
    z: zIn - 0.016, outline: false, shadow: false,
  }));

  /* ② 窗套 / 洞口侧壁：四片一起把洞口框出厚度 */
  for (const s of [-1, 1]) {
    g.add(part(new THREE.BoxGeometry(t, h + t * 2.2, depth), st, {
      x: s * (hw + t / 2), z: zc, outline: false,
    }));
    g.add(part(new THREE.BoxGeometry(w + t * 2.2, t, depth), st, {
      y: s * (hh + t / 2), z: zc, outline: false,
    }));
  }
  /* 窗套外沿线脚：比侧壁再挑出一点，投出一条投影线 */
  for (const s of [-1, 1]) {
    g.add(part(new THREE.BoxGeometry(w + t * 3.4, t * 0.46, 0.05), opt.trimColor || st, {
      y: s * (hh + t * 1.42), z: zOut + 0.018, outline: false, shadow: false,
    }));
    g.add(part(new THREE.BoxGeometry(t * 0.46, h + t * 3.4, 0.05), opt.trimColor || st, {
      x: s * (hw + t * 1.42), z: zOut + 0.018, outline: false, shadow: false,
    }));
  }

  /* ③ 玻璃（退进 recess —— 凹陷感最直接的来源） */
  g.add(part(new THREE.BoxGeometry(w, h, 0.028), opt.glass || 0xd4e6f2, {
    z: zIn,
    emissive: glowI > 0 ? (opt.glow || 0xffa93a) : undefined,
    emissiveIntensity: glowI, outline: false, shadow: false,
  }));

  /* ④ 内框：四根细木条贴住玻璃四边 */
  const ib = Math.max(0.028, t * 0.4);
  for (const s of [-1, 1]) {
    g.add(part(new THREE.BoxGeometry(ib, h, 0.045), fr, {
      x: s * (hw - ib / 2), z: zIn + 0.03, outline: false, shadow: false,
    }));
    g.add(part(new THREE.BoxGeometry(w, ib, 0.045), fr, {
      y: s * (hh - ib / 2), z: zIn + 0.03, outline: false, shadow: false,
    }));
  }

  /* ⑤ 窗棂花样 */
  const mw = Math.max(0.02, t * 0.28);
  const mz = zIn + 0.045;
  if (pattern === 'grid') {
    for (const s of [-1, 1]) {
      g.add(part(new THREE.BoxGeometry(mw, h, 0.04), fr, { x: s * w / 6, z: mz, outline: false, shadow: false }));
      g.add(part(new THREE.BoxGeometry(w, mw, 0.04), fr, { y: s * h / 6, z: mz, outline: false, shadow: false }));
    }
  } else if (pattern === 'lattice') {
    const dl = Math.hypot(w, h) * 0.66;
    g.add(part(new THREE.BoxGeometry(mw, dl, 0.04), fr, {
      z: mz, rz: Math.atan2(w, h), outline: false, shadow: false,
    }));
    g.add(part(new THREE.BoxGeometry(mw, dl, 0.04), fr, {
      z: mz, rz: -Math.atan2(w, h), outline: false, shadow: false,
    }));
    g.add(part(new THREE.BoxGeometry(mw, h, 0.04), fr, { z: mz, outline: false, shadow: false }));
  } else {
    g.add(part(new THREE.BoxGeometry(mw, h, 0.04), fr, { z: mz, outline: false, shadow: false }));
    g.add(part(new THREE.BoxGeometry(w, mw, 0.04), fr, { z: mz, outline: false, shadow: false }));
  }

  /* ⑥ 窗台：上板挑出 + 下板内收，形成滴水线（雨水不会顺着墙流） */
  if (opt.noSill !== true) {
    g.add(part(chamferGeo(w + t * 3.2, 0.05, t * 2.1, { bevel: 0.016 }), st, {
      y: -hh - t * 0.98, z: zOut + 0.03, outline: false,
    }));
    g.add(part(new THREE.BoxGeometry(w + t * 2.4, 0.028, t * 1.2), opt.sillUnder || st, {
      y: -hh - t * 1.42, z: zOut - 0.02, outline: false, shadow: false,
    }));
  }

  /* ⑦ 窗楣 */
  if (lintel === 'arch') {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * (i + 0.5)) / n;
      g.add(part(chamferGeo(t * 0.7, t * 1.1, 0.09, { bevel: 0.012 }),
        i === (n >> 1) ? (opt.keyColor || st) : st, {
          x: Math.cos(a) * (hw + t * 0.55),
          y: hh + t * 0.5 + Math.sin(a) * t * 0.6,
          z: zOut + 0.02, rz: a - Math.PI / 2, outline: false,
        }));
    }
  } else if (lintel === 'pediment') {
    g.add(part(chamferGeo(w + t * 3.6, t * 0.4, 0.1, { bevel: 0.014 }), st, {
      y: hh + t * 1.5, z: zOut + 0.03, outline: false,
    }));
    for (const s of [-1, 1]) {
      const m = beam([s * (hw + t * 1.6), hh + t * 1.68, zOut + 0.03],
        [0, hh + t * 3.1, zOut + 0.03], 0.082, st, {});
      if (m) g.add(m);
    }
  } else {
    g.add(part(chamferGeo(w + t * 3.4, t * 0.48, 0.1, { bevel: 0.014 }), st, {
      y: hh + t * 1.5, z: zOut + 0.03, outline: false,
    }));
  }

  /* ⑧ 木百叶窗板 */
  if (opt.shutters) {
    for (const s of [-1, 1]) {
      const bx = s * (hw + t + w * 0.26);
      g.add(part(chamferGeo(w * 0.5, h + t * 2, 0.05, { bevel: 0.014 }), opt.shutterColor || PALETTE.timber, {
        x: bx, z: zOut - 0.012, outline: false,
      }));
      for (let i = 0; i < 3; i++) {
        g.add(part(new THREE.BoxGeometry(w * 0.4, 0.02, 0.012), PALETTE.timberDark, {
          x: bx, y: -h * 0.26 + i * h * 0.26, z: zOut + 0.017, outline: false, shadow: false,
        }));
      }
    }
  }

  /* ⑨ 窗台花箱 */
  if (opt.flowerBox) {
    const fb = new THREE.Group();
    fb.add(part(chamferGeo(w * 1.1, 0.13, t * 1.5, { bevel: 0.02, corner: 0.02 }), PALETTE.timber, {
      y: 0.065, outline: false,
    }));
    for (let i = 0; i < 3; i++) {
      fb.add(part(new THREE.SphereGeometry(0.052, 6, 4), [PALETTE.leaf, 0xd9699f, PALETTE.leafDark][i], {
        x: (i - 1) * w * 0.3, y: 0.16, z: 0.01, outline: false, shadow: false, grad: GRAD_SOFT,
      }));
    }
    fb.position.set(0, -hh - t * 1.55, zOut + 0.02);
    g.add(fb);
  }

  return g;
}

/* ------------------------------------------------------------------
   门
   ------------------------------------------------------------------ */
/**
 * 拱券大门：两侧门柱 + 拱圈 + 门板 + 门钉 + 顶石
 */
export function archDoor(w, h, opt = {}) {
  const g = new THREE.Group();
  const fr = opt.frame || PALETTE.stoneLight;
  const t = opt.t || 0.11;
  const r = w / 2;
  const straight = Math.max(0.06, h - r);

  // 门内空腔（深色）
  g.add(part(new THREE.BoxGeometry(w * 0.98, straight, 0.08), 0x2c2430, {
    y: straight / 2, z: -0.08, outline: false, shadow: false,
  }));
  const semi = new THREE.Mesh(new THREE.CircleGeometry(r * 0.97, 12, 0, Math.PI),
    toonMat(0x2c2430, { grad: GRAD_SOFT }));
  semi.position.set(0, straight, -0.081);
  semi.userData.noOutline = true;
  g.add(semi);

  // 门板（略小，带门钉）
  const dw = w * 0.86, dh = straight * 0.98;
  const doorC = opt.doorColor || PALETTE.timber;
  g.add(part(new THREE.BoxGeometry(dw, dh, 0.07), doorC, { y: dh / 2, outline: false }));
  for (const sx of [-1, 1]) {
    g.add(part(new THREE.BoxGeometry(0.05, dh * 0.95, 0.045), PALETTE.timberDark, {
      x: sx * dw * 0.42, y: dh / 2, z: 0.04, outline: false,
    }));
  }
  for (const row of [0.3, 0.68]) {
    for (let i = 0; i < 3; i++) {
      g.add(part(new THREE.SphereGeometry(0.028, 6, 4), PALETTE.ironDark, {
        x: (i - 1) * dw * 0.26, y: dh * row, z: 0.045, outline: false, shadow: false,
      }));
    }
  }
  // 门环
  g.add(part(new THREE.TorusGeometry(0.05, 0.016, 4, 10), PALETTE.brass, {
    x: dw * 0.22, y: dh * 0.48, z: 0.06, outline: false,
  }));

  // 门柱
  for (const s of [-1, 1]) {
    g.add(part(chamferGeo(t, h * 0.96, t * 1.3, { bevel: 0.025 }), fr, {
      x: s * (r + t / 2), y: h * 0.48, outline: false,
    }));
  }
  // 拱圈（半圆环）
  g.add(part(new THREE.TorusGeometry(r + t / 2, t * 0.5, 5, 14, Math.PI), fr, {
    y: straight, outline: false,
  }));
  // 顶石
  g.add(part(chamferGeo(t * 1.5, t * 1.3, t * 1.4, { bevel: 0.02, corner: 0.03 }),
    opt.keyColor || PALETTE.stoneLight, { y: straight + r + t * 0.35, outline: false }));
  return g;
}

/* ------------------------------------------------------------------
   烟囱 & 烟
   ------------------------------------------------------------------ */
export function chimney(x, y, z, h, opt = {}) {
  const g = new THREE.Group();
  g.add(part(chamferGeo(0.32, h, 0.32, { bevel: 0.04, corner: 0.05 }), opt.color || PALETTE.stoneMid, {
    x, y: y + h / 2, z,
  }));
  g.add(part(chamferGeo(0.42, 0.12, 0.42, { bevel: 0.03 }), PALETTE.stoneDark, {
    x, y: y + h + 0.06, z, outline: false,
  }));
  g.add(part(new THREE.BoxGeometry(0.17, 0.05, 0.17), 0x2a222e, {
    x, y: y + h + 0.13, z, outline: false, shadow: false,
  }));
  return g;
}

/** 烟囱冒的烟（返回可动画的 Group） */
export function smoke(x, y, z) {
  const g = new THREE.Group();
  const mat = toonMat(0xeef2f6, { grad: GRAD_SOFT, transparent: true, opacity: 0.7 });
  for (let i = 0; i < 3; i++) {
    const s = 0.1 + i * 0.055;
    const m = new THREE.Mesh(new THREE.SphereGeometry(s, 7, 5), mat.clone());
    m.material.opacity = 0.72 - i * 0.18;
    m.position.set(x, y + i * 0.26, z);
    m.userData.noOutline = true;
    m.userData.smoke = i;
    g.add(m);
  }
  return g;
}

/* ------------------------------------------------------------------
   瓦顶（封装 shapes.tileRoof，补上屋脊 + 顶端饰 + **檐下构造**）
   ------------------------------------------------------------------
   v1 的屋顶是「直接扣在墙上的一顶帽子」：檐口下方什么都没有，
   于是"屋顶"和"墙"之间没有交代 —— 这是建筑看起来像玩具的主因之一。
   v2 按等级往上加三层构造（由 LV_STYLE 点亮）：
     托块 corbels   —— 从墙里长出来、把屋顶托住的一排小石头
     椽头 rafters   —— 檐下探出来的一排木椽头
     瓦当 eaveTiles —— 檐口一排半圆瓦头 + 下垂滴水
   再补屋脊苔痕（做旧）。

   坐标：tileRoof 的檐口在 y = 0，所以托块/椽头用负 y 挂在它下面。
   檐口是一个正方形（圆锥底面 4 段旋转 45°），半边长 E = R/√2。
   ------------------------------------------------------------------ */
export function roof(w, d, h, opt = {}) {
  const spread = opt.spread === undefined ? 1.09 : opt.spread;
  const g = tileRoof(w, d, h, opt.color || PALETTE.shingle, {
    layers: opt.layers || 6,
    spread,
    trim: opt.trim || PALETTE.shingleC,
    ridgeColor: opt.ridgeColor, under: opt.under, ridge: opt.ridge,
  });
  // 斜脊已由 tileRoof 生成（贴合坡面的瓦脊，不再另挂细梁）
  // 顶端饰
  if (opt.finial) {
    g.add(part(new THREE.CylinderGeometry(0.055, 0.075, 0.1, 6), PALETTE.brass, { y: h + 0.05, outline: false }));
    g.add(ball(0.12, opt.finialColor || PALETTE.gold, { y: h + 0.24 }));
    g.add(part(new THREE.ConeGeometry(0.065, 0.28, 5), opt.finialColor || PALETTE.gold, { y: h + 0.46, grad: GRAD_MAIN }));
  }

  /* ---------------- 檐下构造 ---------------- */
  const R = 0.5 * Math.hypot(w, d) * spread;
  const E = R * 0.7071;                       // 檐口正方形半边长
  const stone = opt.stone || PALETTE.stoneLight;

  if (opt.corbels && opt.wallW && opt.wallD) {
    g.add(corbelRow(opt.wallW, opt.wallD, opt.corbelY === undefined ? -0.24 : opt.corbelY,
      stone, { step: opt.corbelStep || 0.34, size: 0.13, h: 0.12 }));
  }
  if (opt.rafters) {
    // 椽头挂在檐口一圈、朝内伸（真实椽条就是这个方向）。
    // 伸出长度取"檐口到墙"的那份悬挑：短了看不见，长了会穿墙。
    const over = Math.max(0.14, E - Math.max(opt.wallW || E, opt.wallD || E) / 2 + 0.14);
    g.add(rafterRow(E * 2, E * 2, opt.rafterY === undefined ? -0.075 : opt.rafterY,
      opt.rafterColor || PALETTE.timberDark,
      { out: -over, step: opt.rafterStep || 0.22, thick: 0.05, h: 0.065, drop: 0 }));
  }
  if (opt.eaveTiles) {
    g.add(eaveTiles(E * 2, E * 2, opt.eaveY === undefined ? -0.05 : opt.eaveY,
      opt.trim || PALETTE.shingleC, {
        colorHead: opt.eaveHead || opt.trim || PALETTE.shingleC,
        colorDrip: opt.eaveDrip || opt.trim || PALETTE.shingleC,
        step: opt.eaveStep || 0.185, r: 0.052, out: 0.012, drop: 0.05,
      }));
  }
  /* 屋脊苔痕：三渲二最吃"脏"，几块暗绿就能把"新盖的"变成"立了很久的" */
  if (opt.moss) {
    const rnd = mulberry32(0x5a17 + (opt.mossSeed || 0) * 7919);
    const k = 0.705 * R;
    const mossC = opt.mossColor || 0x5f7c40;
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      for (let j = 0; j < 2; j++) {
        const t = 0.1 + j * 0.2 + rnd() * 0.07;
        g.add(part(new THREE.SphereGeometry(0.075 + rnd() * 0.05, 6, 4), mossC, {
          x: Math.cos(a) * k * (1 - t) * 1.03,
          y: h * t + 0.04,
          z: Math.sin(a) * k * (1 - t) * 1.03,
          sy: 0.5, grad: GRAD_SOFT, outline: false, shadow: false,
        }));
      }
    }
  }
  return g;
}

/* ------------------------------------------------------------------
   木箱 / 木桶 / 麻袋 / 金币堆
   ------------------------------------------------------------------ */
export function crate(w, h, d, color = PALETTE.timber) {
  const g = new THREE.Group();
  g.add(part(chamferGeo(w, h, d, { bevel: 0.035, corner: 0.03 }), color, { y: h / 2 }));
  // 竖向木板缝
  const n = Math.max(2, Math.round(w / 0.16));
  for (let i = 1; i < n; i++) {
    g.add(part(new THREE.BoxGeometry(0.018, h * 0.97, d * 1.01), PALETTE.timberDark, {
      x: -w / 2 + (w * i) / n, y: h / 2, outline: false,
    }));
  }
  // 上下铁箍 + 铆钉
  for (const yy of [h * 0.2, h * 0.8]) {
    g.add(part(new THREE.BoxGeometry(w * 1.02, h * 0.09, d * 1.02), PALETTE.ironDark, {
      y: yy, outline: false,
    }));
  }
  g.add(part(new THREE.BoxGeometry(0.09, h * 0.22, 0.05), PALETTE.brass, {
    x: w * 0.3, y: h * 0.5, z: d / 2 + 0.01, outline: false,
  }));
  return g;
}

export function barrel(r, h, color = PALETTE.timber) {
  const g = new THREE.Group();
  g.add(part(new THREE.CylinderGeometry(r * 0.9, r * 0.9, h, 12), color, { y: h / 2 }));
  g.add(part(new THREE.CylinderGeometry(r, r, h * 0.62, 12), color, { y: h / 2 }));
  for (const yy of [h * 0.22, h * 0.78]) {
    g.add(part(new THREE.CylinderGeometry(r * 1.03, r * 1.03, 0.06, 12), PALETTE.ironDark, {
      y: yy, outline: false, grad: GRAD_SOFT,
    }));
  }
  g.add(part(new THREE.CylinderGeometry(r * 0.88, r * 0.88, 0.04, 12), PALETTE.timberDark, {
    y: h + 0.01, outline: false,
  }));
  return g;
}

export function goldPile(n, r, seed = 0) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = i * 2.2 + seed;
    const rr = r * (0.35 + (i % 3) * 0.3);
    g.add(part(new THREE.SphereGeometry(r * 0.34 + (i % 2) * 0.03, 7, 5), PALETTE.gold, {
      x: Math.cos(a) * rr, y: 0.14 + (i % 2) * 0.11, z: Math.sin(a) * rr,
      grad: GRAD_MAIN, outline: false,
    }));
  }
  return g;
}

/* ------------------------------------------------------------------
   旗帜 / 条幅
   ------------------------------------------------------------------ */
/** 三角军旗（会飘） */
export function flag(x, y, z, color, scale = 1) {
  const g = new THREE.Group();
  g.add(part(new THREE.CylinderGeometry(0.03, 0.04, 1.0 * scale, 6), PALETTE.timberDark, {
    y: 0.5 * scale, outline: false,
  }));
  g.add(ball(0.055, PALETTE.brass, { y: 1.02 * scale, outline: false }));
  const cloth = part(new THREE.ConeGeometry(0.19 * scale, 0.5 * scale, 3), color, { grad: GRAD_MAIN });
  cloth.rotation.set(0, 0, -Math.PI / 2);
  cloth.position.set(0.25 * scale, 0.8 * scale, 0);
  g.add(cloth);
  g.position.set(x, y, z);
  g.userData.anims = [{ obj: cloth, type: 'flag', amp: 0.35, speed: 2.6 }];
  return g;
}

/** 竖挂条幅（带燕尾下摆） */
export function banner(w, h, color, opt = {}) {
  const g = new THREE.Group();
  g.add(part(new THREE.CylinderGeometry(0.035, 0.035, w * 1.25, 6), PALETTE.timberDark, {
    rz: Math.PI / 2, outline: false,
  }));
  // 布
  g.add(part(chamferGeo(w, h * 0.9, 0.035, { bevel: 0.015 }), color, {
    y: -h * 0.47, outline: false,
  }));
  // 燕尾
  for (const s of [-1, 1]) {
    g.add(part(new THREE.ConeGeometry(w * 0.16, w * 0.4, 3), color, {
      x: s * w * 0.33, y: -h * 0.93, rx: Math.PI, outline: false,
    }));
  }
  // 纹章
  g.add(part(new THREE.CylinderGeometry(w * 0.2, w * 0.2, 0.05, 8), opt.emblem || PALETTE.gold, {
    y: -h * 0.42, z: 0.035, rx: Math.PI / 2, outline: false,
  }));
  g.position.y = 0;
  return g;
}

/* ------------------------------------------------------------------
   武器架 / 盾牌 / 训练桩
   ------------------------------------------------------------------ */
export function shield(r, color, opt = {}) {
  const g = new THREE.Group();
  g.add(part(new THREE.CylinderGeometry(r, r, 0.07, 8), color, { rx: Math.PI / 2, outline: false }));
  g.add(part(new THREE.TorusGeometry(r * 0.96, 0.045, 4, 12), opt.rim || PALETTE.ironDark, {
    outline: false,
  }));
  g.add(part(new THREE.SphereGeometry(r * 0.34, 8, 6), opt.boss || PALETTE.brass, {
    z: 0.05, outline: false,
  }));
  return g;
}

export function sword(len, color = PALETTE.iron) {
  const g = new THREE.Group();
  g.add(part(new THREE.BoxGeometry(0.075, len, 0.022), color, { y: len / 2, outline: false, grad: GRAD_MAIN }));
  g.add(part(new THREE.BoxGeometry(0.2, 0.035, 0.045), PALETTE.brassDark, { y: 0.02, outline: false }));
  g.add(part(new THREE.CylinderGeometry(0.028, 0.028, 0.16, 6), PALETTE.timberDark, { y: -0.08, outline: false }));
  g.add(ball(0.045, PALETTE.brass, { y: -0.17, outline: false }));
  return g;
}

export function axe(headR = 0.14) {
  const g = new THREE.Group();
  g.add(part(new THREE.CylinderGeometry(0.026, 0.03, 0.62, 6), PALETTE.timber, { y: 0.31, outline: false }));
  g.add(part(chamferGeo(headR * 1.9, headR * 1.5, 0.035, { bevel: 0.015, corner: 0.02 }), PALETTE.iron, {
    y: 0.5, x: headR * 0.55, outline: false,
  }));
  return g;
}

/** 武器架（三叉立架 + 挂武器） */
export function weaponRack(opt = {}) {
  const g = new THREE.Group();
  const w = opt.w || 0.9;
  for (const s of [-1, 1]) {
    g.add(part(new THREE.CylinderGeometry(0.035, 0.04, 0.72, 6), PALETTE.timberDark, {
      x: s * w * 0.5, y: 0.36, outline: false,
    }));
  }
  g.add(beam([-w * 0.5, 0.66, 0], [w * 0.5, 0.66, 0], 0.055, PALETTE.timber, {}));
  const r2 = beam([-w * 0.5, 0.3, 0], [w * 0.5, 0.3, 0], 0.045, PALETTE.timber, {});
  if (r2) g.add(r2);
  const sw = sword(0.42); sw.position.set(-w * 0.2, 0.4, 0.02); g.add(sw);
  const ax = axe(0.12); ax.position.set(w * 0.2, 0.3, 0.02); ax.rotation.z = 0.16; g.add(ax);
  return g;
}

/** 训练桩（被打的木人） */
export function trainingDummy() {
  const g = new THREE.Group();
  g.add(part(new THREE.CylinderGeometry(0.09, 0.11, 0.3, 8), PALETTE.timberDark, { y: 0.15 }));
  g.add(part(new THREE.CylinderGeometry(0.05, 0.06, 0.62, 6), PALETTE.timber, { y: 0.55, outline: false }));
  g.add(part(chamferGeo(0.4, 0.46, 0.16, { bevel: 0.03, corner: 0.03 }), PALETTE.thatch, { y: 0.68 }));
  g.add(ball(0.15, PALETTE.thatchDark, { y: 1.0 }));
  g.add(part(new THREE.BoxGeometry(0.5, 0.07, 0.07), PALETTE.timberDark, { y: 0.8, outline: false }));
  return g;
}

/* ------------------------------------------------------------------
   招牌 / 指示牌
   ------------------------------------------------------------------ */
export function signboard(text, w = 0.5, h = 0.34, opt = {}) {
  const g = new THREE.Group();
  g.add(part(new THREE.CylinderGeometry(0.03, 0.035, 0.6, 6), PALETTE.timberDark, { y: 0.3, outline: false }));
  g.add(part(chamferGeo(w, h, 0.06, { bevel: 0.02, corner: 0.03 }), opt.color || PALETTE.timberLight, {
    y: 0.62, outline: false,
  }));
  g.add(part(chamferGeo(w * 0.82, h * 0.55, 0.02, { bevel: 0.01 }), opt.face || PALETTE.plasterCream, {
    y: 0.62, z: 0.04, outline: false,
  }));
  return g;
}

/* ------------------------------------------------------------------
   火盆 / 火炬
   ------------------------------------------------------------------ */
export function brazier(r = 0.2, opt = {}) {
  const g = new THREE.Group();
  g.name = 'brazier';
  g.add(part(new THREE.CylinderGeometry(r * 0.4, r * 0.5, 0.34, 6), PALETTE.ironDark, { y: 0.17, outline: false }));
  g.add(part(new THREE.CylinderGeometry(r, r * 0.72, 0.2, 10), PALETTE.iron, { y: 0.4 }));
  g.add(part(new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.05, 10), 0xff8a3a, {
    y: 0.5, emissive: 0xff6a14, emissiveIntensity: 0.9, grad: GRAD_MAIN, outline: false, shadow: false,
  }));
  const fl = part(new THREE.ConeGeometry(r * 0.75, 0.5, 7), 0xffa62b, {
    y: 0.72, emissive: 0xff7a1a, emissiveIntensity: 1.0, grad: GRAD_MAIN, outline: false, shadow: false,
  });
  fl.name = 'flameOuter';
  g.add(fl);
  const fi = part(new THREE.ConeGeometry(r * 0.4, 0.3, 6), 0xffe37a, {
    y: 0.66, emissive: 0xffe37a, emissiveIntensity: 1.0, grad: GRAD_MAIN, outline: false, shadow: false,
  });
  fi.name = 'flameInner';
  g.add(fi);
  g.userData.flames = [fl, fi];
  /* 动画声明在零件上，maker 用 add() 挂上去时自动登记 */
  g.userData.anims = [
    { obj: fl, type: 'flicker', amp: 0.24, speed: 9 },
    { obj: fi, type: 'flicker', amp: 0.3, speed: 12 },
  ];
  return g;
}

/* ------------------------------------------------------------------
   石堆 / 碎石
   ------------------------------------------------------------------ */
export function rubble(r, n, color = PALETTE.stoneMid, seed = 1) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = i * 2.399 + seed * 3.7;
    const rr = r * (0.25 + ((i * 37) % 100) / 140);
    const s = r * (0.24 + ((i * 53) % 100) / 260);
    const m = part(new THREE.DodecahedronGeometry(s, 0), color, {
      x: Math.cos(a) * rr, y: s * 0.5, z: Math.sin(a) * rr,
      rx: a, ry: a * 1.7, grad: GRAD_SOFT,
    });
    g.add(m);
  }
  return g;
}
