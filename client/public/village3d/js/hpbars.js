/* ============================================================
   hpbars.js — 战斗血条层（己方部队 + 敌方建筑）
   ------------------------------------------------------------
   为什么要单独一层：
     battle.js 的职责是「算伤害与目标」（纯逻辑，可以无头跑），
     表现全部外置 —— 弹道粒子走 fx.js，血条走这里。血条每帧都要读
     「谁掉了多少血」，但渲染代码不该塞进战斗逻辑里。
     battle 每帧调一次 sync()，本层把该显示的血条重新灌进实例缓冲。

   为什么是 InstancedMesh，而不是「每个单位一个 Sprite / 一个 DOM 节点」：
     · 同屏可能 60 个兵 + 50 座建筑 + 40 段城墙。各自两个网格就是 300 个
       draw call，iPad 直接跪。按血量分 4 档 + 1 条底槽 = 5 个
       InstancedMesh，整层恒定 5 个 draw call。
     · 也不用 DOM 覆盖层：那要每帧对每个实体做一次投影 + 改样式，100 个
       元素的 layout 抖动比 5 个实例矩阵贵得多。

   三个刻意的取舍（都是「看不见时最容易搞错」的地方）：
     ① 颜色用「每档一个 InstancedMesh」，不用 instanceColor。
        instanceColor 能不能被采样，取决于材质的片元着色器有没有走
        vertexColors 那条分支；本项目没法用眼睛验收，一旦它静默失效，
        所有血条会变成一片白 —— 那是最糟的失败模式（看着像「能用」）。
        按档分网格的着色是 material.color 直接生效的，不可能悄悄错。
     ② 血条不做深度测试（depthTest:false），永远压在画面最上层。
        工事里的兵要是被墙挡住血条，等于没做。
     ③ 底槽比血芯大一圈当描边。0.07 世界单位高的条子在 45° 视角下
        靠「深色框 + 亮色芯」才认得出，纯色细线会糊进背景。

   显示规则（和玩家直觉对齐）：
     · 部队：只要活着就显示（要能看出谁快倒了），满血是短的绿条。
     · 建筑 / 城墙：只有受伤了才显示 —— 没挨打的房子挂一排血条太吵。

   血条高度按**实测头顶**定，不用固定偏移：兵种身高差一倍（巨人 1.44 /
   炸弹人 0.88），建筑更是从加农炮 1.5 到箭塔 6.1。固定偏移的结果是
   矮的血条飘在天上、高的埋进塔里。
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';
import { gridToWorld } from './config.js';

/* 血量分档：健康 → 濒死。颜色沿「草绿 → 黄绿 → 琥珀 → 砖红」走，
   和 HUD 里资源三色 + 警戒色同一套语义（绿=好、琥珀=注意、红=危险）。 */
const TIERS = [
  { at: 0.75, color: 0x49c14b, name: '健康' },
  { at: 0.50, color: 0xb2c93a, name: '轻伤' },
  { at: 0.25, color: 0xeda62b, name: '重伤' },
  { at: 0.00, color: 0xdd4a38, name: '濒死' },
];

const BG_COLOR = 0x1a232e;      // 底槽：深板岩蓝，压住亮色芯也压住背景
const BG_W = 1.12, BG_H = 1.90; // 底槽相对血芯的放大（当描边用）

/* 尺寸按「默认镜头距离 34~50」下的屏幕像素反推过：
   距离 40 时 1 个世界单位约 25 个逻辑像素，所以 0.085 高的条子约 3~4px、
   0.46 宽约 19px —— 再细就糊成一条线了（iPad 的 DPR 会让它实际更实）。 */
const UNIT_W = 0.50, UNIT_H = 0.085;
const WALL_W = 0.64, WALL_H = 0.095;
const BG_W_MAX = 1.72;          // 建筑血条最宽（4×4 的市政厅）

const GROW = 0.16;              // 出现的展开时长（秒）
const HIT = 0.16;               // 掉血后的弹一下的时长（秒）

/** 血量比 → 颜色档下标。纯函数，便于自检单独验它。 */
export function hpTier(ratio) {
  for (let i = 0; i < TIERS.length; i++) if (ratio >= TIERS[i].at) return i;
  return TIERS.length - 1;
}

const easeOut = (t) => 1 - (1 - t) * (1 - t);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class HpBars {
  /**
   * @param {object} o
   * @param {THREE.Object3D} o.root  挂载点（战斗根下的独立子节点）
   * @param {THREE.Camera} o.camera  用来做 billboard —— 血条永远正对镜头
   * @param {number} o.capacity      同屏血条上限（敌人 + 待部署部队 + 余量）
   */
  constructor({ root, camera, capacity = 128 }) {
    this.camera = camera;
    this.capacity = Math.max(8, capacity | 0);

    this.geo = new THREE.PlaneGeometry(1, 1);
    this.mats = [];
    const mk = (color) => {
      const m = new THREE.MeshBasicMaterial({
        color,
        transparent: true,      // 走透明队列 → 稳定压在所有不透明物体之后
        opacity: 1,
        depthTest: false,       // 不被建筑/城墙遮挡
        depthWrite: false,
        toneMapped: false,      // 不参与色调映射，颜色就是色板上那个
        fog: false,
      });
      this.mats.push(m);
      return m;
    };

    this.bgMat = mk(BG_COLOR);
    this.bg = new THREE.InstancedMesh(this.geo, this.bgMat, this.capacity);
    this.bg.name = 'hpbar-bg';
    this.bg.renderOrder = 30;

    this.fills = TIERS.map((t, i) => {
      const m = new THREE.InstancedMesh(this.geo, mk(t.color), this.capacity);
      m.name = 'hpbar-fill-' + i;
      m.renderOrder = 31 + i;   // 血芯一定画在底槽之后
      return m;
    });

    for (const m of this.all()) {
      m.frustumCulled = false;  // 实例散布全场，用几何体的包围球剔除会误杀
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      root.add(m);
    }
    this.root = root;

    /* 复用对象，保证 sync() 里零分配（不然每帧 100 个 Vector3 也能堆出 GC 抖动） */
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._right = new THREE.Vector3();

    this.drawn = [];            // 本帧画了谁（自检用，可外部读）
    this._fillN = TIERS.map(() => 0);
    this.shown = 0;
    this.dropped = 0;
    this._stat = { units: 0, buildings: 0, walls: 0 };
  }

  all() { return [this.bg, ...this.fills]; }

  /** 战斗结束时立刻全部收起 —— 结算卡马上要盖上来，留一排血条会穿帮。 */
  clear() {
    for (const m of this.all()) m.count = 0;
    this.drawn.length = 0;
    this.shown = 0;
    this._stat = { units: 0, buildings: 0, walls: 0 };
    for (let i = 0; i < this._fillN.length; i++) this._fillN[i] = 0;
  }

  /**
   * 每帧重建实例缓冲。
   * @param {object} battle 战斗实例（读 units / enemies）
   * @param {number} dt     帧间隔，用于「展开」与「掉血弹一下」两个小动画
   */
  sync(battle, dt = 0) {
    this.camera.getWorldQuaternion(this._q);
    this._right.set(1, 0, 0).applyQuaternion(this._q);

    let n = 0;
    let units = 0, buildings = 0, walls = 0, dropped = 0;
    this.drawn.length = 0;
    for (let i = 0; i < this._fillN.length; i++) this._fillN[i] = 0;

    /* 部队：活着就显示 */
    for (const u of battle.units) {
      if (u.dead) { u._barT = 0; continue; }
      const ratio = clamp01(u.hp / u.maxHp);
      const k = this._tick(u, dt, u.hp);
      if (this._draw(n, u.x, u.barY || 1.1, u.z, UNIT_W, UNIT_H, ratio, k)) {
        n++; units++;
        this.drawn.push({ kind: 'unit', ref: u, ratio, tier: hpTier(ratio) });
      } else dropped++;
    }

    /* 建筑 / 城墙：受伤才显示 */
    for (const b of battle.enemies) {
      if (b.dead) { b._barT = 0; continue; }
      if (!(b.hp < b.maxHp - 0.5)) { b._barT = 0; continue; }
      const ratio = clamp01(b.hp / b.maxHp);
      const k = this._tick(b, dt, b.hp);
      const isWall = b.type === 'wall';
      const w = isWall ? WALL_W : Math.min(BG_W_MAX, 0.34 + 0.34 * Math.max(b.w, b.h));
      const h = isWall ? WALL_H : 0.10;
      if (b._barX === undefined) {
        const wp = gridToWorld(b.cx, b.cz);
        b._barX = wp.x; b._barZ = wp.z;
      }
      const y = isWall ? 1.22 : (b.barY || 1.2);
      if (this._draw(n, b._barX, y, b._barZ, w, h, ratio, k)) {
        n++;
        if (isWall) walls++; else buildings++;
        this.drawn.push({ kind: isWall ? 'wall' : 'building', ref: b, ratio, tier: hpTier(ratio) });
      } else dropped++;
    }

    this.bg.count = n;
    for (let i = 0; i < this.fills.length; i++) this.fills[i].count = this._fillN[i];
    this.bg.instanceMatrix.needsUpdate = true;
    for (const m of this.fills) m.instanceMatrix.needsUpdate = true;

    this.shown = n;
    this.dropped = dropped;
    this._stat = { units, buildings, walls };
  }

  /** 两个小动画：出现时展开、掉血时弹一下 */
  _tick(e, dt, hp) {
    if (e._barHp === undefined) e._barHp = hp;
    if (hp < e._barHp - 0.01) e._barHit = HIT;
    e._barHp = hp;
    e._barT = Math.min(GROW, (e._barT || 0) + dt);
    e._barHit = Math.max(0, (e._barHit || 0) - dt);
    const grow = easeOut(e._barT / GROW);
    const hit = e._barHit / HIT;
    return grow * (1 + 0.42 * hit);
  }

  /** 压一条血条进实例缓冲。返回 false 表示超出容量被丢弃。 */
  _draw(n, x, y, z, w, h, ratio, k) {
    if (n >= this.capacity) return false;
    const wq = w * k, hq = h * k;

    this._s.set(wq * BG_W, hq * BG_H, 1);
    this._m.compose(this._p.set(x, y, z), this._q, this._s);
    this.bg.setMatrixAt(n, this._m);

    /* 血芯从左往右生长：中心要往左移 (1-ratio)/2 个条宽。
       注意局部 +X 在 billboard 之后就是相机的右方向，所以偏移量
       必须沿着 this._right 走，不能用世界 +X。 */
    const ti = hpTier(ratio);
    const off = wq * (ratio - 1) * 0.5;
    this._s.set(Math.max(wq * 0.02, wq * ratio), hq, 1);
    this._m.compose(
      this._p.set(x + this._right.x * off, y + this._right.y * off, z + this._right.z * off),
      this._q, this._s,
    );
    this.fills[ti].setMatrixAt(this._fillN[ti]++, this._m);
    return true;
  }

  /** 自检读数：容量 / 本帧画了多少 / 各档多少 / draw call 数 */
  stats() {
    return {
      capacity: this.capacity,
      shown: this.shown,
      dropped: this.dropped,
      units: this._stat.units,
      buildings: this._stat.buildings,
      walls: this._stat.walls,
      tiers: this._fillN.slice(),
      drawCalls: this.all().length,
      names: this.all().map((m) => m.name),
      colors: this.fills.map((m) => m.material.color.getHexString()),
      bg: this.bgMat.color.getHexString(),
    };
  }

  dispose() {
    for (const m of this.all()) {
      if (m.parent) m.parent.remove(m);
      m.dispose();
    }
    for (const m of this.mats) m.dispose();
    this.geo.dispose();
    this.mats.length = 0;
    this.drawn.length = 0;
  }
}
