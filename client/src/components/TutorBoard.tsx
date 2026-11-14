import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';

/* 笔色：对齐欧拉那套 hand-drawn 色板（board-theme.mjs）
   注意：这是模块内部常量，不要 export —— 一旦导出，生产构建会做 tree-shake 只留下碰巧被引用的键。 */
const PEN = {
  blue: '#2563d9',
  red: '#cf3a2c',
  green: '#177f47',
  orange: '#c2570e',
  purple: '#7446d6',
  teal: '#0b7c8c',
  rose: '#bf3577',
  gold: '#976b00',
};

/** 沿路径逐点测量（给笔迹生长动画用） */
function polyLen(pts: [number, number][]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/** 手绘感的椭圆：起笔多画 8%，收笔略微飘出 */
function handCirclePath(cx: number, cy: number, rx: number, ry: number, seed = 0): string {
  const N = 64;
  const a0 = -0.35 + (seed % 10) * 0.02;
  const out: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = a0 + t * Math.PI * 2.08; // 多转一点点，像人手收不住的圈
    const wob = 1 + Math.sin(a * 3 + seed) * 0.012;
    const x = cx + Math.cos(a) * rx * wob;
    const y = cy + Math.sin(a) * ry * wob;
    out.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return out.join(' ');
}

/** 手绘感直线/箭头用的折线点（轻微抖动，两点之间不抖） */
function handLine(a: [number, number], b: [number, number], seed = 0): string {
  const N = 12;
  const out: string[] = [];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len, ny = dx / len;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const wob = Math.sin(t * Math.PI) * Math.sin(t * 9 + seed) * 0.9;
    out.push(`${i === 0 ? 'M' : 'L'} ${(a[0] + dx * t + nx * wob).toFixed(1)} ${(a[1] + dy * t + ny * wob).toFixed(1)}`);
  }
  return out.join(' ');
}

function texHtml(src: string): string {
  const parts: string[] = [];
  const re = /\$([^$]+)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) parts.push(src.slice(last, m.index).replace(/</g, '&lt;'));
    try {
      parts.push(katex.renderToString(m[1], { throwOnError: false, strict: false }));
    } catch {
      parts.push(m[1]);
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) parts.push(src.slice(last).replace(/</g, '&lt;'));
  return parts.join('');
}

/**
 * 动态板书画布（欧拉讲题形态）
 * ─────────────────────────────────────────────────────────
 * 全部用 SVG + SMIL，元素自己会动：
 *   circle / line / vector → 描线生长
 *   point                  → 弹出
 *   arc                    → 角张开
 *   orbit                  → 点沿圆周跑（animateMotion）
 *   spin                   → 向量绕点旋转（animateTransform）
 *   move                   → 点平滑位移
 */

export type Op = {
  op: string;
  name?: string;
  x?: number; y?: number;
  cx?: number; cy?: number; r?: number;
  from?: any; to?: any;
  label?: string;
  labelAt?: [number, number];
  text?: string;
  tone?: string;
  dash?: boolean;
  target?: string;
  center?: [number, number];
  path?: string;
  xmin?: number; xmax?: number; ymin?: number; ymax?: number;
  points?: any[];
  fill?: string;
  expr?: string;
  at?: any;
};

export type Step = {
  index: number;
  title: string;
  text: string;
  highlight?: string;
  board: Op[];
};

const W = 560;
const H = 400;


/** 多边形：逐边手绘 + 首尾闭合 */
function handPoly(pts: [number, number][], seed: number): string {
  let d = '';
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const seg = handLine(a, b, seed + i * 13);
    d += (i === 0 ? seg : ' ' + seg.replace(/^M[^L]*L/, 'L'));
  }
  return d.trim();
}

/** 极简表达式求值：只允许数字、x、+ - * / ( ) 和 **，杜绝 eval */
function makeFn(expr: string): ((x: number) => number) | null {
  const src = expr.replace(/\^/g, '**').replace(/\s+/g, '');
  if (!src || !/^[0-9x+\-*/.()]+$/.test(src)) return null;
  const js = src.replace(/(\d)(x|\()/g, '$1*$2').replace(/\)(x|\d|\()/g, ')*$2').replace(/x(\d|\()/g, 'x*$1');
  try {
    // eslint-disable-next-line no-new-func
    const f = new Function('x', `with(Math){return (${js});}`) as (x: number) => number;
    if (!Number.isFinite(f(1))) return null;
    return f;
  } catch {
    return null;
  }
}

export default function TutorBoard({
  steps,
  stepIdx,
  playKey,
  bare = false,
}: {
  steps: Step[];
  stepIdx: number;
  playKey: number;
  /** 嵌入式图块：不画白底、不画圆角边框，直接落在讲解纸上 */
  bare?: boolean;
}) {
  const items = useMemo(() => {
    const list: { op: Op; step: number }[] = [];
    steps.slice(0, stepIdx + 1).forEach((s, si) => {
      (s.board || []).forEach((op) => list.push({ op, step: si }));
    });
    return list;
  }, [steps, stepIdx]);

  const animStepRef = useRef<Set<string>>(new Set());
  const [box, setBox] = useState({ w: 0, h: 0 });
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox((b) => (Math.abs(b.w - r.width) > 2 || Math.abs(b.h - r.height) > 2 ? { w: r.width, h: r.height } : b));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const view = useMemo(() => {
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    /* 坐标轴声明的范围常常远大于实际图形（模型爱写 -1~4），单列出来最后收 */
    let axMinX = Infinity, axMaxX = -Infinity, axMinY = Infinity, axMaxY = -Infinity;
    /* 先扫一遍点名，后面极坐标端点要靠它换算 */
    const pm: Record<string, [number, number]> = {};
    for (const { op } of items) {
      if (op.op === 'point' && op.name) pm[op.name] = [op.x ?? 0, op.y ?? 0];
    }
    const coord = (v: any): [number, number] | null => {
      if (Array.isArray(v)) return [Number(v[0]), Number(v[1])];
      if (typeof v !== 'string') return null;
      const raw = v.trim();
      if (pm[raw]) return pm[raw];
      const m = raw.match(/^(.+?)\s*([+-])\s*([\d.]+)\s*@\s*(-?[\d.]+)$/);
      if (!m) return null;
      const b = pm[m[1].trim()];
      if (!b) return null;
      const rr = Number(m[3]) * (m[2] === '-' ? -1 : 1);
      const a = (Number(m[4]) * Math.PI) / 180;
      return [b[0] + rr * Math.cos(a), b[1] + rr * Math.sin(a)];
    };
    for (const { op } of items) {
      if (op.op === 'axis') {
        axMinX = Math.min(axMinX, op.xmin ?? -1); axMaxX = Math.max(axMaxX, op.xmax ?? 4);
        axMinY = Math.min(axMinY, op.ymin ?? -1); axMaxY = Math.max(axMaxY, op.ymax ?? 4);
      } else if (op.op === 'move' && Array.isArray(op.to)) {
        xmin = Math.min(xmin, Number(op.to[0]) - 0.6); xmax = Math.max(xmax, Number(op.to[0]) + 0.6);
        ymin = Math.min(ymin, Number(op.to[1]) - 0.6); ymax = Math.max(ymax, Number(op.to[1]) + 0.6);
      } else if (op.op === 'point') {
        xmin = Math.min(xmin, (op.x ?? 0) - 0.8); xmax = Math.max(xmax, (op.x ?? 0) + 0.8);
        ymin = Math.min(ymin, (op.y ?? 0) - 0.8); ymax = Math.max(ymax, (op.y ?? 0) + 0.8);
      } else if (op.op === 'note') {
        /* note 是矩形气泡：按字符估宽高，折算成世界坐标占位 */
        const plain = String(op.text || '').replace(/\$/g, '').replace(/\\[a-zA-Z]+/g, 'x');
        /* 数学字体偏宽，按 13px 字宽估；封顶 300px，左右各留 10px 边 */
        const tw = Math.min(300, Math.max(120, plain.length * 9.4 + 22));
        const x0 = (op.x ?? 0) - 0.1;
        /* 若气泡会撞到右边界，就整体左移，宁可压到图形也不出框 */
        /* 气泡高度约 40px；按 k≈46px/单位 折成世界坐标 */
        const kGuess = 46;
        xmin = Math.min(xmin, x0); xmax = Math.max(xmax, x0 + tw / kGuess);
        ymin = Math.min(ymin, (op.y ?? 0) - 0.2); ymax = Math.max(ymax, (op.y ?? 0) + 0.95);
      } else if (op.op === 'circle' || op.op === 'orbit' || op.op === 'arc') {
        xmin = Math.min(xmin, (op.cx ?? 0) - Math.abs(op.r ?? 1) - 0.7);
        xmax = Math.max(xmax, (op.cx ?? 0) + Math.abs(op.r ?? 1) + 0.7);
        ymin = Math.min(ymin, (op.cy ?? 0) - Math.abs(op.r ?? 1) - 0.7);
        ymax = Math.max(ymax, (op.cy ?? 0) + Math.abs(op.r ?? 1) + 0.7);
      } else if (op.op === 'line' || op.op === 'vector') {
        for (const v of [op.from, op.to]) {
          const q = coord(v);
          if (q && Number.isFinite(q[0]) && Number.isFinite(q[1])) {
            xmin = Math.min(xmin, q[0]); xmax = Math.max(xmax, q[0]);
            ymin = Math.min(ymin, q[1]); ymax = Math.max(ymax, q[1]);
          }
        }
      }
    }
    if (!isFinite(xmin)) { xmin = -1; xmax = 4; ymin = -1; ymax = 4; }
    if (isFinite(axMinX)) {
      const nx0 = Math.max(axMinX, xmin), nx1 = Math.min(axMaxX, xmax);
      const ny0 = Math.max(axMinY, ymin), ny1 = Math.min(axMaxY, ymax);
      /* 收得过头就放弃，别把图形压扁 */
      if (nx1 - nx0 >= 1.8 && ny1 - ny0 >= 1.8) {
        xmin = nx0; xmax = nx1; ymin = ny0; ymax = ny1;
      }
    }
    xmin -= 0.4; xmax += 0.4; ymin -= 0.4; ymax += 0.4;

    const spanX = Math.max(xmax - xmin, 1);
    const spanY = Math.max(ymax - ymin, 1);
    /* 以容器实测尺寸为画布，保证图形永远落在框内；量不到就回落到 560x400 */
    const w = box.w > 60 ? box.w : 560;
    const h = box.h > 60 ? box.h : 400;
    const pad = bare ? 14 : 34;
    const k = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
    return {
      xmin, ymax, k, w, h,
      ox: pad + ((w - pad * 2) - spanX * k) / 2,
      oy: pad + ((h - pad * 2) - spanY * k) / 2,
    };
  }, [items, box]);

  const sx = useCallback((x: number) => view.ox + (x - view.xmin) * view.k, [view]);
  const sy = useCallback((y: number) => view.oy + (view.ymax - y) * view.k, [view]);

  const pointMap = useMemo(() => {
    const m: Record<string, [number, number]> = {};
    for (const { op, step } of items) {
      if (op.op === 'point' && op.name) m[op.name] = [op.x ?? 0, op.y ?? 0];
      if (op.op === 'move' && op.name && Array.isArray(op.to) && step <= stepIdx) {
        m[op.name] = [Number(op.to[0]), Number(op.to[1])];
      }
    }
    return m;
  }, [items, stepIdx]);

  /**
   * 端点解析，三种写法都吃：
   *   [1.7, 0.9]      坐标
   *   "P"             点名（取 pointMap）
   *   "P+1@30"        以 P 为心、半径 1、方向 30°（极坐标，角度逆时针）
   *   "C-1@30"        反向：半径取负
   */
  const resolve = (v: any): [number, number] | null => {
    if (Array.isArray(v)) return [Number(v[0]), Number(v[1])];
    if (typeof v !== 'string') return null;
    const raw = v.trim();
    if (pointMap[raw]) return pointMap[raw];
    const m = raw.match(/^(.+?)\s*([+-])\s*([\d.]+)\s*@\s*(-?[\d.]+)$/);
    if (m) {
      const base = pointMap[m[1].trim()];
      if (base) {
        let rr = Number(m[3]) * (m[2] === '-' ? -1 : 1);
        const a = (Number(m[4]) * Math.PI) / 180;
        return [base[0] + rr * Math.cos(a), base[1] + rr * Math.sin(a)];
      }
    }
    return null;
  };

  /**
   * 圆上动点的实时位置。
   * · 没到 settleAt 之前：沿圆周按时间转（等价于 animateMotion，但坐标可控、可停）
   * · 该步有 move：从圆周起点平滑移到终点，落点精确
   * · 到点后：静态固定在终点
   */
  const [tick, setTick] = useState(0);
  const moving = useMemo(() => {
    const list: {
      name: string; cx: number; cy: number; r: number; a0: number; a1: number;
      start: number; dur: number; settleAt: number; fromRatio?: number;
      to?: [number, number]; mvStart?: number; mvDur?: number;
    }[] = [];
    if (!stepIdx) return list;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    for (const { op, step } of items) {
      if (op.op !== 'orbit' || !op.name) continue;
      /* 终点优先级：本步的 move > 之后某一步的 move（让点提前停在「取最值」的位置） */
      const mvSelf = items.find((x) => x.op.op === 'move' && x.op.name === op.name && x.step === step)?.op;
      const mvLater = items.find((x) => x.op.op === 'move' && x.op.name === op.name && x.step > step)?.op;
      const mv = mvSelf || mvLater;
      const mvDelay = mvSelf ? 400 : 2600; // 本步就移；后面步骤的 move，先转两圈再落位
      const mvRatio = mv ? Math.max(0, Math.min(1, mvDelay / 6000)) : 0;
      list.push({
        name: op.name,
        fromRatio: mvRatio,
        cx: sx(op.cx ?? 0), cy: sy(op.cy ?? 0), r: Math.abs((op.r ?? 1) * view.k),
        a0: ((Number(op.from ?? 0)) * Math.PI) / 180,
        a1: ((Number(op.to ?? 360)) * Math.PI) / 180,
        start: now,
        dur: 6000,
        settleAt: mv ? now + mvDelay + 1500 : Infinity,
        to: mv && Array.isArray(mv.to) ? [sx(Number(mv.to[0])), sy(Number(mv.to[1]))] : undefined,
        mvStart: mv ? now + mvDelay : undefined,
        mvDur: mv ? 1500 : undefined,
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, stepIdx, playKey, view]);

  useEffect(() => {
    if (!moving.length) return;
    let raf = 0;
    const loop = () => {
      setTick((t) => (t + 1) % 100000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [moving.length, playKey]);

  const orbitPos = useCallback(
    (name: string): [number, number] | null => {
      const m = moving.find((x) => x.name === name);
      if (!m) return null;
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      const el = now - m.start;
      if (m.to && m.mvStart != null && el >= m.mvStart) {
        /* 从「起跳那一瞬间」的圆周位置直线滑到终点，落点精确、不回跳 */
        const t0 = Math.max(0, Math.min(1, m.fromRatio ?? 0));
        const span0 = m.a1 - m.a0;
        const aMove = m.a0 + span0 * t0;
        const from = [m.cx + m.r * Math.cos(-aMove), m.cy + m.r * Math.sin(-aMove)];
        const p = Math.max(0, Math.min(1, (el - m.mvStart) / (m.mvDur || 1500)));
        const e = p >= 1 ? 1 : 1 - Math.pow(1 - p, 3);
        return [from[0] + (m.to[0] - from[0]) * e, from[1] + (m.to[1] - from[1]) * e];
      }
      const span = m.a1 - m.a0;
      const a = m.a0 + span * ((el % m.dur) / m.dur);
      return [m.cx + m.r * Math.cos(-a), m.cy + m.r * Math.sin(-a)];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [moving, tick]
  );

  const seq = useMemo(
    () => items.map((it, i) => ({ ...it, key: `${playKey}-${it.step}-${i}` })),
    [items, playKey]
  );

  const fresh = (step: number) => step === stepIdx;

  return (
    <div ref={wrapRef} className="w-full h-full relative">
    <svg viewBox={`0 0 ${view.w} ${view.h}`} className="w-full h-full block">
      <defs>
        <marker id="arw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#d946a0" />
        </marker>
        <marker id="arwAx" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#9aa5b1" />
        </marker>
      </defs>

      {!bare && <rect x="0" y="0" width={W} height={H} fill="#fbfcff" rx="14" />}

      {seq.map(({ op, step, key }) => {
        const isNew = fresh(step);

        if (op.op === 'axis') {
          const x0 = sx(op.xmin ?? -1), x1 = sx(op.xmax ?? 4);
          const y0 = sy(op.ymin ?? -1), y1 = sy(op.ymax ?? 4);
          const gx: number[] = [], gy: number[] = [];
          for (let x = Math.ceil(op.xmin ?? -1); x <= Math.floor(op.xmax ?? 4); x++) gx.push(x);
          for (let y = Math.ceil(op.ymin ?? -1); y <= Math.floor(op.ymax ?? 4); y++) gy.push(y);
          return (
            <g key={key} className={isNew ? 'dt-fade' : ''}>
              {!bare && gx.map((x) => <line key={'gx' + x} x1={sx(x)} y1={y0} x2={sx(x)} y2={y1} stroke="#eaeff7" strokeWidth="1" />)}
              {gy.map((y) => <line key={'gy' + y} x1={x0} y1={sy(y)} x2={x1} y2={sy(y)} stroke="#eaeff7" strokeWidth="1" />)}
              <line x1={x0} y1={sy(0)} x2={x1} y2={sy(0)} stroke="#9aa5b1" strokeWidth="1.2" markerEnd="url(#arwAx)" />
              <line x1={sx(0)} y1={y1} x2={sx(0)} y2={y0} stroke="#9aa5b1" strokeWidth="1.2" markerEnd="url(#arwAx)" />
              {gx.filter((x) => x !== 0).map((x) => (
                <text key={'tx' + x} x={sx(x)} y={sy(0) + 14} fontSize="10" fill="#a8b3c1" textAnchor="middle">{x}</text>
              ))}
              {gy.filter((y) => y !== 0).map((y) => (
                <text key={'ty' + y} x={sx(0) - 7} y={sy(y) + 3.5} fontSize="10" fill="#a8b3c1" textAnchor="end">{y}</text>
              ))}
              <text x={x1 - 1} y={sy(0) - 8} fontSize="11" fill="#7b8794" textAnchor="end">x</text>
              <text x={sx(0) + 7} y={y1 + 9} fontSize="11" fill="#7b8794">y</text>
            </g>
          );
        }

        if (op.op === 'circle') {
          const cx = sx(op.cx ?? 0), cy = sy(op.cy ?? 0), r = Math.abs((op.r ?? 1) * view.k);
          const dHand = handCirclePath(cx, cy, r, r, Math.round(cx + cy));
          const lenHand = Math.PI * 2.08 * r;
          return (
            <g key={key}>
              <path d={dHand} fill="none" stroke={PEN.blue} strokeWidth="2.4" strokeLinecap="round"
                strokeLinejoin="round"
                style={{ strokeDasharray: isNew ? lenHand : 'none', strokeDashoffset: isNew ? lenHand : 0 }}>
                {isNew && <animate attributeName="stroke-dashoffset" from={lenHand} to="0" dur="1.1s" fill="freeze" />}
              </path>
            </g>
          );
        }

        if (op.op === 'orbit') {
          // 一旦出现就一直在转，切到后面步骤也不会停
          const cx = sx(op.cx ?? 0), cy = sy(op.cy ?? 0), r = (op.r ?? 1) * view.k;
          const name = op.name || 'P';
          const startA = Number(op.from ?? 0) * Math.PI / 180;
          const endA = Number(op.to ?? 360) * Math.PI / 180;
          const steps = Math.max(24, Math.round(Math.abs(endA - startA) / 0.25));
          let d = '';
          for (let i = 0; i <= steps; i++) {
            const a = startA + ((endA - startA) * i) / steps;
            const px = cx + r * Math.cos(-a);
            const py = cy + r * Math.sin(-a);
            d += (i === 0 ? 'M ' : 'L ') + px.toFixed(2) + ' ' + py.toFixed(2) + ' ';
          }
          const pos = orbitPos(name) || [cx + r * Math.cos(-startA), cy + r * Math.sin(-startA)];
          return (
            <g key={key}>
              <circle cx={pos[0]} cy={pos[1]} r="5" fill={PEN.rose} stroke="#fff" strokeWidth="1.8" />
              <text x={pos[0] + 10} y={pos[1] - 9} fontSize="12.5" fill={PEN.rose} fontWeight="700"
                stroke="#fff" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round">{name}</text>
            </g>
          );
        }

        if (op.op === 'point') {
          // 这个点如果已经有 orbit 在跑，静态点就别再画一遍
          const hasOrbit = items.some(
            (x) => x.op.op === 'orbit' && x.op.name === op.name && x.step <= stepIdx
          );
          if (hasOrbit) return null;
          const base = [op.x ?? 0, op.y ?? 0];
          const p = pointMap[op.name || ''] || base;
          const moveOp = items.find(
            (x) => x.op.op === 'move' && x.op.name === op.name && x.step === stepIdx
          )?.op;
          const moving = !!moveOp && Array.isArray(moveOp.to);
          /* 关键帧按「播放键 + 步号 + 点名」区分：同一帧内动画只跑一次，重播时重新从起点跑 */
          const animKey = `${playKey}-${step}-${op.name || ''}`;
          const settled = moving && animStepRef.current.has(animKey);
          const fx = moving && settled ? Number(moveOp!.to[0]) : (moving ? base[0] : p[0]);
          const fy = moving && settled ? Number(moveOp!.to[1]) : (moving ? base[1] : p[1]);
          return (
            <g key={key}>
              <circle cx={sx(fx)} cy={sy(fy)} r="4.2"
                fill={PEN.green} stroke="#fff" strokeWidth="1.6" className={isNew ? 'dt-pop' : ''}>
                {moving && !settled && (
                  <animate attributeName="cx" from={sx(base[0])} to={sx(Number(moveOp!.to[0]))} dur="1.6s"
                    begin="0.3s" fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1"
                    {...({ onBegin: () => animStepRef.current.add(animKey) } as any)} />
                )}
                {moving && !settled && (
                  <animate attributeName="cy" from={sy(base[1])} to={sy(Number(moveOp!.to[1]))} dur="1.6s"
                    begin="0.3s" fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1" />
                )}
              </circle>
              <text x={sx(fx) + 10} y={sy(fy) - 10}
                fontSize="12.5" fill={PEN.green} fontWeight="600" className={isNew ? 'dt-in' : ''}
                stroke="#fff" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round">
                {op.name}
                {moving && !settled && (
                  <animate attributeName="x" from={sx(base[0]) + 10} to={sx(Number(moveOp!.to[0])) + 10}
                    dur="1.6s" begin="0.3s" fill="freeze" />
                )}
                {moving && !settled && (
                  <animate attributeName="y" from={sy(base[1]) - 10} to={sy(Number(moveOp!.to[1])) - 10}
                    dur="1.6s" begin="0.3s" fill="freeze" />
                )}
              </text>
            </g>
          );
        }

        if (op.op === 'line') {
          const f = resolve(op.from), t = resolve(op.to);
          if (!f || !t) return null;
          const len = Math.hypot(sx(t[0]) - sx(f[0]), sy(t[1]) - sy(f[1]));
          return (
            <g key={key}>
              {(() => {
                const dLine = handLine([sx(f[0]), sy(f[1])], [sx(t[0]), sy(t[1])], f[0] * 7 + t[1] * 3);
                return (
                  <path d={dLine} fill="none"
                    stroke={op.dash ? '#b8ada0' : PEN.teal} strokeWidth={op.dash ? 1.4 : 2.2}
                    strokeLinecap="round" strokeLinejoin="round"
                    style={{ strokeDasharray: op.dash ? '5 6' : isNew ? len : 'none', strokeDashoffset: op.dash ? 0 : isNew ? len : 0 }}>
                    {isNew && !op.dash && <animate attributeName="stroke-dashoffset" from={len} to="0" dur="0.7s" fill="freeze" />}
                  </path>
                );
              })()}
              {op.label && (
                <text x={(sx(f[0]) + sx(t[0])) / 2 + 6} y={(sy(f[1]) + sy(t[1])) / 2 - 6}
                  fontSize="11.5" fill="#7b8794" className={isNew ? 'dt-in' : ''}
                  stroke="#fff" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round">{op.label}</text>
              )}
            </g>
          );
        }

        if (op.op === 'vector') {
          const f = resolve(op.from), t = resolve(op.to);
          if (!f || !t) return null;
          const len = Math.hypot(sx(t[0]) - sx(f[0]), sy(t[1]) - sy(f[1]));
          const spinOp = items.find(
            (x) => x.op.op === 'spin' && x.op.target === op.label && x.step === step
          )?.op;
          const ccx = spinOp?.center ? sx(spinOp.center[0]) : sx(f[0]);
          const ccy = spinOp?.center ? sy(spinOp.center[1]) : sy(f[1]);
          return (
            <g key={key}>
              {(() => {
                const a: [number, number] = [sx(f[0]), sy(f[1])];
                const bx: [number, number] = [sx(t[0]), sy(t[1])];
                const dVec = handLine(a, bx, f[1] * 5 + t[0] * 3);
                /* 注意：虚线长度必须按「抖动折线的真实长度」算，否则短向量会被整条虚掉 */
                const realLen = Math.max(1, polyLen(dVec.match(/[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g)
                  ?.map((m) => m.trim().split(/\s+/).slice(1).map(Number) as [number, number]) || [a, bx]));
                return (
                  <g>
                    <path d={dVec} fill="none" stroke={PEN.rose} strokeWidth="2.4" strokeLinecap="round"
                      style={{ stroke: PEN.rose, strokeDasharray: isNew ? realLen : "none", strokeDashoffset: isNew ? realLen : 0 }}>
                      {isNew && <animate attributeName="stroke-dashoffset" from={realLen} to="0" dur="0.8s" fill="freeze" />}
                      {isNew && spinOp && (
                        <animateTransform attributeName="transform" type="rotate"
                          from={`0 ${ccx} ${ccy}`} to={`${spinOp.to ?? 45} ${ccx} ${ccy}`}
                          dur="2.4s" begin="0.7s" fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1" />
                      )}
                    </path>
                    {/* 手绘箭头：两条短线，跟着生长一起出现 */}
                    <g opacity={isNew ? 0 : 1}>
                      {isNew && <animate attributeName="opacity" values="0;0;1" keyTimes="0;0.7;1" dur="0.9s" fill="freeze" />}
                      {(() => {
                        const ux = (bx[0] - a[0]) / Math.max(1, len);
                        const uy = (bx[1] - a[1]) / Math.max(1, len);
                        const L = 11, W = 5.2;
                        return (
                          <path
                            d={`M ${(bx[0] - ux * L - uy * W).toFixed(1)} ${(bx[1] - uy * L + ux * W).toFixed(1)} L ${bx[0].toFixed(1)} ${bx[1].toFixed(1)} L ${(bx[0] - ux * L + uy * W).toFixed(1)} ${(bx[1] - uy * L - ux * W).toFixed(1)} Z`}
                            fill={PEN.rose} stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
                        );
                      })()}
                    </g>
                  </g>
                );
              })()}
              {op.label && (() => {
                const mx = (sx(f[0]) + sx(t[0])) / 2;
                const my = (sy(f[1]) + sy(t[1])) / 2;
                const dx = sx(t[0]) - sx(f[0]);
                const dy = sy(t[1]) - sy(f[1]);
                const len = Math.max(1, Math.hypot(dx, dy));
                /* 默认沿向量方向、从箭头端点再往外 12px，并整体上抬 6px */
                const ax = sx(t[0]) + (dx / len) * 12;
                const ay = sy(t[1]) + (dy / len) * 12 - 6;
                const at = op.labelAt ? { x: sx(op.labelAt[0]), y: sy(op.labelAt[1]) } : { x: ax, y: ay };
                const shown = String(op.label).replace(/[_.]/g, '');
                return (
                <text x={at.x} y={at.y}
                  textAnchor={op.labelAt ? 'middle' : 'start'}
                  fontSize="12" fill="#d946a0" fontWeight="600" className={isNew ? 'dt-in' : ''}
                  stroke="#fff" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round">{shown}</text>
                );
              })()}
            </g>
          );
        }

        if (op.op === 'arc') {
          const cx = sx(op.cx ?? 0), cy = sy(op.cy ?? 0), r = (op.r ?? 0.4) * view.k;
          const a0 = ((op.from ?? 0) * Math.PI) / 180;
          const a1 = ((op.to ?? 90) * Math.PI) / 180;
          const p0 = [cx + r * Math.cos(-a0), cy + r * Math.sin(-a0)];
          const p1 = [cx + r * Math.cos(-a1), cy + r * Math.sin(-a1)];
          const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
          const sw = a1 > a0 ? 0 : 1;
          const d = `M ${p0[0]} ${p0[1]} A ${r} ${r} 0 ${large} ${sw} ${p1[0]} ${p1[1]}`;
          return (
            <g key={key} className={isNew ? 'dt-in' : ''}>
              <path d={d} fill="none" stroke="#f59e0b" strokeWidth="1.8" />
              {op.label && (
                <text x={cx + r * 1.3 * Math.cos(-(a0 + a1) / 2)} y={cy + r * 1.3 * Math.sin(-(a0 + a1) / 2)}
                  fontSize="11.5" fill="#b45309"
                  stroke="#fff" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round">{op.label}</text>
              )}
            </g>
          );
        }


        if (op.op === 'label') {
          const lx = sx(op.x ?? 0), ly = sy(op.y ?? 0);
          const tone = op.tone === 'warn' ? PEN.red : op.tone === 'key' ? PEN.orange : PEN.blue;
          return (
            <text key={key} x={lx} y={ly} fontSize="13" fontWeight="700" fill={tone}
              textAnchor="middle" className={isNew ? 'dt-in' : ''}
              style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3, strokeLinejoin: 'round' }}>
              {String(op.text || '').slice(0, 6)}
            </text>
          );
        }

        if (op.op === 'polygon') {
          const raw = Array.isArray(op.points) ? op.points : [];
          const pts = raw.map((v: any) => resolve(v)).filter(Boolean) as [number, number][];
          if (pts.length < 3) return null;
          const scr = pts.map((p) => [sx(p[0]), sy(p[1])] as [number, number]);
          const dPoly = handPoly(scr, 11);
          const realLen = Math.max(1, polyLen(scr.concat([scr[0]])));
          const filled = op.fill && op.fill !== 'none';
          return (
            <g key={key}>
              <path d={dPoly} fill={filled ? op.fill : 'none'} fillOpacity={filled ? 0.14 : 0}
                stroke={filled ? op.fill : PEN.blue} strokeWidth="2.2" strokeLinejoin="round"
                style={{ strokeDasharray: isNew ? realLen : 'none', strokeDashoffset: isNew ? realLen : 0 }}>
                {isNew && <animate attributeName="stroke-dashoffset" from={realLen} to="0" dur="1.1s" fill="freeze" />}
              </path>
            </g>
          );
        }

        if (op.op === 'func') {
          const f = makeFn(String(op.expr || ''));
          if (!f) return null;
          const xa = Number(op.xmin ?? -3), xb = Number(op.xmax ?? 3);
          const n = 90;
          let dFn = '';
          let started = false;
          for (let i = 0; i <= n; i++) {
            const xv = xa + ((xb - xa) * i) / n;
            const yv = f(xv);
            if (!Number.isFinite(yv) || Math.abs(yv) > 400) { started = false; continue; }
            dFn += (started ? ' L ' : ' M ') + sx(xv).toFixed(2) + ' ' + sy(yv).toFixed(2);
            started = true;
          }
          if (!dFn) return null;
          return (
            <path key={key} d={dFn} fill="none" stroke={PEN.blue} strokeWidth="2.2" strokeLinecap="round"
              pathLength={1}
              style={{ strokeDasharray: isNew ? 1 : 'none', strokeDashoffset: isNew ? 1 : 0 }}>
              {isNew && <animate attributeName="stroke-dashoffset" from="1" to="0" dur="1.2s" fill="freeze" />}
            </path>
          );
        }

        if (op.op === 'angle') {
          const at = resolve(op.at);
          const pa = resolve(op.from) || (at ? [at[0] + 0.6, at[1]] : null);
          const pb = resolve(op.to) || (at ? [at[0], at[1] + 0.6] : null);
          if (!at || !pa || !pb) return null;
          const ax = sx(pa[0]) - sx(at[0]), ay = sy(pa[1]) - sy(at[1]);
          const bx = sx(pb[0]) - sx(at[0]), by = sy(pb[1]) - sy(at[1]);
          const la = Math.max(1, Math.hypot(ax, ay)), lb = Math.max(1, Math.hypot(bx, by));
          const r = Math.min(30, la * 0.46, lb * 0.46);
          const ua = [ax / la, ay / la], ub = [bx / lb, by / lb];
          const dot = ua[0] * ub[0] + ua[1] * ub[1];
          const cx0 = sx(at[0]), cy0 = sy(at[0]);
          let dArc: string;
          if (dot > 0.97) {
            /* 几乎同向，退化成一个刻度 */
            dArc = `M ${cx0 + ua[0] * r * 0.8} ${cy0 + ua[1] * r * 0.8} L ${cx0 + ua[0] * r * 1.3} ${cy0 + ua[1] * r * 1.3}`;
          } else if (dot > -0.08 && dot < 0.08) {
            /* 直角：画小方角 */
            const q1 = [cx0 + ua[0] * r, cy0 + ua[1] * r];
            const q2 = [q1[0] + ub[0] * r, q1[1] + ub[1] * r];
            const q3 = [cx0 + ub[0] * r, cy0 + ub[1] * r];
            dArc = `M ${q1[0]} ${q1[1]} L ${q2[0]} ${q2[1]} L ${q3[0]} ${q3[1]}`;
          } else {
            const p1 = [cx0 + ua[0] * r, cy0 + ua[1] * r];
            const p2 = [cx0 + ub[0] * r, cy0 + ub[1] * r];
            const cross = ua[0] * ub[1] - ua[1] * ub[0];
            dArc = `M ${p1[0]} ${p1[1]} A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${p2[0]} ${p2[1]}`;
          }
          const mid = [(ua[0] + ub[0]) / 2, (ua[1] + ub[1]) / 2];
          const ml = Math.max(0.001, Math.hypot(mid[0], mid[1]));
          return (
            <g key={key}>
              <path d={dArc} fill="none" stroke={PEN.orange} strokeWidth="1.7" strokeLinecap="round"
                pathLength={1}
                style={{ strokeDasharray: isNew ? 1 : 'none', strokeDashoffset: isNew ? 1 : 0 }}>
                {isNew && <animate attributeName="stroke-dashoffset" from="1" to="0" dur="0.6s" fill="freeze" />}
              </path>
              {op.label && (
                <text x={cx0 + (mid[0] / ml) * (r + 14)} y={cy0 + (mid[1] / ml) * (r + 14) + 4}
                  fontSize="11.5" fill={PEN.orange} fontWeight="600" className={isNew ? 'dt-in' : ''}
                  textAnchor="middle"
                  style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3, strokeLinejoin: 'round' }}>
                  {String(op.label)}
                </text>
              )}
            </g>
          );
        }

        if (op.op === 'note') {
          const px = sx(op.x ?? 0), py = sy(op.y ?? 0);
          const rawNote = String(op.text || '')
            .replace(/(^|[^$\\])(\\[a-zA-Z]+\s*\{[^{}]*\}\s*\{[^{}]*\})/g, '$1$$$2$$');
          const tone = op.tone || 'normal';
          const bg = tone === 'key' ? '#fff8e8' : tone === 'warn' ? '#fef2f2' : '#eef4ff';
          const bd = tone === 'key' ? '#f2cf8a' : tone === 'warn' ? '#f2b8b8' : '#cfdcff';
          const fg = tone === 'key' ? '#8a5a10' : tone === 'warn' ? '#9b2020' : '#334155';
          const w = Math.min(340, Math.max(104, String(op.text || '').replace(/\$/g, '').length * 9.4 + 26));
          return (
            <foreignObject key={key} x={px - 6} y={py - 17} width={w} height="34"
              className={isNew ? 'dt-in' : ''}>
              <div
                style={{
                  display: 'inline-flex', alignItems: 'center', height: 30, padding: '0 9px',
                  borderRadius: 8, background: bg, border: `1px solid ${bd}`, color: fg,
                  fontSize: 12, whiteSpace: 'nowrap', fontWeight: 500,
                }}
                dangerouslySetInnerHTML={{ __html: texHtml(rawNote) }}
              />
            </foreignObject>
          );
        }

        return null;
      })}
    </svg>
    </div>
  );
}
