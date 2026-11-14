/* ============================================================
   battle.js — 攻城对战
   ------------------------------------------------------------
   · 按难度程序化生成敌方村庄（确定性种子）
   · 兵种 BFS/转向式寻路 + 城墙阻挡判定
   · 防御建筑索敌、发射弹道、范围溅射
   · 摧毁度 / 三星 / 掠夺结算
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';
import {
  GRID, BUILDINGS, TROOPS, RAID_TIERS, gridToWorld, worldToGrid,
} from './config.js';
import { buildModel, buildTroop, variantOf, BUILD_VARIANTS } from './models.js';
import { troopAnchor } from './models-units.js';
import { Fx } from './fx.js';
import { HpBars } from './hpbars.js';
import { mulberry32, clamp, dist, easeOutCubic, toonMat, GRAD_SOFT } from './toon.js';
import { sfx } from './audio.js';
import { WallField } from './engine.js';
import { maxHp } from './village.js';

/* 每个难度对应的敌方阵营配置。
   导出给 ui.js 用：进攻面板要靠它把敌方血量折算成「建议兵力」。

   【2026-10-19 平衡】塔的**数量**也一起改了，不只是 dps：
     原来 1 → 2 → 6 → 9 → 11，而兵力只有 20 → 24 → 112 → 168 → 168。
     TH3 之后塔数翻了三倍、兵力却只翻一倍，这才是「高本打不动」的根因 ——
     单靠调 dps 只能压一头、翘另一头。
     现在改成 1 → 2 → 5 → 7 → 10，与兵力曲线大致同步：
       TH3：3 加农 + 1 箭塔 + 1 迫击炮（5 座，原 6 座）
       TH4：4 + 2 + 1（7 座，原 9 座）
       TH5：5 + 3 + 2（10 座，原 11 座） */
export const COMPO = [
  { th: 1, walls: false, def: { cannon: 1 }, res: { goldmine: 1, elixircollector: 1, goldstorage: 1, elixirstorage: 1 } },
  { th: 2, walls: true,  def: { cannon: 2 }, res: { goldmine: 2, elixircollector: 2, goldstorage: 1, elixirstorage: 1 } },
  { th: 3, walls: true,  def: { cannon: 3, archertower: 1, mortar: 1 }, res: { goldmine: 3, elixircollector: 3, goldstorage: 2, elixirstorage: 2 } },
  { th: 4, walls: true,  def: { cannon: 4, archertower: 2, mortar: 1 }, res: { goldmine: 4, elixircollector: 4, goldstorage: 3, elixirstorage: 3 } },
  { th: 5, walls: true,  def: { cannon: 5, archertower: 3, mortar: 2 }, res: { goldmine: 5, elixircollector: 5, goldstorage: 4, elixirstorage: 4 } },
];

const BATTLE_TIME = 180;   // 现实秒
const SPAWN_DIP = 0.3;     // 部署落地压缩时长（秒）
/* 每个兵种的「出招周期」。伤害是连续结算的（不改数值手感），
   但挥砍 / 拉弓 / 砸地这些动作按这个节奏走，读者才看得出在打什么。 */
const ATTACK_CYCLE = { barbarian: 1.0, archer: 1.25, giant: 1.6, wallbreaker: 1.4 };
/* 出招幅度：arm 摆臂、lean 前倾、twist 拧腰。巨人靠体量、炸弹人靠前冲。 */
const ATTACK_POSE = {
  barbarian:   { arm: 1.00, lean: 0.34, twist: 0.30 },
  archer:      { arm: 0.30, lean: 0.10, twist: 0.24 },
  giant:       { arm: 0.85, lean: 0.30, twist: 0.22 },
  wallbreaker: { arm: 0.40, lean: 0.45, twist: 0.14 },
};
/* 同屏单位超过这个数就关掉单位描边 —— 描边占掉一半的网格数，
   兵海压上来时优先保帧率（建筑描边不受影响）。 */
const UNIT_OUTLINE_MAX = 16;

/* ============================================================
   敌方村庄布局生成
   ============================================================ */
function generateLayout(tierIndex, seed) {
  const cfg = COMPO[Math.min(tierIndex, COMPO.length - 1)];
  const rnd = mulberry32(seed);
  const occ = new Int8Array(GRID * GRID);
  const list = [];
  const C = GRID / 2;

  const fits = (gx, gz, w, h) => {
    if (gx < 1 || gz < 1 || gx + w > GRID - 1 || gz + h > GRID - 1) return false;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (occ[(gz + j) * GRID + gx + i]) return false;
    return true;
  };
  const mark = (gx, gz, w, h, v) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) occ[(gz + j) * GRID + gx + i] = v;
  };
  const put = (type, gx, gz, level) => {
    const [w, h] = BUILDINGS[type].size;
    if (!fits(gx, gz, w, h)) return null;
    mark(gx, gz, w, h, 1);
    const b = {
      type, level, gx, gz, w, h,
      hp: maxHp(type, level), maxHp: maxHp(type, level),
      area: w * h, dead: false,
      cx: gx + (w - 1) / 2, cz: gz + (h - 1) / 2,
      cd: rnd() * 1.2,
    };
    list.push(b);
    return b;
  };

  /* --- 市政厅居中 --- */
  const thLv = cfg.th;
  put('townhall', Math.round(C - 2), Math.round(C - 2), thLv);

  /* --- 城墙矩形 --- */
  const R = 4 + cfg.th;
  const x0 = Math.round(C - R), z0 = Math.round(C - R);
  const x1 = x0 + 2 * R - 1, z1 = z0 + 2 * R - 1;
  if (cfg.walls) {
    const gateSide = Math.floor(rnd() * 4);
    const gateAt = Math.round(R - 1 + (rnd() * 2 - 1) * (R - 1));
    const wallLv = clamp(cfg.th, 1, 5);
    const ring = [];
    for (let x = x0; x <= x1; x++) { ring.push([x, z0, 0]); ring.push([x, z1, 2]); }
    for (let z = z0 + 1; z < z1; z++) { ring.push([x0, z, 1]); ring.push([x1, z, 3]); }
    for (const [x, z, side] of ring) {
      // 留一道 3 格宽的城门
      if (side === gateSide && Math.abs((side === 0 || side === 2 ? x : z) - gateAt) <= 1) continue;
      if (!fits(x, z, 1, 1)) continue;
      put('wall', x, z, wallLv);
    }
  }

  /* --- 候选位置池（按切比雪夫半径分层） --- */
  const pool = (rMin, rMax) => {
    const out = [];
    for (let z = 0; z < GRID; z++) {
      for (let x = 0; x < GRID; x++) {
        const d = Math.max(Math.abs(x + 0.5 - C), Math.abs(z + 0.5 - C));
        if (d >= rMin && d <= rMax) out.push([x, z]);
      }
    }
    // 确定性洗牌
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  };

  const inner = pool(3.4, Math.max(4.6, R));
  const inner2 = pool(2.4, Math.max(3.6, R));
  const outer = pool(R + 1.5, R + 4.5);
  const outer2 = pool(R + 1.5, R + 6);

  /** 依次尝试多个候选池，全部失败再全局兜底 */
  const take = (type, level, pools) => {
    const list = Array.isArray(pools) ? pools : [pools];
    for (const ord of list) {
      for (const [x, z] of ord) {
        const [w, h] = BUILDINGS[type].size;
        const gx = Math.round(x - (w - 1) / 2), gz = Math.round(z - (h - 1) / 2);
        const r = put(type, gx, gz, level);
        if (r) return r;
      }
    }
    // 全局兜底：逐格扫描
    for (let gz = 1; gz + BUILDINGS[type].size[1] < GRID - 1; gz++) {
      for (let gx = 1; gx + BUILDINGS[type].size[0] < GRID - 1; gx++) {
        const r = put(type, gx, gz, level);
        if (r) return r;
      }
    }
    return null;
  };

  /* --- 防御：内圈 --- */
  const defLv = clamp(cfg.th, 1, 5);
  const poolFor = (key) => {
    if (key === 'mortar') return [inner2, inner, outer];
    if (key === 'archertower') return [inner, inner2, outer];
    return [inner, inner2, outer];
  };
  for (const key in cfg.def) {
    for (let i = 0; i < cfg.def[key]; i++) {
      take(key, clamp(defLv - (i > 2 ? 1 : 0), 1, 5), poolFor(key));
    }
  }

  /* --- 资源：外圈 --- */
  const keys = Object.keys(cfg.res);
  let toggle = 0;
  const maxRes = Math.max(...keys.map((k) => cfg.res[k]));
  for (let i = 0; i < maxRes; i++) {
    for (const k of keys) {
      if (i >= cfg.res[k]) continue;
      take(k, clamp(cfg.th - (i > 2 ? 1 : 0), 1, 5), (toggle++ % 2 === 0) ? [outer, outer2] : [outer2, outer]);
    }
  }

  return { cfg, buildings: list, R };
}

/* ============================================================
   Battle
   ============================================================ */
export class Battle {
  /**
   * @param {import('./engine.js').Engine} engine
   * @param {import('./village.js').Village} village
   * @param {import('./army.js').Army} army
  /**
   * @param {number} tierIndex NPC 模式下的关卡序号（0..4）
   * @param {object} [opts] PVP 模式：{ mode:'pvp', snapshotId, layout, lootElixir, name, th }
   */
  constructor(engine, village, army, tierIndex, opts = {}) {
    this.engine = engine;
    this.village = village;
    this.army = army;
    this.tierIndex = tierIndex;

    /* PVP 模式：造一个"伪 tier"对象，让 main.js 的 toast、result.tier、
       ui.js 的结算卡都不用为 PVP 单独分支 —— 它们照旧读 tier.name 即可。
       ⚠️ loot 用服务端下发的对手圣水存量，而不是 RAID_TIERS 的写死值。 */
    this.mode = opts.mode === 'pvp' ? 'pvp' : 'npc';
    this.opts = opts;
    this.startedAt = Date.now();
    this.tier = this.mode === 'pvp'
      ? { id: -1, name: opts.name || '对手村庄', th: opts.th || 1,
          loot: opts.lootElixir || 0, minTH: 1 }
      : RAID_TIERS[tierIndex];

    this.root = new THREE.Group();
    this.root.name = 'battle';
    engine.scene.add(this.root);

    this.wallField = new WallField();
    this.root.add(this.wallField.group);

    this.buildingRoot = new THREE.Group();
    this.root.add(this.buildingRoot);
    this.unitRoot = new THREE.Group();
    this.root.add(this.unitRoot);
    this.fxRoot = new THREE.Group();
    this.root.add(this.fxRoot);

    /* 特效总控：池化粒子 / 碎片 / 冲击波 / 焦痕 / 投射物 + 屏幕震动。
       伤害与寻路留在本文件，弹道与表现全部交给它（见 fx.js 顶部说明）。 */
    this.vfx = new Fx({ root: this.fxRoot, engine, rig: engine.rig });

    this.occ = new Int32Array(GRID * GRID).fill(-1);
    this.enemies = [];
    this.units = [];
    this.fires = [];          // 还在烧的残骸（持续冒烟 + 飘火星）
    this._va = new THREE.Vector3();
    this._popT = 0;           // 飘字节流
    this._unitOutline = true;

    this.reserve = army.takeForBattle();
    this.deployed = {};
    /* 答题强化倍率（2026-10-19）：1 = 无加成。
       新部署的兵按 hp 倍率给血量；已部署的兵实时吃攻击倍率。 */
    this.buff = { atk: 1, hp: 1 };
    this.survivors = {};
    /* 本场派出去的兵（按兵种）。survivors 只记「还活着的」，
       没有这个基线就算不出阵亡多少 —— 战报里那句「阵亡 3」就来自两者之差。 */
    this.deployed = {};
    this.selected = null;
    this.time = BATTLE_TIME;
    this.pct = 0;
    this.stars = 0;
    this.over = false;
    this.onEnd = null;
    this.onTick = null;

    this._buildEnemyVillage();

    /* 血条层（放在最后建：容量要按「实际敌人 + 待部署部队」算）。
       部队与建筑的掉血全靠它变成看得见的东西 —— 没有它，玩家只能靠
       飘字猜哪座房子快塌了，以及自己的兵还剩几个。 */
    this.barRoot = new THREE.Group();
    this.barRoot.name = 'hpbars';
    this.root.add(this.barRoot);
    this.bars = new HpBars({
      root: this.barRoot,
      camera: engine.camera,
      capacity: this.enemies.length + this.reserveTotal + 16,
    });
  }

  /* ------------------------------------------------------------
     构建
     ------------------------------------------------------------ */
  _buildEnemyVillage() {
    // PVP：村庄布局来自服务端下发的对手快照，而不是本地程序生成
    if (this.mode === 'pvp') { this._buildFromSave(this.opts.layout || []); return; }

    const seed = 987654 + this.tierIndex * 7919;
    const layout = generateLayout(this.tierIndex, seed);
    const walls = [];

    for (const b of layout.buildings) {
      this.enemies.push(b);
      for (let j = 0; j < b.h; j++) {
        for (let i = 0; i < b.w; i++) this.occ[(b.gz + j) * GRID + b.gx + i] = this.enemies.length - 1;
      }
      if (b.type === 'wall') { walls.push({ gx: b.gx, gz: b.gz, level: b.level }); continue; }

      const g = buildModel(b.type, b.level, { variant: variantOf(b.cx + ':' + b.cz) });
      const { x, z } = gridToWorld(b.cx, b.cz);
      g.position.set(x, 0, z);
      b.model = g;
      /* 血条挂多高必须实测：建筑高度从加农炮 1.5 到箭塔 6.1 差四倍，
         用固定偏移会让矮建筑的血条飘在半空、高塔的血条埋进塔里。 */
      b.barY = new THREE.Box3().setFromObject(g).max.y + 0.22;
      this.buildingRoot.add(g);
    }
    this.wallField.rebuild(walls);

    // 总权重用于摧毁度
    /* 【2026-10-14 按需求改】摧毁度的分母**不含城墙**。
       需求是「所有建筑没了就可以结束，城墙不包括」。
       城墙是 1×1，一个村子动辄几十段，算进分母的话 pct 极难涨上去，
       会出现「房子都平了、还在拆墙、战斗不结束」。
       服务端 pickDamagedBuildings() 本来就写了 `b.y !== 'wall'`，
       即口径本来就不含城墙，这里是让客户端与它对齐。
       于是 pct=100 ⇔ 所有建筑被摧毁 ⇔ end('destroyed')。 */
    this.totalArea = this.enemies.reduce((a, b) => a + (b.type === 'wall' ? 0 : b.area), 0) || 1;
    this.destroyedArea = 0;
    this.th = this.enemies.find((b) => b.type === 'townhall') || null;
  }

  /**
   * PVP：用服务端下发的对手存档重建村庄。
   *
   * 输入是 [{y:类型, l:等级, x:gx, z:gz, v:外观变体号}]，产出与 NPC 路径里
   * put() 完全同构的结构 —— 这样后面的 update/_fire/_impact/_recalc 一行都不用改。
   *
   * 每一处防御都是为了"手改过的存档不能把战斗搞崩"：
   *   · 未知 type 跳过（服务端已过滤一层，这里是双保险）
   *   · l 用 max(1,...) —— 存档里 l=0 表示施工中，maxHp(type,0) 会越界
   *   · 越界 / 占格冲突的整座跳过，宁可少一座房子也不能白屏
   */
  _buildFromSave(rows) {
    const walls = [];
    for (const r of rows) {
      if (!r || typeof r.y !== 'string') continue;
      if (!BUILDINGS[r.y]) continue;

      const level = Math.max(1, Math.min(5, Math.floor(Number(r.l)) || 1));
      const [w, h] = BUILDINGS[r.y].size;
      const gx = Math.round(Number(r.x) || 0);
      const gz = Math.round(Number(r.z) || 0);
      if (gx < 0 || gz < 0 || gx + w > GRID || gz + h > GRID) continue;

      // 占格冲突（手改过的档可能让两座房子叠在一起）：整座跳过
      let clash = false;
      for (let j = 0; j < h && !clash; j++) {
        for (let i = 0; i < w; i++) {
          const k = (gz + j) * GRID + gx + i;
          if (k < 0 || k >= this.occ.length || this.occ[k] !== -1) { clash = true; break; }
        }
      }
      if (clash) continue;

      const b = {
        type: r.y, level, gx, gz, w, h,
        hp: maxHp(r.y, level), maxHp: maxHp(r.y, level),
        area: w * h, dead: false,
        cx: gx + (w - 1) / 2, cz: gz + (h - 1) / 2,
        cd: Math.random() * 1.2,
      };
      this.enemies.push(b);
      const idx = this.enemies.length - 1;
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) this.occ[(gz + j) * GRID + gx + i] = idx;
      }

      if (r.y === 'wall') { walls.push({ gx, gz, level }); continue; }

      /* 外观变体：优先用服务端下发的 v（按建筑实例 id 哈希，与 village.js
         里房主自己看自己村庄的算法同源）。于是「打的就是他家」这件事在
         视觉上也成立。老快照没有 v 时退回坐标哈希，行为与从前一致。 */
      const variant = typeof r.v === 'number' && isFinite(r.v)
        ? ((r.v % BUILD_VARIANTS) + BUILD_VARIANTS) % BUILD_VARIANTS
        : variantOf(b.cx + ':' + b.cz);

      const g = buildModel(r.y, level, { variant });
      const { x, z } = gridToWorld(b.cx, b.cz);
      g.position.set(x, 0, z);
      b.model = g;
      b.barY = new THREE.Box3().setFromObject(g).max.y + 0.22;
      this.buildingRoot.add(g);
    }

    this.wallField.rebuild(walls);
    // 总权重用于摧毁度
    /* 【2026-10-14 按需求改】摧毁度的分母**不含城墙**。
       需求是「所有建筑没了就可以结束，城墙不包括」。
       城墙是 1×1，一个村子动辄几十段，算进分母的话 pct 极难涨上去，
       会出现「房子都平了、还在拆墙、战斗不结束」。
       服务端 pickDamagedBuildings() 本来就写了 `b.y !== 'wall'`，
       即口径本来就不含城墙，这里是让客户端与它对齐。
       于是 pct=100 ⇔ 所有建筑被摧毁 ⇔ end('destroyed')。 */
    this.totalArea = this.enemies.reduce((a, b) => a + (b.type === 'wall' ? 0 : b.area), 0) || 1;
    this.destroyedArea = 0;
    this.th = this.enemies.find((b) => b.type === 'townhall') || null;
  }

  /* ------------------------------------------------------------
     查询
     ------------------------------------------------------------ */
  at(gx, gz) {
    if (gx < 0 || gz < 0 || gx >= GRID || gz >= GRID) return null;
    const i = this.occ[gz * GRID + gx];
    return i === -1 ? null : this.enemies[i];
  }
  atWorld(x, z) {
    const g = worldToGrid(x, z);
    return this.at(g.gx, g.gz);
  }
  /** 世界点到建筑足迹的最近距离 */
  distToBuilding(x, z, b) {
    const dx = Math.abs(x - gridToWorld(b.cx, b.cz).x);
    const dz = Math.abs(z - gridToWorld(b.cx, b.cz).z);
    const hx = b.w / 2, hz = b.h / 2;
    const ex = Math.max(0, dx - hx), ez = Math.max(0, dz - hz);
    return Math.sqrt(ex * ex + ez * ez);
  }

  canDeployAt(x, z) {
    const g = worldToGrid(x, z);
    if (g.gx < 0 || g.gz < 0 || g.gx >= GRID || g.gz >= GRID) return false;
    for (const b of this.enemies) {
      if (b.dead) continue;
      if (g.gx >= b.gx - 1 && g.gx <= b.gx + b.w && g.gz >= b.gz - 1 && g.gz <= b.gz + b.h) return false;
    }
    return true;
  }

  /* ------------------------------------------------------------
     部队
     ------------------------------------------------------------ */
  get reserveTotal() {
    return Object.values(this.reserve).reduce((a, b) => a + b, 0);
  }
  get aliveUnits() {
    return this.units.filter((u) => !u.dead).length;
  }

  /**
   * 设置答题加成倍率（由 quiz.js 调用）。
   * 只乘倍率、不改 TROOPS 里的原始数值 —— def 是所有兵共享的引用，
   * 直接改会让加成永久留在兵种身上。
   */
  setBuff(atk, hp) {
    this.buff.atk = Math.max(1, Number(atk) || 1);
    this.buff.hp = Math.max(1, Number(hp) || 1);
  }

  select(type) {
    if ((this.reserve[type] || 0) <= 0) { this.selected = null; return false; }
    this.selected = this.selected === type ? null : type;
    return true;
  }

  deploy(x, z, type) {
    const t = type || this.selected;
    if (!t || (this.reserve[t] || 0) <= 0) return { ok: false, why: '没有可部署的部队' };
    if (!this.canDeployAt(x, z)) return { ok: false, why: '不能部署在建筑附近' };
    const def = TROOPS[t];
    this.reserve[t]--;

    const mesh = buildTroop(t);
    mesh.position.set(x, 0, z);
    this.unitRoot.add(mesh);

    const hp = Math.round(def.hp * this.buff.hp);
    const u = {
      type: t, def, mesh,
      x, z, hp, maxHp: hp,
      target: null, cd: 0, phase: Math.random() * 6.28,
      stuck: 0, bestD: Infinity, dying: 0, dead: false,
    };
    u.stepT = 0;
    u.spawnT = SPAWN_DIP;           // 落地压缩：先蹲一下再站直
    u.atkT = Math.random() * 0.6;   // 出击相位错开，一排兵不会同手同脚
    u.dmgAcc = 0;
    /* 血条高度同理按实测头顶定：巨人 1.44 与炸弹人 0.88 差了一倍 */
    u.barY = new THREE.Box3().setFromObject(mesh).max.y + 0.16;
    this.units.push(u);
    this.survivors[t] = (this.survivors[t] || 0) + 1;
    this.deployed[t] = (this.deployed[t] || 0) + 1;

    /* 落地表现：一圈冲击环 + 一蓬尘土（让「拍下去」有重量） */
    this.vfx.ring(x, 0.06, z, { r0: 0.22, r1: 1.5, dur: 0.42, a0: 0.6, color: 0xffffff });
    this.vfx.dust(x, 0.14, z, { n: 8, power: 1.7, spread: 0.42, s0: 0.14, s1: 0.55, a0: 0.5 });
    if ((this.reserve[t] || 0) <= 0 && this.selected === t) this.selected = null;
    return { ok: true };
  }

  _pickTarget(u) {
    const pref = u.def.preference;
    let best = null, bestD = Infinity;
    const score = (b, d) => {
      if (pref === 'defense') return (BUILDINGS[b.type].def ? 0 : 1000) + d;
      if (pref === 'wall') return (b.type === 'wall' ? 0 : 1000) + d;
      // 'any'：城墙权重高（最后考虑），其余按距离
      return (b.type === 'wall' ? 400 : 0) + d;
    };
    for (const b of this.enemies) {
      if (b.dead) continue;
      const d = this.distToBuilding(u.x, u.z, b);
      const s = score(b, d);
      if (s < bestD) { bestD = s; best = b; }
    }
    return best;
  }

  _walkable(x, z, target) {
    const g = worldToGrid(x, z);
    if (g.gx < 0 || g.gz < 0 || g.gx >= GRID || g.gz >= GRID) return false;
    const b = this.at(g.gx, g.gz);
    if (!b || b.dead) return true;
    return b === target;
  }

  /** 找到挡路的建筑：由近及远探测，第一个碰到的实体格就是阻挡者。
   *  之前只探一格（range+0.4），会直接跳过城墙探到墙后的目标，
   *  导致单位卡在城墙外永远不拆墙。 */
  _blocker(x, z, angle) {
    const sx = Math.sin(angle), sz = Math.cos(angle);
    for (const d of [0.42, 0.7, 1.0, 1.4, 1.9]) {
      const b = this.atWorld(x + sx * d, z + sz * d);
      if (b && !b.dead) return b;
    }
    return null;
  }

  /* ------------------------------------------------------------
     主循环
     ------------------------------------------------------------ */
  update(dt) {
    if (this.over) return;

    this.time -= dt;

    /* 防御建筑索敌开火 */
    for (const b of this.enemies) {
      if (b.dead) continue;
      const d = BUILDINGS[b.type].def;
      if (!d) continue;
      const st = d[Math.min(b.level, d.length) - 1];
      b.cd -= dt;
      // 开火后坐：整座建筑沿「目标反方向」顿一下再归位
      if (b.recoil > 0 && b.model) {
        b.recoil = Math.max(0, b.recoil - dt * 7);
        const wp = gridToWorld(b.cx, b.cz);
        b.model.position.set(wp.x + b.recX * 0.085 * b.recoil, 0, wp.z + b.recZ * 0.085 * b.recoil);
      }
      // 炮塔转向
      if (b.model && b.model.userData.turret) {
        const t = b.model.userData.turret;
        const near = this._nearestUnit(b, st.range);
        if (near) {
          const wx = gridToWorld(b.cx, b.cz).x, wz = gridToWorld(b.cx, b.cz).z;
          const want = Math.atan2(near.z - wz, near.x - wx);
          let diff = want - t.rotation.y;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          t.rotation.y += diff * Math.min(1, dt * 6);
        }
      }
      if (b.cd > 0) continue;
      const u = this._nearestUnit(b, st.range, st.min);
      if (!u) continue;
      b.cd = st.rof;
      this._fire(b, st, u);
    }

    /* 单位 */
    for (const u of this.units) {
      if (u.dead) continue;
      this._updateUnit(u, dt);
    }
    this._separate(dt);

    /* 弹道与粒子都交给 fx.js 的池（旧版这里每帧在 new 几何体和材质） */
    this.vfx.update(dt);
    /* 血条：同样是表现层，每帧重建实例缓冲（整层恒定 5 个 draw call） */
    this.bars.sync(this, dt);
    this._updateFires(dt);
    this._updateUnitOutline();
    if (this._popT > 0) this._popT -= dt;

    /* 清理阵亡单位 */
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (!u.dead) continue;
      u.dying -= dt;
      u.mesh.rotation.x = -Math.min(1, 1 - u.dying / 0.55) * 1.4;
      u.mesh.position.y = -Math.max(0, 0.55 - u.dying) * 0.5;
      if (u.dying <= 0) {
        this.unitRoot.remove(u.mesh);
        this.units.splice(i, 1);
      }
    }

    /* 结算判定 */
    this._recalc();
    if (this.onTick) this.onTick(this);

    if (this.pct >= 100) return this.end('destroyed');
    if (this.time <= 0) return this.end('timeout');
    if (this.aliveUnits === 0 && this.reserveTotal === 0) return this.end('army');
  }

  /**
   * 兵海压上来时关掉单位描边。
   * 描边壳占掉单位一半的网格数；同屏单位超过 UNIT_OUTLINE_MAX
   * 就先保帧率。建筑描边不受影响（它们数量固定、剪影更重要）。
   */
  _updateUnitOutline() {
    /* 低画质档引擎已经全局关掉描边了，这里不能再把它们打开 */
    const on = this.engine.quality !== 'low' && this.aliveUnits <= UNIT_OUTLINE_MAX;
    if (on === this._unitOutline) return;
    this._unitOutline = on;
    this.unitRoot.traverse((o) => {
      if (o.isMesh && o.userData && o.userData.isOutline) o.visible = on;
    });
  }

  /** 单位间软分离，避免叠成一团（推入被占格则回退） */
  _separate() {
    const MIN = 0.55, MIN2 = MIN * MIN;
    const list = this.units;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead) continue;
        let dx = b.x - a.x, dz = b.z - a.z;
        let d2 = dx * dx + dz * dz;
        if (d2 > MIN2) continue;
        if (d2 < 1e-6) {
          dx = Math.random() - 0.5; dz = Math.random() - 0.5; d2 = dx * dx + dz * dz;
        }
        const d = Math.sqrt(d2);
        const push = (MIN - d) * 0.42;
        dx /= d; dz /= d;
        const ax = a.x - dx * push, az = a.z - dz * push;
        const bx = b.x + dx * push, bz = b.z + dz * push;
        if (this._walkable(ax, az, a.target)) { a.x = ax; a.z = az; }
        if (this._walkable(bx, bz, b.target)) { b.x = bx; b.z = bz; }
      }
    }
  }

  _setTarget(u, b) {
    if (u.target === b) return;
    u.target = b;
    u.bestD = Infinity;
    u.stuck = 0;
  }

  _nearestUnit(b, range, min = 0) {
    const { x: bx, z: bz } = gridToWorld(b.cx, b.cz);
    let best = null, bd = Infinity;
    for (const u of this.units) {
      if (u.dead) continue;
      const d = dist(bx, bz, u.x, u.z);
      if (d > range || d < min) continue;
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  /* ------------------------------------------------------------
     单位行为
     ------------------------------------------------------------ */
  _updateUnit(u, dt) {
    /* 落地压缩回弹：部署后 SPAWN_DIP 秒内先蹲一下，脚才像踩在草地上 */
    if (u.spawnT > 0) {
      u.spawnT = Math.max(0, u.spawnT - dt);
      const k = u.spawnT / SPAWN_DIP;
      const sq = 1 - 0.28 * k * k;
      const inv = 1 / Math.sqrt(sq);
      u.mesh.scale.set(inv, sq, inv);
    } else if (u.mesh.scale.y !== 1) {
      u.mesh.scale.set(1, 1, 1);
    }
    if (!u.target || u.target.dead) {
      const nt = this._pickTarget(u);
      if (nt !== u.target) { u.bestD = Infinity; u.stuck = 0; }
      u.target = nt;
    }
    const t = u.target;
    if (!t) {
      // 没有目标：原地待机
      u.mesh.position.set(u.x, 0, u.z);
      this._poseIdle(u);
      return;
    }

    const d = this.distToBuilding(u.x, u.z, t);
    if (d <= u.def.range) {
      // 攻击
      u.stuck = 0; u.bestD = 0;
      u.cd += dt;
      const dmg = u.def.dps * dt * this.buff.atk;
      this._damage(t, dmg, u);
      // 攻击方向朝向目标
      const tp = gridToWorld(t.cx, t.cz);
      u.mesh.rotation.y = Math.atan2(tp.x - u.x, tp.z - u.z);
      /* 出招节奏：伤害照旧连续结算（数值手感不变），但挥砍 / 拉弓 / 砸地
         按 ATTACK_CYCLE 走一个完整动作，飘字也在动作落点处跳一次。 */
      u.atkT += dt;
      const cyc = ATTACK_CYCLE[u.type] || 1.1;
      if (u.atkT >= cyc) { u.atkT -= cyc; this._onStrike(u, t, tp); }
      this._poseAttack(u, Math.min(1, u.atkT / cyc));
      // 自杀式兵种
      if (u.def.suicide && d <= u.def.range + 0.15 && u.cd > 0.35) {
        this._explode(u);
        return;
      }
    } else {
      // 移动
      const tp = gridToWorld(t.cx, t.cz);
      const base = Math.atan2(tp.x - u.x, tp.z - u.z);
      const step = u.def.speed * dt;
      let moved = false;
      for (const off of [0, 0.42, -0.42, 0.9, -0.9, 1.5, -1.5, 2.1, -2.1]) {
        const a = base + off;
        const sx = Math.sin(a), sz = Math.cos(a);
        const nx = u.x + sx * step, nz = u.z + sz * step;
        if (this._walkable(nx, nz, t)) {
          u.x = nx; u.z = nz;
          moved = true;
          u.mesh.rotation.y = a;
          break;
        }
      }
      // 卡住判定：只有「刷新历史最近距离」才算真正的进展。
      // 之前用逐帧距离差，会被沿墙来回蹭的振荡骗过，导致永远不拆墙。
      const after = this.distToBuilding(u.x, u.z, t);
      if (after < u.bestD - 0.02) { u.bestD = after; u.stuck = 0; }
      else u.stuck += dt;

      if (u.stuck > (moved ? 2.0 : 0.5)) {
        const bl = this._blocker(u.x, u.z, base);
        if (bl && bl !== t) { this._setTarget(u, bl); }
        else u.stuck = 1.2;
      }
      // 走路上下起伏 + 四肢摆动
      u.phase += dt * 11;
      u.mesh.position.set(u.x, Math.abs(Math.sin(u.phase)) * 0.09, u.z);
      u.mesh.rotation.z = Math.sin(u.phase) * 0.07;
      this._poseWalk(u, 1);
      this._footDust(u, dt);
      return;
    }
  }

  /* ------------------------------------------------------------
     姿势系统
     ------------------------------------------------------------
     建模时 models-units.js 把 6 个关节做成了独立 Group，并在 models.js 里
     被声明成网格合并的「岛根」—— 所以合并优化之后，手脚依然能独立旋转。
     基准姿势（如弓箭手抬弓的 armL.rotation.set(...)）在建模型时就捕获在
     parts.base 里，这里只做叠加，不会把造型改掉。

     旧版最大的问题是「两条腿锁在同一个 Group 里一起摆」，走起来像钟摆。
     现在 legL / legR 反相，手臂再反相一次，躯干前倾、头随之点动 ——
     这四件事加起来，才让 25px 高的小人有「在走路」的感觉。
     ------------------------------------------------------------ */

  /** 走路：反相迈腿 + 反向摆臂 + 躯干前倾与侧倾 + 头部点动 */
  _poseWalk(u, amp) {
    const P = u.mesh.userData.parts;
    if (!P || !P.joints) return;
    const J = P.joints, B = P.base;
    const sw = Math.sin(u.phase);
    const cw = Math.cos(u.phase);
    J.legL.rotation.x = B.legL - sw * 0.58 * amp;
    J.legR.rotation.x = B.legR + sw * 0.58 * amp;
    J.armL.rotation.x = B.armL + sw * 0.36 * amp;
    J.armR.rotation.x = B.armR - sw * 0.32 * amp;
    J.torso.rotation.x = B.torsoX + 0.055;
    J.torso.rotation.y = B.torsoY + cw * 0.07 * amp;
    J.torso.rotation.z = B.torsoZ - cw * 0.05 * amp;
    J.head.rotation.x = B.headX + Math.abs(sw) * 0.055;
  }

  /** 待机：轻微呼吸，不要像根柱子 */
  _poseIdle(u) {
    const P = u.mesh.userData.parts;
    if (!P || !P.joints) return;
    const J = P.joints, B = P.base;
    u.idleT = (u.idleT || 0) + 0.016;
    const b = Math.sin(u.idleT * 1.7);
    J.legL.rotation.x = B.legL;
    J.legR.rotation.x = B.legR;
    J.armL.rotation.x = B.armL + b * 0.05;
    J.armR.rotation.x = B.armR - b * 0.05;
    J.torso.rotation.x = B.torsoX + b * 0.02;
    J.torso.rotation.y = B.torsoY;
    J.head.rotation.x = B.headX + b * 0.04;
  }

  /**
   * 攻击：抬起 → 劈下。
   * 一个公式覆盖四个兵种：armR 从「抬到身后」到「砸到身前」，
   * 躯干跟着拧、腿跟着蹬。弓箭手的右手本来就是拉弦的手，同样成立。
   */
  _poseAttack(u, w) {
    const P = u.mesh.userData.parts;
    if (!P || !P.joints) return;
    const J = P.joints, B = P.base;
    const pose = ATTACK_POSE[u.type] || ATTACK_POSE.barbarian;
    /* 旋转方向别搞反：绕 +X 转是把手臂往「身后」送。
       所以抬起（蓄力）= 角度变正，劈下（发力）= 角度变负。
       总行程 2.6*arm 弧度，约 150°，在 25px 上也看得出是在砍东西。 */
    const raise = Math.sin(Math.min(1, w / 0.55) * Math.PI * 0.5);   // 0→1 蓄力
    const drop = w < 0.55 ? 0 : (w - 0.55) / 0.45;                   // 0→1 劈下
    const a = 1.6 * raise - 1.0 * drop;
    J.armR.rotation.x = B.armR + pose.arm * a;
    J.armL.rotation.x = B.armL - pose.arm * a * 0.3;
    J.torso.rotation.x = B.torsoX + pose.lean * (0.35 + 0.65 * drop);
    J.torso.rotation.y = B.torsoY - pose.twist * Math.sin(w * Math.PI);
    J.torso.rotation.z = B.torsoZ;
    J.head.rotation.x = B.headX - pose.lean * 0.55 * drop;
    J.legL.rotation.x = B.legL + 0.3 * drop;
    J.legR.rotation.x = B.legR - 0.24 * drop;
  }

  /** 脚步扬尘：按步频出尘，且只在移动时出 */
  _footDust(u, dt) {
    if (this.vfx.budget < 0.5) return;
    u.stepT -= dt;
    if (u.stepT > 0) return;
    /* 只在脚落地的相位出尘（|sin| 接近 0 时），否则会一路拖灰 */
    const sw = Math.abs(Math.sin(u.phase));
    u.stepT = 0.16;
    if (sw > 0.42) return;
    this.vfx.dust(u.x, 0.06, u.z, { n: 1, power: 0.7, spread: 0.2, s0: 0.08, s1: 0.3, a0: 0.3, life: 0.5 });
  }

  /**
   * 一次攻击动作的「落点表现」。
   * 弓箭手真的射一支箭出去（弹道、尾迹、落地火花都在 fx 里）；
   * 近战在命中点冒火花 + 木屑 + 飘字；炸弹人由 _explode 接管。
   */
  _onStrike(u, t, tp) {
    if (u.def.suicide) return;                       // 自爆兵不挥空
    const dmg = Math.max(1, Math.round(u.dmgAcc));
    u.dmgAcc = 0;
    const y = 0.72;

    if (u.type === 'archer') {
      const from = troopAnchor(u.mesh, 'weapon', this._va)
        || this._va.set(u.x, 0.85, u.z);
      const fx0 = from.x, fy0 = from.y, fz0 = from.z;
      this.vfx.shoot({
        kind: 'arrow',
        from: { x: fx0, y: fy0, z: fz0 },
        to: { x: tp.x, y, z: tp.z },
        speed: 27,
        payload: { t, dmg },
        onHit: (p, to) => {
          this.vfx.sparks(to.x, to.y, to.z, { n: 5, power: 2.3, color: 0xffe08a });
          this._pop(to.x, to.y + 0.3, to.z, '-' + p.dmg, 'dmg');
        },
      });
      sfx.arrow();
      return;
    }

    /* 近战命中点：火花 + 尘 + 木屑/石屑 */
    this.vfx.sparks(tp.x, y, tp.z, { n: 6, power: 2.7, color: 0xffd27a });
    this.vfx.dust(tp.x, 0.32, tp.z, { n: 3, power: 1.1, spread: 0.3, s0: 0.1, s1: 0.38, a0: 0.38 });
    this.vfx.debris(tp.x, y, tp.z, { n: 3, power: 2.4, size: 0.085, buckets: ['wood', 'stone'] });
    this._pop(tp.x, y + 0.35, tp.z, '-' + dmg, 'dmg');
    this.vfx.shake(0.03, 0.1);
    sfx.slash();
  }

  /** 飘字节流：一屏十几个人同时砍会糊成一片，限制在每秒 4 个左右 */
  _pop(x, y, z, text, kind) {
    if (this._popT > 0 && kind !== 'crit') return;
    this._popT = 0.24;
    this.vfx.popup(x, y, z, text, kind);
  }

  /* ------------------------------------------------------------
     伤害
     ------------------------------------------------------------ */
  _damage(b, dmg, src) {
    if (b.dead) return;
    b.hp -= dmg;
    if (b.model && Math.random() < 0.25) b.model.rotation.y += (Math.random() - 0.5) * 0.02;
    if (b.hp <= 0) this._killBuilding(b);
  }

  _killBuilding(b) {
    b.hp = 0; b.dead = true;
    /* 与分母同口径：城墙不参与摧毁度统计 ——
       否则打掉一段墙也能推进进度条，几秒就能刷到 100%，
       和「所有建筑没了才结束」的语义相反。城墙照旧阻挡、照旧有血条。 */
    if (b.type !== 'wall') this.destroyedArea += b.area;
    const { x, z } = gridToWorld(b.cx, b.cz);

    if (b.type === 'wall') {
      // 城墙走实例化渲染，重建实例数据即可
      this._rebuildWalls();
    } else if (b.model) {
      /* 取一个真实材质当残骸色。注意合并优化之后 children[0] 是 Group 而不是
         Mesh，再按老写法取 .material 会拿到 undefined —— 残骸会变成一坨白盒子。 */
      let mat = null;
      b.model.traverse((o) => {
        if (mat || !o.isMesh || !o.material) return;
        if (o.userData && o.userData.isOutline) return;
        if (o.material.isMeshToonMaterial) mat = o.material;
      });
      if (!mat) mat = toonMat(0x9a938a, { grad: GRAD_SOFT });

      this.buildingRoot.remove(b.model);

      // 残骸
      const debris = new THREE.Group();
      const rnd = Math.random;
      for (let i = 0; i < 5; i++) {
        const s = 0.18 + rnd() * 0.26;
        const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
        m.position.set((rnd() - 0.5) * b.w * 0.7, s / 2, (rnd() - 0.5) * b.h * 0.7);
        m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
        m.castShadow = true;
        debris.add(m);
      }
      debris.position.set(x, 0, z);
      this.buildingRoot.add(debris);

      /* 释放这座建筑的几何体。每个模型的几何体都是现场新建的，
         不 dispose 的话打完几场就堆出几十 MB 显存。 */
      b.model.traverse((o) => {
        if (o.isMesh && o.geometry && o.geometry.dispose) o.geometry.dispose();
      });
      b.model = null;
    }
    sfx.crumble();
    /* 塌落：灰云 + 碎块 + 尘环 + 震屏 + 焦痕，之后残骸还会冒一阵烟 */
    this.vfx.collapse(x, 1.0, z, {
      r: Math.max(1.2, b.w * 0.72),
      buckets: b.type === 'wall' ? ['stone', 'dirt'] : ['stone', 'wood', 'dirt'],
      amp: b.type === 'wall' ? 0.13 : 0.26,
    });
    this.fires.push({ x, z, t: 5.0, acc: 0 });
    if (this.onTick) this.onTick(this);
  }

  _rebuildWalls() {
    const alive = this.enemies.filter((b) => b.type === 'wall' && !b.dead);
    this.wallField.rebuild(alive.map((w) => ({ gx: w.gx, gz: w.gz, level: w.level })));
  }

  _explode(u) {
    const d = u.def;
    const r = d.splash || 1.5;
    const dmg = d.dps * (d.splashMult || 6);
    for (const b of this.enemies) {
      if (b.dead) continue;
      if (this.distToBuilding(u.x, u.z, b) <= r) this._damage(b, dmg);
    }
    sfx.boom();
    /* 炸弹人自爆是全场最响的一下：火球 + 冲击波 + 烟柱 + 碎块 + 强震屏 */
    this.vfx.explosion(u.x, 0.5, u.z, {
      r: Math.max(1.8, r), n: 22, debris: 20, sparks: 24, smoke: 14,
      light: 10, amp: 0.36, embers: true,
    });
    this.vfx.popup(u.x, 1.4, u.z, 'BOOM', 'crit');
    this._killUnit(u);
  }

  _killUnit(u) {
    if (u.dead) return;
    u.dead = true;
    u.dying = 0.55;
    const t = u.type;
    if (this.survivors[t]) this.survivors[t] = Math.max(0, this.survivors[t] - 1);
    /* 倒下时扬一小蓬土；翻滚动作在 update 的清理循环里做 */
    this.vfx.dust(u.x, 0.12, u.z, { n: 5, power: 1.3, spread: 0.36, s0: 0.12, s1: 0.45, a0: 0.42 });
  }

  /* ------------------------------------------------------------
     防御开火
     ------------------------------------------------------------ */
  _fire(b, st, u) {
    const { x: bx, z: bz } = gridToWorld(b.cx, b.cz);
    let ox = bx, oz = bz, oy = 1.3;
    if (b.model && b.model.userData.muzzle) {
      const p = new THREE.Vector3();
      b.model.userData.muzzle.getWorldPosition(p);
      ox = p.x; oy = p.y; oz = p.z;
    }
    const isMortar = b.type === 'mortar';
    const speed = isMortar ? 9 : 26;
    const tx = u.x, ty = 0.55, tz = u.z;

    /* 炮口闪光 + 烟，并给整座建筑一次后坐（沿目标反方向顿一下） */
    const dx = tx - ox, dz = tz - oz;
    const dl = Math.hypot(dx, dz) || 1;
    this.vfx.muzzle(ox, oy, oz, { x: dx / dl, z: dz / dl }, { light: isMortar ? 2.6 : 3.4 });
    b.recoil = 1;
    b.recX = -dx / dl;
    b.recZ = -dz / dl;

    this.vfx.shoot({
      kind: isMortar ? 'bomb' : 'shell',
      from: { x: ox, y: oy, z: oz },
      to: { x: tx, y: ty, z: tz },
      speed,
      arc: isMortar ? 3.4 : 0,
      scale: isMortar ? 1.25 : 1,
      payload: { dmg: st.dps * st.rof, splash: st.splash || 0, target: u },
      onHit: (p, to) => this._impact(p, to),
    });
    sfx.shot(isMortar);
  }

  /** 弹道命中：payload 由 _fire 打包，to 是落点（世界坐标） */
  _impact(p, to) {
    if (p.splash > 0) {
      for (const u of this.units) {
        if (u.dead) continue;
        if (dist(to.x, to.z, u.x, u.z) <= p.splash) this._hurtUnit(u, p.dmg);
      }
      sfx.boom();
      this.vfx.explosion(to.x, 0.4, to.z, {
        r: Math.max(1.1, p.splash * 0.85), n: 14, debris: 8, sparks: 12, smoke: 8,
        light: 6, amp: 0.2, embers: true,
      });
      return;
    }
    const u = p.target;
    if (u && !u.dead) this._hurtUnit(u, p.dmg);
    this.vfx.sparks(to.x, to.y, to.z, { n: 5, power: 2.3, color: 0xffe08a });
    this._pop(to.x, to.y + 0.35, to.z, '-' + Math.round(p.dmg), 'crit');
  }

  _hurtUnit(u, dmg) {
    u.hp -= dmg;
    if (u.hp <= 0) this._killUnit(u);
  }

  /* ------------------------------------------------------------
     粒子
     ------------------------------------------------------------ */
  /**
   * 残骸余火。旧版这里是 spawnBurst —— 每个粒子都现 new 一个几何体和材质，
   * 现在粒子全部走 fx.js 的池；这里只负责「塌过的建筑继续冒一阵烟」。
   */
  _updateFires(dt) {
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t -= dt;
      if (f.t <= 0) { this.fires.splice(i, 1); continue; }
      f.acc += dt;
      if (f.acc < 0.17) continue;
      f.acc = 0;
      this.vfx.smoke(f.x, 0.55, f.z, { n: 1, rise: 1.5, life: 1.7, s0: 0.26, s1: 1.15, a0: 0.3 });
      this.vfx.embers(f.x, 0.45, f.z, { n: 1, life: 1.1 });
    }
  }

  /* ------------------------------------------------------------
     结算
     ------------------------------------------------------------ */
  _recalc() {
    this.pct = clamp((this.destroyedArea / this.totalArea) * 100, 0, 100);
    let s = 0;
    if (this.pct >= 50) s++;
    if (this.th && this.th.dead) s++;
    if (this.pct >= 99.5) s = 3;
    this.stars = s;
  }

  end(reason) {
    if (this.over) return null;
    this.over = true;
    this._recalc();
    /* 战斗一结束就收血条：结算卡 700ms 后盖上来，留一排血条在那儿会穿帮 */
    if (this.bars) this.bars.clear();

    /* 结算瞬间的表现：拿到星就在市政厅上放一束金色火花 */
    if (this.stars >= 1) {
      const c = this.th ? gridToWorld(this.th.cx, this.th.cz) : { x: 0, z: 0 };
      this.vfx.ring(c.x, 0.08, c.z, { r0: 1.0, r1: 6.5, dur: 0.95, a0: 0.7, color: 0xffd75e });
      this.vfx.fire(c.x, 2.4, c.z, { n: 20, r: 1.1, life: 0.95, color: 0xffd75e });
      this.vfx.sparks(c.x, 2.2, c.z, { n: 24, power: 6.5, color: 0xffe9a8 });
    }

    const ratio = this.pct / 100;
    /* ⚠️ gold 恒为 0 —— 见 main.js _finishBattle 的说明。
       「金币=铜板」之后，客户端能算出的任何金币数都是一台印钞机：
       tier5 的 loot 是 1719，一场满星战斗折算是 1719×0.62 ≈ 1065 铜板，
       而玩家一天正常学习只有 20~40 铜板。铜板由服务端按星级另发。
       elixir 是纯游戏内资源，保留原算法。 */
    const gold = 0;
    /* PVP 时掠夺基数用服务端下发的对手圣水存量，而不是 RAID_TIERS 的写死 loot
       —— 打真人时"关卡固定产出"这个概念根本不存在。
       注意这只是客户端预估，最终以 /attack/finish 返回的权威值为准。 */
    const lootBase = this.mode === 'pvp' ? (Number(this.opts.lootElixir) || 0) : this.tier.loot;
    const elixir = Math.floor(lootBase * ratio * 0.62);

    const result = {
      reason,
      pct: Math.round(this.pct * 10) / 10,
      stars: this.stars,
      gold, elixir,
      gems: this.stars >= 1 ? this.stars * 5 : 0,
      survivors: Object.assign({}, this.survivors),
      deployed: Object.assign({}, this.deployed),
      tier: this.tier,
    };
    this.result = result;
    return result;
  }

  /* ------------------------------------------------------------
     销毁
     ------------------------------------------------------------ */
  dispose() {
    if (this.vfx) this.vfx.dispose();     // 自带对象池，并会把 fxRoot 摘下来
    if (this.bars) this.bars.dispose();
    this.engine.scene.remove(this.root);
    this.root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      /* 兵种的几何体是原型共享的，绝不能在这里释放 ——
         否则下一场战斗里同兵种的模型会直接变成空壳。
         models.js 给原型几何打了 __protoshare 标记。 */
      if (o.geometry.userData && o.geometry.userData.__protoshare) return;
      if (o.geometry.dispose) o.geometry.dispose();
    });
  }
}
