/* ============================================================
   models-units.js — 兵种模型
   ------------------------------------------------------------
   兵种在屏幕上只有 25~80px（默认镜头约 25px，拉到最近约 80px）。
   所以「精细度」在这里不是一个面数，而是按性价比排的三件事：

     1) 剪影可辨识 —— 帽子 / 武器 / 体型 / 站姿。25px 时只剩轮廓。
     2) 关节正确   —— 两条腿必须**左右交替**迈（旧版两条腿锁在同一个
                      Group 里一起摆，走起来像钟摆）；手臂反向摆；
                      躯干朝行进方向前倾；头随步伐点。
     3) 同屏不撞脸 —— 每种兵种 3 个确定性变体（身高 / 肩宽 / 布料色调 /
                      装备挂件开关）。旧版同屏 10 个野蛮人是 10 个克隆人。

   细节（铆钉、绑带、护腕、指节、鞋帮、面部结构、布褶、箭羽）刻意全部
   复用「所在岛已有的材质」。在 optimize.js 的合并不变量下：
     · 加三角形 ≈ 免费（只多顶点，不多 draw call）
     · 加材质   = 多一个 draw call
   这条纪律是「又细又快」的全部秘密 —— 所以小件一律 outline:false，
   且颜色只从该兵种的 8 色盘里取。

   骨架约定
     · Group 原点在脚底 y=0，面朝 +Z
     · userData.parts.joints 列出「会独立旋转」的关节，models.js 把它们
       声明成合并的岛根（详见 optimize.js）。名单刻意只保留在 25px 下
       真的看得出来的 6 个：
         legL · legR · torso · armL · armR · head      （hips 属根岛）
     · 膝盖 / 肘部是**静态弯曲**，烘在小腿 / 前臂里：换到更真实的腿型与
       持械姿势，但不多付 draw call。关节预算的取舍写在 README。
     · userData.parts.anchor 存「命名锚点」在某个岛局部空间的坐标
       （手 / 头 / 武器 / 引信）。特效靠它把箭从弓上射出去、把火花打在
       斧刃上，而不是从单位中心冒烟。取用见 troopAnchor()。
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';
import { part, mulberry32 } from './toon.js';
import { chamferGeo, beam } from './shapes.js';

/** 每种兵种的确定性变体数（同屏不撞脸，又不至于把材质表撑爆） */
export const TROOP_VARIANTS = 3;

/* ============================================================
   0. 比例系统
   ============================================================ */
/**
 * 由「总高 H」推导全身比例。
 * 旧版的毛病是 scale / h / legH 三个数字各自手调，四个兵种的头身比、
 * 肩宽、腿长比全是散的，摆一起不像同一种族。现在统一派生。
 */
function metrics(H, o) {
  const headH = H * (o.headRatio || 0.225);
  const legTotal = H * (o.legRatio || 0.40);
  const footH = H * 0.05;
  const torsoH = H * (o.torsoRatio || 0.33);
  const neckL = H * 0.016;
  return {
    H, headH, headR: headH * 0.5,
    legTotal, thighL: legTotal * 0.52, shinL: legTotal * 0.48,
    footH, footL: footH * 2.35, footW: footH * 1.75,
    torsoH, neckL,
    hipY: footH * 0.55 + legTotal,
    hipW: (o.hipW || 0.20) * H,
    shoulderW: (o.shoulderW || 0.44) * H,
    chestW: (o.chestW || 0.30) * H,
    chestD: (o.chestD || 0.21) * H,
    upperL: torsoH * 0.54,
    foreL: torsoH * 0.46,
    handR: H * 0.032,
    neckY: torsoH * 0.985,
  };
}

/* ============================================================
   1. 通用零件
   ============================================================ */

/** 铆钉 / 钉头：不描边不投影，纯粹给金属件加「做工」 */
function nail(parent, x, y, z, r, color, opt = {}) {
  parent.add(part(new THREE.CylinderGeometry(r, r, r * 1.6, 6), color, {
    x, y, z,
    rx: opt.rx === undefined ? Math.PI / 2 : opt.rx,
    rz: opt.rz, ry: opt.ry,
    outline: false, shadow: false,
  }));
}

/** 一排铆钉 */
function nailRow(parent, x0, x1, y, z, n, r, color) {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    nail(parent, x0 + (x1 - x0) * t, y, z, r, color);
  }
}

/** 带扣：金属框 + 中间一根针 */
function buckle(parent, x, y, z, w, h, colorA, colorB) {
  parent.add(part(chamferGeo(w, h, w * 0.34, { bevel: w * 0.12 }), colorA, {
    x, y, z, outline: false, shadow: false,
  }));
  parent.add(part(new THREE.BoxGeometry(w * 0.1, h * 0.62, w * 0.4), colorB, {
    x, y, z, outline: false, shadow: false,
  }));
}

/**
 * 手掌 + 三指 + 拇指。
 * 本轮最典型的「细节但几乎免费」项：4 个盒子约 48 个三角形，
 * 只多顶点不多 draw call，而握拳 / 搭弦 / 托炸弹的剪影立刻从「一个球」
 * 变成「一只手」。
 */
function hand(parent, x, y, z, size, skin, opt = {}) {
  const curl = opt.curl === undefined ? 0.5 : opt.curl;
  const g = new THREE.Group();
  g.name = opt.name || 'hand';               // 自检按 handL / handR 找这只手
  g.position.set(x, y, z);
  if (opt.rx) g.rotation.x = opt.rx;
  parent.add(g);

  g.add(part(chamferGeo(size * 1.05, size * 1.15, size * 0.74, { bevel: size * 0.2 }), skin, {
    y: -size * 0.1, outline: false,
  }));
  const fL = size * (1.0 - curl * 0.5);
  for (let i = -1; i <= 1; i++) {
    g.add(part(new THREE.BoxGeometry(size * 0.27, fL, size * 0.3), skin, {
      x: i * size * 0.31, y: -size * 0.62 - fL * 0.5, z: curl * size * 0.34,
      rx: curl * 1.3, outline: false, shadow: false,
    }));
  }
  g.add(part(new THREE.BoxGeometry(size * 0.27, size * 0.72, size * 0.28), skin, {
    x: size * 0.54 * (opt.mirror ? -1 : 1), y: -size * 0.44, z: size * 0.2,
    rz: (opt.mirror ? 1 : -1) * 0.5, rx: curl * 0.6,
    outline: false, shadow: false,
  }));
  return g;
}

/** 靴子：鞋底 + 鞋面 + 鞋头包铁 + 脚踝束带 */
function boot(parent, M, C) {
  const w = M.footW, l = M.footL, h = M.footH, z = l * 0.16;
  parent.add(part(chamferGeo(w * 1.02, h * 0.34, l, { bevel: h * 0.13, corner: h * 0.24 }),
    C.leatherDark, { y: h * 0.17, z, outline: false }));
  parent.add(part(chamferGeo(w * 0.94, h * 0.9, l * 0.82, { bevel: w * 0.16, corner: w * 0.14 }),
    C.leather, { y: h * 0.62, z: z - l * 0.06, outline: false }));
  parent.add(part(chamferGeo(w * 0.86, h * 0.54, l * 0.26, { bevel: w * 0.12, corner: w * 0.12 }),
    C.metalDark, { y: h * 0.46, z: z + l * 0.34, outline: false, shadow: false }));
  parent.add(part(new THREE.BoxGeometry(w * 0.98, h * 0.16, l * 0.5), C.leatherDark, {
    y: h * 1.0, z: z - l * 0.12, outline: false, shadow: false,
  }));
  nailRow(parent, -w * 0.3, w * 0.3, h * 0.46, z + l * 0.48, 2, h * 0.075, C.metal);
}

/** 腰带 + 带扣 + 侧挂小包 */
function belt(parent, y, M, C, opt = {}) {
  const w = M.chestW * 1.06, d = M.chestD * 1.08;
  parent.add(part(chamferGeo(w, M.H * 0.044, d, { bevel: M.H * 0.012 }), C.leather, {
    y, outline: false,
  }));
  buckle(parent, 0, y, d * 0.52, M.H * 0.05, M.H * 0.042, C.metal, C.metalDark);
  if (opt.pouch !== false) {
    const k = opt.pouchSide || 1;
    parent.add(part(chamferGeo(w * 0.3, M.H * 0.075, d * 0.42, { bevel: M.H * 0.012, corner: M.H * 0.01 }),
      C.leatherDark, { x: w * 0.44 * k, y: y - M.H * 0.032, z: d * 0.18, outline: false, shadow: false }));
    nail(parent, w * 0.44 * k, y - M.H * 0.032, d * 0.42, M.H * 0.008, C.metal);
  }
}

/* ============================================================
   2. 骨架
   ============================================================ */
/**
 * @param {THREE.Group} g 模型根
 * @param {object} o 体型 + 色盘 + 基准姿势
 * @returns {object} parts
 */
function skeleton(g, o) {
  const M = metrics(o.H, o);
  const C = o.C;

  /* ---------- 髋（归入根岛，本身不单独动画） ---------- */
  const hips = new THREE.Group();
  hips.name = 'hips';
  hips.position.y = M.hipY;
  g.add(hips);
  hips.add(part(chamferGeo(M.chestW * 0.94, M.torsoH * 0.24, M.chestD * 0.94,
    { bevel: M.H * 0.02, corner: M.H * 0.02 }), o.pelvisColor || C.cloth, {
    y: M.torsoH * 0.06, outline: false,
  }));

  /* ---------- 腿：髋摆动 + 静态屈膝 ---------- */
  const legL = new THREE.Group(); legL.name = 'legL';
  const legR = new THREE.Group(); legR.name = 'legR';
  const elbows = {}, hands = {};
  for (const [leg, k, tag] of [[legL, -1, 'L'], [legR, 1, 'R']]) {
    leg.position.set(k * M.hipW * 0.5, 0, 0);
    hips.add(leg);

    leg.add(part(new THREE.CylinderGeometry(M.H * 0.052, M.H * 0.063, M.thighL, 8),
      o.legColor || C.clothDark, { y: -M.thighL * 0.5, outline: false }));
    leg.add(part(chamferGeo(M.H * 0.118, M.H * 0.08, M.H * 0.104,
      { bevel: M.H * 0.012, corner: M.H * 0.012 }), C.leather, {
      y: -M.thighL * 0.14, z: M.H * 0.012, outline: false, shadow: false,
    }));

    const kneeBend = o.kneeBend === undefined ? 0.13 : o.kneeBend;
    const knee = new THREE.Group();
    knee.name = 'knee' + tag;
    knee.position.y = -M.thighL;
    knee.rotation.x = kneeBend;                 // 静态屈膝
    leg.add(knee);

    knee.add(part(new THREE.CylinderGeometry(M.H * 0.046, M.H * 0.051, M.shinL, 8),
      o.legColor || C.clothDark, { y: -M.shinL * 0.5, outline: false }));
    knee.add(part(chamferGeo(M.H * 0.096, M.shinL * 0.64, M.H * 0.088,
      { bevel: M.H * 0.014, corner: M.H * 0.012 }), o.greaveColor || C.leatherDark, {
      y: -M.shinL * 0.56, z: M.H * 0.01, outline: false,
    }));
    // 膝盖护片
    knee.add(part(new THREE.SphereGeometry(M.H * 0.032, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.6),
      o.greaveColor || C.leatherDark, { y: -M.H * 0.004, z: M.H * 0.03, outline: false, shadow: false }));
    if (o.greaveNails !== false) {
      nailRow(knee, -M.H * 0.024, M.H * 0.024, -M.shinL * 0.52, M.H * 0.056, 2, M.H * 0.006, C.metal);
    }

    const foot = new THREE.Group();
    foot.name = 'foot' + tag;
    foot.position.y = -M.shinL;
    foot.rotation.x = -kneeBend;                // 脚掌回正，踩实地面
    knee.add(foot);
    boot(foot, M, C);
  }

  /* ---------- 躯干 ---------- */
  const torso = new THREE.Group();
  torso.name = 'torso';
  hips.add(torso);

  // 收腰（有腰线才不像一个方块）
  torso.add(part(chamferGeo(M.chestW * 0.9, M.torsoH * 0.44, M.chestD * 0.9,
    { bevel: M.H * 0.02, corner: M.H * 0.02 }), o.waistColor || C.cloth, {
    y: M.torsoH * 0.2, outline: false,
  }));
  torso.add(part(chamferGeo(M.chestW, M.torsoH * 0.52, M.chestD,
    { bevel: M.H * 0.026, corner: M.H * 0.025 }), C.cloth, {
    y: M.torsoH * 0.6, outline: false,
  }));
  torso.add(part(new THREE.CylinderGeometry(M.H * 0.052, M.H * 0.074, M.H * 0.032, 8),
    o.collarColor || C.clothDark, { y: M.neckY, outline: false, shadow: false }));
  belt(torso, M.torsoH * 0.3, M, C, { pouch: o.beltPouch, pouchSide: o.pouchSide });

  /* ---------- 手臂：肩摆动 + 静态屈肘 ---------- */
  const armL = new THREE.Group(); armL.name = 'armL';
  const armR = new THREE.Group(); armR.name = 'armR';
  for (const [arm, k, tag] of [[armL, -1, 'L'], [armR, 1, 'R']]) {
    arm.position.set(k * M.shoulderW * 0.5, M.torsoH * 0.82, 0);
    torso.add(arm);

    arm.add(part(new THREE.CylinderGeometry(M.H * 0.038, M.H * 0.043, M.upperL, 7),
      o.sleeveColor || C.cloth, { y: -M.upperL * 0.5, outline: false }));
    if (o.pauldron !== false) {
      arm.add(part(new THREE.SphereGeometry(M.H * 0.064, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.58),
        o.pauldronColor || C.metal, { y: M.H * 0.014, outline: false }));
      arm.add(part(new THREE.BoxGeometry(M.H * 0.105, M.H * 0.014, M.H * 0.092),
        o.pauldronColor || C.metal, { y: -M.H * 0.03, outline: false, shadow: false }));
      nail(arm, 0, -M.H * 0.032, M.H * 0.052, M.H * 0.006, C.metalDark);
    }

    const elbow = new THREE.Group();
    elbow.name = 'elbow' + tag;
    elbow.position.y = -M.upperL;
    elbow.rotation.x = o.elbowBend === undefined ? -0.3 : o.elbowBend;
    arm.add(elbow);
    elbows[tag] = elbow;

    elbow.add(part(new THREE.CylinderGeometry(M.H * 0.032, M.H * 0.039, M.foreL, 7),
      o.sleeveColor || C.cloth, { y: -M.foreL * 0.5, outline: false }));
    elbow.add(part(new THREE.CylinderGeometry(M.H * 0.046, M.H * 0.042, M.H * 0.05, 8),
      o.bracerColor || C.leatherDark, { y: -M.foreL * 0.8, outline: false }));
    if (o.bracerNails !== false) {
      nail(elbow, 0, -M.foreL * 0.8, M.H * 0.046, M.H * 0.007, C.metal);
    }
    hands[tag] = hand(elbow, 0, -M.foreL - M.handR * 0.4, 0, M.handR,
      o.handColor || C.skin, {
        curl: o.handCurl === undefined ? 0.45 : o.handCurl,
        mirror: k > 0,
        name: 'hand' + tag,
      });
  }

  /* ---------- 头 ---------- */
  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = M.neckY;
  torso.add(head);

  head.add(part(new THREE.CylinderGeometry(M.H * 0.042, M.H * 0.05, M.H * 0.046, 7),
    o.neckColor || C.skinDark, { y: M.H * 0.014, outline: false }));

  if (o.face !== false) {
    head.add(part(new THREE.SphereGeometry(M.headR, 12, 9), C.skin, {
      y: M.neckL + M.headR * 0.94, sy: 1.08, outline: true,
    }));
    // 下颌（单靠球体像灯泡）
    head.add(part(chamferGeo(M.headR * 1.34, M.headR * 0.64, M.headR * 1.2,
      { bevel: M.headR * 0.22, corner: M.headR * 0.2 }), C.skin, {
      y: M.neckL + M.headR * 0.6, z: M.headR * 0.14, outline: false,
    }));
    // 鼻
    head.add(part(new THREE.ConeGeometry(M.headR * 0.16, M.headR * 0.3, 5), C.skinDark, {
      y: M.neckL + M.headR * 0.84, z: M.headR * 0.98, rx: Math.PI * 0.5,
      outline: false, shadow: false,
    }));
    // 眉骨
    for (const k of [-1, 1]) {
      head.add(part(new THREE.BoxGeometry(M.headR * 0.44, M.headR * 0.13, M.headR * 0.16),
        o.browColor || C.skinDark, {
          x: k * M.headR * 0.33, y: M.neckL + M.headR * 1.08, z: M.headR * 0.86,
          rz: k * 0.18, outline: false, shadow: false,
        }));
    }
    // 眼白 + 瞳
    for (const k of [-1, 1]) {
      head.add(part(new THREE.SphereGeometry(M.headR * 0.195, 7, 5), 0xf6f2ea, {
        x: k * M.headR * 0.34, y: M.neckL + M.headR * 0.97, z: M.headR * 0.8,
        sz: 0.6, outline: false, shadow: false,
      }));
      head.add(part(new THREE.SphereGeometry(M.headR * 0.1, 6, 5), 0x241c2b, {
        x: k * M.headR * 0.34, y: M.neckL + M.headR * 0.97, z: M.headR * 0.94,
        outline: false, shadow: false,
      }));
    }
  }
  // 耳（所有人都有）
  for (const k of [-1, 1]) {
    head.add(part(new THREE.SphereGeometry(M.headR * 0.2, 6, 5), C.skin, {
      x: k * M.headR * 0.94, y: M.neckL + M.headR * 0.9, sy: 1.35,
      outline: false, shadow: false,
    }));
  }

  return {
    hips, torso, head, legL, legR, armL, armR,
    elbows, hands, M, C, anchor: [],
    /** 只有这 6 个是「合并时要切开的岛根」—— 关节预算见 README */
    joints: { legL, legR, torso, armL, armR, head },
  };
}

/** 记录命名锚点：坐标存在 island 的局部空间里，随动画一起走 */
function anchor(P, name, island, obj) {
  obj.updateWorldMatrix(true, false);
  island.updateWorldMatrix(true, false);
  const p = new THREE.Vector3();
  obj.getWorldPosition(p);
  island.worldToLocal(p);
  P.anchor.push({ name, island, v: p });
}

/** 收尾：捕获基准姿势（动画只叠加，不覆盖造型） */
function finish(P, g) {
  const J = P.joints;
  P.base = {
    legL: J.legL.rotation.x, legR: J.legR.rotation.x,
    armL: J.armL.rotation.x, armR: J.armR.rotation.x,
    armLz: J.armL.rotation.z, armRz: J.armR.rotation.z,
    torsoX: J.torso.rotation.x, torsoY: J.torso.rotation.y, torsoZ: J.torso.rotation.z,
    headX: J.head.rotation.x, headY: J.head.rotation.y,
  };
  g.userData.parts = P;
  return P;
}

/* ============================================================
   3. 四个兵种
   ============================================================ */
const BARB_TUNIC = [0xc8672f, 0xa8552a, 0xd07a3a];
const ARCH_CLOTH = [0x4d7a3c, 0x3d6a4a, 0x5a7a34];
const GIANT_TUNIC = [0x8a4a36, 0x7a5540, 0x6f4636];

/** 取第 v 号变体的色 */
const pick = (arr, v) => arr[Math.min(arr.length - 1, Math.floor(v * arr.length))];

/* ---------------- 野蛮人：角盔 + 三层胡子 + 双刃大斧 ---------------- */
export function barbarian(g, R) {
  const v = R();                                  // 变体编号（确定性）
  const hv = R();                                 // 身高
  const H = 0.96 * (0.94 + hv * 0.12);
  const C = {
    skin: 0xf0b183, skinDark: 0xcf8f60, hair: 0xe8c97a, hairDark: 0xc9a75b,
    cloth: pick(BARB_TUNIC, v), clothDark: 0x9a4a20,
    leather: 0x7a4a22, leatherDark: 0x54331a,
    metal: 0x9aa3ad, metalDark: 0x5c646e, ink: 0x241c2b,
  };
  const P = skeleton(g, {
    H, C,
    headRatio: 0.228, legRatio: 0.395, torsoRatio: 0.335,
    hipW: 0.205, shoulderW: 0.44 + R() * 0.06, chestW: 0.315, chestD: 0.215,
    kneeBend: 0.11 + R() * 0.06, elbowBend: -1.42, handCurl: 0.8,
    pauldronColor: C.metal, greaveColor: C.leatherDark,
  });
  const { torso, head, armL, armR, elbows } = P;
  const M = P.M;

  /* 胸口：皮甲 + 铁胸片 + 铆钉 + 斜挎带 */
  torso.add(part(chamferGeo(M.chestW * 1.08, M.torsoH * 0.52, M.chestD * 1.1,
    { bevel: M.H * 0.026, corner: M.H * 0.028 }), C.leather, {
    y: M.torsoH * 0.58, outline: true,
  }));
  torso.add(part(chamferGeo(M.chestW * 0.6, M.torsoH * 0.3, M.H * 0.022,
    { bevel: M.H * 0.01, corner: M.H * 0.012 }), C.metal, {
    y: M.torsoH * 0.62, z: M.chestD * 0.57, outline: false,
  }));
  nailRow(torso, -M.chestW * 0.2, M.chestW * 0.2, M.torsoH * 0.62, M.chestD * 0.6,
    2, M.H * 0.008, C.metalDark);
  torso.add(part(chamferGeo(M.chestW * 0.32, M.torsoH * 0.15, M.H * 0.018,
    { bevel: M.H * 0.008 }), C.metal, {
    y: M.torsoH * 0.36, z: M.chestD * 0.56, outline: false, shadow: false,
  }));
  const st = beam([-M.chestW * 0.44, M.torsoH * 1.02, M.chestD * 0.4],
    [M.chestW * 0.38, M.torsoH * 0.22, M.chestD * 0.5], M.H * 0.034, C.leatherDark, {});
  if (st) torso.add(st);

  /* 头：三层胡子 + 角盔 */
  head.add(part(new THREE.SphereGeometry(M.headR * 0.84, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    C.hair, { y: M.neckL + M.headR * 0.62, z: M.headR * 0.2, outline: false }));
  head.add(part(new THREE.ConeGeometry(M.headR * 0.74, M.headR * 1.3, 7), C.hair, {
    y: M.neckL + M.headR * 0.2, z: M.headR * 0.42, rx: Math.PI * 0.93, outline: false,
  }));
  head.add(part(chamferGeo(M.headR * 1.04, M.headR * 0.54, M.headR * 0.74,
    { bevel: M.headR * 0.16 }), C.hairDark, {
    y: M.neckL + M.headR * 0.4, z: M.headR * 0.52, outline: false, shadow: false,
  }));
  head.add(part(new THREE.CylinderGeometry(M.H * 0.018, M.H * 0.027, M.H * 0.095, 6), C.hair, {
    y: M.neckL + M.headR * 0.74, z: -M.headR * 0.86, rx: 0.75, outline: false, shadow: false,
  }));

  head.add(part(new THREE.SphereGeometry(M.headR * 1.09, 11, 8, 0, Math.PI * 2, 0, Math.PI * 0.56),
    C.metal, { y: M.neckL + M.headR * 1.0, outline: true }));
  head.add(part(new THREE.CylinderGeometry(M.headR * 1.14, M.headR * 1.17, M.H * 0.026, 11),
    C.metalDark, { y: M.neckL + M.headR * 1.02, outline: false }));
  head.add(part(chamferGeo(M.H * 0.018, M.H * 0.03, M.headR * 1.5, { bevel: M.H * 0.006 }),
    C.metalDark, { y: M.neckL + M.headR * 1.34, outline: false, shadow: false }));
  head.add(part(chamferGeo(M.H * 0.028, M.H * 0.066, M.H * 0.022, { bevel: M.H * 0.006 }),
    C.metalDark, { y: M.neckL + M.headR * 0.84, z: M.headR * 1.06, outline: false, shadow: false }));
  for (const k of [-1, 1]) {
    head.add(part(new THREE.ConeGeometry(M.H * 0.027, M.H * 0.12, 6), 0xe8dcc0, {
      x: k * M.headR * 1.06, y: M.neckL + M.headR * 1.22, rz: k * -0.55,
      outline: false, shadow: false,
    }));
    head.add(part(new THREE.CylinderGeometry(M.H * 0.014, M.H * 0.019, M.H * 0.024, 6),
      C.metalDark, {
        x: k * M.headR * 0.96, y: M.neckL + M.headR * 1.14, rz: k * -0.55,
        outline: false, shadow: false,
      }));
  }

  /* 变体：左手圆盾（一眼看出同屏不是克隆人） */
  if (v > 0.33) {
    const sh = new THREE.Group();
    sh.add(part(new THREE.CylinderGeometry(M.H * 0.118, M.H * 0.1, M.H * 0.032, 12), C.leather, {
      rz: Math.PI / 2, outline: true,
    }));
    sh.add(part(new THREE.TorusGeometry(M.H * 0.115, M.H * 0.012, 4, 14), C.metalDark, {
      rz: Math.PI / 2, outline: false, shadow: false,
    }));
    sh.add(part(new THREE.SphereGeometry(M.H * 0.025, 7, 5), C.metal, { outline: false, shadow: false }));
    nailRow(sh, -M.H * 0.06, M.H * 0.06, M.H * 0.018, M.H * 0.05, 3, M.H * 0.007, C.metal);
    sh.position.set(-M.H * 0.035, -M.H * 0.13, M.H * 0.025);
    sh.rotation.y = 0.25;
    armL.add(sh);
    anchor(P, 'shield', P.armL, sh);
  }
  armL.rotation.set(0.2, 0, -0.24);
  armR.rotation.set(-0.55, 0, 0.3);

  /* 右手：双刃大斧，挂在屈肘后的前臂上 */
  const ax = new THREE.Group();
  const shaftL = M.H * 0.54;
  ax.add(part(new THREE.CylinderGeometry(M.H * 0.019, M.H * 0.023, shaftL, 7), 0x6b4a2a, {
    y: shaftL * 0.08, outline: true,
  }));
  for (let i = 0; i < 5; i++) {
    ax.add(part(new THREE.TorusGeometry(M.H * 0.025, M.H * 0.006, 4, 10), 0x8a6a42, {
      y: -shaftL * 0.28 + i * M.H * 0.031, rx: Math.PI / 2, outline: false, shadow: false,
    }));
  }
  const blade = (sx) => chamferGeo(M.H * 0.185, M.H * 0.15, M.H * 0.028,
    { bevel: M.H * 0.012, corner: M.H * 0.05 });
  ax.add(part(blade(1), C.metal, {
    x: M.H * 0.058, y: shaftL * 0.34, rz: -0.05, outline: true,
  }));
  ax.add(part(blade(-1), C.metal, {
    x: -M.H * 0.058, y: shaftL * 0.34, rz: 0.05, outline: true,
  }));
  for (const k of [-1, 1]) {
    ax.add(part(new THREE.BoxGeometry(M.H * 0.009, M.H * 0.155, M.H * 0.02), 0xe6ecf2, {
      x: k * M.H * 0.15, y: shaftL * 0.34, outline: false, shadow: false,
    }));
  }
  ax.add(part(chamferGeo(M.H * 0.072, M.H * 0.125, M.H * 0.046, { bevel: M.H * 0.01 }),
    C.metalDark, { y: shaftL * 0.34, outline: false }));
  ax.add(part(new THREE.TorusGeometry(M.H * 0.024, M.H * 0.007, 4, 10), 0xc8a24a, {
    y: shaftL * 0.26, rx: Math.PI / 2, outline: false, shadow: false,
  }));
  ax.position.set(M.H * 0.03, 0, M.H * 0.03);
  ax.rotation.set(0.12, 0.12, 0.42);
  elbows.R.add(ax);

  anchor(P, 'weapon', P.armR, ax);
  anchor(P, 'handL', P.armL, P.hands.L);
  anchor(P, 'handR', P.armR, P.hands.R);
  anchor(P, 'head', P.torso, head);
  anchor(P, 'chest', P.torso, P.hands.R);      // 兜底：胸口 = 右前臂根部
  return finish(P, g);
}

/* ---------------- 弓箭手：兜帽 + 披风 + 反曲弓 ---------------- */
export function archer(g, R) {
  const v = R();
  const H = 0.94 * (0.95 + R() * 0.1);
  const C = {
    skin: 0xf7cfa8, skinDark: 0xd9a87c, hair: 0x8a5a34,
    cloth: pick(ARCH_CLOTH, v), clothDark: 0x35592a,
    leather: 0x6f4527, leatherDark: 0x4a2d18,
    metal: 0x8a939c, metalDark: 0x4e545c, ink: 0x241c2b,
  };
  const P = skeleton(g, {
    H, C,
    headRatio: 0.222, legRatio: 0.425, torsoRatio: 0.315,
    hipW: 0.185, shoulderW: 0.395, chestW: 0.275, chestD: 0.185,
    kneeBend: 0.1, elbowBend: -0.62, handCurl: 0.35,
    pauldron: false, greaveColor: C.leatherDark, greaveNails: false,
    legColor: C.clothDark, bracerColor: C.leather,
  });
  const { torso, head, armL, armR, elbows } = P;
  const M = P.M;

  /* 皮甲背心 + 肩带 + 铆钉 */
  torso.add(part(chamferGeo(M.chestW * 1.1, M.torsoH * 0.56, M.chestD * 1.12,
    { bevel: M.H * 0.024, corner: M.H * 0.026 }), C.leather, {
    y: M.torsoH * 0.58, outline: true,
  }));
  const st = beam([-M.chestW * 0.42, M.torsoH * 1.0, M.chestD * 0.5],
    [M.chestW * 0.36, M.torsoH * 0.24, M.chestD * 0.56], M.H * 0.03, C.leatherDark, {});
  if (st) torso.add(st);
  nailRow(torso, -M.chestW * 0.3, M.chestW * 0.3, M.torsoH * 0.5, M.chestD * 0.58, 2, M.H * 0.007, C.metal);

  /* 兜帽：外层 + 内衬阴影 + 前沿圈 + 后飘带 */
  head.add(part(new THREE.SphereGeometry(M.headR * 1.15, 11, 8, 0, Math.PI * 2, 0, Math.PI * 0.62),
    C.cloth, { y: M.neckL + M.headR * 0.96, outline: true }));
  head.add(part(new THREE.ConeGeometry(M.headR * 1.17, M.headR * 1.9, 9), C.cloth, {
    y: M.neckL + M.headR * 1.6, outline: true,
  }));
  head.add(part(new THREE.ConeGeometry(M.headR * 0.4, M.headR * 1.5, 5), C.clothDark, {
    y: M.neckL + M.headR * 1.55, z: -M.headR * 0.9, rx: -0.85, outline: false, shadow: false,
  }));
  head.add(part(new THREE.TorusGeometry(M.headR * 1.12, M.headR * 0.17, 4, 14), C.clothDark, {
    y: M.neckL + M.headR * 0.98, rx: Math.PI / 2, outline: false, shadow: false,
  }));
  // 兜帽内的阴影：把脸「压」进帽子里
  head.add(part(new THREE.SphereGeometry(M.headR * 0.76, 9, 7), 0x2a2318, {
    y: M.neckL + M.headR * 0.96, z: M.headR * 0.12, sz: 0.92, outline: false, shadow: false,
  }));
  // 眼（放在阴影球前面，否则会被吃掉）
  for (const k of [-1, 1]) {
    head.add(part(new THREE.SphereGeometry(M.headR * 0.105, 6, 5), 0x241c2b, {
      x: k * M.headR * 0.32, y: M.neckL + M.headR * 1.0, z: M.headR * 0.87,
      outline: false, shadow: false,
    }));
  }
  if (v > 0.4) {                                  // 变体：兜帽羽饰
    head.add(part(new THREE.ConeGeometry(M.H * 0.02, M.H * 0.1, 5), 0xd8d2c4, {
      y: M.neckL + M.headR * 1.5, z: M.headR * 0.68, rx: -0.5, outline: false, shadow: false,
    }));
  }

  /* 披风：主体 + 下摆暗色内衬（两层才像布） */
  const cape = part(chamferGeo(M.chestW * 1.24, M.torsoH * 1.08, M.H * 0.024,
    { bevel: M.H * 0.012, corner: M.H * 0.03 }), C.cloth, {
    y: M.torsoH * 0.46, z: -M.chestD * 0.64, outline: true,
  });
  torso.add(cape);
  torso.add(part(chamferGeo(M.chestW * 0.92, M.torsoH * 0.52, M.H * 0.02,
    { bevel: M.H * 0.01 }), C.clothDark, {
    y: M.torsoH * 0.22, z: -M.chestD * 0.68, outline: false, shadow: false,
  }));
  nail(torso, -M.chestW * 0.36, M.torsoH * 1.0, M.chestD * 0.4, M.H * 0.011, C.metal);
  P.cape = cape;

  /* 箭袋：筒 + 双箍 + 6 支箭（箭杆 + 双羽） */
  const qv = new THREE.Group();
  const qh = M.H * 0.28;
  qv.add(part(new THREE.CylinderGeometry(M.H * 0.043, M.H * 0.047, qh, 9), C.leather, { outline: true }));
  for (const yy of [qh * 0.3, -qh * 0.3]) {
    qv.add(part(new THREE.TorusGeometry(M.H * 0.047, M.H * 0.008, 4, 10), C.leatherDark, {
      y: yy, rx: Math.PI / 2, outline: false, shadow: false,
    }));
  }
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05;
    const px = Math.cos(a) * M.H * 0.022, pz = Math.sin(a) * M.H * 0.022;
    qv.add(part(new THREE.CylinderGeometry(M.H * 0.005, M.H * 0.005, M.H * 0.19, 4), 0xc8a878, {
      x: px, y: qh * 0.54, z: pz, outline: false, shadow: false,
    }));
    for (let f = 0; f < 2; f++) {
      qv.add(part(new THREE.BoxGeometry(M.H * 0.012, M.H * 0.046, M.H * 0.004), 0xe6e0d0, {
        x: px, y: qh * 0.64, z: pz, ry: f * Math.PI * 0.5, outline: false, shadow: false,
      }));
    }
  }
  qv.position.set(M.chestW * 0.32, M.torsoH * 0.52, -M.chestD * 0.74);
  qv.rotation.set(0.32, 0, -0.34);
  torso.add(qv);
  anchor(P, 'quiver', P.torso, qv);

  /* 反曲弓：主臂 + 上下反曲梢 + 握把 + 弓弦 */
  const bow = new THREE.Group();
  bow.add(part(new THREE.TorusGeometry(M.H * 0.16, M.H * 0.014, 5, 16, Math.PI * 1.15),
    0x6b4a2a, { rz: 0.4, outline: true }));
  for (const k of [-1, 1]) {
    bow.add(part(new THREE.CylinderGeometry(M.H * 0.011, M.H * 0.014, M.H * 0.078, 6), 0x8a6a42, {
      y: k * M.H * 0.163, z: -k * M.H * 0.014, rz: k * 0.5, outline: false, shadow: false,
    }));
  }
  bow.add(part(new THREE.CylinderGeometry(M.H * 0.017, M.H * 0.02, M.H * 0.078, 7), C.leatherDark, {
    outline: false,
  }));
  const bs = beam([M.H * 0.006, M.H * 0.19, 0], [M.H * 0.006, -M.H * 0.19, 0], M.H * 0.006, 0xe8e2d4, {});
  if (bs) bow.add(bs);
  bow.position.set(-M.H * 0.035, -M.H * 0.02, M.H * 0.055);
  bow.rotation.set(0, 0.16, 0.44);
  elbows.L.add(bow);
  armL.rotation.set(-1.0, 0, -0.2);
  armR.rotation.set(-0.9, 0, 0.34);

  anchor(P, 'weapon', P.armL, bow);
  anchor(P, 'handL', P.armL, P.hands.L);
  anchor(P, 'handR', P.armR, P.hands.R);
  anchor(P, 'head', P.torso, head);
  return finish(P, g);
}

/* ---------------- 巨人：大肚皮 + 铁护腕 + 尖牙 + 巨拳 ---------------- */
export function giant(g, R) {
  const v = R();
  const H = 1.44 * (0.95 + R() * 0.1);
  const C = {
    skin: 0xe0a878, skinDark: 0xc0844f, belly: 0xf0cca4, hair: 0x3a2a1e,
    cloth: pick(GIANT_TUNIC, v), clothDark: 0x6a3626,
    leather: 0x8a5a3a, leatherDark: 0x5e3c26,
    metal: 0x99a1aa, metalDark: 0x555c64, ink: 0x241c2b,
  };
  const P = skeleton(g, {
    H, C,
    headRatio: 0.20, legRatio: 0.365, torsoRatio: 0.375,
    hipW: 0.215, shoulderW: 0.5, chestW: 0.375, chestD: 0.28,
    kneeBend: 0.14, elbowBend: -0.4, handCurl: 0.72,
    pelvisColor: C.leather, waistColor: C.skin, pauldron: false,
    greaveColor: C.leather, bracerColor: C.metal, handColor: C.skinDark,
    legColor: C.skinDark, legBare: true,
  });
  const { torso, head, armL, armR, elbows } = P;
  const M = P.M;

  /* 大肚皮 + 胸肌 + 斜挎带 + 腰布皮条 */
  torso.add(part(new THREE.SphereGeometry(M.chestW * 0.5, 13, 10), C.belly, {
    y: M.torsoH * 0.44, z: M.chestD * 0.22, sx: 0.95, sy: 0.92, outline: true,
  }));
  for (const k of [-1, 1]) {
    torso.add(part(new THREE.SphereGeometry(M.chestW * 0.29, 10, 8), C.skinDark, {
      x: k * M.chestW * 0.23, y: M.torsoH * 0.76, z: M.chestD * 0.42,
      sy: 0.82, outline: false,
    }));
  }
  const st = beam([-M.chestW * 0.5, M.torsoH * 0.98, M.chestD * 0.3],
    [M.chestW * 0.46, M.torsoH * 0.18, M.chestD * 0.34], M.H * 0.052, C.leatherDark, {});
  if (st) torso.add(st);
  for (let i = -2; i <= 2; i++) {
    torso.add(part(chamferGeo(M.chestW * 0.19, M.torsoH * 0.26, M.H * 0.022,
      { bevel: M.H * 0.008, corner: M.H * 0.012 }), C.leather, {
      x: i * M.chestW * 0.19, y: M.torsoH * 0.04, z: M.chestD * 0.52,
      rz: i * 0.05, outline: false, shadow: false,
    }));
  }

  /* 头：眉骨 + 尖牙 + 头顶小辫 + 耳环 + 变体战纹 */
  head.add(part(new THREE.BoxGeometry(M.headR * 1.5, M.H * 0.017, M.H * 0.028), C.skinDark, {
    y: M.neckL + M.headR * 1.12, z: M.headR * 0.86, outline: false, shadow: false,
  }));
  for (const k of [-1, 1]) {
    head.add(part(new THREE.ConeGeometry(M.H * 0.014, M.H * 0.042, 4), 0xfdfbf5, {
      x: k * M.headR * 0.34, y: M.neckL + M.headR * 0.5, z: M.headR * 0.8,
      rz: Math.PI, outline: false, shadow: false,
    }));
  }
  head.add(part(new THREE.CylinderGeometry(M.H * 0.015, M.H * 0.022, M.H * 0.078, 6), C.hair, {
    y: M.neckL + M.headR * 1.42, z: -M.headR * 0.36, rx: 0.55, outline: false, shadow: false,
  }));
  head.add(part(new THREE.TorusGeometry(M.headR * 0.17, M.H * 0.007, 4, 9), 0xc8a24a, {
    x: M.headR * 1.0, y: M.neckL + M.headR * 0.66, ry: Math.PI / 2, outline: false, shadow: false,
  }));
  if (v > 0.45) {
    for (const k of [-1, 1]) {
      head.add(part(new THREE.BoxGeometry(M.H * 0.013, M.H * 0.052, M.H * 0.006), 0xb8442e, {
        x: k * M.headR * 0.6, y: M.neckL + M.headR * 0.9, z: M.headR * 0.72,
        rz: k * 0.3, outline: false, shadow: false,
      }));
    }
  }

  /* 巨拳：大球 + 指节鼓包 + 指节护铁。巨人靠「拳头剪影」立人设。 */
  for (const [tag, arm] of [['L', armL], ['R', armR]]) {
    const elbow = elbows[tag];
    elbow.add(part(new THREE.SphereGeometry(M.H * 0.074, 10, 8), C.skinDark, {
      y: -M.foreL - M.H * 0.018, sy: 1.08, outline: true,
    }));
    for (let k = -1; k <= 1; k++) {
      elbow.add(part(new THREE.SphereGeometry(M.H * 0.025, 6, 5), C.skin, {
        x: k * M.H * 0.035, y: -M.foreL - M.H * 0.052, z: M.H * 0.028,
        outline: false, shadow: false,
      }));
      elbow.add(part(new THREE.BoxGeometry(M.H * 0.027, M.H * 0.02, M.H * 0.018), C.metal, {
        x: k * M.H * 0.035, y: -M.foreL - M.H * 0.064, z: M.H * 0.028,
        outline: false, shadow: false,
      }));
    }
    // 护腕铆钉（骨架里已给护腕，这里再加一圈）
    nail(elbow, 0, -M.foreL * 0.62, M.H * 0.046, M.H * 0.007, C.metalDark);
  }
  armL.rotation.set(0.12, 0, -0.32);
  armR.rotation.set(0.12, 0, 0.32);

  anchor(P, 'handL', P.armL, P.hands.L);
  anchor(P, 'handR', P.armR, P.hands.R);
  anchor(P, 'head', P.torso, head);
  return finish(P, g);
}

/* ---------------- 炸弹人：骷髅面具 + 怀抱大炸弹 ---------------- */
export function wallbreaker(g, R) {
  const v = R();
  const H = 0.88 * (0.95 + R() * 0.1);
  const C = {
    skin: 0xd8c0a0, skinDark: 0xb8a082, hair: 0x2e2a24,
    bone: 0xf2eee2, boneDark: 0xcfc7b4, ember: 0xff6a3a,
    cloth: 0x5c5c6e, clothDark: 0x41414f,
    leather: 0x3f3f4a, leatherDark: 0x2a2a33,
    metal: 0x6c6c78, metalDark: 0x43434d, ink: 0x14101a,
  };
  const P = skeleton(g, {
    H, C,
    headRatio: 0.232, legRatio: 0.415, torsoRatio: 0.325,
    hipW: 0.19, shoulderW: 0.42, chestW: 0.30, chestD: 0.2,
    kneeBend: 0.17, elbowBend: -1.3, handCurl: 0.9,
    pauldron: false, pelvisColor: C.leather, waistColor: C.cloth,
    greaveColor: C.leatherDark, greaveNails: false,
    bracerColor: C.leatherDark, bracerNails: false,
    face: false,                                 // 脸上换成骨面
  });
  const { torso, head, armL, armR, elbows } = P;
  const M = P.M;

  /* 皮质围裙 + 双背带 + 胸前炸药罐 + 腰带工具 */
  torso.add(part(chamferGeo(M.chestW * 1.08, M.torsoH * 0.68, M.chestD * 1.08,
    { bevel: M.H * 0.022, corner: M.H * 0.026 }), C.leather, {
    y: M.torsoH * 0.5, outline: true,
  }));
  for (const k of [-1, 1]) {
    const sp = beam([k * M.chestW * 0.3, M.torsoH * 1.0, M.chestD * 0.44],
      [k * M.chestW * 0.3, M.torsoH * 0.16, M.chestD * 0.5], M.H * 0.028, C.leatherDark, {});
    if (sp) torso.add(sp);
  }
  for (const k of [-1, 1]) {
    torso.add(part(new THREE.CylinderGeometry(M.H * 0.037, M.H * 0.037, M.H * 0.09, 8), 0x8a3226, {
      x: k * M.chestW * 0.26, y: M.torsoH * 0.6, z: M.chestD * 0.54, outline: false,
    }));
    torso.add(part(new THREE.CylinderGeometry(M.H * 0.025, M.H * 0.025, M.H * 0.024, 8), C.metal, {
      x: k * M.chestW * 0.26, y: M.torsoH * 0.66, z: M.chestD * 0.54,
      outline: false, shadow: false,
    }));
    torso.add(part(new THREE.BoxGeometry(M.H * 0.022, M.H * 0.078, M.H * 0.02), C.metalDark, {
      x: k * M.chestW * 0.6, y: M.torsoH * 0.2, z: M.chestD * 0.36,
      rz: k * 0.25, outline: false, shadow: false,
    }));
  }

  /* 骷髅面具：骨颅 + 骨面 + 眼窝 + 眼火 + 鼻腔 + 牙缝 + 颧骨 */
  head.add(part(new THREE.SphereGeometry(M.headR * 1.07, 12, 9), C.bone, {
    y: M.neckL + M.headR * 0.96, sy: 1.06, outline: true,
  }));
  head.add(part(chamferGeo(M.headR * 1.26, M.headR * 0.74, M.headR * 1.12,
    { bevel: M.headR * 0.24, corner: M.headR * 0.2 }), C.bone, {
    y: M.neckL + M.headR * 0.56, z: M.headR * 0.16, outline: true,
  }));
  for (const k of [-1, 1]) {
    head.add(part(new THREE.SphereGeometry(M.headR * 0.32, 8, 6), C.ink, {
      x: k * M.headR * 0.4, y: M.neckL + M.headR * 1.0, z: M.headR * 0.72,
      outline: false, shadow: false,
    }));
    head.add(part(new THREE.SphereGeometry(M.headR * 0.115, 6, 5), C.ember, {
      x: k * M.headR * 0.4, y: M.neckL + M.headR * 1.0, z: M.headR * 0.9,
      emissive: 0xff5a1a, emissiveIntensity: 1.2, outline: false, shadow: false,
    }));
    head.add(part(new THREE.BoxGeometry(M.headR * 0.34, M.H * 0.013, M.H * 0.016), C.boneDark, {
      x: k * M.headR * 0.76, y: M.neckL + M.headR * 0.84, z: M.headR * 0.6,
      rz: k * 0.5, outline: false, shadow: false,
    }));
  }
  head.add(part(new THREE.ConeGeometry(M.headR * 0.15, M.headR * 0.27, 4), C.ink, {
    y: M.neckL + M.headR * 0.84, z: M.headR * 0.9, rx: Math.PI, outline: false, shadow: false,
  }));
  for (let i = -2; i <= 2; i++) {
    head.add(part(new THREE.BoxGeometry(M.H * 0.009, M.headR * 0.42, M.H * 0.015), C.ink, {
      x: i * M.headR * 0.2, y: M.neckL + M.headR * 0.48, z: M.headR * 0.78,
      outline: false, shadow: false,
    }));
  }
  head.add(part(new THREE.CylinderGeometry(M.headR * 1.11, M.headR * 1.11, M.H * 0.034, 11),
    C.leather, { y: M.neckL + M.headR * 1.34, outline: false }));
  head.add(part(new THREE.ConeGeometry(M.headR * 0.33, M.H * 0.115, 5), C.leather, {
    y: M.neckL + M.headR * 1.42, z: -M.headR * 0.9, rx: -0.7, outline: false, shadow: false,
  }));
  head.add(part(chamferGeo(M.H * 0.015, M.H * 0.095, M.H * 0.008, { bevel: M.H * 0.004 }),
    C.leatherDark, {
      y: M.neckL + M.headR * 1.08, z: -M.headR * 1.0, rx: 0.5, outline: false, shadow: false,
    }));

  /* 怀抱的大炸弹：球 + 双箍 + 颈 + 引信 + 火花 */
  const bomb = new THREE.Group();
  const br = M.chestW * 0.43;
  bomb.add(part(new THREE.SphereGeometry(br, 14, 11), 0x35353f, { sy: 1.1, outline: true }));
  bomb.add(part(new THREE.TorusGeometry(br * 0.99, br * 0.075, 5, 16), 0x22222a, {
    y: br * 0.14, rx: Math.PI / 2, outline: false, shadow: false,
  }));
  bomb.add(part(new THREE.TorusGeometry(br * 0.72, br * 0.07, 5, 14), 0x22222a, {
    y: -br * 0.84, rx: Math.PI / 2, outline: false, shadow: false,
  }));
  bomb.add(part(new THREE.CylinderGeometry(br * 0.3, br * 0.36, br * 0.32, 9), 0x1f1f26, {
    y: br * 1.06, outline: false,
  }));
  const fuse = beam([0, br * 1.2, 0], [br * 0.16, br * 1.9, br * 0.22], br * 0.09, 0xc8b48c, {});
  if (fuse) bomb.add(fuse);
  const spark = part(new THREE.SphereGeometry(br * 0.26, 8, 6), 0xffb03a, {
    y: br * 1.94, z: br * 0.22, emissive: 0xff8a1a, emissiveIntensity: 1.3,
    outline: false, shadow: false,
  });
  bomb.add(spark);
  bomb.position.set(0, M.torsoH * 0.5, M.chestD * 0.78);
  bomb.rotation.set(0.16, 0, 0);
  torso.add(bomb);
  P.spark = spark;
  P.bomb = bomb;
  g.userData.spark = spark;

  /* 环抱姿势：手臂向内收 + 前移 */
  armL.rotation.set(0.34, 0, -1.0);
  armR.rotation.set(0.34, 0, 1.0);
  armL.position.z = M.chestD * 0.34;
  armR.position.z = M.chestD * 0.34;

  anchor(P, 'bomb', P.torso, bomb);
  anchor(P, 'handL', P.armL, P.hands.L);
  anchor(P, 'handR', P.armR, P.hands.R);
  anchor(P, 'head', P.torso, head);
  return finish(P, g);
}

/* ============================================================
   4. 分发
   ============================================================ */
export const TROOP_MAKERS = { barbarian, archer, giant, wallbreaker };

/**
 * 取命名锚点的世界坐标。
 * 用「岛局部坐标 + 该岛当前 world 矩阵」算，所以手的挥动、头的点动都
 * 会正确带上 —— 特效不会从单位立方体的中心冒出来。
 * @param {THREE.Object3D} mesh buildTroop 的返回值
 * @param {string} name 锚点名
 * @param {THREE.Vector3} out 输出（命中返回 out，未命中返回 null）
 */
export function troopAnchor(mesh, name, out) {
  const P = mesh && mesh.userData.parts;
  if (!P || !P.anchor) return null;
  for (const a of P.anchor) {
    if (a.name !== name) continue;
    if (!a.island) return null;
    a.island.updateWorldMatrix(true, false);
    out.copy(a.v);
    a.island.localToWorld(out);
    return out;
  }
  return null;
}

/** 确定性变体随机源：同一个变体号永远得到同一套抖动 */
export function variantRnd(vi) {
  const r = mulberry32(0x51ed2701 + (vi | 0) * 7919);
  return () => r();
}
