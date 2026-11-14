import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * Island3D — 一起背「3D 校园小岛」第一版（2026-09-09）
 *
 * 交互（iPad 横屏触控优先）：
 *  - 点按地面：角色走过去（第三人称，角色在画面中央）
 *  - 单指拖拽：环绕角色旋转视角
 *  - 双指捏合：拉近 / 拉远
 *  - 鼠标滚轮（桌面）：拉近 / 拉远
 *
 * 全代码建模低模小岛（草地 + 沙滩 + 海 + 教学楼/小卖部/小屋/凉亭 + 树），
 * 无外部素材。性能：像素比上限 2，Lambert 光照，不开阴影，几何体轻量。
 */
export default function Island3D({ className = '' }: { className?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    /* ────────── renderer / scene / camera ────────── */
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x86cdf0);

    scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x79b56b, 1.05));
    const sun = new THREE.DirectionalLight(0xfff1d0, 1.35);
    sun.position.set(28, 46, 18);
    scene.add(sun);
    const back = new THREE.DirectionalLight(0xbcd8ff, 0.45);
    back.position.set(-22, 20, -26);
    scene.add(back);

    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.1, 600);
    camera.position.set(12, 16, 12);

    const disposables: THREE.BufferGeometry[] = [];
    const addMesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, name = '') => {
      disposables.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (name) m.name = name;
      scene.add(m);
      return m;
    };
    const box = (w: number, h: number, d: number, color: number) =>
      new THREE.MeshLambertMaterial({ color });
    const boxGeo = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

    /* ────────── 海 / 沙滩 / 草地 ────────── */
    const sea = new THREE.Mesh(
      new THREE.CircleGeometry(260, 48),
      new THREE.MeshLambertMaterial({ color: 0x45a5e6, transparent: true, opacity: 0.92 }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.55;
    scene.add(sea);

    // 草地（可行走地面）
    addMesh(new THREE.CircleGeometry(41, 48), box(1, 1, 1, 0x75c96b), 0, 0.01, 0, 'walkable');
    // 沙滩环
    const sand = new THREE.Mesh(
      new THREE.RingGeometry(41, 46, 48),
      new THREE.MeshLambertMaterial({ color: 0xf3dcae }),
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.y = 0.02;
    sand.name = 'walkable';
    scene.add(sand);
    // 岛侧面
    const side = new THREE.Mesh(
      new THREE.CylinderGeometry(46, 49, 1.9, 48),
      new THREE.MeshLambertMaterial({ color: 0xe6c793 }),
    );
    side.position.y = -0.93;
    scene.add(side);

    // 中央十字浅色步道
    const path = new THREE.MeshLambertMaterial({ color: 0xf0e2c0 });
    const mkPath = (len: number) => {
      const g = new THREE.PlaneGeometry(4.4, len);
      disposables.push(g);
      return g;
    };
    const p1 = new THREE.Mesh(mkPath(82), path); p1.rotation.x = -Math.PI / 2; p1.position.y = 0.05; scene.add(p1);
    const p2 = new THREE.Mesh(mkPath(82), path); p2.rotation.x = -Math.PI / 2; p2.rotation.z = Math.PI / 2; p2.position.y = 0.05; scene.add(p2);

    /* ────────── 低模建筑 ────────── */
    const matWall = box(1, 1, 1, 0xfaf7f0);
    const matRoof = box(1, 1, 1, 0x3d6fe0);
    const matRoof2 = box(1, 1, 1, 0xf2b64d);
    const matRed = box(1, 1, 1, 0xe5764e);
    const matPurple = box(1, 1, 1, 0x9a7ad6);

    // 教学楼（大，蓝顶）—— 小班
    {
      const g = new THREE.Group();
      g.position.set(-19, 0, -9);
      const base = new THREE.Mesh(boxGeo(11, 4.4, 8), matWall); base.position.y = 2.2; g.add(base);
      const roof = new THREE.Mesh(boxGeo(12.2, 1.2, 9.2), matRoof); roof.position.y = 5; g.add(roof);
      // 窗：正面两列小深蓝
      const wMat = new THREE.MeshLambertMaterial({ color: 0x8fbdf0 });
      for (const wx of [-3.4, 3.4]) {
        for (const wy of [1.6, 3]) {
          const win = new THREE.Mesh(boxGeo(1.5, 1.5, 0.15), wMat);
          win.position.set(wx, wy, 4.06); g.add(win);
        }
      }
      // 门
      const door = new THREE.Mesh(boxGeo(1.7, 2.2, 0.15), new THREE.MeshLambertMaterial({ color: 0x6b4a2f }));
      door.position.set(0, 1.1, 4.06); g.add(door);
      scene.add(g);
    }
    // 小卖部（橙棚平顶）
    {
      const g = new THREE.Group();
      g.position.set(20, 0, -12);
      const base = new THREE.Mesh(boxGeo(7, 3.4, 5.6), matRed); base.position.y = 1.7; g.add(base);
      const roof = new THREE.Mesh(boxGeo(8, 0.5, 6.6), matRoof2); roof.position.y = 3.65; g.add(roof);
      const awning = new THREE.Mesh(boxGeo(6, 0.28, 0.5), new THREE.MeshLambertMaterial({ color: 0xffffff }));
      awning.position.set(0, 2.5, 3.05); g.add(awning);
      scene.add(g);
    }
    // 同桌小屋（黄顶小屋）
    {
      const g = new THREE.Group();
      g.position.set(-13, 0, 16);
      const base = new THREE.Mesh(boxGeo(6, 3, 5), matWall); base.position.y = 1.5; g.add(base);
      // 金字塔式小屋顶
      const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 2.2, 4), matRoof2);
      roof.position.y = 4.1; roof.rotation.y = Math.PI / 4; g.add(roof);
      const door2 = new THREE.Mesh(boxGeo(1.4, 1.8, 0.12), new THREE.MeshLambertMaterial({ color: 0x6b4a2f }));
      door2.position.set(0, 0.9, 2.56); g.add(door2);
      scene.add(g);
    }
    // 招新广场凉亭（紫顶）
    {
      const g = new THREE.Group();
      g.position.set(14, 0, 20);
      const pillarMat = new THREE.MeshLambertMaterial({ color: 0xf7f1e4 });
      for (const [px, pz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) {
        const pillar = new THREE.Mesh(boxGeo(0.42, 2.6, 0.42), pillarMat);
        pillar.position.set(px, 1.3, pz); g.add(pillar);
      }
      const top = new THREE.Mesh(boxGeo(6.4, 0.4, 6.4), matPurple); top.position.y = 2.8; g.add(top);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.6, 4), matPurple);
      spire.position.y = 3.8; spire.rotation.y = Math.PI / 4; g.add(spire);
      const floor = new THREE.Mesh(boxGeo(5.2, 0.3, 5.2), new THREE.MeshLambertMaterial({ color: 0xe8d9b8 }));
      floor.position.y = 0.15; g.add(floor);
      scene.add(g);
    }
    // 灯塔（海边装饰）
    {
      const g = new THREE.Group();
      g.position.set(0, 0, -26);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 7, 10), matWall);
      tower.position.y = 3.5; g.add(tower);
      const lamp = new THREE.Mesh(boxGeo(1.7, 1, 1.7), matRed); lamp.position.y = 7.4; g.add(lamp);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1, 10), matRoof2); cap.position.y = 8.4; g.add(cap);
      scene.add(g);
    }

    /* ────────── 树 / 花 点缀 ────────── */
    const treeMat = new THREE.MeshLambertMaterial({ color: 0x3f9157 });
    const treeMat2 = new THREE.MeshLambertMaterial({ color: 0x59a76b });
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a5f3c });
    const treeSpots: [number, number, number][] = [
      [8, -4, 1.4], [14, 3, 1.1], [-25, 6, 1.2], [27, 6, 1.0], [-30, -16, 1.3],
      [30, -20, 1.0], [-8, -19, 1.1], [24, 26, 1.2], [-24, 26, 1.1], [-5, 30, 0.9],
      [10, -28, 0.9], [33, 12, 0.85], [-33, 2, 0.9], [-20, -28, 0.95], [34, -6, 0.8],
    ];
    for (const [tx, tz, ts] of treeSpots) {
      const g = new THREE.Group();
      g.position.set(tx, 0, tz);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * ts, 0.4 * ts, 1.3 * ts, 7), trunkMat);
      trunk.position.y = 0.65 * ts; g.add(trunk);
      const c1 = new THREE.Mesh(new THREE.ConeGeometry(1.7 * ts, 2.4 * ts, 8), treeMat);
      c1.position.y = 2.4 * ts; g.add(c1);
      const c2 = new THREE.Mesh(new THREE.ConeGeometry(1.25 * ts, 1.8 * ts, 8), treeMat2);
      c2.position.y = 3.7 * ts; g.add(c2);
      scene.add(g);
    }
    const flowerMat = new THREE.MeshLambertMaterial({ color: 0xffcf6b });
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + 0.7;
      const r = 26 + (i % 5) * 3.2;
      const fx = Math.cos(a) * r;
      const fz = Math.sin(a) * r;
      const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.14, 6), flowerMat);
      fl.position.set(fx, 0.09, fz);
      scene.add(fl);
    }

    /* ────────── 玩家角色（低模方块小人） ────────── */
    const player = new THREE.Group();
    player.position.set(0, 0, 2);
    scene.add(player);

    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 20),
      new THREE.MeshLambertMaterial({ color: 0x1d3a26, transparent: true, opacity: 0.22 }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.035;
    player.add(blob);

    const skinMat = new THREE.MeshLambertMaterial({ color: 0xffd9b3 });
    const clothMat = new THREE.MeshLambertMaterial({ color: 0x3b6be8 });   // 校服蓝
    const pantsMat = new THREE.MeshLambertMaterial({ color: 0x2a3a66 });
    const hairMat = new THREE.MeshLambertMaterial({ color: 0x3a2b20 });
    const shoeMat = new THREE.MeshLambertMaterial({ color: 0xf4f4f4 });

    // 腿（摆动支点在髋部 y=0.8）
    const mkLimb = (w: number, h: number, d: number, mat: THREE.Material, pivotY: number) => {
      const pivot = new THREE.Group();
      pivot.position.y = pivotY;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.y = -h / 2;
      pivot.add(mesh);
      player.add(pivot);
      return pivot;
    };
    const legL = mkLimb(0.34, 0.8, 0.42, pantsMat, 0.82);
    legL.position.x = -0.2;
    const legR = mkLimb(0.34, 0.8, 0.42, pantsMat, 0.82);
    legR.position.x = 0.2;
    // 鞋
    const shoeL = new THREE.Mesh(boxGeo(0.36, 0.16, 0.5), shoeMat); shoeL.position.set(-0.2, 0.08, 0.02); player.add(shoeL);
    const shoeR = new THREE.Mesh(boxGeo(0.36, 0.16, 0.5), shoeMat); shoeR.position.set(0.2, 0.08, 0.02); player.add(shoeR);

    // 身体
    const torso = new THREE.Mesh(boxGeo(0.95, 1.05, 0.56), clothMat);
    torso.position.y = 1.38;
    player.add(torso);
    // 领口点缀
    const collar = new THREE.Mesh(boxGeo(0.3, 0.12, 0.1), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    collar.position.set(0, 1.72, 0.29);
    player.add(collar);
    // 手臂（摆动支点肩膀 y=1.72）
    const armL = mkLimb(0.24, 0.72, 0.26, clothMat, 1.74); armL.position.x = -0.62;
    const armR = mkLimb(0.24, 0.72, 0.26, clothMat, 1.74); armR.position.x = 0.62;
    // 手
    const handL = new THREE.Mesh(boxGeo(0.26, 0.16, 0.28), skinMat); handL.position.set(-0.62, 1.02, 0); player.add(handL);
    const handR = new THREE.Mesh(boxGeo(0.26, 0.16, 0.28), skinMat); handR.position.set(0.62, 1.02, 0); player.add(handR);

    // 头（面向 +Z，有刘海与眼睛）
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 16), skinMat);
    head.position.y = 2.16;
    player.add(head);
    const fringe = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
    fringe.position.y = 2.22;
    player.add(fringe);
    const eyeMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    for (const ex of [-0.15, 0.15]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), eyeMat);
      eye.position.set(ex, 2.2, 0.36);
      player.add(eye);
    }

    /* ────────── 状态 ────────── */
    const moveTarget = new THREE.Vector3(0, 0, 2);
    const MOVE_SPEED = 7.5;
    let yaw = Math.PI / 4;          // 相机环绕角
    let pitch = 0.62;               // 俯角（弧度，越大越俯视）
    let camDist = 15;
    const MIN_DIST = 7, MAX_DIST = 30;
    let phase = 0;
    let isWalking = false;
    const clock = new THREE.Clock();

    /* ────────── 输入 ────────── */
    const pointers = new Map<number, { x: number; y: number }>();
    let downPos: { x: number; y: number } | null = null;
    let dragged = false;
    let pinchDist = 0;
    let camPos = new THREE.Vector3().copy(camera.position);

    const el = renderer.domElement;
    const ndc = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const setCamTargetByPointer = (nx: number, ny: number) => {
      const dx = nx - downPos!.x;
      const dy = ny - downPos!.y;
      if (Math.abs(dx) + Math.abs(dy) > 10) dragged = true;
      if (dragged && pointers.size === 1) {
        yaw -= dx * 0.0065;
        pitch = Math.min(1.15, Math.max(0.18, pitch + dy * 0.005));
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      downPos = { x: e.clientX, y: e.clientY };
      dragged = false;
      if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!downPos) return;
      const p = pointers.get(e.pointerId);
      if (p) { p.x = e.clientX; p.y = e.clientY; }
      if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        const cur = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0 && cur > 0) {
          camDist = Math.min(MAX_DIST, Math.max(MIN_DIST, camDist * (pinchDist / cur)));
          pinchDist = cur;
        }
        dragged = true;
      } else if (pointers.size === 1) {
        setCamTargetByPointer(e.clientX, e.clientY);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      const up = { x: e.clientX, y: e.clientY };
      const moved = downPos ? Math.hypot(up.x - downPos.x, up.y - downPos.y) : 999;
      const wasDrag = dragged;
      downPos = null;
      dragged = false;
      pinchDist = 0;
      if (wasDrag || moved > 10 || pointers.size > 0) return; // 拖拽/多指不算点击
      // 点按 → 射线找地面
      const rect = el.getBoundingClientRect();
      ndc.set(((up.x - rect.left) / rect.width) * 2 - 1, -((up.y - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(scene.children, false).filter(h => (h.object.name === 'walkable' || h.object.name === 'ground'));
      if (hits.length) {
        moveTarget.set(hits[0].point.x, 0, hits[0].point.z);
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camDist = Math.min(MAX_DIST, Math.max(MIN_DIST, camDist + e.deltaY * 0.02));
    };
    const onContext = (e: Event) => e.preventDefault();

    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContext);

    /* ────────── 主循环 ────────── */
    let raf = 0;
    const tmpDir = new THREE.Vector3();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05);

      // 移动
      const dx = moveTarget.x - player.position.x;
      const dz = moveTarget.z - player.position.z;
      const dist = Math.hypot(dx, dz);
      isWalking = dist > 0.25;
      if (isWalking) {
        const step = Math.min(dist, MOVE_SPEED * dt);
        player.position.x += (dx / dist) * step;
        player.position.z += (dz / dist) * step;
        const targetRot = Math.atan2(dx, dz);
        let diff = targetRot - player.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        player.rotation.y += diff * Math.min(1, 12 * dt);
        phase += dt * 10;
      }

      // 肢体动画（带缓动回中）
      const swing = isWalking ? Math.sin(phase) : 0;
      const amp = isWalking ? 1 : 0.001;
      legL.rotation.x = swing * 0.62 * amp + legL.rotation.x * (isWalking ? 0 : 0.75);
      legR.rotation.x = -swing * 0.62 * amp + legR.rotation.x * (isWalking ? 0 : 0.75);
      armL.rotation.x = -swing * 0.5 * amp + armL.rotation.x * (isWalking ? 0 : 0.75);
      armR.rotation.x = swing * 0.5 * amp + armR.rotation.x * (isWalking ? 0 : 0.75);
      const bob = isWalking ? Math.abs(Math.cos(phase * 0.5)) * 0.06 : 0;
      torso.position.y = 1.38 + bob;

      // 相机：绕玩家 + 平滑跟随
      const cx = player.position.x + camDist * Math.cos(pitch) * Math.sin(yaw);
      const cy = player.position.y + camDist * Math.sin(pitch) + 1.2;
      const cz = player.position.z + camDist * Math.cos(pitch) * Math.cos(yaw);
      camPos.x += (cx - camPos.x) * Math.min(1, 6 * dt);
      camPos.y += (cy - camPos.y) * Math.min(1, 6 * dt);
      camPos.z += (cz - camPos.z) * Math.min(1, 6 * dt);
      camera.position.copy(camPos);
      tmpDir.set(player.position.x, 1.35, player.position.z);
      camera.lookAt(tmpDir);

      renderer.render(scene, camera);
    };
    loop();

    /* ────────── 尺寸自适应 ────────── */
    const onResize = () => {
      const w = mount.clientWidth || window.innerWidth;
      const h = mount.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    /* ────────── 清理 ────────── */
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContext);
      disposables.forEach(g => g.dispose());
      scene.traverse(o => {
        if (o instanceof THREE.Mesh) o.material?.dispose?.();
      });
      renderer.dispose();
      if (el.parentNode === mount) mount.removeChild(el);
    };
  }, []);

  return <div ref={mountRef} className={className} />;
}
