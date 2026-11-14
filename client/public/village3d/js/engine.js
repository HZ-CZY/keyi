/* ============================================================
   engine.js — 渲染器 / 场景 / 摄像机 / 地形 / 输入
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';
import {
  toonMat, part, outlineMat, tuneOutline, outlineState,
  GRAD_MAIN, GRAD_SOFT, GRAD_DARK, gradientMap,
  cyl, cone, ball, mulberry32, clamp,
} from './toon.js';
import { chamferGeo, mergeGeos } from './shapes.js';
import { TILE, GRID, gridToWorld, PALETTE } from './config.js';
/* 【2026-10-19】昼夜与天气：由 sky.js 统一驱动天空穹顶 / 光照 / 雾，不再固定正午晴天 */
import { SkySystem } from './sky.js';

/** 岛屿空地半径（格），比可建造区大一圈用于装饰 */
export const ISLAND_PAD = 5;

/* ============================================================
   摄像机控制（iPad 触控：单指平移 / 双指缩放旋转）
   ============================================================ */
export class CameraRig {
  constructor(camera, dom) {
    this.cam = camera;
    this.dom = dom;

    this.target = new THREE.Vector3(0, 0, 0);
    this.dist = 52;
    this.azim = Math.PI * 0.25;   // 45° 等距视角
    this.polar = 0.815;           // 与 Y 轴夹角 ≈ 46.7°（俯角 43°）

    this.distGoal = this.dist;
    this.azimGoal = this.azim;
    this.polarGoal = this.polar;
    this.targetGoal = this.target.clone();

    this.minDist = 15;
    this.maxDist = 96;
    this.minPolar = 0.52;   // 俯角上限（更俯视）
    this.maxPolar = 1.18;   // 俯角下限（更平视）

    this.bounds = (GRID / 2 + ISLAND_PAD - 1);
    this._tmp = new THREE.Vector3();

    /* 屏幕震动：爆炸 / 塌落 / 炸弹人自爆用。
       只抖位置不抖朝向 —— 便宜、够用，而且不会把 lookAt 的稳定性搞坏。 */
    this.shakeAmp = 0;
    this.shakeT = 0;
    this.shakeT0 = 1;
  }

  /**
   * 触发屏幕震动。
   * @param {number} amp 振幅（世界单位，0.1~0.4 比较合适）
   * @param {number} dur 持续时间（秒）
   */
  shake(amp, dur) {
    const a = amp || 0.2;
    // 取较大值而不是叠加：连续爆炸时不会震成地震
    this.shakeAmp = Math.max(this.shakeAmp * (this.shakeT > 0 ? this.shakeT / this.shakeT0 : 0), a);
    this.shakeT0 = Math.max(0.03, dur || 0.3);
    this.shakeT = this.shakeT0;
  }

  /** 屏幕像素 → 目标平面上 1px 对应多少世界单位 */
  worldPerPixel() {
    const h = this.dom.clientHeight || 1;
    return (2 * this.dist * Math.tan((this.cam.fov * Math.PI / 180) / 2)) / h;
  }

  /** 按屏幕位移平移（拖拽手感与手指一致） */
  panByPixels(dx, dy) {
    const wpp = this.worldPerPixel();
    const elev = Math.PI / 2 - this.polar;         // 俯角
    const sinE = Math.max(0.2, Math.sin(elev));
    // 摄像机在水平面上的朝向
    const fx = -Math.sin(this.azim), fz = -Math.cos(this.azim);
    const rx = Math.cos(this.azim),  rz = -Math.sin(this.azim);
    const kx = -dx * wpp;
    const kz = (dy * wpp) / sinE;
    this.targetGoal.x += rx * kx + fx * kz;
    this.targetGoal.z += rz * kx + fz * kz;
    this.targetGoal.x = clamp(this.targetGoal.x, -this.bounds, this.bounds);
    this.targetGoal.z = clamp(this.targetGoal.z, -this.bounds, this.bounds);
  }

  /** 缩放：factor > 1 拉远 */
  zoomBy(factor) {
    this.distGoal = clamp(this.distGoal * factor, this.minDist, this.maxDist);
  }

  /** 旋转（弧度） */
  rotateBy(rad) {
    this.azimGoal += rad;
  }

  tiltBy(rad) {
    this.polarGoal = clamp(this.polarGoal + rad, this.minPolar, this.maxPolar);
  }

  /** 平滑聚焦到某点 */
  focusOn(wx, wz, dist) {
    this.targetGoal.set(wx, 0, wz);
    this.targetGoal.x = clamp(this.targetGoal.x, -this.bounds, this.bounds);
    this.targetGoal.z = clamp(this.targetGoal.z, -this.bounds, this.bounds);
    if (dist) this.distGoal = clamp(dist, this.minDist, this.maxDist);
  }

  /** 立即到位（读档、进入战斗时用） */
  snap() {
    this.target.copy(this.targetGoal);
    this.dist = this.distGoal;
    this.azim = this.azimGoal;
    this.polar = this.polarGoal;
    this.apply();
  }

  update(dt) {
    const k = 1 - Math.pow(0.0015, dt);   // 指数阻尼，帧率无关
    this.target.lerp(this.targetGoal, k);
    // 角度差归一到最短路径
    let da = this.azimGoal - this.azim;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    this.azim += da * k;
    this.dist += (this.distGoal - this.dist) * k;
    this.polar += (this.polarGoal - this.polar) * k;
    if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt);
    this.apply();
  }

  apply() {
    const sp = Math.sin(this.polar), cp = Math.cos(this.polar);
    const x = this.target.x + this.dist * sp * Math.sin(this.azim);
    const y = this.target.y + this.dist * cp;
    const z = this.target.z + this.dist * sp * Math.cos(this.azim);
    this.cam.position.set(x, y, z);
    this.cam.lookAt(this.target.x, this.target.y + 1.2, this.target.z);

    if (this.shakeT > 0 && this.shakeAmp > 0) {
      const u = this.shakeT / this.shakeT0;
      const a = this.shakeAmp * u * u;          // 平方衰减，收尾不突兀
      this.cam.position.x += (Math.random() - 0.5) * a;
      this.cam.position.y += (Math.random() - 0.5) * a * 0.7;
      this.cam.position.z += (Math.random() - 0.5) * a;
    }
  }
}

/* ============================================================
   地形纹理（Canvas 生成，无外部资源）
   ============================================================ */
function grassTexture() {
  const C = document.createElement('canvas');
  const T = 64, N = 4;                 // 每格 64px，共 4x4 格
  C.width = C.height = T * N;
  const g = C.getContext('2d');

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const even = (x + y) % 2 === 0;
      g.fillStyle = even ? PALETTE.grassA : PALETTE.grassB;
      g.fillRect(x * T, y * T, T, T);
    }
  }
  // 细碎草点
  const rnd = mulberry32(20260924);
  for (let i = 0; i < 1500; i++) {
    const x = rnd() * C.width, y = rnd() * C.height;
    g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,.13)' : 'rgba(60,120,40,.13)';
    g.fillRect(x, y, 2, 2);
  }
  // 格线（很浅，只用于暗示网格）
  g.strokeStyle = 'rgba(70,140,50,.20)';
  g.lineWidth = 2;
  for (let i = 0; i <= N; i++) {
    g.beginPath(); g.moveTo(i * T, 0); g.lineTo(i * T, C.height); g.stroke();
    g.beginPath(); g.moveTo(0, i * T); g.lineTo(C.width, i * T); g.stroke();
  }

  const tex = new THREE.CanvasTexture(C);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function gridOverlayTexture() {
  const C = document.createElement('canvas');
  const T = 32;
  C.width = C.height = T;
  const g = C.getContext('2d');
  g.clearRect(0, 0, T, T);
  g.strokeStyle = 'rgba(255,255,255,.55)';
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(0, 0.75); g.lineTo(T, 0.75); g.stroke();
  g.beginPath(); g.moveTo(0.75, 0); g.lineTo(0.75, T); g.stroke();
  const tex = new THREE.CanvasTexture(C);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ============================================================
   城墙实例化场（大量城墙只占 10 个 draw call）
   ============================================================ */
const WALL_LIMIT = 140;
export class WallField {
  constructor() {
    this.levels = new Map();     // level -> { solid, shell, count }
    this.levelsInfo = [];
    this.group = new THREE.Group();
    this.group.name = 'walls';
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);
  }

  _level(lv) {
    if (!this.levels.has(lv)) {
      const i = Math.min(Math.max(lv, 1), 5) - 1;
      // 墙体：切角石柱（几何体自带绝对高度，实例只需平移 x/z）
      const body = chamferGeo(0.94, 1.3, 0.94, { bevel: 0.052, corner: 0.06 });
      body.translate(0, 0.65, 0);
      // 垛口 + 勒脚（多零件烘成一个几何体，仍然只占 1 个 draw call）
      const cap = mergeGeos([
        { geo: new THREE.BoxGeometry(0.98, 0.1, 0.98), y: 1.33 },
        { geo: chamferGeo(0.3, 0.27, 0.3, { bevel: 0.04, corner: 0.045 }), x: 0.33, y: 1.5, z: 0.33 },
        { geo: chamferGeo(0.3, 0.27, 0.3, { bevel: 0.04, corner: 0.045 }), x: -0.33, y: 1.5, z: 0.33 },
        { geo: chamferGeo(0.3, 0.27, 0.3, { bevel: 0.04, corner: 0.045 }), x: 0.33, y: 1.5, z: -0.33 },
        { geo: chamferGeo(0.3, 0.27, 0.3, { bevel: 0.04, corner: 0.045 }), x: -0.33, y: 1.5, z: -0.33 },
        { geo: chamferGeo(1.0, 0.13, 1.0, { bevel: 0.035, corner: 0.06 }), y: 0.065 },
      ]);

      const bodyC = [0xc4ab84, 0xbea279, 0xb79a70, 0xad9066, 0xa3865c][i];
      const capC = [0xdcc9a6, 0xd6c19c, 0xcfb892, 0xc6ad86, 0xbea37a][i];

      const solid = new THREE.InstancedMesh(body, toonMat(bodyC, { grad: GRAD_SOFT }), WALL_LIMIT);
      const shell = new THREE.InstancedMesh(body, outlineMat(PALETTE.outline), WALL_LIMIT);
      const capM = new THREE.InstancedMesh(cap, toonMat(capC, { grad: GRAD_SOFT }), WALL_LIMIT);
      shell.userData.isOutline = true;
      shell.visible = outlineState.on;
      solid.castShadow = true; solid.receiveShadow = true;
      capM.castShadow = true;
      for (const m of [solid, shell, capM]) {
        m.count = 0;
        m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(m);
      }

      const rec = { solid, shell, cap: capM, count: 0 };
      this.levels.set(lv, rec);
      this.levelsInfo.push({ lv, rec });
      return rec;
    }
    return this.levels.get(lv);
  }

  /** walls: [{gx, gz, level}] */
  rebuild(walls) {
    for (const rec of this.levels.values()) { rec.count = 0; }

    for (const w of walls) {
      const rec = this._level(w.level);
      if (rec.count >= WALL_LIMIT) continue;
      const { x, z } = gridToWorld(w.gx, w.gz);
      const i = rec.count;
      this._p.set(x, 0, z);
      this._m.compose(this._p, this._q, this._s);
      rec.solid.setMatrixAt(i, this._m);
      rec.shell.setMatrixAt(i, this._m);
      rec.cap.setMatrixAt(i, this._m);
      rec.count++;
    }

    for (const { rec } of this.levelsInfo) {
      rec.solid.count = rec.count;
      rec.shell.count = rec.count;
      rec.cap.count = rec.count;
      rec.solid.instanceMatrix.needsUpdate = true;
      rec.shell.instanceMatrix.needsUpdate = true;
      rec.cap.instanceMatrix.needsUpdate = true;
    }
  }
}

/* ============================================================
   环境道具实例化场
   ------------------------------------------------------------
   草丛 / 小花 / 碎石这类小件数量多（上百个），逐个建 Mesh 会把
   draw call 打爆。做法与城墙一致：
     同色零件 mergeGeos 烘成一个几何体 → InstancedMesh
   于是「几百株草」只占几个 draw call。
   小件默认不出描边：0.05 量级的物体配 2.6px 描边会糊成黑团。
   ============================================================ */
const _pm4 = new THREE.Matrix4();
const _ppv = new THREE.Vector3();
const _ppq = new THREE.Quaternion();
const _pps = new THREE.Vector3();
const _pup = new THREE.Vector3(0, 1, 0);

/**
 * @param {Array} defs [{ color, grad, items:[{geo,x,y,z,rx,ry,rz}] }]
 * @param {number} cap 最大实例数
 * @param {boolean} withOutline 是否生成描边壳
 */
function instField(defs, cap, withOutline = false) {
  const group = new THREE.Group();
  const layers = [];
  for (const d of defs) {
    const geo = mergeGeos(d.items);
    const solid = new THREE.InstancedMesh(geo, toonMat(d.color, { grad: d.grad || GRAD_MAIN }), cap);
    solid.castShadow = true;
    solid.count = 0;
    solid.frustumCulled = false;
    solid.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(solid);
    let shell = null;
    if (withOutline) {
      shell = new THREE.InstancedMesh(geo, outlineMat(PALETTE.outline), cap);
      shell.count = 0;
      shell.frustumCulled = false;
      shell.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(shell);
    }
    layers.push({ solid, shell });
  }
  const field = {
    group, layers, cap, n: 0,
    /** 放一个实例（y 默认 0；s 为等比缩放） */
    place(x, z, ry = 0, s = 1, y = 0) {
      if (field.n >= cap) return;
      _ppv.set(x, y, z);
      _ppq.setFromAxisAngle(_pup, ry);
      _pps.setScalar(s);
      _pm4.compose(_ppv, _ppq, _pps);
      for (const L of layers) {
        L.solid.setMatrixAt(field.n, _pm4);
        if (L.shell) L.shell.setMatrixAt(field.n, _pm4);
      }
      field.n++;
    },
    flush() {
      for (const L of layers) {
        L.solid.count = field.n;
        L.solid.instanceMatrix.needsUpdate = true;
        if (L.shell) { L.shell.count = field.n; L.shell.instanceMatrix.needsUpdate = true; }
      }
    },
  };
  return field;
}

/* ============================================================
   Engine
   ============================================================ */
export class Engine {
  constructor(canvas) {
    this.canvas = canvas;

    /* ---- 渲染器 ---- */
    this.quality = 'high';
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x9fdcf5, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.applyQuality(this.quality);

    /* ---- 场景 ---- */
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xa8e2f7, 78, 210);

    /* ---- 摄像机 ---- */
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 500);
    this.rig = new CameraRig(this.camera, canvas);
    this.rig.snap();

    /* ---- 光照：三段式 ---- */
    this.ambient = new THREE.AmbientLight(0xffffff, 1.05);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff3d6, 2.35);
    this.sun.position.set(28, 46, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34;
    sc.near = 1; sc.far = 140;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 1.1;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // 冷色补光：制造「卡通双色调」的暗部色偏
    this.fill = new THREE.DirectionalLight(0x9fc9ff, 0.62);
    this.fill.position.set(-30, 22, -24);
    this.scene.add(this.fill);

    /* ---- 天空 ---- */
    /* 穹顶保留引用：sky.js 每 0.5 秒改写它的三段色 uniform */
    this.skyDome = this._makeSky();
    this.scene.add(this.skyDome);

    /* ---- 地形 ---- */
    this.island = this._makeIsland();
    this.scene.add(this.island);

    /* ---- 城墙场 ---- */
    this.wallField = new WallField();
    this.scene.add(this.wallField.group);

    /* ---- 建筑容器 ---- */
    this.buildingRoot = new THREE.Group();
    this.buildingRoot.name = 'buildings';
    this.scene.add(this.buildingRoot);

    /* ---- 单位容器 ---- */
    this.unitRoot = new THREE.Group();
    this.scene.add(this.unitRoot);

    /* ---- 特效容器 ---- */
    this.fxRoot = new THREE.Group();
    this.scene.add(this.fxRoot);

    /* ---- 预览层 ---- */
    this.previewRoot = new THREE.Group();
    this.scene.add(this.previewRoot);
    this.ghost = null;
    this.footprint = this._makeFootprint();
    this.scene.add(this.footprint);
    this.selectRing = this._makeSelectRing();
    this.scene.add(this.selectRing);
    this.selectRing.visible = false;
    this.gridOverlay = this._makeGridOverlay();
    this.scene.add(this.gridOverlay);
    this.gridOverlay.visible = false;

    /* ---- 拾取 ---- */
    this.ray = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ndc = new THREE.Vector2();
    this._hit = new THREE.Vector3();

    /* ---- 尺寸 ---- */
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', () => setTimeout(this._onResize, 260));
    this.resize();

    /* ---- 时钟 ---- */
    this.clock = new THREE.Clock();
    this._raf = 0;
    this._updaters = [];

    /* ---- 昼夜 / 天气 ----
       放在最后创建：它要读 scene.fog、sun/ambient/fill、skyDome，
       这些必须都已存在。构造时会立刻套用一次「现在」的环境，
       所以开场加载完就是正确的天色，不会先亮一下再变。 */
    this.sunHeight = 46;
    this.sky = new SkySystem(this);
  }

  /* ---------- 画质 ---------- */
  applyQuality(q) {
    this.quality = q;
    const dprCap = q === 'low' ? 1.0 : q === 'mid' ? 1.4 : 2.0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    this.renderer.shadowMap.enabled = q !== 'low';
    if (this.sun) {
      const s = q === 'low' ? 1024 : q === 'mid' ? 1536 : 2048;
      this.sun.shadow.mapSize.set(s, s);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    /* 反壳描边占了整场大约一半的几何量，弱机型直接关掉最划算 */
    this.setOutlineEnabled(q !== 'low');
  }

  /**
   * 全局开关描边壳。已存在的对象立即生效；之后新建的模型由
   * toon.partOutline / optimize 读 outlineState 自动遵守。
   */
  setOutlineEnabled(on) {
    outlineState.on = on;
    const roots = [
      this.island, this.buildingRoot, this.unitRoot, this.fxRoot,
      this.previewRoot, this.wallField && this.wallField.group,
    ];
    for (const r of roots) {
      if (!r || !r.traverse) continue;
      r.traverse((o) => { if (o.userData && o.userData.isOutline) o.visible = on; });
    }
  }

  /* ---------- 天空穹顶 ---------- */
  _makeSky() {
    const geo = new THREE.SphereGeometry(300, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top:    { value: new THREE.Color(0x4fb6ea) },
        mid:    { value: new THREE.Color(0x9ddcf6) },
        bottom: { value: new THREE.Color(0xffe9c4) },
      },
      vertexShader: /* glsl */`
        varying vec3 vP;
        void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 top, mid, bottom;
        varying vec3 vP;
        void main(){
          float h = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0);
          vec3 c = h < 0.5 ? mix(bottom, mid, h/0.5) : mix(mid, top, (h-0.5)/0.5);
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = -100;
    m.frustumCulled = false;
    return m;
  }

  /* ---------- 岛屿 ---------- */
  _makeIsland() {
    const g = new THREE.Group();
    const half = GRID / 2;
    const grassSize = (half + ISLAND_PAD) * 2;          // 54
    const R = grassSize / 2 * Math.SQRT2;               // 4 段圆柱的外接半径

    /* 海面 */
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(460, 460),
      new THREE.MeshBasicMaterial({ color: 0x63b9e0 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -6.4;
    g.add(water);

    /* 深水圈（做出岛屿的"浮空厚度"） */
    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.995, R * 0.82, 6.2, 4, 1),
      toonMat(PALETTE.cliff, { grad: GRAD_DARK, flat: true })
    );
    skirt.rotation.y = Math.PI / 4;
    skirt.position.y = -3.9;
    skirt.receiveShadow = false;
    g.add(skirt);

    /* 沙滩唇 */
    const sand = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 1.006, R * 1.0, 1.1, 4, 1),
      toonMat(PALETTE.sand, { grad: GRAD_SOFT, flat: true })
    );
    sand.rotation.y = Math.PI / 4;
    sand.position.y = -0.56;
    g.add(sand);

    /* 草地顶面（专用材质：过度色阶会让大面积地面出现难看的分层，这里用 2 阶平色） */
    const GRAD_FLAT = gradientMap(2, [0.9, 1.0]);
    const tex = grassTexture();
    tex.repeat.set(grassSize / 4, grassSize / 4);
    const grassMat = new THREE.MeshToonMaterial({
      color: 0xffffff, gradientMap: GRAD_FLAT, map: tex,
    });
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(grassSize, grassSize), grassMat);
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = 0.001;
    grass.receiveShadow = true;
    g.add(grass);

    /* 装饰：树 / 石头 / 灌木（只放在可建造区之外的环带） */
    const rnd = mulberry32(773311);
    const deco = new THREE.Group();
    for (let i = 0; i < 62; i++) {
      const ang = rnd() * Math.PI * 2;
      const rad = half + 1.1 + rnd() * (ISLAND_PAD - 0.9);
      const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      if (Math.abs(x) > half + ISLAND_PAD - 0.7 || Math.abs(z) > half + ISLAND_PAD - 0.7) continue;
      const t = rnd();
      if (t < 0.62) deco.add(this._tree(x, z, rnd));
      else if (t < 0.83) deco.add(this._rock(x, z, rnd));
      else deco.add(this._bush(x, z, rnd));
    }
    g.add(deco);

    /* 细部：草丛 / 小花 / 碎石（实例化，几百株也只占几个 draw call） */
    g.add(this._makeGroundDetail(half));

    return g;
  }

  /* ---------- 地面细部（实例化） ---------- */
  /**
   * 只铺在「装饰环带」上：可建造区内部留白，避免草丛从建筑底面穿出来。
   * 每一类小件按颜色拆成若干层，每层 1 个 InstancedMesh。
   */
  _makeGroundDetail(half) {
    const rnd = mulberry32(4466221);
    const g = new THREE.Group();

    /* 草丛：三片叶子，高低错落 */
    const tuftGeo = [
      { geo: new THREE.ConeGeometry(0.062, 0.3, 3), y: 0.15 },
      { geo: new THREE.ConeGeometry(0.05, 0.22, 3), x: 0.085, y: 0.11, rz: 0.34 },
      { geo: new THREE.ConeGeometry(0.05, 0.24, 3), x: -0.075, y: 0.12, z: -0.03, rz: -0.36 },
      { geo: new THREE.ConeGeometry(0.045, 0.18, 3), z: 0.07, y: 0.09, rx: -0.3 },
    ];
    /* 小花：细茎 + 花头（两种花色） */
    const stemGeo = [{ geo: new THREE.CylinderGeometry(0.013, 0.015, 0.2, 4), y: 0.1 }];
    const headGeo = (y) => [{ geo: new THREE.SphereGeometry(0.05, 6, 5), y }];
    /* 碎石：三块不规则小石 */
    const pebbleGeo = [
      { geo: new THREE.DodecahedronGeometry(0.075, 0), y: 0.045 },
      { geo: new THREE.DodecahedronGeometry(0.052, 0), x: 0.11, y: 0.032, z: 0.05, ry: 0.8 },
      { geo: new THREE.DodecahedronGeometry(0.038, 0), x: -0.07, y: 0.024, z: 0.08, ry: 2.1 },
    ];

    /* 每一类小件 = 一个实例化场；同一场内所有层共用同一个实例位，
       所以「同一件东西的不同颜色」必须拆成不同场，否则会叠在一起。 */
    const grassA = instField([{ color: 0x3f8c33, grad: GRAD_SOFT, items: tuftGeo }], 210);
    const grassB = instField([{ color: 0x57a83f, grad: GRAD_SOFT, items: tuftGeo }], 210);
    const flowerPink = instField([
      { color: 0x3f8c33, grad: GRAD_SOFT, items: stemGeo },
      { color: 0xff6f8f, grad: GRAD_MAIN, items: headGeo(0.2) },
    ], 110);
    const flowerGold = instField([
      { color: 0x3f8c33, grad: GRAD_SOFT, items: stemGeo },
      { color: 0xffd75e, grad: GRAD_MAIN, items: headGeo(0.185) },
    ], 110);
    const pebbles = instField([{ color: 0xb9b0a4, grad: GRAD_SOFT, items: pebbleGeo }], 130);

    const R = half + ISLAND_PAD - 1.1;
    const inBand = (x, z) =>
      Math.abs(x) < R && Math.abs(z) < R &&
      Math.max(Math.abs(x), Math.abs(z)) > half + 0.5;

    for (let i = 0; i < 1800; i++) {
      const x = (rnd() * 2 - 1) * R, z = (rnd() * 2 - 1) * R;
      if (!inBand(x, z)) continue;
      const ry = rnd() * Math.PI * 2;
      const t = rnd();
      if (t < 0.66) {
        (rnd() < 0.5 ? grassA : grassB).place(x, z, ry, 0.72 + rnd() * 0.7);
      } else if (t < 0.83) {
        (rnd() < 0.5 ? flowerPink : flowerGold).place(x, z, ry, 0.85 + rnd() * 0.5);
      } else {
        pebbles.place(x, z, ry, 0.7 + rnd() * 0.8);
      }
    }
    for (const f of [grassA, grassB, flowerPink, flowerGold, pebbles]) {
      f.flush();
      g.add(f.group);
    }
    return g;
  }

  /* ---------- 树：松（分层塔形） / 阔叶（团状树冠） ---------- */
  _tree(x, z, rnd) {
    const g = rnd() < 0.58 ? this._pine(rnd) : this._broadleaf(rnd);
    g.position.set(x, 0, z);
    g.rotation.y = rnd() * Math.PI * 2;
    const s = 0.85 + rnd() * 0.42;
    g.scale.setScalar(s);
    return g;
  }

  /** 松树：树干 + 根部外扩 + 4 层锥（逐层缩小、交错旋转、明暗交替） */
  _pine(rnd) {
    const g = new THREE.Group();
    const h = 1.5 + rnd() * 0.75;
    // 树干（下粗上细）+ 根部裙
    g.add(cyl(0.105, 0.185, h * 1.06, PALETTE.woodDark, { y: h * 0.5, seg: 6 }));
    g.add(cone(0.28, 0.26, 0xb08050, { y: 0.08, seg: 7, rz: Math.PI }));
    // 4 层锥冠：明暗交替（三渲二里，纯几何台阶在 45° 视角下几乎看不见）
    const tiers = 4;
    const baseR = 0.72 + rnd() * 0.24;
    const leafA = PALETTE.leaf, leafB = PALETTE.leafDark;
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const y = h + i * 0.34;
      const r = baseR * (1 - t * 0.58);
      g.add(cone(r, 0.62 - t * 0.12, i % 2 ? leafB : leafA, {
        y, seg: 7, ry: i * 0.62,
      }));
    }
    // 顶芽
    g.add(cone(baseR * 0.2, 0.3, 0x74c95c, { y: h + (tiers - 1) * 0.34 + 0.34, seg: 6 }));
    return g;
  }

  /** 阔叶树：略弯的树干 + 分枝 + 5 团球冠（深浅交错 + 高光球） */
  _broadleaf(rnd) {
    const g = new THREE.Group();
    const h = 0.95 + rnd() * 0.6;
    const lean = (rnd() - 0.5) * 0.18;
    g.add(cyl(0.1, 0.17, h, PALETTE.woodDark, { y: h * 0.5, seg: 6, rz: lean }));
    g.add(cone(0.26, 0.24, 0xb08050, { y: 0.07, seg: 7, rz: Math.PI }));
    // 三根分枝，把树冠"撑"起来
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + 0.5;
      g.add(cyl(0.045, 0.07, 0.46, PALETTE.woodDark, {
        x: Math.cos(a) * 0.16, y: h + 0.16, z: Math.sin(a) * 0.16,
        rx: Math.sin(a) * 0.5, rz: -Math.cos(a) * 0.5, seg: 5, outline: false,
      }));
    }
    // 球冠：5~6 团，半径/高度/颜色都错开
    const cy = h + 0.5;
    const clumps = [
      [0, 0.12, 0, 0.54, PALETTE.leaf],
      [0.42, 0.0, 0.16, 0.4, PALETTE.leafDark],
      [-0.38, 0.03, 0.22, 0.38, PALETTE.leaf],
      [0.1, 0.06, -0.42, 0.36, PALETTE.leafDark],
      [-0.2, 0.34, -0.16, 0.34, 0x74c95c],
      [0.28, 0.3, 0.24, 0.3, PALETTE.leaf],
    ];
    for (const [cx, dy, cz, r, c] of clumps) {
      g.add(ball(r * (0.9 + rnd() * 0.2), c, { x: cx, y: cy + dy, z: cz, seg: 8, seg2: 6 }));
    }
    return g;
  }

  /** 岩石：主石 + 两块伴石 + 底部埋入的碎石，避免"一个多面体立在地上" */
  _rock(x, z, rnd) {
    const g = new THREE.Group();
    const s = 0.34 + rnd() * 0.38;
    const c = rnd() < 0.5 ? 0xa9a29a : 0xb5aea4;
    const main = part(new THREE.DodecahedronGeometry(s, 0), c, { grad: GRAD_SOFT });
    main.position.set(0, s * 0.52, 0);
    main.rotation.set(rnd(), rnd() * 3, rnd());
    g.add(main);
    for (let i = 0; i < 2; i++) {
      const ss = s * (0.42 + rnd() * 0.3);
      const a = rnd() * Math.PI * 2;
      const m2 = part(new THREE.DodecahedronGeometry(ss, 0), c, { grad: GRAD_SOFT });
      m2.position.set(Math.cos(a) * s * 1.05, ss * 0.42, Math.sin(a) * s * 1.05);
      m2.rotation.set(rnd(), rnd() * 3, rnd());
      g.add(m2);
    }
    // 贴地碎石（压住底边，让石头"长"在草里）
    for (let i = 0; i < 3; i++) {
      const ss = s * 0.1 * (0.7 + rnd());
      const a = rnd() * Math.PI * 2;
      g.add(ball(ss, c, {
        x: Math.cos(a) * s * 1.25, y: ss * 0.5, z: Math.sin(a) * s * 1.25,
        seg: 5, seg2: 4, grad: GRAD_SOFT, outline: false,
      }));
    }
    g.position.set(x, 0, z);
    return g;
  }

  /** 灌木：3~4 团球 + 顶端小花点 */
  _bush(x, z, rnd) {
    const g = new THREE.Group();
    const s = 0.28 + rnd() * 0.2;
    g.add(ball(s, PALETTE.leafDark, { y: s * 0.8, seg: 8, seg2: 6 }));
    g.add(ball(s * 0.74, PALETTE.leaf, { x: s * 0.56, y: s * 0.98, z: s * 0.3, seg: 7, seg2: 5 }));
    g.add(ball(s * 0.66, PALETTE.leaf, { x: -s * 0.46, y: s * 0.88, z: -s * 0.34, seg: 7, seg2: 5 }));
    if (rnd() < 0.6) {
      g.add(ball(s * 0.2, 0xff6f8f, { x: s * 0.2, y: s * 1.5, z: s * 0.18, seg: 6, seg2: 5, outline: false }));
    }
    g.position.set(x, 0, z);
    g.rotation.y = rnd() * Math.PI * 2;
    return g;
  }

  /* ---------- 网格覆盖层 ---------- */
  _makeGridOverlay() {
    const tex = gridOverlayTexture();
    tex.repeat.set(GRID, GRID);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.85,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(GRID, GRID), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.02;
    m.renderOrder = 2;
    m.frustumCulled = false;
    return m;
  }

  /* ---------- 占地高亮 ---------- */
  _makeFootprint() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x5ee08a, transparent: true, opacity: 0.42,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.045;
    m.renderOrder = 3;
    m.visible = false;
    m.frustumCulled = false;
    m.userData.mat = mat;
    return m;
  }

  _makeSelectRing() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd75e, transparent: true, opacity: 0.55,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 26), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.05;
    m.renderOrder = 3;
    m.frustumCulled = false;
    m.userData.mat = mat;
    return m;
  }

  /* ---------- 占地预览 ---------- */
  showFootprint(gx, gz, w, h, valid) {
    const m = this.footprint;
    const cx = gx + (w - 1) / 2;
    const cz = gz + (h - 1) / 2;
    const { x, z } = gridToWorld(cx, cz);
    m.position.set(x, 0.045, z);
    m.scale.set(w * 0.98, h * 0.98, 1);
    m.userData.mat.color.setHex(valid ? 0x5ee08a : 0xff5a5a);
    m.userData.mat.opacity = 0.45;
    m.visible = true;
  }
  hideFootprint() { this.footprint.visible = false; }

  /* ---------- 选中环 ---------- */
  showSelectRing(gx, gz, w, h) {
    const cx = gx + (w - 1) / 2;
    const cz = gz + (h - 1) / 2;
    const { x, z } = gridToWorld(cx, cz);
    const r = Math.max(w, h) * 0.72;
    this.selectRing.position.set(x, 0.05, z);
    this.selectRing.scale.set(r, r, r);
    this.selectRing.visible = true;
  }
  hideSelectRing() { this.selectRing.visible = false; }

  /* ---------- 拾取 ---------- */
  screenToGround(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    this._ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    this._ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    this.ray.setFromCamera(this._ndc, this.camera);
    const p = this.ray.ray.intersectPlane(this.groundPlane, this._hit);
    return p ? p.clone() : null;
  }

  /* ---------- 尺寸 ---------- */
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    tuneOutline(2.6, this.camera.fov, h * this.renderer.getPixelRatio());
  }

  /* ---------- 主循环 ---------- */
  onUpdate(fn) { this._updaters.push(fn); }

  start() {
    /* 性能读数：设置面板里直接看得到，不用开 DevTools */
    this.perf = { fps: 0, draw: 0, tris: 0 };
    let acc = 0, frames = 0;

    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.clock.getDelta());
      this.rig.update(dt);
      // 阳光跟随目标，保证阴影贴图始终覆盖镜头区域
      const t = this.rig.target;
      /* y 由 sky.js 给（白天高、夜里低），x/z 仍固定偏移 ——
         只动高度不改方位，阴影不会被"甩"到画面外。 */
      this.sun.position.set(t.x + 28, this.sunHeight ?? 46, t.z + 20);
      this.sun.target.position.set(t.x, 0, t.z);
      this.sun.target.updateMatrixWorld();
      /* 昼夜 + 天气 + 雨幕（雨幕跟随镜头焦点） */
      this.sky.update(dt, t);
      for (const f of this._updaters) f(dt);
      this.renderer.render(this.scene, this.camera);

      this.perf.draw = this.renderer.info.render.calls;
      this.perf.tris = this.renderer.info.render.triangles;
      this.renderer.info.reset();

      acc += dt; frames++;
      if (acc >= 0.5) { this.perf.fps = Math.round(frames / acc); acc = 0; frames = 0; }
    };
    loop();
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}
