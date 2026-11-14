/* ============================================================
   villagers.js — 村庄里的村民 NPC（2026-10-14 新增）
   ------------------------------------------------------------
   需求：村里应该有 NPC 在活动 —— 否则再好的建筑也是一座空城。

   设计取舍：
     · **纯氛围，不参与玩法**。村民不给资源、不参与战斗、不能被点击。
       一旦给它们玩法职责，就要接存档、服务端、反作弊，收益远不抵成本。
     · 数量随市政厅等级增长（TH1 → 2 人，TH5 → 6 人）：
       让"升级市政厅"多一个看得见的好处。
     · 在自己村里走动时**避开建筑与城墙**（走 occupantAt 判定为空的地格），
       不会穿墙、不会站到屋顶上。
     · 走进/走出都平滑：到达目标后停 0.6~2 秒再挑下一个目标，
       看起来像"在村里闲逛"而不是"被程序驱动"。

   性能：村民数 ≤ 6，每人约 7 个零件。零件共用顶点色材质（toon.js 的
   part 默认就是共享材质），所以不额外吃显存；每帧只更新 6 个 Group 的
   位置与四肢角度，开销可忽略。
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';
import { GRID, gridToWorld, worldToGrid } from './config.js';
import { box, ball, cone, mulberry32 } from './toon.js';

/** 村民上限 —— 再多也不加，避免"人海"把村庄变吵 */
const MAX_VILLAGERS = 6;

/** 走路速度（世界单位/秒）。约合"慢悠悠散步"，比兵种慢 */
const WALK_SPEED = 0.85;

/* 配色：肤 / 衣 / 裤 / 发。每人都从这几组里取，保证整体协调又不重样 */
const SKIN = [0xf2c9a0, 0xe8b48c, 0xd9a074, 0xc98d5e];
const CLOTH = [0x6f8fd6, 0xd66f8f, 0x6fd6a0, 0xd6a86f, 0x9a7fd6, 0x5fb8c9];
const PANTS = [0x4a4a5a, 0x5a4a3a, 0x3f4a5a];
const HAIR = [0x3a2a22, 0x5a3a22, 0x22303a, 0x6a5a4a];

/**
 * 造一个村民。
 *
 * 四肢都必须**挂在一个枢轴上**（pivot 放在髋/肩，网格相对枢轴向下偏），
 * 否则 rotation.x 会绕几何中心转，看起来像腿从中间折断。
 * 这个坑在第一版就踩过 —— 所以腿和手臂这里显式用 Group 包一层。
 */
function makeVillager(rnd) {
  const skin = SKIN[(rnd() * SKIN.length) | 0];
  const cloth = CLOTH[(rnd() * CLOTH.length) | 0];
  const pants = PANTS[(rnd() * PANTS.length) | 0];
  const hair = HAIR[(rnd() * HAIR.length) | 0];
  const tall = 0.92 + rnd() * 0.16;   // 个体高矮差异

  const g = new THREE.Group();
  g.scale.setScalar(tall);

  /* 腿：枢轴在髋部（y = 0.30），网格向下延伸 */
  const mkLimb = (w, h, col, px, py) => {
    const pivot = new THREE.Group();
    pivot.position.set(px, py, 0);
    pivot.add(box(w, h, w, col, { y: -h / 2 }));
    return pivot;
  };
  const legL = mkLimb(0.075, 0.30, pants, -0.05, 0.30);
  const legR = mkLimb(0.075, 0.30, pants, 0.05, 0.30);
  g.add(legL, legR);

  /* 身体：上窄下宽一点点，比纯方块有型 */
  g.add(box(0.23, 0.16, 0.17, cloth, { y: 0.38 }));
  g.add(box(0.21, 0.12, 0.155, cloth, { y: 0.50 }));
  /* 腰带 */
  g.add(box(0.235, 0.035, 0.175, 0x7a6a5a, { y: 0.31, outline: false }));

  /* 手臂：枢轴在肩（y = 0.54） */
  const armL = mkLimb(0.062, 0.24, cloth, -0.145, 0.54);
  const armR = mkLimb(0.062, 0.24, cloth, 0.145, 0.54);
  g.add(armL, armR);

  /* 头 + 头发 + 脖子 */
  g.add(box(0.06, 0.05, 0.06, skin, { y: 0.585, outline: false }));  // 脖子
  const head = ball(0.125, skin, { y: 0.68 });
  g.add(head);
  /* 头发：一个略大的球后移，露出脸 */
  const hairBall = ball(0.128, hair, { y: 0.705, z: -0.022 });
  hairBall.scale.set(1.0, 0.82, 1.02);
  g.add(hairBall);
  /* 三成村民戴帽子（让村子看起来更有层次） */
  if (rnd() < 0.32) {
    g.add(cone(0.15, 0.13, 0xd9c9a0, { y: 0.80, outline: false }));
  }

  return { group: g, legL, legR, armL, armR, body: g.children[2] };
}

export class Villagers {
  /**
   * @param {import('./engine.js').Engine} engine
   * @param {import('./village.js').Village} village
   */
  constructor(engine, village) {
    this.engine = engine;
    this.village = village;
    this.rnd = mulberry32(20261014);   // 固定种子：同一存档每次进村布局一致

    this.root = new THREE.Group();
    this.root.name = 'villagers';
    engine.scene.add(this.root);

    /** @type {Array<{g:THREE.Group,x:number,z:number,tx:number,tz:number,yaw:number,phase:number,wait:number,speed:number,legL:any,legR:any,armL:any,armR:any,body:any}>} */
    this.list = [];
    this._sync(this._wantCount());
  }

  /** 村民人数 = 市政厅等级 + 1（TH1 → 2 人 …… TH5 → 6 人），封顶 MAX */
  _wantCount() {
    const th = Math.max(1, Number(this.village && this.village.thLevel) || 1);
    return Math.min(MAX_VILLAGERS, th + 1);
  }

  /** 增删到指定人数（不重建已有的，避免每次升级市政厅所有人瞬移） */
  _sync(want) {
    while (this.list.length < want) this._spawn();
    while (this.list.length > want) {
      const p = this.list.pop();
      this.root.remove(p.g);
    }
  }

  _spawn() {
    const v = makeVillager(this.rnd);
    const spot = this._randomSpot();
    const p = {
      g: v.group,
      legL: v.legL, legR: v.legR, armL: v.armL, armR: v.armR, body: v.body,
      x: spot.x, z: spot.z,
      tx: spot.x, tz: spot.z,
      yaw: this.rnd() * Math.PI * 2,
      phase: this.rnd() * Math.PI * 2,
      wait: this.rnd() * 1.5,
      speed: WALK_SPEED * (0.85 + this.rnd() * 0.3),
    };
    p.g.position.set(p.x, 0, p.z);
    p.g.rotation.y = p.yaw;
    this.root.add(p.g);
    this.list.push(p);
    this._pickTarget(p);
  }

  /** 某个世界坐标是否落在被占用的格子上（建筑 / 城墙） */
  _blocked(x, z) {
    const v = this.village;
    if (!v || typeof v.occupantAt !== 'function') return false;
    const g = worldToGrid(x, z);
    if (!g) return false;
    return !!v.occupantAt(Math.round(g.gx), Math.round(g.gz));
  }

  /**
   * 随机取一块**空地**（没被建筑或城墙占用的格）。
   *
   * 为什么不直接在整张图上随机：村庄大部分格子是空的，但一旦随机到
   * 建筑格，村民就会走进房子里。试 24 次仍失败就退回"地图中心"。
   */
  _randomSpot() {
    const vill = this.village;
    for (let i = 0; i < 24; i++) {
      const gx = 2 + Math.floor(this.rnd() * (GRID - 4));
      const gz = 2 + Math.floor(this.rnd() * (GRID - 4));
      if (vill && typeof vill.occupantAt === 'function' && vill.occupantAt(gx, gz)) continue;
      return gridToWorld(gx + 0.5, gz + 0.5);
    }
    // 兜底：地图中心附近
    return gridToWorld(GRID / 2, GRID / 2);
  }

  _pickTarget(p) {
    const spot = this._randomSpot();
    p.tx = spot.x;
    p.tz = spot.z;
    p.wait = 0.6 + this.rnd() * 1.6;   // 到了先站一会儿，像在"停下来看看"
  }

  update(dt) {
    if (!this.village) return;
    /* 人数跟着市政厅等级走。每帧检查的成本只是一次属性读取 + 一次比较，
       比"在升级回调里记得调 rebuild"可靠得多。 */
    const want = this._wantCount();
    if (want !== this.list.length) this._sync(want);

    const step = Math.min(dt, 0.1);   // 切后台回来时 dt 会很大，钳一下防止瞬移

    for (const p of this.list) {
      const dx = p.tx - p.x;
      const dz = p.tz - p.z;
      const d = Math.hypot(dx, dz);

      if (d < 0.28) {
        /* 到站：站一会儿再挑下一个目标 */
        p.wait -= step;
        if (p.wait <= 0) this._pickTarget(p);
      } else {
        const move = Math.min(d, p.speed * step);
        const nx = p.x + (dx / d) * move;
        const nz = p.z + (dz / d) * move;
        /* 前方若被建筑/城墙占了就换目标 —— 否则村民会径直穿过房子。
           只判「下一步」，不做完整寻路：村庄是开阔地，绕一下的观感收益
           远不抵 A* 的复杂度与每帧开销。 */
        if (this._blocked(nx, nz)) {
          this._pickTarget(p);
          continue;
        }
        p.x = nx;
        p.z = nz;
        /* 平滑转向（直接 atan2 会在换目标时"啪"地转头） */
        const target = Math.atan2(dx, dz);
        let diff = target - p.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        p.yaw += diff * Math.min(1, step * 7);
        p.phase += step * 8.2;
      }

      p.g.position.set(p.x, 0, p.z);
      p.g.rotation.y = p.yaw;

      /* 走路动画：四肢反相摆动 + 身体轻微起伏。
         站着不动时 phase 不再增长，幅度乘以一个"是否在走"的系数会更跳，
         这里索性让摆动直接停在当前角度 —— 视觉上就是"站着不动"。 */
      const sw = Math.sin(p.phase);
      p.legL.rotation.x = sw * 0.52;
      p.legR.rotation.x = -sw * 0.52;
      p.armL.rotation.x = -sw * 0.38;
      p.armR.rotation.x = sw * 0.38;
      p.body.position.y = Math.abs(sw) * 0.022;
    }
  }

  /** 战斗/打烊时整体隐藏，回村再显示 */
  setVisible(on) {
    this.root.visible = !!on;
  }

  dispose() {
    this.engine.scene.remove(this.root);
    this.list.length = 0;
  }
}
