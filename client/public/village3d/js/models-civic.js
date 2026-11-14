/* ============================================================
   models-civic.js — 民用建筑（市政厅 / 资源 / 军事设施 / 工人小屋）
   ------------------------------------------------------------
   建模思路：先立「结构」（台基→墙身→楼层→屋顶），再挂「构件」
   （门、窗、烟囱、檐口、梁柱），最后撒「生活痕迹」（箱子、工具、
   木桶、旗帜）。三渲二的可读性来自这个层次，而不是面数。

   v2（本轮）三件事
   ------------------------------------------------------------
   ① 统一构造语言。
      所有建筑的墙 / 窗 / 屋顶都必须经过 styledWall / styledWindow /
      styledRoof。等级差异由 level-style.js 的 LV_STYLE 统一发放，
      于是「升一级」在任何建筑上都是同一件事：
        屋面换代 → 砌石层数 +2 → 檐下点亮（瓦当/椽头/托块）
        → 窗型升级（十字→九宫→菱格）→ 压顶 / 溅泥 / 苔痕
      修的是老问题：等级名存实亡 —— archertower 五级三角面一模一样，
      barracks / builderhut 的 lv3~lv5 也完全相同，玩家掏钱看不到变化。

   ② 承重可见。
      老屋顶是「直接扣在墙上的一顶帽子」，檐口下方什么都没有，
      所以看着像玩具。现在等级够了就有椽头、托块、瓦当；
      墙身有砌缝与收分，墙脚有溅泥，台身有压顶收头。

   ③ 确定性变体。
      每个 maker 收一个**已播种**的 R()，所以「同类型相邻两座」不再
      是复制粘贴：杂物摆位、配色、朝向、侧房左右、做旧种子都会不同。
      同一个 (type, level, variant) 永远得到同一个样子（可校验）。

   纪律（否则 draw call 会反弹）：
     · 所有新构件都走 part() 默认的顶点色共享材质；
       同一座静态岛因此仍然只合并出 2~3 个网格，而不是每件一个。
     · 除压顶外的新构件一律 outline:false。
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';
import { part, ball, GRAD_MAIN, GRAD_SOFT, toonMat } from './toon.js';
import { PALETTE } from './config.js';
import {
  chamferGeo, archWallGeo, beam, railing,
  quoins, rivets, lantern, rope,
} from './shapes.js';
import {
  base, archDoor, chimney, smoke, roof,
  crate, barrel, goldPile, flag, weaponRack, trainingDummy,
  signboard, brazier, rubble, shield, sword, axe,
} from './parts.js';
import { LV_STYLE } from './level-style.js';

/* ============================================================
   0. 统一构造语言 —— 已抽到 build-kit.js
   ------------------------------------------------------------
   墙 / 窗 / 屋顶 / 台身 / 台阶 / 石墩 / 瞭望塔，原本是本文件的私有实现，
   而 models-def.js 里另长着一套几乎一模一样的同名函数。
   两套「各写各的」正是「加农炮每级涨 27%、迫击炮只涨 2.6%」这类等级
   失衡的根因：等级风格表只有一份，构造语言却有两份，改一份等于没改。
   现在两边的 maker 都在同一套 build-kit 上说话。

   注意：这里只 import、不转发（re-export）—— 转发会让模块额外泄漏出
   一批「没人用的导出」，反而模糊了谁才是构造语言的真正主人。
   ============================================================ */

import {
  FALLBACK_RND as FALLBACK,
  pickR, jit, add, anim,
  styledWall, styledRoof, styledWindow, podium,
  entryStairs, stonePiers, watchtower,
} from './build-kit.js';

/* ============================================================
   1. 市政厅 —— 村庄核心，五级每级加一层记忆点
   ------------------------------------------------------------
   等级结构：
     lv1 单层 + 大屋顶            lv2 檐下点亮 + 百叶 + 压顶/溅泥
     lv3 起二层 + 阳台            lv4 + 老虎窗 + 侧附房
     lv5 + 门前石狮 + 金脊
   ============================================================ */
export function mTownhall(lv, R = FALLBACK) {
  const st = LV_STYLE(lv);
  const g = new THREE.Group();
  const bw = 2.95, bd = 2.55, h1 = 1.5;

  /* --- 变体：侧附房在左还是右 / 旗色组 / 做旧种子 / 台基色 --- */
  const side = R() < 0.5 ? -1 : 1;
  const seed = (R() * 89) | 0;
  const baseColor = pickR(R, [PALETTE.stoneMid, PALETTE.stoneWarm, PALETTE.stoneCool]);
  const fc = pickR(R, [
    [PALETTE.tileBlue, 0x59c07a, PALETTE.shingleA, PALETTE.gold],
    [PALETTE.tileGreen, PALETTE.gold, PALETTE.shingleA, PALETTE.tileBlue],
    [0x59c07a, PALETTE.shingleA, PALETTE.tileBlue, PALETTE.gold],
  ]);

  /* ---- 台基（分层：lv>=3 起两级）+ 正面台阶 ---- */
  g.add(base(bw + 0.34, bd + 0.34, { h: 0.34, color: baseColor, colorLow: PALETTE.stoneDark }));
  const Y0 = 0.42;

  /* ---- 一层：石砌抹灰墙 ---- */
  const w1 = styledWall(bw, h1, bd, PALETTE.plasterWarm, st, {
    corner: 0.08, quoins: true, quoinSize: 0.32, seed, coping: false,
  });
  w1.position.y = Y0;
  g.add(w1);

  const st1 = entryStairs(Y0, 0.95, PALETTE.stoneLight, { sd: 0.2, side: PALETTE.stoneDark });
  st1.position.z = bd / 2 + 0.32;
  g.add(st1);

  /* ---- 正面：大门 + 两侧拱窗 ---- */
  const front = bd / 2 + 0.03;
  const door = archDoor(0.72, 1.16, {
    frame: PALETTE.stoneLight, doorColor: PALETTE.timberDark, keyColor: PALETTE.stoneLight,
  });
  door.position.set(0, Y0, front);
  g.add(door);
  for (const s of [-1, 1]) {
    const wd = styledWindow(0.4, 0.48, st, { shutters: lv >= 2, shutterColor: PALETTE.timber });
    wd.position.set(s * 1.02, Y0 + 0.74, front);
    g.add(wd);
  }
  /* ---- 侧面窗 ---- */
  for (const s of [-1, 1]) {
    const wd = styledWindow(0.38, 0.44, st, {});
    wd.position.set(s * (bw / 2 + 0.03), Y0 + 0.72, 0.42);
    wd.rotation.y = s * Math.PI / 2;
    g.add(wd);
    const wd2 = styledWindow(0.38, 0.44, st, {});
    wd2.position.set(s * (bw / 2 + 0.03), Y0 + 0.72, -0.5);
    wd2.rotation.y = s * Math.PI / 2;
    g.add(wd2);
  }
  // 门口壁灯
  for (const s of [-1, 1]) {
    g.add(lantern(s * 0.62, Y0 + 1.42, front + 0.04, { color: 0xffd98a }));
  }

  /* ---- 二层（3 级起）+ 阳台 ---- */
  let topY = Y0 + h1;
  if (lv >= 3) {
    const h2 = 1.06;
    const b2w = bw * 0.72, b2d = bd * 0.76;
    g.add(part(chamferGeo(bw * 0.96, 0.12, bd * 0.9, { bevel: 0.035, corner: 0.09 }), PALETTE.stoneLight, {
      y: topY + 0.06,
    }));
    g.add(railing([-bw * 0.44, topY + 0.12, bd * 0.44], [bw * 0.44, topY + 0.12, bd * 0.44], 0.3,
      PALETTE.timber, { n: 10, mid: true }));
    for (const s of [-1, 1]) {
      g.add(railing([s * bw * 0.44, topY + 0.12, -bd * 0.4], [s * bw * 0.44, topY + 0.12, bd * 0.44], 0.3,
        PALETTE.timber, { n: 6, mid: true }));
    }
    const w2 = styledWall(b2w, h2, b2d, PALETTE.plasterCream, st, { corner: 0.06, coping: false, seed: seed + 1 });
    w2.position.y = topY + 0.12;
    g.add(w2);
    const wd = styledWindow(0.5, 0.5, st, { glowI: 0.4 });
    wd.position.set(0, topY + 0.68, b2d / 2 + 0.03);
    g.add(wd);
    for (const s of [-1, 1]) {
      const ws = styledWindow(0.34, 0.4, st, {});
      ws.position.set(s * (b2w / 2 + 0.03), topY + 0.58, 0.3);
      ws.rotation.y = s * Math.PI / 2;
      g.add(ws);
    }
    topY += 0.12 + h2;
    g.add(part(chamferGeo(b2w + 0.16, 0.09, b2d + 0.16, { bevel: 0.028 }), PALETTE.stoneLight, {
      y: topY + 0.03,
    }));
  } else {
    topY += 0.06;
  }

  /* ---- 大屋顶 ---- */
  const RF_W = bw + 0.2, RF_D = bd + 0.2;
  const RF_H = 1.46 + lv * 0.06;
  const rf = styledRoof(RF_W, RF_D, RF_H, st, {
    wallW: lv >= 3 ? bw * 0.72 : bw,
    wallD: lv >= 3 ? bd * 0.76 : bd,
    corbelStep: 0.36, rafterStep: 0.24, eaveStep: 0.2,
    finial: true, mossSeed: seed,
  });
  rf.position.y = topY;
  g.add(rf);
  const RF_R = 0.5 * Math.hypot(RF_W, RF_D) * 1.09 * 0.707;
  const roofYAt = (x, z) => Math.max(0, RF_H * (1 - Math.max(Math.abs(x), Math.abs(z)) / RF_R));

  /* ---- 老虎窗（4 级起，前坡两扇，按坡面高度吸附） ---- */
  if (lv >= 4) {
    for (const s of [-1, 1]) {
      const dx = s * 0.6;
      const dz = 0.86;
      const dy = topY + roofYAt(dx, dz) * 0.5;
      g.add(part(chamferGeo(0.44, 0.4, 0.42, { bevel: 0.035, corner: 0.05 }), PALETTE.plasterCream, {
        x: dx, y: dy - 0.06, z: dz, outline: false,
      }));
      g.add(part(chamferGeo(0.56, 0.08, 0.54, { bevel: 0.025 }), PALETTE.shingleC, {
        x: dx, y: dy + 0.16, z: dz, outline: false,
      }));
      const gl = styledWindow(0.2, 0.22, st, { glowI: 0.45, shutters: false });
      gl.position.set(dx, dy + 0.0, dz + 0.2);
      g.add(gl);
    }
  }

  /* ---- 侧附房（4 级起）：石砌小耳房，凭空长出一截新体量 ---- */
  let annexTop = 0;
  if (lv >= 4) {
    const aw = 1.0, ad = 1.6, ah = 1.02;
    const ax = side * (bw / 2 + aw / 2 - 0.05);
    const ap = podium(aw + 0.2, ad + 0.2, 0.26, baseColor, st, { corner: 0.04, seed: seed + 5 });
    ap.g.position.set(ax, 0.02, -0.1);
    g.add(ap.g);
    const awall = styledWall(aw, ah, ad, PALETTE.plasterCream, st, { corner: 0.05, seed: seed + 6, coping: false });
    awall.position.set(ax, 0.02 + ap.top, -0.1);
    g.add(awall);
    const an = styledRoof(aw + 0.24, ad + 0.24, 0.56, st, {
      wallW: aw, wallD: ad, layers: 5, corbelStep: 0.3, rafterStep: 0.22, eaveStep: 0.18,
    });
    an.position.set(ax, 0.02 + ap.top + ah, -0.1);
    g.add(an);
    // 耳房小门 + 窗
    const adr = archDoor(0.36, 0.6, { frame: PALETTE.stoneLight, doorColor: PALETTE.timberDark, t: 0.07 });
    adr.position.set(ax, 0.02 + ap.top, -0.1 + ad / 2 + 0.03);
    g.add(adr);
    const awd = styledWindow(0.26, 0.3, st, { glowI: 0.35, shutters: false });
    awd.position.set(ax + side * (aw / 2 + 0.03), 0.02 + ap.top + 0.6, -0.1);
    awd.rotation.y = side * Math.PI / 2;
    g.add(awd);
    annexTop = 0.02 + ap.top + ah + 0.56;
  }

  /* ---- 烟囱 ×2 + 烟 ---- */
  for (const s of [-1, 1]) {
    const cx = s * 1.02, cz = -0.68;
    const ch = 1.58 + (s > 0 ? lv * 0.05 : 0);
    g.add(chimney(cx, topY - 0.22, cz, ch, { color: PALETTE.stoneMid }));
    if (lv >= 3 && s > 0) {
      add(g, smoke(cx, topY - 0.22 + ch + 0.2, cz, { speed: 0.55 }));
    }
  }

  /* ---- 角旗（插在檐口四角，杆身从屋檐穿出） ---- */
  const nf = Math.min(lv + 1, 4);
  for (let i = 0; i < nf; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const t = 0.7;
    add(g, flag(Math.cos(a) * RF_R * t, topY + RF_H * t, Math.sin(a) * RF_R * t, fc[i % fc.length], 0.98));
  }

  /* ---- 5 级：门前石狮柱 + 金脊顶饰 ---- */
  if (lv >= 5) {
    for (const s of [-1, 1]) {
      g.add(part(chamferGeo(0.22, 0.42, 0.22, { bevel: 0.03, corner: 0.03 }), PALETTE.stoneLight, {
        x: s * 1.28, y: 0.2, z: bd / 2 + 0.36,
      }));
      g.add(part(chamferGeo(0.26, 0.05, 0.26, { bevel: 0.015 }), PALETTE.stoneLight, {
        x: s * 1.28, y: 0.44, z: bd / 2 + 0.36, outline: false,
      }));
      g.add(ball(0.13, PALETTE.brass, { x: s * 1.28, y: 0.54, z: bd / 2 + 0.36 }));
    }
    // 檐下挂灯（会晃）
    for (const s of [-1, 1]) {
      const bar = new THREE.Group();
      bar.add(part(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 5), PALETTE.ironDark, {
        y: -0.17, outline: false,
      }));
      bar.add(lantern(0, -0.4, 0, { color: 0xffe6a8 }));
      bar.position.set(s * 0.8, topY + 0.02, front + 0.06);
      g.add(bar);
      anim(g, bar, 'swing', { amp: 0.09, speed: 1.6 });
    }
  }

  /* ---- 等级装饰：台面石墩（把台基"围"起来） ---- */
  if (lv >= 2) {
    const n = 2 + lv;
    const piers = stonePiers(Math.max(bw, bd) * 0.56, n, 0.22, PALETTE.stoneLight, {
      w: 0.17 + lv * 0.01, phase: Math.PI / 4, capColor: PALETTE.stoneMid,
    });
    piers.position.y = 0.02;
    piers.scale.set(1, 1, 0.92);
    g.add(piers);
  }

  g.userData.annexTop = annexTop;
  return g;
}

/* ============================================================
   2. 金矿 —— 矿洞 + 卷扬架 + 矿车
   ------------------------------------------------------------
   等级结构：lv1 单柱木架 lv2 + 矿灯/第二支撑 lv3 + 石砌挡土墙
             lv4 + 第二辆矿车 lv5 + 洞口石券加高
   ============================================================ */
export function mGoldMine(lv, R = FALLBACK) {
  const st = LV_STYLE(lv);
  const g = new THREE.Group();
  const postH = 1.05 + lv * 0.13;

  /* --- 变体：矿丘形状 / 招牌朝向 / 杂物摆位 / 木料色 --- */
  const seed = (R() * 97) | 0;
  const signYaw = -0.4 + jit(R, 0.5);
  const cartX = 0.58 + jit(R, 0.16);
  const oreSide = R() < 0.5 ? -1 : 1;
  const woodC = pickR(R, [PALETTE.timber, PALETTE.timberLight, PALETTE.timberDark]);

  /* ---- 场地 ---- */
  g.add(base(2.75, 2.65, { h: 0.22, color: PALETTE.stoneWarm, colorLow: PALETTE.stoneDark }));
  const Y0 = 0.26;

  /* ---- 后方矿丘 + 石砌挡土墙 + 拱形矿洞 ---- */
  const hill = rubble(1.05, 7, 0x9c8b74, 3 + seed);
  hill.position.set(0, Y0, -0.62);
  hill.scale.set(1.5, 0.95, 1.1);
  g.add(hill);
  /* 挡土墙：把"挖出来的边坡"托住。等级越高砌得越高、层数越密 */
  const rw = styledWall(2.32, 0.44 + lv * 0.07, 0.26, PALETTE.stoneMid, st, {
    corner: 0.05, seed, stain: lv >= 3, plinthH: 0.1,
  });
  rw.position.set(0, Y0, -0.9);
  g.add(rw);
  // 洞口（石材拱券墙）
  const mouth = part(archWallGeo(1.12, 0.92, 0.34, [
    { x: 0, y: 0, w: 0.62, h: 0.74, arch: true },
  ]), PALETTE.stoneMid, { y: Y0 + 0.46, z: -0.28, grad: GRAD_MAIN });
  g.add(mouth);
  g.add(part(new THREE.BoxGeometry(0.6, 0.7, 0.5), 0x231d29, {
    y: Y0 + 0.35, z: -0.44, outline: false, shadow: false,
  }));
  // 木质洞口支撑框
  for (const s of [-1, 1]) {
    g.add(part(chamferGeo(0.1, 0.9, 0.12, { bevel: 0.022 }), woodC, {
      x: s * 0.4, y: Y0 + 0.45, z: -0.13, outline: false,
    }));
  }
  g.add(part(chamferGeo(1.0, 0.11, 0.13, { bevel: 0.022 }), woodC, {
    y: Y0 + 0.86, z: -0.13, outline: false,
  }));
  // 洞口上方压顶（等级 3 起，压住拱券）
  if (lv >= 3) {
    g.add(part(chamferGeo(1.28, 0.08, 0.36, { bevel: 0.02, corner: 0.04 }), PALETTE.stoneLight, {
      y: Y0 + 0.96, z: -0.28, outline: false,
    }));
  }
  // 矿车轨道（两条 + 枕木）
  for (const s of [-1, 1]) {
    g.add(part(new THREE.BoxGeometry(0.05, 0.04, 1.15), PALETTE.ironDark, {
      x: s * 0.22, y: Y0 + 0.03, z: 0.32, outline: false,
    }));
  }
  for (let i = 0; i < 4; i++) {
    g.add(part(new THREE.BoxGeometry(0.62, 0.035, 0.09), PALETTE.timberDark, {
      y: Y0 + 0.012, z: 0.05 + i * 0.26, outline: false,
    }));
  }

  /* ---- 卷扬机架（A 形桁架） ---- */
  const legs = [[-0.62, -0.42], [0.62, -0.42], [-0.62, 0.46], [0.62, 0.46]];
  for (const [x, z] of legs) {
    g.add(part(chamferGeo(0.11, postH, 0.11, { bevel: 0.024 }), woodC, {
      x, y: Y0 + postH / 2, z, outline: false,
    }));
    const cx = Math.sign(x) * 0.42;
    const bm = beam([x * 0.98, Y0 + 0.1, z], [cx, Y0 + postH * 0.72, z], 0.055, PALETTE.timberDark, {});
    if (bm) g.add(bm);
    // 柱脚石（等级 2 起）
    if (lv >= 2) {
      g.add(part(chamferGeo(0.17, 0.09, 0.17, { bevel: 0.02 }), PALETTE.stoneMid, {
        x, y: Y0 + 0.045, z, outline: false,
      }));
    }
  }
  // 顶部横梁 ×2
  for (const z of [-0.42, 0.46]) {
    g.add(part(chamferGeo(1.36, 0.12, 0.12, { bevel: 0.024 }), PALETTE.timberDark, {
      y: Y0 + postH + 0.05, z, outline: false,
    }));
  }
  const xb1 = beam([-0.6, Y0 + postH * 0.85, -0.42], [0.6, Y0 + postH * 0.85, 0.46], 0.05, woodC, {});
  if (xb1) g.add(xb1);
  const xb2 = beam([0.6, Y0 + postH * 0.85, -0.42], [-0.6, Y0 + postH * 0.85, 0.46], 0.05, woodC, {});
  if (xb2) g.add(xb2);

  // 滑轮（转动）
  const pulley = part(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 12), PALETTE.timberDark, {
    y: Y0 + postH + 0.05, z: 0.02, rx: Math.PI / 2,
  });
  pulley.name = 'pulley';
  g.add(pulley);
  g.add(part(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 8), PALETTE.iron, {
    y: Y0 + postH + 0.05, z: 0.02, rx: Math.PI / 2, outline: false,
  }));
  anim(g, pulley, 'spinX', { speed: 1.1 });
  // 绳 + 吊桶
  const yTop = Y0 + postH - 0.02;
  g.add(rope([0, yTop, 0.02], [0, Y0 + 0.62, 0.02], 0.028, 0xb09a72, 0));
  const bucket = new THREE.Group();
  bucket.name = 'bucket';
  bucket.add(part(new THREE.CylinderGeometry(0.24, 0.2, 0.36, 10), PALETTE.timber, { y: 0 }));
  bucket.add(part(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 10), PALETTE.ironDark, { y: 0.19, outline: false }));
  bucket.add(part(new THREE.CylinderGeometry(0.21, 0.21, 0.05, 10), PALETTE.gold, { y: 0.22, grad: GRAD_MAIN, outline: false }));
  bucket.add(part(new THREE.TorusGeometry(0.13, 0.018, 4, 10), PALETTE.iron, { y: 0.28, outline: false }));
  bucket.position.set(0, Y0 + 0.62 - 0.5, 0.02);
  g.add(bucket);
  anim(g, bucket, 'bob', { amp: 0.34, speed: 0.85, base: Y0 + 0.62 - 0.5 });
  // 卷扬滚筒
  g.add(part(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 10), PALETTE.timberDark, {
    x: 0.62, y: Y0 + 0.34, z: 0.02, rz: Math.PI / 2, outline: false,
  }));

  /* ---- 矿车（4 级起第二辆） ---- */
  const mkCart = (px, pz, yaw) => {
    const cart = new THREE.Group();
    cart.add(part(chamferGeo(0.62, 0.36, 0.42, { bevel: 0.03, corner: 0.04 }), PALETTE.iron, { y: 0.34 }));
    cart.add(part(new THREE.BoxGeometry(0.5, 0.06, 0.34), PALETTE.gold, { y: 0.42, grad: GRAD_MAIN, outline: false }));
    for (const s of [-1, 1]) {
      for (const z of [-0.14, 0.14]) {
        cart.add(part(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 10), PALETTE.ironDark, {
          x: s * 0.26, y: 0.09, z, rz: Math.PI / 2, outline: false,
        }));
      }
    }
    cart.position.set(px, Y0, pz);
    cart.rotation.y = yaw;
    return cart;
  };
  g.add(mkCart(cartX, 0.52, -0.12));
  if (lv >= 4) g.add(mkCart(-cartX - 0.06, 0.28, 0.16 + jit(R, 0.12)));

  /* ---- 矿石堆 + 金块 ---- */
  const ore = rubble(0.5, 5, 0x8f8477, 7 + seed);
  ore.position.set(oreSide * 0.85, Y0, 0.42);
  g.add(ore);
  const gp = goldPile(3 + lv, 0.42, 1.2);
  gp.position.set(oreSide * 0.85, Y0, 0.42);
  g.add(gp);

  /* ---- 工具与生活痕迹 ---- */
  const pk = new THREE.Group();
  pk.add(part(new THREE.CylinderGeometry(0.03, 0.032, 0.66, 6), PALETTE.timber, { y: 0.33, outline: false }));
  pk.add(part(new THREE.BoxGeometry(0.36, 0.08, 0.07), PALETTE.iron, { y: 0.62, outline: false }));
  pk.add(part(new THREE.BoxGeometry(0.1, 0.07, 0.07), PALETTE.iron, { y: 0.62, x: -0.19, outline: false }));
  pk.position.set(-1.0, Y0 + 0.02, -0.2);
  pk.rotation.z = -0.44;
  g.add(pk);

  const sign = signboard('', 0.4, 0.26, { color: PALETTE.timber });
  sign.position.set(1.05, Y0 + 0.02, -0.7);
  sign.rotation.y = signYaw;
  g.add(sign);
  g.add(part(new THREE.BoxGeometry(0.2, 0.14, 0.05), PALETTE.gold, {
    x: 1.05, y: Y0 + 0.64, z: -0.7, outline: false,
  }));

  const bl = barrel(0.17, 0.4, PALETTE.timberDark);
  bl.position.set(1.06, Y0 + 0.02, 0.74);
  g.add(bl);
  const bx = crate(0.34, 0.24, 0.26, PALETTE.timber);
  bx.position.set(-1.06, Y0 + 0.02, -0.86);
  bx.rotation.y = 0.3 + jit(R, 0.3);
  g.add(bx);
  // 等级 2 起：备用镐 + 木料堆
  if (lv >= 2) {
    for (let i = 0; i < 3; i++) {
      g.add(part(new THREE.CylinderGeometry(0.045, 0.05, 0.56, 6), PALETTE.timber, {
        x: 1.16, y: Y0 + 0.06 + Math.floor(i / 2) * 0.1, z: 0.3, rz: Math.PI / 2, ry: 0.24, outline: false,
      }));
    }
  }
  // 矿灯
  g.add(lantern(-0.42, Y0 + 0.92, -0.12, {}));
  return g;
}

/* ============================================================
   3. 圣水收集器 —— 玻璃罐 + 支架管网
   ------------------------------------------------------------
   等级结构：lv1 裸架 lv2 石砌台身压顶 lv3 台面石墩+加箍
             lv4 石栏圈 lv5 铜管加粗+铭牌
   ============================================================ */
/* ============================================================
   矿场 —— 露天采矿场（2026-10-14 新增）
   ------------------------------------------------------------
   与 mGoldMine（学识矿脉）刻意拉开差异，两座并排放要一眼分清：
     · 学识矿脉 = 地下矿洞：拱形洞口 + 挡土墙 + 卷扬桁架、冷色调
     · 矿场     = 露天矿区：中央矿石山 + 卷扬架 + 矿车、成堆铜板、暖金色
   成堆的铜板是这座建筑真正的语义核心 —— 玩家扫一眼就知道「这里产钱」，
   不需要看名字；铜板堆数量随等级增长，升级的收益是"看得见"的。

   高度刻意做到 ~2.0（与学识矿脉的 1.95 相当）。第一版只堆了地面矿渣，
   整体高 0.8，摆进村庄像块地砖 —— 新建筑必须和邻居在一个体量级上。

   等级语言沿用全局那套：台缘压顶(2)、工具架(3)、招牌(5)，
   外加矿石山逐级变高、铜板堆逐级变多、矿车逐级变大。
   ============================================================ */
export function mMine(lv, R = FALLBACK) {
  const g = new THREE.Group();

  /* 变体：矿车朝向 / 木料色 / 矿石山种子 —— 同屏两座矿场不会一模一样 */
  const seed = (R() * 97) | 0;
  const woodC = pickR(R, [PALETTE.timber, PALETTE.timberLight, PALETTE.timberDark]);
  const cartYaw = -0.22 + jit(R, 0.44);
  const postH = 1.12 + lv * 0.1;

  /* ---- 场地 ---- */
  g.add(base(2.75, 2.65, { h: 0.22, color: PALETTE.stoneWarm, colorLow: PALETTE.stoneDark }));
  const Y0 = 0.26;

  /* ---- 中央矿石山：三层递减，等级越高堆得越高 ---- */
  const mound = [
    { r: 0.62, n: 8, c: PALETTE.stoneMid, y: 0.10, sx: 1.55, sy: 0.95, sz: 1.45 },
    { r: 0.45, n: 6, c: 0xa08e76,        y: 0.40, sx: 1.32, sy: 0.88, sz: 1.24 },
    { r: 0.30, n: 5, c: 0xb59a72,        y: 0.68 + lv * 0.03, sx: 1.12, sy: 0.9, sz: 1.02 },
  ];
  for (let i = 0; i < mound.length; i++) {
    const m = mound[i];
    const rk = rubble(m.r, m.n, m.c, seed + i * 11);
    rk.position.set(0, Y0 + m.y, -0.18);
    rk.scale.set(m.sx, m.sy, m.sz);
    g.add(rk);
  }

  /* ---- 木质卷扬架（A 形桁架）：把"这是矿口"说清楚，同时拉起整体高度 ---- */
  const legs = [[-0.6, -0.62], [0.6, -0.62], [-0.6, 0.18], [0.6, 0.18]];
  for (const [x, z] of legs) {
    g.add(part(chamferGeo(0.1, postH, 0.1, { bevel: 0.022 }), woodC, {
      x, y: Y0 + postH / 2, z, outline: false,
    }));
    /* 柱脚石：等级 2 起 */
    if (lv >= 2) {
      g.add(part(chamferGeo(0.16, 0.08, 0.16, { bevel: 0.018 }), PALETTE.stoneMid, {
        x, y: Y0 + 0.04, z, outline: false,
      }));
    }
  }
  /* 顶部横梁 ×2（前后各一，形成"门"） */
  for (const z of [-0.62, 0.18]) {
    g.add(part(chamferGeo(1.34, 0.11, 0.11, { bevel: 0.022 }), PALETTE.timberDark, {
      y: Y0 + postH + 0.05, z, outline: false,
    }));
  }
  /* 斜撑（A 形收口） */
  for (const s of [-1, 1]) {
    const bm = beam([s * 0.6, Y0 + 0.12, -0.62], [s * 0.42, Y0 + postH * 0.84, -0.22], 0.05, PALETTE.timberDark, {});
    if (bm) g.add(bm);
  }
  /* 吊索 + 吊桶（悬挂在矿山上方） */
  g.add(part(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6), PALETTE.ironDark, {
    y: Y0 + postH - 0.16, z: -0.22, outline: false,
  }));
  const bucket = part(new THREE.CylinderGeometry(0.14, 0.11, 0.2, 10), PALETTE.timberDark, {
    y: Y0 + postH - 0.5, z: -0.22, outline: false,
  });
  g.add(bucket);
  /* 桶里的矿石 */
  g.add(part(new THREE.BoxGeometry(0.2, 0.05, 0.2), 0x8a6f4a, {
    y: Y0 + postH - 0.42, z: -0.22, outline: false,
  }));

  /* ---- 矿车（正面）+ 轨道 ---- */
  const cart = new THREE.Group();
  const cw = 0.5 + lv * 0.03;
  cart.add(part(chamferGeo(cw, 0.3, 0.4, { bevel: 0.02 }), woodC, { y: 0.2 }));
  cart.add(part(chamferGeo(cw * 0.86, 0.1, 0.32, { bevel: 0.02 }), PALETTE.ironDark, {
    y: 0.09, outline: false,
  }));
  cart.add(part(new THREE.BoxGeometry(cw * 0.8, 0.07, 0.3), 0x8a6f4a, {
    y: 0.31, outline: false,
  }));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      /* 轮子用圆柱；旋转写成 .rotation —— part() 的 opt 只认 x/y/z/outline，
         塞未知键会被静默忽略，轮子就变成一块竖着的圆饼。 */
      const wheel = part(new THREE.CylinderGeometry(0.072, 0.072, 0.05, 8), PALETTE.ironDark, {
        x: sx * cw * 0.36, y: 0.07, z: sz * 0.18, outline: false,
      });
      wheel.rotation.z = Math.PI / 2;
      cart.add(wheel);
    }
  }
  cart.position.set(0, Y0, 0.86);
  cart.rotation.y = cartYaw;
  g.add(cart);
  for (const s of [-1, 1]) {
    g.add(part(new THREE.BoxGeometry(0.05, 0.035, 1.0), PALETTE.ironDark, {
      x: s * 0.19, y: Y0 + 0.02, z: 0.72, outline: false,
    }));
  }

  /* ---- 铜板堆：这座建筑的语义核心，数量随等级增长 ---- */
  const piles = 1 + lv;
  for (let i = 0; i < piles; i++) {
    const a = -2.35 + i * (4.7 / Math.max(1, piles - 1));
    const px = Math.cos(a) * 1.0;
    const pz = Math.sin(a) * 0.62 + 0.42;
    const heap = goldPile(6 + lv, 0.18 + lv * 0.014, seed + i * 31);
    heap.position.set(px, Y0 + 0.05, pz);
    g.add(heap);
  }

  /* ---- 等级构件 ---- */
  /* 2 级起：台缘压顶（与其余建筑的等级语言一致） */
  if (lv >= 2) {
    g.add(part(chamferGeo(2.62, 0.07, 2.52, { bevel: 0.02, corner: 0.06 }), PALETTE.stoneLight, {
      y: Y0 - 0.02, outline: false,
    }));
  }
  /* 3 级起：工具架（晾镐头） */
  if (lv >= 3) {
    const rack = new THREE.Group();
    rack.add(part(chamferGeo(0.08, 0.48, 0.08, { bevel: 0.018 }), woodC, { x: -0.28, y: 0.24, outline: false }));
    rack.add(part(chamferGeo(0.08, 0.48, 0.08, { bevel: 0.018 }), woodC, { x: 0.28, y: 0.24, outline: false }));
    rack.add(part(chamferGeo(0.68, 0.07, 0.07, { bevel: 0.016 }), PALETTE.timberDark, { y: 0.46, outline: false }));
    rack.position.set(-1.02, Y0, 0.5);
    rack.rotation.y = 0.35;
    g.add(rack);
  }
  /* 5 级：立一块「矿」字招牌 */
  if (lv >= 5) {
    const sb = signboard('矿', 0.5, 0.36, { color: PALETTE.timberDark });
    sb.position.set(1.06, Y0 + 0.1, 0.34);
    sb.rotation.y = -0.55;
    g.add(sb);
  }

  return g;
}

export function mElixirCollector(lv, R = FALLBACK) {
  const st = LV_STYLE(lv);
  const g = new THREE.Group();

  /* --- 变体：阀门朝向 / 铜管绕向 / 罐箍色 / 接管桶位 --- */
  const seed = (R() * 83) | 0;
  const tankR = 0.6 + lv * 0.03;
  const tankH = 1.05 + lv * 0.12;
  const valveYaw = 0.7 + jit(R, 0.4);
  const pipeA = R() < 0.5 ? 1 : -1;
  const bandC = pickR(R, [PALETTE.iron, PALETTE.copperDark, PALETTE.ironLight]);

  g.add(base(2.7, 2.6, { h: 0.24, color: PALETTE.stoneCool, colorLow: PALETTE.stoneDark }));
  /* ---- 石砌台身（等级越高砌得越厚、层数越密） ---- */
  const pod = podium(2.42, 2.32, 0.3 + lv * 0.012, PALETTE.stoneCool, st, {
    corner: 0.09, seed, quoins: lv >= 3, quoinSize: 0.16,
  });
  pod.g.position.y = 0.24;
  g.add(pod.g);
  const Y0 = 0.24 + pod.top;
  g.add(part(chamferGeo(2.3, 0.07, 2.2, { bevel: 0.025, corner: 0.16 }), PALETTE.stoneLight, {
    y: Y0 - 0.04, outline: false,
  }));

  /* ---- 支架（金属腿 + 交叉斜撑 + 底环） ---- */
  const legR = tankR + 0.28;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * legR, z = Math.sin(a) * legR;
    g.add(part(new THREE.CylinderGeometry(0.05, 0.062, 0.46, 6), PALETTE.ironDark, {
      x, y: Y0 + 0.23, z, outline: false,
    }));
    g.add(part(new THREE.BoxGeometry(0.15, 0.05, 0.15), PALETTE.iron, {
      x, y: Y0 + 0.02, z, outline: false,
    }));
  }
  g.add(part(new THREE.TorusGeometry(legR * 0.99, 0.028, 4, 14), PALETTE.iron, {
    y: Y0 + 0.08, rx: Math.PI / 2, outline: false,
  }));
  g.add(part(new THREE.TorusGeometry(legR * 0.99, 0.026, 4, 14), PALETTE.iron, {
    y: Y0 + 0.4, rx: Math.PI / 2, outline: false,
  }));
  for (let i = 0; i < 4; i++) {
    const a0 = (i / 4) * Math.PI * 2 + Math.PI / 4, a1 = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4;
    const b1 = beam([Math.cos(a0) * legR, Y0 + 0.06, Math.sin(a0) * legR],
      [Math.cos(a1) * legR, Y0 + 0.44, Math.sin(a1) * legR], 0.035, PALETTE.iron, { round: true, seg: 5 });
    if (b1) g.add(b1);
    const b2 = beam([Math.cos(a1) * legR, Y0 + 0.06, Math.sin(a1) * legR],
      [Math.cos(a0) * legR, Y0 + 0.44, Math.sin(a0) * legR], 0.035, PALETTE.iron, { round: true, seg: 5 });
    if (b2) g.add(b2);
  }

  /* ---- 罐体：液体 + 玻璃罩 + 箍 ---- */
  const yBase = Y0 + 0.46;
  const liquidH = tankH * 0.84;
  const liquid = part(new THREE.CylinderGeometry(tankR * 0.9, tankR * 0.9, liquidH, 14), PALETTE.elixir, {
    y: yBase + liquidH / 2 + 0.05, grad: GRAD_MAIN,
    emissive: PALETTE.elixir, emissiveIntensity: 0.24,
  });
  liquid.name = 'liquid';
  g.add(liquid);
  anim(g, liquid, 'pulse', { amp: 0.028, speed: 1.35 });
  g.add(part(new THREE.CylinderGeometry(tankR * 0.9, tankR * 0.9, 0.06, 14), 0xf0b6ff, {
    y: yBase + liquidH + 0.06, grad: GRAD_MAIN, emissive: 0xd76bff, emissiveIntensity: 0.5, outline: false,
  }));
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1;
    g.add(part(new THREE.SphereGeometry(0.055, 7, 5), 0xf3c8ff, {
      x: Math.cos(a) * tankR * 0.45, y: yBase + 0.3 + i * 0.22, z: Math.sin(a) * tankR * 0.45,
      emissive: 0xd76bff, emissiveIntensity: 0.6, outline: false, shadow: false,
    }));
  }
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(tankR, tankR, tankH, 14, 1, true),
    toonMat(PALETTE.glassTint, { grad: GRAD_SOFT, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide })
  );
  glass.position.y = yBase + tankH / 2 + 0.06;
  glass.userData.noOutline = true;
  g.add(glass);
  for (let i = 0; i < 3; i++) {
    g.add(part(new THREE.TorusGeometry(tankR * 1.01, 0.036, 5, 16), bandC, {
      y: yBase + tankH * (0.2 + i * 0.3), rx: Math.PI / 2,
    }));
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(part(new THREE.BoxGeometry(0.035, tankH * 0.96, 0.035), PALETTE.ironDark, {
      x: Math.cos(a) * tankR * 1.015, y: yBase + tankH * 0.5 + 0.06, z: Math.sin(a) * tankR * 1.015,
      outline: false,
    }));
  }
  g.add(part(new THREE.CylinderGeometry(tankR * 1.06, tankR * 1.02, 0.12, 14), PALETTE.iron, {
    y: yBase + 0.02,
  }));
  g.add(part(new THREE.CylinderGeometry(tankR * 1.06, tankR * 1.06, 0.13, 14), PALETTE.iron, {
    y: yBase + tankH + 0.11,
  }));
  g.add(part(new THREE.CylinderGeometry(tankR * 0.86, tankR * 0.98, 0.16, 14), PALETTE.ironDark, {
    y: yBase + tankH + 0.25, outline: false,
  }));

  /* ---- 顶部搅拌桨（转） ---- */
  const arm = new THREE.Group();
  arm.name = 'stirrer';
  arm.add(part(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 6), PALETTE.iron, {
    rz: Math.PI / 2, outline: false,
  }));
  for (const s of [-1, 1]) {
    arm.add(part(new THREE.BoxGeometry(0.12, 0.1, 0.26), PALETTE.ironDark, {
      x: s * 0.82, outline: false,
    }));
  }
  arm.add(ball(0.09, PALETTE.brass, { y: 0.1, outline: false }));
  arm.position.set(0, yBase + tankH + 0.42, 0);
  g.add(arm);
  anim(g, arm, 'spinY', { speed: 0.62 });

  /* ---- 压力表 ---- */
  const gauge = new THREE.Group();
  gauge.add(part(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 12), PALETTE.ironLight, {
    rx: Math.PI / 2, outline: false,
  }));
  gauge.add(part(new THREE.CylinderGeometry(0.085, 0.085, 0.055, 12), 0xfdf6e2, {
    rx: Math.PI / 2, z: 0.005, outline: false,
  }));
  gauge.add(part(new THREE.BoxGeometry(0.015, 0.07, 0.01), 0xd03a3a, { z: 0.035, rz: 0.5, outline: false }));
  gauge.position.set(tankR * 0.85, yBase + tankH + 0.2, 0.28);
  g.add(gauge);

  /* ---- 底座：铜管 + 阀门轮 ---- */
  const pipe1 = beam([-legR * 0.9, Y0 + 0.12, legR * 0.9], [tankR * 0.4, yBase + 0.2, 0.5], 0.075, PALETTE.copperDark, { round: true, seg: 6 });
  if (pipe1) g.add(pipe1);
  const valve = new THREE.Group();
  valve.add(part(new THREE.TorusGeometry(0.13, 0.028, 5, 12), PALETTE.brass, { outline: false }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    const bm = beam([-Math.cos(a) * 0.13, -Math.sin(a) * 0.13, 0], [Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0], 0.022, PALETTE.brass, {});
    if (bm) valve.add(bm);
  }
  valve.position.set(pipeA * 0.75, Y0 + 0.5, 0.62);
  valve.rotation.y = valveYaw;
  g.add(valve);
  g.add(part(new THREE.CylinderGeometry(0.05, 0.055, 0.3, 8), PALETTE.copper, {
    x: pipeA * 0.75, y: Y0 + 0.3, z: 0.62, rx: Math.PI / 2, outline: false,
  }));
  const drip = part(new THREE.SphereGeometry(0.045, 7, 5), PALETTE.elixir, {
    x: pipeA * 0.75, y: Y0 + 0.18, z: 0.78, emissive: PALETTE.elixir, emissiveIntensity: 0.5, outline: false, shadow: false,
  });
  drip.name = 'drip';
  g.add(drip);
  anim(g, drip, 'drip', { base: Y0 + 0.2, amp: 0.12, speed: 1.1 });
  const rec = barrel(0.16, 0.34, PALETTE.copperDark);
  rec.position.set(pipeA * 0.75, Y0 + 0.02, 0.78);
  g.add(rec);
  g.add(part(new THREE.TorusGeometry(0.2, 0.045, 5, 14), PALETTE.copperDark, {
    x: -pipeA * 0.72, y: Y0 + 0.2, z: -0.72, rx: Math.PI / 2, outline: false,
  }));

  /* ---- 等级装饰：石栏圈（4 级起，2 级起先有几只石墩） ---- */
  if (lv >= 2) {
    const n = 3 + lv;
    const piers = stonePiers(1.2, n, 0.26 + lv * 0.02, PALETTE.stoneLight, {
      w: 0.18, capColor: PALETTE.stoneMid, ball: lv >= 4, ballColor: PALETTE.elixirDark,
    });
    piers.position.y = Y0 - 0.28;
    g.add(piers);
  }
  return g;
}

/* ============================================================
   4. 金币库 —— 铁包角宝库
   ------------------------------------------------------------
   等级结构：lv1 木箱 lv2 石砌墙裙 + 檐下 lv3 双道铁箍 + 侧挂盾
             lv4 附箱 + 石墩 lv5 金脊球 + 石兽
   ============================================================ */
export function mGoldStorage(lv, R = FALLBACK) {
  const st = LV_STYLE(lv);
  const g = new THREE.Group();

  /* --- 变体：铁箍色 / 金币堆位 / 招牌朝向 / 锁的形制 --- */
  const seed = (R() * 79) | 0;
  const ironC = pickR(R, [PALETTE.ironDark, 0x4a4550, PALETTE.iron]);
  const coinYaw = jit(R, 0.6);
  const signYaw = -0.3 + jit(R, 0.4);
  const bw = 1.95, bd = 1.65, bh = 0.95 + lv * 0.08;

  g.add(base(bw + 0.34, bd + 0.34, { h: 0.3, color: PALETTE.stoneWarm, colorLow: PALETTE.stoneDark }));
  /* ---- 石砌墙裙：宝库不是木头搁地上，是搁在石头上的 ---- */
  const sk = podium(bw + 0.26, bd + 0.26, 0.34, PALETTE.stoneWarm, st, {
    corner: 0.05, seed, quoins: lv >= 3, quoinSize: 0.22,
  });
  sk.g.position.y = 0.3;
  g.add(sk.g);
  const Y0 = 0.3 + sk.top;
  const sk2 = entryStairs(Y0, 0.8, PALETTE.stoneLight, { sd: 0.2 });
  sk2.position.z = bd / 2 + 0.28;
  g.add(sk2);

  /* ---- 箱体 ---- */
  const body = styledWall(bw, bh, bd, PALETTE.timber, st, {
    corner: 0.05, plinth: false, masonry: false, coping: false, stain: false,
  });
  body.position.y = Y0;
  g.add(body);
  const n = 5;
  for (let i = 1; i < n; i++) {
    g.add(part(new THREE.BoxGeometry(0.02, bh * 0.94, bd * 1.008), PALETTE.timberDark, {
      x: -bw / 2 + (bw * i) / n, y: Y0 + bh / 2, outline: false,
    }));
  }
  /* 横向铁箍：2 + lv 道（等级越高包得越牢） */
  const nb = 2 + lv;
  for (let i = 0; i < nb; i++) {
    const y = Y0 + bh * (0.12 + (i / (nb - 1 || 1)) * 0.78);
    g.add(part(chamferGeo(bw * 1.025, 0.08, bd * 1.025, { bevel: 0.02 }), ironC, { y, outline: false }));
    g.add(rivets([-bw * 0.46, y, bd / 2 + 0.02], [bw * 0.46, y, bd / 2 + 0.02], 4, 0.026, PALETTE.ironLight, {}));
  }
  /* 四角铁包角 */
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(part(chamferGeo(0.2, bh * 1.01, 0.2, { bevel: 0.025, corner: 0.04 }), ironC, {
      x: sx * (bw / 2 - 0.05), y: Y0 + bh / 2, z: sz * (bd / 2 - 0.05), outline: false,
    }));
    for (let i = 0; i < 3; i++) {
      g.add(part(new THREE.SphereGeometry(0.024, 6, 4), PALETTE.ironLight, {
        x: sx * (bw / 2 + 0.03), y: Y0 + bh * (0.24 + i * 0.26),
        z: sz * (bd / 2 - 0.05), outline: false, shadow: false,
      }));
    }
  }

  /* ---- 双开门 + 锁 ---- */
  const fz = bd / 2 + 0.02;
  g.add(part(chamferGeo(bw * 0.74, bh * 0.66, 0.09, { bevel: 0.025 }), PALETTE.timberLight, {
    y: Y0 + bh * 0.42, z: fz,
  }));
  g.add(part(new THREE.BoxGeometry(0.05, bh * 0.62, 0.07), PALETTE.timberDark, {
    y: Y0 + bh * 0.42, z: fz + 0.03, outline: false,
  }));
  for (const s of [-1, 1]) {
    for (const yy of [0.24, 0.6]) {
      g.add(part(new THREE.BoxGeometry(0.14, 0.06, 0.05), ironC, {
        x: s * bw * 0.3, y: Y0 + bh * yy, z: fz + 0.04, outline: false,
      }));
    }
  }
  g.add(part(chamferGeo(0.2, 0.18, 0.1, { bevel: 0.02, corner: 0.03 }), PALETTE.brass, {
    y: Y0 + bh * 0.42, z: fz + 0.08, outline: false,
  }));
  g.add(part(new THREE.TorusGeometry(0.07, 0.022, 4, 10, Math.PI), PALETTE.ironLight, {
    y: Y0 + bh * 0.52, z: fz + 0.08, outline: false,
  }));

  /* ---- 屋顶 ---- */
  const rf = styledRoof(bw + 0.28, bd + 0.28, 0.86, st, {
    wallW: bw, wallD: bd, layers: 5, corbelStep: 0.3, rafterStep: 0.22, eaveStep: 0.18,
    mossSeed: seed, finial: lv >= 5,
  });
  rf.position.y = Y0 + bh;
  g.add(rf);
  g.add(ball(0.1, PALETTE.gold, { y: Y0 + bh + 0.88 + 0.04 }));

  /* ---- 门前金币与器具 ---- */
  const coinG = new THREE.Group();
  for (let i = 0; i < 4 + lv; i++) {
    const a = i * 1.9 + 0.4;
    const rr = 0.62 + (i % 3) * 0.2;
    coinG.add(part(new THREE.CylinderGeometry(0.14, 0.14, 0.075, 10), PALETTE.gold, {
      x: Math.cos(a) * rr, z: Math.sin(a) * 0.28, y: 0.06,
      rx: 0.2, grad: GRAD_MAIN, outline: false,
    }));
  }
  coinG.position.set(0, Y0, bd / 2 + 0.3);
  coinG.rotation.y = coinYaw;
  g.add(coinG);
  /* 天平 */
  const scales = new THREE.Group();
  scales.add(part(new THREE.CylinderGeometry(0.03, 0.045, 0.5, 6), PALETTE.brassDark, { y: 0.25, outline: false }));
  scales.add(part(chamferGeo(0.06, 0.05, 0.06, { bevel: 0.015 }), PALETTE.brass, { y: 0.5, outline: false }));
  const bal = beam([-0.3, 0.52, 0], [0.3, 0.52, 0], 0.03, PALETTE.brass, {});
  if (bal) scales.add(bal);
  for (const s of [-1, 1]) {
    const ropeL = beam([s * 0.3, 0.52, 0], [s * 0.3, 0.36, 0], 0.012, PALETTE.timberDark, {});
    if (ropeL) scales.add(ropeL);
    scales.add(part(new THREE.CylinderGeometry(0.1, 0.08, 0.05, 10), PALETTE.brass, {
      x: s * 0.3, y: 0.33, outline: false,
    }));
  }
  scales.position.set(-1.15, Y0 + 0.02, 1.55);
  g.add(scales);
  /* 钱袋 */
  g.add(part(new THREE.SphereGeometry(0.17, 9, 7), PALETTE.timberLight, {
    x: 1.02, y: Y0 + 0.16, z: 1.1, sy: 0.95, outline: false,
  }));
  g.add(part(new THREE.CylinderGeometry(0.05, 0.08, 0.09, 7), PALETTE.timberDark, {
    x: 1.02, y: Y0 + 0.31, z: 1.1, outline: false,
  }));
  g.add(part(new THREE.SphereGeometry(0.058, 6, 4), PALETTE.gold, {
    x: 1.02, y: Y0 + 0.36, z: 1.1, outline: false,
  }));
  const cr = crate(0.32, 0.24, 0.26, PALETTE.timber);
  cr.position.set(0.95, Y0 + 0.02, -1.5);
  g.add(cr);
  /* 4 级起：附箱 + 石墩 */
  if (lv >= 4) {
    const cr2 = crate(0.46, 0.34, 0.36, PALETTE.timberDark);
    cr2.position.set(-0.9, Y0 + 0.02, -1.42);
    cr2.rotation.y = -0.34;
    g.add(cr2);
    g.add(ball(0.1, PALETTE.gold, { x: -0.9, y: Y0 + 0.4, z: -1.42 }));
    const piers = stonePiers(1.32, 4, 0.3, PALETTE.stoneLight, {
      w: 0.19, phase: Math.PI / 4, capColor: PALETTE.stoneMid, ball: true, ballColor: PALETTE.gold,
    });
    piers.position.y = 0.02;
    g.add(piers);
  }
  /* 招牌 */
  const sg = signboard('', 0.42, 0.3, { color: PALETTE.timber, face: PALETTE.gold });
  sg.position.set(bw / 2 + 0.42, Y0 + 0.02, bd / 2 + 0.1);
  sg.rotation.y = signYaw;
  g.add(sg);
  return g;
}

/* ============================================================
   5. 圣水库 —— 立式玻璃瓮
   ------------------------------------------------------------
   等级结构：lv1 裸支腿 lv2 石砌台身 + 檐口压顶 lv3 台面石墩
             lv4 石栏 + 铭牌 lv5 金顶饰
   ============================================================ */
export function mElixirStorage(lv, R = FALLBACK) {
  const st = LV_STYLE(lv);
  const g = new THREE.Group();

  /* --- 变体：罐箍色 / 阀门朝向 / 管道走向 / 液位计在左还是右 --- */
  const seed = (R() * 71) | 0;
  const bandC = pickR(R, [PALETTE.iron, PALETTE.copperDark, PALETTE.ironLight]);
  const valveYaw = 1.2 + jit(R, 0.5);
  const pipeSide = R() < 0.5 ? -1 : 1;
  const gaugeSide = R() < 0.5 ? -1 : 1;
  const R0 = 0.82 + lv * 0.045;
  const H = 1.05 + lv * 0.1;

  g.add(base(2.7, 2.6, { h: 0.26, color: PALETTE.stoneCool, colorLow: PALETTE.stoneDark }));
  const pod = podium(2.4, 2.3, 0.32 + lv * 0.012, PALETTE.stoneCool, st, {
    corner: 0.09, seed, quoins: lv >= 3, quoinSize: 0.18,
  });
  pod.g.position.y = 0.26;
  g.add(pod.g);
  const Y0 = 0.26 + pod.top;
  g.add(part(chamferGeo(2.2, 0.07, 2.1, { bevel: 0.025, corner: 0.16 }), PALETTE.stoneLight, {
    y: Y0 - 0.04, outline: false,
  }));

  /* ---- 支腿 ×4 ---- */
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * (R0 + 0.14), z = Math.sin(a) * (R0 + 0.14);
    g.add(part(chamferGeo(0.11, 0.5, 0.11, { bevel: 0.024 }), PALETTE.ironDark, { x, y: Y0 + 0.25, z, outline: false }));
    g.add(part(new THREE.BoxGeometry(0.17, 0.05, 0.17), PALETTE.iron, { x, y: Y0 + 0.02, z, outline: false }));
  }
  g.add(part(new THREE.TorusGeometry(R0 + 0.1, 0.032, 4, 16), PALETTE.iron, {
    y: Y0 + 0.11, rx: Math.PI / 2, outline: false,
  }));

  /* ---- 罐体（下圆柱 + 上半球） ---- */
  const yBase = Y0 + 0.5;
  const body = part(new THREE.CylinderGeometry(R0, R0, H, 16), PALETTE.elixir, {
    y: yBase + H / 2, grad: GRAD_MAIN, emissive: PALETTE.elixir, emissiveIntensity: 0.2,
  });
  body.name = 'liquid';
  g.add(body);
  anim(g, body, 'pulse', { amp: 0.018, speed: 1.1 });
  const dome = part(new THREE.SphereGeometry(R0, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), PALETTE.elixir, {
    y: yBase + H, grad: GRAD_MAIN, emissive: PALETTE.elixir, emissiveIntensity: 0.2,
  });
  g.add(dome);
  const bot = part(new THREE.SphereGeometry(R0, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), PALETTE.elixirDark, {
    y: yBase, grad: GRAD_MAIN,
  });
  g.add(bot);

  /* ---- 金属箍：3 + lv/2 道 ---- */
  const nh = 3 + Math.floor(lv / 2);
  for (let i = 0; i < nh; i++) {
    const yy = yBase + H * (0.08 + (i / Math.max(1, nh - 1)) * 0.84);
    g.add(part(new THREE.TorusGeometry(R0 * 1.012, 0.038, 5, 18), bandC, {
      y: yy, rx: Math.PI / 2,
    }));
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    g.add(part(new THREE.BoxGeometry(0.04, H * 0.95, 0.04), PALETTE.ironDark, {
      x: Math.cos(a) * R0 * 1.018, y: yBase + H * 0.5, z: Math.sin(a) * R0 * 1.018, outline: false,
    }));
  }

  /* ---- 顶部阀塔 ---- */
  const topY = yBase + H + R0;
  g.add(part(new THREE.CylinderGeometry(R0 * 0.34, R0 * 0.44, 0.22, 12), PALETTE.iron, { y: topY + 0.08 }));
  g.add(part(new THREE.CylinderGeometry(R0 * 0.2, R0 * 0.24, 0.2, 10), PALETTE.ironDark, { y: topY + 0.28, outline: false }));
  g.add(part(new THREE.TorusGeometry(R0 * 0.3, 0.045, 5, 12), PALETTE.brass, { y: topY + 0.38, rx: Math.PI / 2 }));
  g.add(ball(0.075, PALETTE.brass, { y: topY + 0.46, outline: false }));
  if (lv >= 5) {
    g.add(part(new THREE.ConeGeometry(0.09, 0.3, 5), PALETTE.gold, { y: topY + 0.62, grad: GRAD_MAIN }));
    g.add(ball(0.055, PALETTE.goldDark, { y: topY + 0.8 }));
  }
  const p1 = beam([R0 * 0.3, topY + 0.1, 0], [R0 * 1.15, topY - 0.1, 0.3 * pipeSide], 0.055, PALETTE.copper, { round: true, seg: 6 });
  if (p1) g.add(p1);

  /* ---- 液位计（侧面玻璃管） ---- */
  g.add(part(new THREE.CylinderGeometry(0.055, 0.055, H * 0.78, 8), 0xe8c8ff, {
    x: gaugeSide * (R0 + 0.22), y: yBase + H * 0.45, z: 0.12, grad: GRAD_MAIN,
    emissive: PALETTE.elixir, emissiveIntensity: 0.45, outline: false,
  }));
  for (const yy of [0.1, 0.8]) {
    const bm = beam([gaugeSide * (R0 + 0.05), yBase + H * yy, 0.12], [gaugeSide * (R0 + 0.24), yBase + H * yy, 0.12], 0.035, PALETTE.iron, { round: true, seg: 5 });
    if (bm) g.add(bm);
  }

  /* ---- 管道 + 阀门轮 ---- */
  const pipe = beam([-pipeSide * R0 * 0.9, yBase + 0.28, R0 * 0.6], [-pipeSide * (R0 + 0.3), Y0 + 0.12, R0 * 1.05], 0.08, PALETTE.copperDark, { round: true, seg: 6 });
  if (pipe) g.add(pipe);
  const valve = new THREE.Group();
  valve.add(part(new THREE.TorusGeometry(0.14, 0.03, 5, 12), PALETTE.brass, { outline: false }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    const bm = beam([-Math.cos(a) * 0.14, -Math.sin(a) * 0.14, 0], [Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0], 0.024, PALETTE.brass, {});
    if (bm) valve.add(bm);
  }
  valve.position.set(-pipeSide * (R0 + 0.32), Y0 + 0.36, R0 * 1.02);
  valve.rotation.y = valveYaw;
  g.add(valve);

  /* ---- 等级装饰：台面石墩 + 铭牌 ---- */
  if (lv >= 2) {
    const n = 3 + lv;
    const piers = stonePiers(1.16, n, 0.26 + lv * 0.02, PALETTE.stoneLight, {
      w: 0.18, capColor: PALETTE.stoneMid, ball: lv >= 4, ballColor: PALETTE.elixirDark,
    });
    piers.position.y = Y0 - 0.3;
    g.add(piers);
  }
  if (lv >= 5) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      g.add(part(chamferGeo(0.24, 0.08, 0.24, { bevel: 0.02 }), PALETTE.goldDark, {
        x: Math.cos(a) * 1.16, y: Y0 - 0.34, z: Math.sin(a) * 1.16, outline: false,
      }));
    }
  }
  return g;
}

/* ============================================================
   6. 兵营 —— 半木结构长屋
   ------------------------------------------------------------
   等级结构：lv1 单层长屋 lv2 + 瞭望塔（矮） lv3 塔加高 + 披屋
             lv4 + 院墙 lv5 塔最高 + 第二烟囱 + 金脊
   ============================================================ */
export function mBarracks(lv, R = FALLBACK) {
  const st = LV_STYLE(lv);
  const g = new THREE.Group();

  /* --- 变体：半木构架分格 / 旗色 / 盾牌色序 / 杂物位 --- */
  const seed = (R() * 73) | 0;
  const bayN = pickR(R, [3, 3, 4]);
  const flagC = pickR(R, [PALETTE.shingleA, PALETTE.tileBlue, PALETTE.tileGreen]);
  const shieldSeq = pickR(R, [
    [PALETTE.tileBlue, PALETTE.shingleA, PALETTE.tileGreen],
    [PALETTE.tileGreen, PALETTE.shingleA, PALETTE.tileBlue],
    [PALETTE.shingleA, PALETTE.tileBlue, PALETTE.tileGreen],
  ]);
  const bw = 1.92, bd = 1.55, bh = 0.88 + lv * 0.06;

  g.add(base(bw + 0.36, bd + 0.36, { h: 0.3, color: PALETTE.stoneWarm, colorLow: PALETTE.stoneDark }));
  /* ---- 石砌台身（承重基座，等级越高越厚） ---- */
  const pod = podium(bw + 0.28, bd + 0.28, 0.3 + lv * 0.01, PALETTE.stoneWarm, st, {
    corner: 0.05, seed, quoins: lv >= 3, quoinSize: 0.2,
  });
  pod.g.position.y = 0.3;
  g.add(pod.g);
  const Y0 = 0.3 + pod.top;
  const st1 = entryStairs(Y0, 0.72, PALETTE.stoneLight, { sd: 0.2 });
  st1.position.z = bd / 2 + 0.3;
  g.add(st1);

  /* ---- 墙体（半木结构：抹灰填充，不走砌石） ---- */
  const wl = styledWall(bw, bh, bd, PALETTE.canvas, st, {
    plinth: false, corner: 0.04, masonry: false, coping: false, stain: false,
  });
  wl.position.y = Y0;
  g.add(wl);
  const tw = 0.07;
  const bays = [];
  for (let i = 1; i < bayN; i++) bays.push(-bw / 2 + (bw * i) / bayN);
  for (const zz of [-bd / 2, bd / 2]) {
    for (const x of bays) {
      g.add(part(new THREE.BoxGeometry(tw, bh * 0.98, tw * 0.6), PALETTE.beam, {
        x, y: Y0 + bh / 2, z: zz + Math.sign(zz) * 0.015, outline: false,
      }));
    }
    for (const s of [-1, 1]) {
      g.add(part(new THREE.BoxGeometry(tw, bh * 0.98, tw * 0.6), PALETTE.beam, {
        x: s * (bw / 2 - 0.03), y: Y0 + bh / 2, z: zz + Math.sign(zz) * 0.015, outline: false,
      }));
    }
    for (const yy of [bh * 0.08, bh * 0.9]) {
      g.add(part(new THREE.BoxGeometry(bw * 1.01, tw * 0.7, tw * 0.6), PALETTE.beam, {
        y: Y0 + yy, z: zz + Math.sign(zz) * 0.015, outline: false,
      }));
    }
    for (const x of bays) {
      for (const s of [-1, 1]) {
        const bm = beam([x, Y0 + bh * 0.12, zz + Math.sign(zz) * 0.02],
          [x + s * (bw / (bayN * 1.6)), Y0 + bh * 0.86, zz + Math.sign(zz) * 0.02], 0.05, PALETTE.beam, {});
        if (bm) g.add(bm);
      }
    }
  }
  for (const s of [-1, 1]) {
    for (const yy of [bh * 0.08, bh * 0.9]) {
      g.add(part(new THREE.BoxGeometry(tw * 0.6, tw * 0.7, bd * 1.01), PALETTE.beam, {
        x: s * (bw / 2 + 0.015), y: Y0 + yy, outline: false,
      }));
    }
    g.add(part(new THREE.BoxGeometry(tw * 0.6, bh * 0.98, tw), PALETTE.beam, {
      x: s * (bw / 2 + 0.015), y: Y0 + bh / 2, outline: false,
    }));
  }

  /* ---- 大门（拱形门洞） ---- */
  const front = bd / 2 + 0.04;
  const dr = archDoor(0.66, 1.0, {
    frame: PALETTE.timber, doorColor: PALETTE.timberDark, t: 0.1,
  });
  dr.position.set(0, Y0, front);
  g.add(dr);
  const cr = new THREE.Group();
  const s1 = sword(0.34); s1.position.set(0, 0, 0.02); s1.rotation.z = 0.6; cr.add(s1);
  const a1 = axe(0.1); a1.position.set(0, 0.06, 0.04); a1.rotation.z = -0.6; cr.add(a1);
  cr.position.set(0, Y0 + 1.2, front + 0.05);
  cr.scale.setScalar(0.62);
  g.add(cr);
  /* 侧面窗（等级 2 起） */
  if (lv >= 2) {
    for (const s of [-1, 1]) {
      const wd = styledWindow(0.3, 0.32, st, { shutters: false, glowI: 0.35 });
      wd.position.set(s * (bw / 2 + 0.04), Y0 + bh * 0.6, 0.34);
      wd.rotation.y = s * Math.PI / 2;
      g.add(wd);
    }
  }

  /* ---- 屋顶 ---- */
  const rf = styledRoof(bw + 0.3, bd + 0.3, 0.94 + lv * 0.04, st, {
    wallW: bw, wallD: bd, layers: 5, corbelStep: 0.28, rafterStep: 0.22, eaveStep: 0.18,
    mossSeed: seed, finial: lv >= 5,
  });
  rf.position.y = Y0 + bh;
  g.add(rf);
  const roofTop = Y0 + bh + 0.94 + lv * 0.04;
  g.add(chimney(-0.68, Y0 + bh + 0.3, -0.42, 0.72 + lv * 0.06, { color: PALETTE.stoneMid }));
  if (lv >= 5) {
    add(g, smoke(-0.68, Y0 + bh + 0.3 + 0.72 + lv * 0.06 + 0.22, -0.42, { speed: 0.6 }));
    g.add(chimney(0.68, Y0 + bh + 0.3, 0.34, 0.6, { color: PALETTE.stoneMid }));
  }

  /* ---- 瞭望塔（2 级起，等级越高越高） ---- */
  if (lv >= 2) {
    const th = 0.95 + (lv - 2) * 0.34;
    const tw2 = 0.62 + lv * 0.03;
    const tower = watchtower(tw2, th, PALETTE.timber, {
      roofColor: st.roof.color, roofTrim: st.roof.trim, brace: PALETTE.beam,
      rh: 0.28 + lv * 0.03,
    });
    tower.position.set(bw / 2 - tw2 * 0.5, roofTop - 0.1, -bd / 2 + tw2 * 0.5);
    g.add(tower);
    add(g, flag(tower.position.x + tw2 * 0.6, roofTop - 0.1 + th * 0.88 + 0.9, tower.position.z, flagC, 0.72));
  }

  /* ---- 披屋（3 级起）：侧面搭出去一小间 ---- */
  if (lv >= 3) {
    const lean = new THREE.Group();
    const lw = 0.86 + (lv - 3) * 0.06, ld = 1.0, lh = 0.62;
    lean.add(part(chamferGeo(lw, lh, ld, { bevel: 0.04, corner: 0.04 }), PALETTE.plasterCream, { y: lh / 2 }));
    const lroof = styledRoof(lw + 0.24, ld + 0.24, 0.42, st, {
      wallW: lw, wallD: ld, layers: 4, corbels: false, rafters: false, eaveTiles: true,
      eaveStep: 0.16, moss: false, color: PALETTE.thatch, trim: PALETTE.thatchDark,
    });
    lroof.position.y = lh;
    lean.add(lroof);
    for (const z of [-ld / 2 + 0.1, ld / 2 - 0.1]) {
      lean.add(part(new THREE.CylinderGeometry(0.04, 0.045, lh, 6), PALETTE.timberDark, {
        x: lw / 2, y: lh / 2, z, outline: false,
      }));
    }
    lean.position.set(-bw / 2 - lw / 2 + 0.06, Y0, 0.12);
    g.add(lean);
  }

  /* ---- 院墙（4 级起）：石砌矮院墙，等级越高越厚 ---- */
  if (lv >= 4) {
    const yard = new THREE.Group();
    const inW = bw / 2 + 0.46, inD = bd / 2 + 0.46;
    const wh = 0.34 + (lv - 4) * 0.08;
    for (const [px, pz, w2, d2] of [
      [-inW, -inD, 0.14, inD * 2], [inW, -inD, 0.14, inD * 2],
      [-inW, inD, 0.14, inD * 2], [inW, inD, 0.14, inD * 2],
    ]) {
      const seg = styledWall(w2, wh, d2, PALETTE.stoneMid, st, {
        corner: 0.02, seed: seed + 11, stain: true, coping: true,
      });
      seg.position.set(px, 0.02, pz);
      yard.add(seg);
    }
    for (const z of [-inD, inD]) {
      const seg = styledWall(inW * 2, wh, 0.14, PALETTE.stoneMid, st, {
        corner: 0.02, seed: seed + 12, stain: true, coping: true,
      });
      seg.position.set(0, 0.02, z - (z > 0 ? 0.06 : -0.06));
      yard.add(seg);
    }
    // 石砌门柱
    for (const s of [-1, 1]) {
      yard.add(part(chamferGeo(0.26, wh + 0.3, 0.26, { bevel: 0.03, corner: 0.04 }), PALETTE.stoneLight, {
        x: s * 0.62, y: (wh + 0.3) / 2 + 0.02, z: inD - 0.06,
      }));
      yard.add(ball(0.11, PALETTE.stoneLight, { x: s * 0.62, y: wh + 0.4, z: inD - 0.06 }));
    }
    g.add(yard);
    // 院墙上的火把
    add(g, flag(-inW, wh + 0.4, -inD + 0.4, flagC, 0.9));
    add(g, flag(inW, wh + 0.4, -inD + 0.4, shieldSeq[0], 0.9));
  }

  /* ---- 门口武备区 ---- */
  const rack = weaponRack({ w: 0.86 });
  rack.position.set(-1.16, Y0 + 0.02, 0.86);
  rack.rotation.y = 0.5;
  g.add(rack);
  for (const s of [-1, 1]) {
    const sh = shield(0.2, shieldSeq[s > 0 ? 0 : 1]);
    sh.position.set(s * 0.86, Y0 + 0.68, front + 0.02);
    g.add(sh);
  }
  const sh2 = shield(0.22, shieldSeq[2]);
  sh2.position.set(bw / 2 + 0.03, Y0 + 0.6, 0.1);
  sh2.rotation.y = Math.PI / 2;
  g.add(sh2);
  const dm = trainingDummy();
  dm.position.set(1.24, Y0 + 0.02, 1.0);
  dm.rotation.y = -0.4 + jit(R, 0.3);
  g.add(dm);
  const br = brazier(0.17, {});
  br.position.set(1.26, Y0 + 0.02, -0.82);
  add(g, br);
  add(g, flag(-1.2, Y0 + bh * 0.92, -0.92, flagC, 1.0));
  if (lv >= 2) add(g, flag(1.2, Y0 + bh * 0.92, -0.92, flagC, 0.9));

  /* ---- 木栅栏 ---- */
  for (let i = 0; i < 4; i++) {
    g.add(part(new THREE.CylinderGeometry(0.045, 0.05, 0.42, 6), PALETTE.timber, {
      x: -1.4 + i * 0.3, z: -1.28, y: Y0 + 0.21, outline: false,
    }));
  }
  if (lv >= 3) {
    const rack2 = weaponRack({ w: 0.7 });
    rack2.position.set(1.24, Y0 + 0.02, -0.1);
    rack2.rotation.y = -1.2;
    g.add(rack2);
  }
  return g;
}

/* ============================================================
   7. 兵营营帐 —— 帐篷营地 + 篝火
   ------------------------------------------------------------
   等级结构：lv1 双帐+篝火 lv2 三帐 lv3 瞭望台 lv4 四帐+栅栏
             lv5 台加高 + 第五帐 + 旗阵
   ============================================================ */
/** 单顶帐篷：布 + 门帘 + 顶杆小旗 + 地钉绳 */
function tent(w, d, h, color, opt = {}) {
  const g = new THREE.Group();
  const bh = h * 0.4;
  g.add(part(chamferGeo(w, bh, d, { bevel: 0.05, corner: w * 0.14 }), opt.canvas || PALETTE.canvas, { y: bh / 2 }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    g.add(part(new THREE.BoxGeometry(0.035, bh * 0.86, 0.035), 0xd8c9a4, {
      x: Math.cos(a) * w * 0.42, y: bh * 0.5, z: Math.sin(a) * d * 0.42, outline: false,
    }));
  }
  const R = 0.5 * Math.hypot(w, d) * 1.08;
  const rh = h * 0.68;
  g.add(part(new THREE.ConeGeometry(R, rh, 4), color, { y: bh + rh / 2, ry: Math.PI / 4, grad: GRAD_MAIN }));
  for (let i = 0; i < 3; i++) {
    const t0 = i / 3, t1 = (i + 1) / 3;
    g.add(part(new THREE.CylinderGeometry(R * (1 - t1) * 1.05, R * (1 - t0) * 1.04 || R * 0.2, rh / 3 * 0.94, 4, 1, true),
      i % 2 ? color : opt.panel || color, { y: bh + rh * t0 + rh / 6, ry: Math.PI / 4, grad: GRAD_MAIN, outline: false }));
  }
  g.add(part(new THREE.CylinderGeometry(R * 1.05, R * 1.09, 0.075, 4), opt.trim || PALETTE.timberDark, {
    y: bh + 0.03, ry: Math.PI / 4, outline: false,
  }));
  g.add(part(chamferGeo(w * 0.36, bh * 0.82, 0.06, { bevel: 0.02 }), PALETTE.timberDark, {
    y: bh * 0.42, z: d / 2 - 0.02, outline: false,
  }));
  for (const s of [-1, 1]) {
    g.add(part(new THREE.BoxGeometry(0.05, bh * 0.8, 0.05), PALETTE.timber, {
      x: s * w * 0.2, y: bh * 0.44, z: d / 2 - 0.02, outline: false,
    }));
  }
  const poleH = h * 0.5;
  g.add(part(new THREE.CylinderGeometry(0.026, 0.03, poleH, 6), PALETTE.timberDark, {
    y: bh + rh + poleH / 2 - 0.1, outline: false,
  }));
  const cl = part(new THREE.ConeGeometry(0.1, 0.24, 3), opt.flag || PALETTE.shingleA, { grad: GRAD_MAIN, outline: false });
  cl.name = 'tentFlag';
  cl.rotation.set(0, 0, -Math.PI / 2);
  cl.position.set(0.13, bh + rh + poleH - 0.2, 0);
  g.add(cl);
  anim(g, cl, 'flag', { amp: 0.4, speed: 3.0 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const px = Math.cos(a) * w * 0.62, pz = Math.sin(a) * d * 0.62;
    g.add(rope([0, bh + rh - 0.06, 0], [px, 0.04, pz], 0.014, 0xbba882, 0));
    g.add(part(new THREE.CylinderGeometry(0.025, 0.03, 0.16, 5), PALETTE.timberDark, {
      x: px, y: 0.08, z: pz, rx: 0.3, outline: false,
    }));
  }
  return g;
}

export function mArmyCamp(lv, R = FALLBACK) {
  const g = new THREE.Group();

  /* --- 变体：帐篷布色 / 摆位角 / 盾墙色序 / 篝火偏移 --- */
  const seed = (R() * 67) | 0;
  const tentTone = pickR(R, [
    [PALETTE.tileGreen, PALETTE.tileGreenDk, PALETTE.shingleB, 0xe0b25c],
    [PALETTE.tileBlue, PALETTE.tileBlueDark, PALETTE.shingleB, 0xc4744c],
    [PALETTE.shingleB, PALETTE.shingleC, PALETTE.tileGreen, 0x8fa05a],
  ]);
  const yardYaw = jit(R, 0.16);
  const fireOff = jit(R, 0.12);

  g.add(base(3.7, 3.6, { h: 0.22, color: PALETTE.stoneWarm, colorLow: PALETTE.stoneDark, corner: 0.28 }));
  const Y0 = 0.26;
  for (let i = 0; i < 5; i++) {
    const a = i * 2.3 + seed * 0.07;
    g.add(part(new THREE.CylinderGeometry(0.28 + (i % 2) * 0.1, 0.3, 0.03, 8), 0xc0a075, {
      x: Math.cos(a) * 1.15, z: Math.sin(a) * 1.1, y: Y0 + 0.005, outline: false,
    }));
  }
  /* 夯土场地边缘：等级 2 起加木栅 */
  if (lv >= 2) {
    const n = 10 + lv * 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + yardYaw;
      const rr = 1.74 + ((i % 3) - 1) * 0.02;
      g.add(part(new THREE.CylinderGeometry(0.04, 0.045, 0.34 + (i % 3) * 0.04, 6), PALETTE.timber, {
        x: Math.cos(a) * rr, y: Y0 + 0.17, z: Math.sin(a) * rr, outline: false,
      }));
    }
  }

  /* ---- 中央篝火 ---- */
  const fx0 = fireOff;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    g.add(part(new THREE.DodecahedronGeometry(0.11 + (i % 3) * 0.02, 0), 0x9a938a, {
      x: fx0 + Math.cos(a) * 0.5, y: Y0 + 0.06, z: Math.sin(a) * 0.5,
      rx: a, ry: a * 2, grad: GRAD_SOFT,
    }));
  }
  g.add(part(new THREE.CylinderGeometry(0.34, 0.36, 0.05, 10), 0x3f3a3f, { x: fx0, y: Y0 + 0.05, outline: false }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    g.add(part(new THREE.CylinderGeometry(0.05, 0.055, 0.78, 6), PALETTE.timberDark, {
      x: fx0, y: Y0 + 0.16, rx: Math.PI / 2, ry: a, outline: false,
    }));
  }
  const flame = part(new THREE.ConeGeometry(0.25, 0.8, 7), 0xffa62b, {
    x: fx0, y: Y0 + 0.62, grad: GRAD_MAIN, emissive: 0xff7a1a, emissiveIntensity: 1.0, shadow: false,
  });
  flame.name = 'campfireOuter';
  const flameIn = part(new THREE.ConeGeometry(0.14, 0.46, 6), 0xffe37a, {
    x: fx0, y: Y0 + 0.54, grad: GRAD_MAIN, emissive: 0xffe37a, emissiveIntensity: 1.0, shadow: false,
  });
  flameIn.name = 'campfireInner';
  g.add(flame, flameIn);
  anim(g, flame, 'flicker', { amp: 0.26, speed: 9 });
  anim(g, flameIn, 'flicker', { amp: 0.32, speed: 12 });
  /* 火架高度随等级 —— 营地"长大"的可读来源。
     为什么必须有：瞭望台要到 lv3 才出现，于是 lv1 与 lv2 的总高完全相等
     （自检 model-stats 报 h-），玩家看不出升级。让火架逐级升高，
     再在顶尖挂一面军旗，营地就从第一级起有可见高差。 */
  const rigH = 1.15 + (lv - 1) * 0.14;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const bm = beam([fx0 + Math.cos(a) * 0.66, Y0 + 0.02, Math.sin(a) * 0.66], [fx0, Y0 + rigH, 0], 0.055, PALETTE.timberDark, {});
    if (bm) g.add(bm);
  }
  g.add(part(new THREE.CylinderGeometry(0.045, 0.055, 0.42, 6), PALETTE.timberDark, {
    x: fx0, y: Y0 + rigH + 0.21, outline: false,
  }));
  add(g, flag(fx0, Y0 + rigH + 0.36, 0, tentTone[0], 0.85));
  g.add(part(new THREE.CylinderGeometry(0.24, 0.2, 0.08, 10), PALETTE.iron, { x: fx0, y: Y0 + 0.62, outline: false }));
  g.add(part(new THREE.SphereGeometry(0.2, 10, 7), PALETTE.ironDark, { x: fx0, y: Y0 + 0.52, sy: 0.8 }));
  g.add(part(new THREE.TorusGeometry(0.1, 0.016, 4, 10, Math.PI), PALETTE.iron, {
    x: fx0, y: Y0 + 0.7, outline: false,
  }));

  /* ---- 帐篷群（等级越高越多、越讲究） ---- */
  const spots = [
    { p: [-1.15, -1.05], y: 0.5, s: [1.35, 1.2, 1.15], c: 0 },
    { p: [1.2, -0.95], y: -0.45, s: [1.25, 1.1, 1.05], c: 1 },
  ];
  if (lv >= 2) spots.push({ p: [1.25, 1.15], y: 2.65, s: [1.15, 1.0, 0.95], c: 2 });
  if (lv >= 4) spots.push({ p: [-1.2, 1.2], y: 1.1, s: [1.1, 0.98, 0.9], c: 3 });
  if (lv >= 5) spots.push({ p: [-1.5, 0.05], y: -1.5, s: [1.05, 0.95, 0.88], c: 1 });
  for (const sp of spots) {
    const t = tent(sp.s[0], sp.s[1], sp.s[2], tentTone[sp.c % tentTone.length], {
      trim: PALETTE.timberDark, flag: tentTone[(sp.c + 1) % tentTone.length], panel: PALETTE.canvas,
    });
    t.position.set(sp.p[0], Y0, sp.p[1]);
    t.rotation.y = sp.y + jit(R, 0.12);
    add(g, t);
  }

  /* ---- 瞭望台（3 级起）：营地高度的来源 ---- */
  if (lv >= 3) {
    const th = 1.55 + (lv - 3) * 0.42;
    const tower = watchtower(0.72, th, PALETTE.timber, {
      roofColor: PALETTE.thatch, roofTrim: PALETTE.thatchDark,
      rh: 0.32 + lv * 0.02, railH: 0.26,
    });
    tower.position.set(-0.1, Y0, -1.9);
    g.add(tower);
    add(g, flag(-0.1, Y0 + th * 0.88 + 0.9, -1.9, tentTone[0], 0.8));
  }

  /* ---- 营地杂物 ---- */
  const rack = weaponRack({ w: 0.8 });
  rack.position.set(0.3, Y0 + 0.02, 1.35);
  rack.rotation.y = Math.PI;
  g.add(rack);
  const cr = crate(0.36, 0.28, 0.3, PALETTE.timber);
  cr.position.set(-0.42, Y0 + 0.02, 1.42);
  cr.rotation.y = -0.25;
  g.add(cr);
  const cr2 = crate(0.28, 0.22, 0.24, PALETTE.timberDark);
  cr2.position.set(-0.42, Y0 + 0.3, 1.42);
  cr2.rotation.y = 0.35;
  g.add(cr2);
  const bl = barrel(0.16, 0.38, PALETTE.timber);
  bl.position.set(1.5, Y0 + 0.02, 0.2);
  g.add(bl);
  for (let i = 0; i < 3; i++) {
    const sh = shield(0.2, tentTone[i % tentTone.length]);
    sh.position.set(-1.55, Y0 + 0.3 + i * 0.02, 0.15 + i * 0.36);
    sh.rotation.y = Math.PI / 2 + 0.1;
    g.add(sh);
  }
  const d1 = trainingDummy();
  d1.position.set(-0.15, Y0 + 0.02, -1.55);
  d1.scale.setScalar(0.92);
  g.add(d1);
  if (lv >= 3) {
    const d2 = trainingDummy();
    d2.position.set(0.8, Y0 + 0.02, -1.5);
    d2.rotation.y = 0.4;
    d2.scale.setScalar(0.92);
    g.add(d2);
  }
  add(g, flag(-1.72, Y0 + 0.4, -0.5, tentTone[0], 1.05));
  if (lv >= 2) add(g, flag(1.72, Y0 + 0.4, -0.4, tentTone[1], 1.0));
  for (let i = 0; i < 5; i++) {
    g.add(part(new THREE.CylinderGeometry(0.045, 0.05, 0.5, 6), PALETTE.timber, {
      x: 0.1 + (i % 2) * 0.1, y: Y0 + 0.06 + Math.floor(i / 4) * 0.09,
      z: -0.5 - (i % 3) * 0.11, rx: Math.PI / 2, rz: 0.1, outline: false,
    }));
  }
  return g;
}

/* ============================================================
   8. 工人小屋 —— 茅草顶 + 工地
   ------------------------------------------------------------
   等级结构：lv1 单间 lv2 脚手架 lv3 阁楼（抬高） lv4 石砌烟囱加高
             lv5 小塔楼 + 旗
   ============================================================ */
export function mBuilderHut(lv, R = FALLBACK) {
  const st = LV_STYLE(lv);
  const g = new THREE.Group();

  /* --- 变体：木材堆位 / 梯子朝向 / 草顶色 / 独轮车位 --- */
  const seed = (R() * 61) | 0;
  const thatchC = pickR(R, [PALETTE.thatch, 0xc9a861, 0xb99a5c]);
  const ladYaw = 0.28 + jit(R, 0.3);
  const cartYaw = 0.5 + jit(R, 0.4);
  const bw = 1.0, bd = 0.9, bh = 0.66;

  g.add(base(bw + 0.36, bd + 0.36, { h: 0.26, color: PALETTE.stoneWarm, colorLow: PALETTE.stoneDark }));
  /* ---- 石砌墙裙（小屋也有石头底座） ---- */
  const sk = podium(bw + 0.2, bd + 0.2, 0.24 + lv * 0.008, PALETTE.stoneWarm, st, {
    corner: 0.05, seed, quoins: lv >= 3, quoinSize: 0.16,
  });
  sk.g.position.y = 0.26;
  g.add(sk.g);
  const Y0 = 0.26 + sk.top;

  /* ---- 小屋（抹灰 + 木构角柱） ---- */
  const wl = styledWall(bw, bh, bd, PALETTE.plasterCream, st, {
    corner: 0.05, plinth: false, masonry: false, coping: false, stain: lv >= 2,
  });
  wl.position.y = Y0;
  g.add(wl);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(part(new THREE.BoxGeometry(0.09, bh * 1.02, 0.09), PALETTE.beam, {
      x: sx * (bw / 2 - 0.03), y: Y0 + bh / 2, z: sz * (bd / 2 - 0.03), outline: false,
    }));
  }
  const dr = archDoor(0.36, 0.52, { frame: PALETTE.timberDark, doorColor: PALETTE.timber, t: 0.06 });
  dr.position.set(-0.16, Y0, bd / 2 + 0.03);
  g.add(dr);
  const wd = styledWindow(0.26, 0.24, st, { glowI: 0.45, shutters: false });
  wd.position.set(0.3, Y0 + 0.38, bd / 2 + 0.03);
  g.add(wd);

  /* ---- 茅草厚屋顶（放进一个 Group：阁楼起来时整顶抬高） ---- */
  const roofG = new THREE.Group();
  const R0 = 0.5 * Math.hypot(bw, bd) * 1.24;
  const rh = 0.72;
  roofG.add(part(new THREE.ConeGeometry(R0, rh, 4), thatchC, {
    y: rh / 2, ry: Math.PI / 4, grad: GRAD_MAIN,
  }));
  for (let i = 0; i < 3; i++) {
    const t0 = i / 3, t1 = (i + 1) / 3;
    roofG.add(part(new THREE.CylinderGeometry(R0 * (1 - t1) * 1.06, R0 * (1 - t0) * 1.06, rh / 3 * 0.9, 4, 1, true),
      i % 2 ? thatchC : PALETTE.thatchDark, {
        y: rh * t0 + rh / 6, ry: Math.PI / 4, grad: GRAD_MAIN, outline: false,
      }));
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    roofG.add(part(new THREE.ConeGeometry(0.045, 0.2, 4), PALETTE.thatchDark, {
      x: Math.cos(a) * R0 * 0.98, y: -0.04, z: Math.sin(a) * R0 * 0.98,
      rx: 0.4, ry: a, outline: false,
    }));
  }
  roofG.add(part(new THREE.CylinderGeometry(0.07, 0.11, 0.22, 6), PALETTE.thatchDark, {
    y: rh + 0.06, outline: false,
  }));
  roofG.position.y = Y0 + bh;
  g.add(roofG);
  let roofTop = Y0 + bh + rh + 0.17;

  /* ---- 阁楼（3 级起）：草顶下面长出一个小木楼层 ---- */
  let loftH = 0;
  if (lv >= 3) {
    loftH = 0.42 + (lv - 3) * 0.1;
    const lo = new THREE.Group();
    lo.add(part(chamferGeo(bw * 0.96, 0.06, bd * 0.96, { bevel: 0.02 }), PALETTE.timberLight, { outline: false }));
    lo.add(part(chamferGeo(bw * 0.78, loftH, bd * 0.78, { bevel: 0.03, corner: 0.03 }), PALETTE.timber, {
      y: loftH / 2 + 0.03,
    }));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        lo.add(part(new THREE.BoxGeometry(0.07, loftH, 0.07), PALETTE.beam, {
          x: sx * (bw * 0.39 - 0.02), y: loftH / 2 + 0.03, z: sz * (bd * 0.39 - 0.02), outline: false,
        }));
      }
    }
    lo.position.y = Y0 + bh;
    g.add(lo);
    roofG.position.y = Y0 + bh + loftH;
    roofTop += loftH;
    const loWin = styledWindow(0.2, 0.2, st, { glowI: 0.4, shutters: false });
    loWin.position.set(0.3, Y0 + bh + loftH * 0.6, bd * 0.39 + 0.05);
    g.add(loWin);
  }

  /* ---- 烟囱 + 烟（等级越高烟囱越高） ---- */
  const chH = 0.56 + lv * 0.1;
  const chY = Y0 + bh + 0.34 + loftH * 0.8;
  g.add(chimney(0.42, chY, -0.3, chH, { color: PALETTE.stoneMid }));
  if (lv >= 2) add(g, smoke(0.42, chY + chH + 0.22, -0.3, { speed: 0.7 }));

  /* ---- 小塔楼（5 级）：屋顶上再起一小间 ---- */
  if (lv >= 5) {
    const th = 0.5;
    const tw = watchtower(0.42, th, PALETTE.timber, {
      roofColor: thatchC, roofTrim: PALETTE.thatchDark, rh: 0.24, railH: 0.2, tw: 0.06,
    });
    tw.position.set(-0.06, roofTop - 0.12, -0.02);
    g.add(tw);
    add(g, flag(0.02, roofTop - 0.12 + th * 0.88 + 0.8, -0.02, PALETTE.tileBlue, 0.6));
    roofTop += 0.6;
  }

  /* ---- 工地杂物 ---- */
  const sg = new THREE.Group();
  sg.add(part(new THREE.CylinderGeometry(0.028, 0.032, 0.5, 6), PALETTE.timberDark, { y: 0.25, outline: false }));
  sg.add(part(chamferGeo(0.26, 0.13, 0.07, { bevel: 0.02 }), PALETTE.iron, { y: 0.5, outline: false }));
  sg.add(part(new THREE.BoxGeometry(0.08, 0.13, 0.07), PALETTE.timber, { x: 0.17, y: 0.5, outline: false }));
  sg.position.set(0.66, Y0 + 0.02, 0.6);
  sg.rotation.y = -0.5;
  g.add(sg);
  /* 木材堆（等级越高堆得越多） */
  const logs = 4 + lv;
  for (let i = 0; i < logs; i++) {
    const row = Math.floor(i / 3);
    g.add(part(new THREE.CylinderGeometry(0.055, 0.06, 0.7, 6), PALETTE.timber, {
      x: -0.82 + (i % 3) * 0.13, y: Y0 + 0.06 + row * 0.11,
      z: 0.42, rz: Math.PI / 2, ry: 0.2, outline: false,
    }));
  }
  const ld = new THREE.Group();
  for (const s of [-1, 1]) {
    ld.add(part(new THREE.BoxGeometry(0.045, 0.86, 0.045), PALETTE.timber, { x: s * 0.13, y: 0.43, outline: false }));
  }
  for (let i = 0; i < 4; i++) {
    ld.add(part(new THREE.CylinderGeometry(0.022, 0.022, 0.26, 5), PALETTE.timberDark, {
      y: 0.14 + i * 0.22, rz: Math.PI / 2, outline: false,
    }));
  }
  ld.position.set(-0.72, Y0 + 0.02, -0.62);
  ld.rotation.z = 0.28;
  ld.rotation.y = ladYaw;
  g.add(ld);
  g.add(part(new THREE.CylinderGeometry(0.13, 0.11, 0.2, 10), PALETTE.timber, {
    x: 0.7, y: Y0 + 0.12, z: -0.66, outline: false,
  }));
  g.add(part(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 10), 0xcfc6bb, {
    x: 0.7, y: Y0 + 0.22, z: -0.66, outline: false,
  }));
  const cart = new THREE.Group();
  cart.add(part(chamferGeo(0.42, 0.16, 0.3, { bevel: 0.025, corner: 0.03 }), PALETTE.timber, { y: 0.2 }));
  cart.add(part(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10), PALETTE.ironDark, { y: 0.09, rz: Math.PI / 2, outline: false }));
  for (const s of [-1, 1]) {
    const bm = beam([s * 0.2, 0.2, -0.14], [s * 0.16, 0.14, -0.5], 0.035, PALETTE.timber, {});
    if (bm) cart.add(bm);
  }
  cart.position.set(-0.2, Y0 + 0.02, -0.95);
  cart.rotation.y = cartYaw;
  g.add(cart);
  if (lv >= 2) {
    const sc = new THREE.Group();
    const sh2 = 1.0 + (lv - 2) * 0.12;
    for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
      sc.add(part(new THREE.CylinderGeometry(0.035, 0.04, sh2, 6), PALETTE.timber, {
        x, y: sh2 / 2, z, outline: false,
      }));
    }
    for (const yy of [sh2 * 0.45, sh2 * 0.9]) {
      sc.add(part(new THREE.BoxGeometry(0.66, 0.05, 0.66), PALETTE.timberLight, { y: yy, outline: false }));
    }
    // 脚手架上的砖垛
    if (lv >= 3) {
      for (let i = 0; i < 2 + (lv - 3); i++) {
        sc.add(part(chamferGeo(0.2, 0.07, 0.14, { bevel: 0.012 }), PALETTE.stoneWarm, {
          y: sh2 * 0.9 + 0.06 + i * 0.07, outline: false,
        }));
      }
    }
    sc.position.set(0.95, Y0 + 0.02, -1.0);
    g.add(sc);
  }
  return g;
}
