/* ============================================================
   models-def.js — 防御建筑（加农炮 / 迫击炮 / 箭塔）
   ------------------------------------------------------------
   防御建筑是玩家的视线锚点，所以机械细节必须一路可读：
   转盘 → 炮座 → 炮耳 → 炮管 → 加强箍 → 炮口。
   约定：炮口朝向 +X（由 battle.js 旋转 userData.turret 控制朝向），
        muzzle 是 turret 的子节点、必须停在炮口位置（弹道从这里出发）。

   v2（本轮）
   ------------------------------------------------------------
   老问题（由 tools/model-stats.mjs 量出来，不是猜的）：
     · archertower 五级三角面**完全相同**（3989/145/7 恒定）
     · cannon 高度不随等级变化（h-）；mortar 五级只涨 2.6%
     · 11 种建筑 3 个变体指纹全等 —— 同屏两座炮是复制粘贴
   根因：等级只改了「尺寸」，没改「结构」。
   做法：接上 build-kit 的统一构造语言，让每一级都**加东西**：
     石砌圆台层数 = 2 + lv      垛口数 = 6 + lv*2
     炮管加强箍   = 2 + lv      沙袋/弹药件数 = 2 + lv
     台面高度     = 0.3 + lv*0.05（唯一"长大"的量，保证高度单调）
   于是「升一级」在任何建筑上都是同一件事 —— 这是 level-style.js
   那张表存在的意义，也是模型自检能断言的东西。

   变体：maker 收一个**已播种**的 R()，同一个 (type, lv, variant)
   永远得到同一个样子（可复现），但相邻两座不再一模一样。
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';
import { part, GRAD_MAIN, GRAD_SOFT } from './toon.js';
import { PALETTE } from './config.js';
import {
  chamferGeo, beam, railingRing, rivets, lantern,
} from './shapes.js';
import {
  base, barrel, crate, rubble, flag, brazier, shield,
} from './parts.js';
import {
  LV_STYLE, FALLBACK_RND, pickR, jit, add, anim,
  stoneDrum, merlons, stonePiers, entryStairs,
} from './build-kit.js';

/* ------------------------------------------------------------------
   炮管通用件：渐细管身 + 加强箍 + 炮口 + 内膛
   加强箍数量由等级决定（rings），这是炮"越升级越精工"最直白的证据。
   ------------------------------------------------------------------ */
function gunBarrel(len, r, opt = {}) {
  const g = new THREE.Group();
  const seg = opt.seg || 12;
  // 主身（锥度）
  g.add(part(new THREE.CylinderGeometry(r * 0.92, r * 1.1, len, seg), opt.color || PALETTE.iron, {
    rz: -Math.PI / 2, x: len / 2, y: 0, grad: GRAD_MAIN,
  }));
  // 加强箍
  const nRing = opt.rings === undefined ? 3 : opt.rings;
  for (let i = 0; i < nRing; i++) {
    const t = 0.2 + (i / Math.max(1, nRing - 1)) * 0.6;
    const rr = r * (1.1 - t * 0.18);
    g.add(part(new THREE.CylinderGeometry(rr * 1.16, rr * 1.16, len * 0.07, seg),
      opt.ringColor || PALETTE.ironDark, {
        rz: -Math.PI / 2, x: len * t, grad: GRAD_MAIN, outline: false,
      }));
  }
  // 炮口（加厚 + 内膛）
  g.add(part(new THREE.CylinderGeometry(r * 1.26, r * 1.26, len * 0.14, seg),
    opt.muzzleColor || PALETTE.ironDark, {
      rz: -Math.PI / 2, x: len * 0.94, grad: GRAD_MAIN,
    }));
  g.add(part(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.05, seg), 0x241f28, {
    rz: -Math.PI / 2, x: len * 1.01, outline: false, shadow: false,
  }));
  // 炮尾
  g.add(part(new THREE.SphereGeometry(r * 1.3, seg, 8), opt.breachColor || PALETTE.ironDark, {
    x: -r * 0.5, grad: GRAD_MAIN,
  }));
  if (opt.rivets !== false) {
    g.add(rivets([len * 0.3, r * 1.15, 0], [len * 0.75, r * 1.15, 0], 3, 0.022, PALETTE.ironLight, {}));
  }
  return g;
}

/** 炮位沙袋掩体：一圈交错两层的麻袋。层数随等级增加。 */
function sandbagRing(radius, y, color, opt = {}) {
  const g = new THREE.Group();
  const n = opt.n || 10;
  const rows = opt.rows || 1;
  for (let r = 0; r < rows; r++) {
    const rr = radius - r * 0.06;
    const k = Math.max(4, n - r * 2);
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + r * 0.24;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      g.add(part(chamferGeo(0.44, 0.2, 0.27, { bevel: 0.035, corner: 0.035 }), color, {
        x, y: y + r * 0.19, z, ry: a, grad: GRAD_SOFT,
      }));
    }
  }
  return g;
}

/* ============================================================
   1. 加农炮
   ============================================================ */
export function mCannon(lv, R) {
  const R0 = R || FALLBACK_RND;
  const st = LV_STYLE(lv);
  const g = new THREE.Group();

  /* ---- 石砌炮台：垫层 + 收分圆台（层数随等级） + 垛口（数量随等级） ---- */
  g.add(base(2.7, 2.6, { h: 0.26, color: PALETTE.stoneMid, colorLow: PALETTE.stoneDark }));
  const podH = 0.3 + lv * 0.05;
  g.add(stoneDrum(1.24, podH, {
    n: 2 + lv, seg: 12, color: PALETTE.stoneMid, batter: st.batter + 0.06,
  }));
  // 垛口（隔一个空一个 → 真正的"工事"而不是石头台子）
  g.add(merlons(1.36, 6 + lv * 2, 0.26, PALETTE.stoneMid, {
    phase: 0.3, capColor: PALETTE.stoneLight,
  }));
  const deckY = podH;

  /* ---- 固定转盘（齿轮感） ---- */
  g.add(part(new THREE.CylinderGeometry(0.62, 0.7, 0.16, 12), PALETTE.ironDark, { y: deckY + 0.08 }));
  const nb = 8 + lv * 2;                       // 齿数随等级
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2;
    g.add(part(new THREE.BoxGeometry(0.08, 0.14, 0.07), PALETTE.iron, {
      x: Math.cos(a) * 0.68, y: deckY + 0.08, z: Math.sin(a) * 0.68, ry: -a, outline: false,
    }));
  }

  /* ---- 可旋转炮座 ---- */
  const turret = new THREE.Group();
  turret.position.y = deckY + 0.16;
  const brl = 1.34 + lv * 0.11;
  const brr = 0.098 + lv * 0.007;
  const boxW = 0.8 + lv * 0.024;
  const boxD = 0.76 + lv * 0.024;

  turret.add(part(chamferGeo(boxW, 0.4, boxD, { bevel: 0.05, corner: 0.09 }), PALETTE.iron, { y: 0.18 }));
  turret.add(part(chamferGeo(boxW * 1.1, 0.09, boxD * 1.1, { bevel: 0.03 }), PALETTE.ironDark, { y: 0.05, outline: false }));
  // 侧面加强肋：数量随等级（升一级多一道）
  for (let i = 0; i < lv; i++) {
    const t = 0.22 + (i / Math.max(1, lv)) * 0.56;
    for (const s of [-1, 1]) {
      turret.add(part(new THREE.BoxGeometry(0.05, 0.3, boxD * 0.9), PALETTE.ironDark, {
        x: s * boxW * 0.46, y: 0.19, z: (t - 0.5) * boxD, outline: false,
      }));
    }
  }
  for (const s of [-1, 1]) {
    turret.add(part(new THREE.BoxGeometry(0.06, 0.34, 0.5), PALETTE.ironDark, {
      x: s * (boxW / 2 + 0.03), y: 0.19, outline: false,
    }));
    turret.add(part(new THREE.TorusGeometry(0.075, 0.02, 4, 10, Math.PI), PALETTE.brass, {
      x: s * (boxW / 2 + 0.08), y: 0.24, z: -0.1, ry: Math.PI / 2, outline: false,
    }));
    // 炮耳（trunnion）
    turret.add(part(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 10), PALETTE.ironDark, {
      x: s * (boxW / 2 - 0.01), y: 0.42, rz: Math.PI / 2, outline: false,
    }));
    turret.add(part(new THREE.CylinderGeometry(0.055, 0.055, 0.14, 8), PALETTE.brass, {
      x: s * (boxW / 2 + 0.04), y: 0.42, rz: Math.PI / 2, outline: false,
    }));
  }
  turret.add(rivets([-boxW * 0.44, 0.33, boxD * 0.51], [boxW * 0.44, 0.33, boxD * 0.51], 5, 0.026, PALETTE.ironLight, {}));

  // 炮管（加强箍随等级）
  const gun = gunBarrel(brl, brr, { color: PALETTE.iron, ringColor: PALETTE.ironDark, rings: 2 + lv });
  gun.position.y = 0.42;
  turret.add(gun);
  turret.add(part(new THREE.BoxGeometry(0.12, 0.3, 0.07), PALETTE.ironDark, {
    x: brl * 0.55, y: 0.28, z: 0.16, outline: false,
  }));
  // 瞄准具
  const sight = new THREE.Group();
  sight.add(part(new THREE.CylinderGeometry(0.025, 0.03, 0.24, 6), PALETTE.brassDark, { y: 0.12, outline: false }));
  sight.add(part(new THREE.BoxGeometry(0.1, 0.06, 0.03), PALETTE.ironDark, { y: 0.26, outline: false }));
  sight.position.set(-0.1, 0.5, 0.24);
  turret.add(sight);
  // 黄铜铆钉（数量随等级）
  for (let i = 0; i < lv; i++) {
    const a = i * 1.25;
    turret.add(part(new THREE.SphereGeometry(0.038, 6, 4), PALETTE.brass, {
      x: Math.cos(a) * (boxW / 2 - 0.02), y: 0.34, z: Math.sin(a) * (boxD / 2 - 0.02), outline: false,
    }));
  }

  const muzzle = new THREE.Object3D();
  muzzle.position.set(brl * 1.0 + brr * 0.9, 0.42, 0);
  turret.add(muzzle);
  g.add(turret);
  g.userData.turret = turret;
  g.userData.muzzle = muzzle;

  /* ---- 弹药区（件数随等级） ---- */
  const stack = new THREE.Group();
  const n = 1 + lv;
  for (let i = 0; i < n; i++) {
    stack.add(part(new THREE.SphereGeometry(0.115, 9, 7), 0x4d4a54, {
      x: -0.22 + (i % 3) * 0.22, y: 0.1 + Math.floor(i / 3) * 0.2, z: 0, grad: GRAD_MAIN,
    }));
  }
  const px = pickR(R0, [-1.0, -1.12, -0.92]);
  const pz = pickR(R0, [0.85, 0.95, 0.74]);
  stack.position.set(px, 0.02, pz);
  g.add(stack);

  const pw = barrel(0.17, 0.4, PALETTE.timberDark);
  pw.position.set(1.05, 0.02, 0.88);
  g.add(pw);
  add(g, part(new THREE.TorusGeometry(0.18, 0.025, 4, 12), PALETTE.brass, {
    y: 0.4, x: 1.05, z: 0.88, rx: Math.PI / 2, outline: false,
  }));
  const am = crate(0.34, 0.22, 0.26, PALETTE.timber);
  am.position.set(px + 0.05, 0.02, -0.7);
  am.rotation.y = 0.35 + jit(R0, 0.2);
  g.add(am);
  // 通条
  for (const s of [-1, 1]) {
    const rd = beam([s * 1.2, 0.02, -0.28], [s * 1.02, 0.52, -0.5], 0.036, PALETTE.timber, {});
    if (rd) g.add(rd);
    g.add(part(new THREE.SphereGeometry(0.05, 6, 5), PALETTE.ironDark, {
      x: s * 1.02, y: 0.54, z: -0.5, outline: false,
    }));
  }
  /* 沙袋掩体：两圈随等级变厚（掩体是"这里挨过打"的证据） */
  g.add(sandbagRing(1.42, 0.095, PALETTE.sandbag, { n: 9 + lv, rows: 1 + Math.floor(lv / 2) }));

  // 火把（挂在台上，不随炮塔旋转）
  g.add(lantern(0.9, deckY + 0.72, -1.0, {}));
  // 角墩（石砌锚点，别做成一圈"麻将牌"）
  g.add(stonePiers(1.34, 4 + lv, 0.3 + lv * 0.03, PALETTE.stoneLight, { w: 0.2, phase: Math.PI / 4 }));
  return g;
}

/* ============================================================
   2. 迫击炮
   ============================================================ */
export function mMortar(lv, R) {
  const R0 = R || FALLBACK_RND;
  const st = LV_STYLE(lv);
  const g = new THREE.Group();

  /* ---- 石砌炮位 ---- */
  g.add(base(2.7, 2.6, { h: 0.28, color: PALETTE.stoneCool, colorLow: PALETTE.stoneDark }));
  const podH = 0.32 + lv * 0.05;
  g.add(stoneDrum(1.26, podH, {
    n: 2 + lv, seg: 14, color: PALETTE.stoneCool, batter: st.batter + 0.05,
  }));
  g.add(merlons(1.38, 8 + lv * 2, 0.24, PALETTE.stoneCool, {
    phase: 0.2, capColor: PALETTE.stoneLight,
  }));

  /* ---- 沙袋圈：圈数随等级（迫击炮位最典型的地面语言） ---- */
  g.add(sandbagRing(1.5, 0.1, PALETTE.sandbag, { n: 11 + lv, rows: 1 + Math.floor((lv + 1) / 2) }));

  const deckY = podH;

  /* ---- 大底板 + 地脚螺栓 ---- */
  g.add(part(chamferGeo(1.4, 0.1, 1.4, { bevel: 0.03, corner: 0.14 }), PALETTE.ironDark, { y: deckY + 0.05 }));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(part(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 8), PALETTE.iron, {
      x: sx * 0.56, y: deckY + 0.13, z: sz * 0.56, outline: false,
    }));
  }

  /* ---- 可旋转炮组 ---- */
  const turret = new THREE.Group();
  turret.position.y = deckY + 0.1;

  // 转盘（齿数随等级）
  turret.add(part(new THREE.CylinderGeometry(0.5, 0.56, 0.12, 14), PALETTE.iron, { y: 0.06 }));
  const nt = 8 + lv * 2;
  for (let i = 0; i < nt; i++) {
    const a = (i / nt) * Math.PI * 2;
    turret.add(part(new THREE.BoxGeometry(0.06, 0.1, 0.05), PALETTE.ironDark, {
      x: Math.cos(a) * 0.54, y: 0.06, z: Math.sin(a) * 0.54, ry: -a, outline: false,
    }));
  }
  // 炮座
  turret.add(part(chamferGeo(0.66, 0.3, 0.62, { bevel: 0.05, corner: 0.08 }), PALETTE.ironDark, { y: 0.26 }));
  turret.add(rivets([-0.3, 0.4, 0.3], [0.3, 0.4, 0.3], 4, 0.028, PALETTE.ironLight, {}));

  const tubeLen = 0.96 + lv * 0.11;
  const tubeR = 0.22 + lv * 0.014;
  const pitch = 1.02;   // 仰角（弧度），≈58°
  const pivot = new THREE.Group();
  pivot.position.set(0.06, 0.4, 0);
  pivot.rotation.z = pitch;
  pivot.add(part(new THREE.CylinderGeometry(tubeR * 0.94, tubeR * 1.06, tubeLen, 14), PALETTE.iron, {
    y: tubeLen / 2, grad: GRAD_MAIN,
  }));
  // 加强环随等级
  const nR = 2 + lv;
  for (let i = 0; i < nR; i++) {
    const t = 0.14 + (i / Math.max(1, nR - 1)) * 0.68;
    pivot.add(part(new THREE.CylinderGeometry(tubeR * 1.2, tubeR * 1.2, 0.07, 14), PALETTE.ironDark, {
      y: tubeLen * t, grad: GRAD_MAIN, outline: false,
    }));
  }
  pivot.add(part(new THREE.CylinderGeometry(tubeR * 1.24, tubeR * 1.24, 0.16, 14), PALETTE.ironDark, {
    y: tubeLen * 0.96, grad: GRAD_MAIN,
  }));
  pivot.add(part(new THREE.CylinderGeometry(tubeR * 0.78, tubeR * 0.78, 0.13, 14), 0x1f1a24, {
    y: tubeLen * 1.0, outline: false, shadow: false,
  }));
  pivot.add(part(new THREE.SphereGeometry(tubeR * 1.25, 12, 8), PALETTE.ironDark, { y: -tubeR * 0.4 }));
  for (const s of [-1, 1]) {
    pivot.add(part(new THREE.CylinderGeometry(0.075, 0.075, 0.14, 10), PALETTE.ironDark, {
      x: s * (tubeR + 0.05), y: tubeR * 0.9, rz: Math.PI / 2, outline: false,
    }));
  }
  turret.add(pivot);

  // 支撑架（两侧斜撑 + 液压杆）
  for (const s of [-1, 1]) {
    const stm = beam([s * 0.3, 0.34, -0.26], [s * 0.1, 0.78, 0.06], 0.06, PALETTE.ironDark, {});
    if (stm) turret.add(stm);
    turret.add(part(new THREE.CylinderGeometry(0.045, 0.05, 0.42, 8), PALETTE.iron, {
      x: s * 0.2, y: 0.5, z: -0.18, rx: -0.5, outline: false,
    }));
  }
  // 瞄准镜
  const scope = new THREE.Group();
  scope.add(part(new THREE.CylinderGeometry(0.045, 0.05, 0.3, 8), PALETTE.brassDark, { y: 0.15, outline: false }));
  scope.add(part(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 8), PALETTE.ironDark, { y: 0.32, outline: false }));
  scope.position.set(-0.26, 0.42, 0.16);
  scope.rotation.z = 0.3;
  turret.add(scope);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(Math.sin(pitch) * tubeLen * 1.02, 0.4 + Math.cos(pitch) * tubeLen * 1.02, 0);
  turret.add(muzzle);

  // 黄铜涂装铆钉随等级
  for (let i = 0; i < lv; i++) {
    const a = i * 1.3;
    turret.add(part(new THREE.SphereGeometry(0.04, 6, 4), PALETTE.brass, {
      x: Math.cos(a) * 0.36, y: 0.36, z: Math.sin(a) * 0.34, outline: false,
    }));
  }

  g.add(turret);
  g.userData.turret = turret;
  g.userData.muzzle = muzzle;

  /* ---- 弹药（件数随等级） ---- */
  const am = crate(0.42, 0.26, 0.32, PALETTE.timberDark);
  am.position.set(-1.34, 0.02, -0.3);
  am.rotation.y = 0.3 + jit(R0, 0.25);
  g.add(am);
  g.add(part(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 10), PALETTE.brass, {
    x: -1.34, y: 0.29, z: -0.3, outline: false,
  }));
  const nSh = 2 + lv;
  for (let i = 0; i < nSh; i++) {
    const sh = new THREE.Group();
    sh.add(part(new THREE.SphereGeometry(0.1, 9, 7), 0x46424c, { grad: GRAD_MAIN }));
    sh.add(part(new THREE.CylinderGeometry(0.06, 0.075, 0.12, 9), PALETTE.brassDark, { y: 0.11, outline: false }));
    sh.position.set(1.3 - (i % 3) * 0.19, 0.13, -0.5 + Math.floor(i / 3) * 0.24 + (i % 3) * 0.05);
    sh.rotation.x = 0.4 + jit(R0, 0.12);
    g.add(sh);
  }
  // 弹坑
  const p1 = rubble(0.4, 4, 0x8a8074, 5 + lv);
  p1.position.set(-1.1, 0.02, 0.95);
  g.add(p1);
  // 火把
  g.add(lantern(1.2, deckY + 0.72, 0.9, {}));
  return g;
}

/* ============================================================
   3. 箭塔 —— 八角木塔 + 弓手平台
   ------------------------------------------------------------
   等级 → 结构：塔身加高 → 木箍变密 → 中段多一层挑台（lv3+）
        → 平台垛口变多 → 屋顶瓦层变厚 → 顶上金饰
   这是"三层木塔"读起来比"一根木柱"强的关键。
   ============================================================ */
export function mArcherTower(lv, R) {
  const R0 = R || FALLBACK_RND;
  const st = LV_STYLE(lv);
  const g = new THREE.Group();
  const th = 1.42 + lv * 0.2;           // 塔身高度（逐级 +0.2）
  const rBot = 0.74, rTop = 0.62;
  const podH = 0.28 + lv * 0.035;

  /* ---- 石砌塔基 + 台步 ---- */
  g.add(base(2.6, 2.5, { h: 0.26, color: PALETTE.stoneMid, colorLow: PALETTE.stoneDark }));
  g.add(stoneDrum(1.0, podH, { n: 2 + lv, seg: 8, color: PALETTE.stoneLight, batter: st.batter + 0.04 }));
  const stp = entryStairs(podH, 0.62, PALETTE.stoneLight, { z: 1.0, ry: -0.7 });
  g.add(stp);
  g.add(stonePiers(1.16, 4 + lv, 0.22 + lv * 0.02, PALETTE.stoneLight, { w: 0.17 }));

  /* ---- 八角塔身 ---- */
  const tower = new THREE.Group();
  tower.position.y = podH;
  tower.add(part(new THREE.CylinderGeometry(rTop, rBot, th, 8), PALETTE.timber, {
    y: th / 2, ry: Math.PI / 8, grad: GRAD_MAIN,
  }));
  // 竖向木板条（固定 8 面，跟着塔高拉长）
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    tower.add(part(new THREE.BoxGeometry(0.09, th * 0.98, 0.06), PALETTE.timberDark, {
      x: Math.cos(a) * (rBot + rTop) / 2, y: th / 2, z: Math.sin(a) * (rBot + rTop) / 2,
      ry: -a, outline: false,
    }));
  }
  // 木箍：数量随等级（2 + ceil(lv/2) → 3/3/4/4/5）
  const nHoop = 2 + Math.ceil(lv / 2);
  for (let i = 0; i < nHoop; i++) {
    const t = 0.14 + (i / Math.max(1, nHoop - 1)) * 0.72;
    const r = rBot + (rTop - rBot) * t;
    tower.add(part(new THREE.CylinderGeometry(r * 1.03, r * 1.03, 0.07, 8), PALETTE.timberDark, {
      y: th * t, ry: Math.PI / 8, outline: false,
    }));
  }
  // 交叉斜撑（四面）
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const rr = (rBot + rTop) / 2 * 1.02;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const b1 = beam([x - Math.sin(a) * 0.24, th * 0.18, z + Math.cos(a) * 0.24],
      [x + Math.sin(a) * 0.24, th * 0.72, z - Math.cos(a) * 0.24], 0.05, PALETTE.timberLight, {});
    if (b1) tower.add(b1);
    const b2 = beam([x + Math.sin(a) * 0.24, th * 0.18, z - Math.cos(a) * 0.24],
      [x - Math.sin(a) * 0.24, th * 0.72, z + Math.cos(a) * 0.24], 0.05, PALETTE.timberLight, {});
    if (b2) tower.add(b2);
  }
  // 底部斜撑
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bp = beam([Math.cos(a) * 1.0, 0.05, Math.sin(a) * 1.0],
      [Math.cos(a) * rBot, th * 0.34, Math.sin(a) * rBot], 0.07, PALETTE.timberDark, {});
    if (bp) tower.add(bp);
  }
  g.add(tower);

  /* ---- 中段挑台（lv3 起）：塔不再是一根柱子，而是有层次的塔 ---- */
  if (lv >= 3) {
    const my = podH + th * 0.52;
    g.add(part(new THREE.CylinderGeometry(0.92, 0.86, 0.1, 8), PALETTE.timberDark, {
      y: my, ry: Math.PI / 8, grad: GRAD_MAIN,
    }));
    const nBr = 8;
    for (let i = 0; i < nBr; i++) {
      const a = (i / nBr) * Math.PI * 2 + Math.PI / 8;
      const bm = beam([Math.cos(a) * 0.6, my - 0.42, Math.sin(a) * 0.6],
        [Math.cos(a) * 0.86, my - 0.03, Math.sin(a) * 0.86], 0.05, PALETTE.timberDark, {});
      if (bm) g.add(bm);
    }
    // 挑台栏杆
    g.add(railingRing(0.86, 0.3, 8, PALETTE.timber, { y: my + 0.16, mid: true, thick: 0.05 }));
  }

  /* ---- 平台 ---- */
  const py = podH + th;
  g.add(part(new THREE.CylinderGeometry(1.02, 0.92, 0.17, 8), PALETTE.timberDark, {
    y: py + 0.085, ry: Math.PI / 8, grad: GRAD_MAIN,
  }));
  g.add(part(new THREE.CylinderGeometry(1.06, 1.06, 0.06, 8), PALETTE.timber, {
    y: py + 0.21, ry: Math.PI / 8, outline: false,
  }));
  // 平台下斜撑托架
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const bm = beam([Math.cos(a) * 0.56, py - 0.5, Math.sin(a) * 0.56],
      [Math.cos(a) * 0.96, py - 0.02, Math.sin(a) * 0.96], 0.055, PALETTE.timberDark, {});
    if (bm) g.add(bm);
  }
  // 平台垛口（木栏板，数量随等级）
  g.add(merlons(1.12, 8 + lv * 2, 0.2, PALETTE.timber, {
    phase: Math.PI / 8, capColor: PALETTE.timberLight, w: 0.2, t: 0.1,
  }));

  /* ---- 可旋转单元（弓手） ---- */
  const turret = new THREE.Group();
  const platY = py + 0.24;
  const rl = railingRing(0.92, 0.4, 8 + lv, PALETTE.timber, { y: 0.05, mid: true, thick: 0.055 });
  turret.add(rl);
  // 弓手人偶
  const man = new THREE.Group();
  man.add(part(new THREE.CylinderGeometry(0.055, 0.06, 0.2, 7), 0x5c4a36, { x: -0.07, y: 0.1, outline: false }));
  man.add(part(new THREE.CylinderGeometry(0.055, 0.06, 0.2, 7), 0x5c4a36, { x: 0.07, y: 0.1, outline: false }));
  man.add(part(new THREE.BoxGeometry(0.22, 0.08, 0.18), 0x4a3a2c, { y: 0.03 }));
  man.add(part(chamferGeo(0.26, 0.3, 0.19, { bevel: 0.035, corner: 0.03 }), 0x4d7a3c, { y: 0.35 }));
  man.add(part(new THREE.BoxGeometry(0.28, 0.06, 0.21), 0x6f4527, { y: 0.24, outline: false }));
  man.add(part(new THREE.BoxGeometry(0.1, 0.1, 0.04), PALETTE.brass, { y: 0.24, z: 0.1, outline: false }));
  man.add(part(new THREE.SphereGeometry(0.115, 10, 8), PALETTE.skin, { y: 0.57 }));
  man.add(part(new THREE.ConeGeometry(0.145, 0.22, 8), 0x3f6a30, { y: 0.68 }));
  man.add(part(new THREE.SphereGeometry(0.135, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x4d7a3c, { y: 0.58 }));
  for (const s of [-1, 1]) {
    man.add(part(new THREE.SphereGeometry(0.022, 6, 4), 0x241c2b, { x: s * 0.05, y: 0.585, z: 0.1, outline: false, shadow: false }));
  }
  man.add(part(new THREE.CylinderGeometry(0.04, 0.042, 0.24, 6), PALETTE.skin, { x: -0.17, y: 0.36, rz: 0.28, outline: false }));
  man.add(part(new THREE.CylinderGeometry(0.04, 0.042, 0.24, 6), PALETTE.skin, { x: 0.17, y: 0.4, rz: -0.9, outline: false }));
  man.add(part(new THREE.TorusGeometry(0.23, 0.022, 4, 12, Math.PI * 1.15), PALETTE.timberDark, {
    x: 0.34, y: 0.42, rz: 0.52,
  }));
  const str = beam([0.42, 0.66, 0.06], [0.42, 0.18, 0.06], 0.012, 0xd8d2c4, {});
  if (str) man.add(str);
  man.add(part(new THREE.CylinderGeometry(0.055, 0.06, 0.3, 8), 0x6f4527, {
    x: -0.16, y: 0.4, z: -0.13, rx: 0.35, outline: false,
  }));
  for (let i = 0; i < 3; i++) {
    man.add(part(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 5), PALETTE.timberLight, {
      x: -0.16 + (i - 1) * 0.035, y: 0.58, z: -0.16, rx: 0.35, outline: false,
    }));
  }
  man.position.set(-0.06, 0.05, -0.08);
  man.scale.setScalar(1.15);
  turret.add(man);
  turret.position.y = platY;

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.42, 0.5, 0);
  turret.add(muzzle);
  g.add(turret);
  g.userData.turret = turret;
  g.userData.muzzle = muzzle;

  /* ---- 塔顶（挂在塔身，不随旋转） ---- */
  const roofH = 0.76 + lv * 0.07;
  const roofY = platY + 1.36;
  const RF = 1.05;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(part(new THREE.BoxGeometry(0.09, 1.3, 0.09), PALETTE.timber, {
      x: Math.cos(a) * 0.82, y: platY + 0.66, z: Math.sin(a) * 0.82, outline: false,
    }));
    const bs = beam([Math.cos(a) * 0.82, platY + 1.02, Math.sin(a) * 0.82],
      [Math.cos(a + Math.PI / 2) * 0.82, platY + 1.3, Math.sin(a + Math.PI / 2) * 0.82], 0.05, PALETTE.timberLight, {});
    if (bs) g.add(bs);
  }
  g.add(part(new THREE.CylinderGeometry(RF * 0.96, RF * 0.96, 0.08, 8), PALETTE.timberDark, {
    y: roofY - 0.04, ry: Math.PI / 8, outline: false,
  }));
  /* 八角锥瓦顶：瓦层数随等级（3+lv → 4/5/6/7/8），每级多一层瓦 */
  const rc = st.roof.color;
  const rc2 = st.roof.trim;
  const nLayer = 3 + lv;
  g.add(part(new THREE.ConeGeometry(RF, roofH, 8), rc, {
    y: roofY + roofH / 2, ry: Math.PI / 8, grad: GRAD_MAIN,
  }));
  for (let i = 0; i < nLayer; i++) {
    const t0 = i / nLayer, t1 = (i + 1) / nLayer;
    g.add(part(new THREE.CylinderGeometry(RF * (1 - t1) * 1.06, RF * (1 - t0) * 1.06, roofH / nLayer * 0.94, 8, 1, true),
      i % 2 ? rc2 : rc, {
        y: roofY + roofH * t0 + roofH / (2 * nLayer), ry: Math.PI / 8, grad: GRAD_MAIN, outline: false,
      }));
  }
  g.add(part(new THREE.CylinderGeometry(RF * 1.04, RF * 1.08, 0.08, 8), rc2, {
    y: roofY + 0.03, ry: Math.PI / 8, outline: false,
  }));
  g.add(part(new THREE.SphereGeometry(0.105, 8, 6), st.roof.gold ? PALETTE.gold : PALETTE.brass, {
    y: roofY + roofH + 0.1,
  }));
  g.add(part(new THREE.ConeGeometry(0.055, 0.26, 5), st.roof.gold ? PALETTE.gold : PALETTE.brass, {
    y: roofY + roofH + 0.32, grad: GRAD_MAIN,
  }));
  // 军旗（旗色按变体取，别再全场一个色）
  const fc = pickR(R0, [PALETTE.shingleA, PALETTE.tileBlue, PALETTE.shingleB, 0x8a4038]);
  const fl = flag(0.9, podH + 0.04, 0.9, fc, 0.95);
  add(g, fl);

  /* ---- 塔下杂物 ---- */
  const rk = new THREE.Group();
  const nA = 2 + lv;
  for (let i = 0; i < nA; i++) {
    rk.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 5), PALETTE.timberLight, {
      x: (i - nA / 2 + 0.5) * 0.09, y: 0.2, outline: false,
    }));
    rk.add(part(new THREE.ConeGeometry(0.05, 0.12, 4), 0xd8d2c4, {
      x: (i - nA / 2 + 0.5) * 0.09, y: 0.44, outline: false,
    }));
  }
  rk.position.set(0.95 + jit(R0, 0.1), 0.02, -0.95);
  rk.rotation.z = 0.3;
  g.add(rk);
  // 火盆
  const br = brazier(0.16, {});
  br.position.set(-1.02, 0.02, 0.9);
  add(g, br);
  if (br.userData.flames) {
    anim(g, br.userData.flames[0], 'flicker', { amp: 0.24, speed: 9 });
    anim(g, br.userData.flames[1], 'flicker', { amp: 0.3, speed: 12 });
  }
  // 盾牌挂饰
  const sh = shield(0.17, PALETTE.shingleB);
  sh.position.set(-0.86, podH + 0.5, -0.5);
  sh.rotation.y = -1.2;
  g.add(sh);
  const bl = barrel(0.14, 0.32, PALETTE.timberDark);
  bl.position.set(-0.95, 0.02, -0.95);
  g.add(bl);
  return g;
}
