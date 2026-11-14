import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * GeoGebra 动态画板（对齐欧拉 boardggb.mjs 的做法）
 * ─────────────────────────────────────────────────────────
 * 欧拉的做法：每个 figure 块挂一个 GeoGebra applet，把 commands 数组逐条 evalCommand。
 * 我们照做，但把「板书指令」自动翻译成 GGB 构造命令，于是图形是有约束的：
 *   · 圆心定点 + 圆上动点 → Circle(C, P) 自动过 C，拖动也不散
 *   · 线段长度、角度、垂直关系由 GGB 保证
 *   · 动点轨迹可以 trace，动点滑动直接 SetCoords
 *
 * 两个模式：
 *   live  —— 真 GeoGebra（需外网 CDN 加载 web3d，失败自动退回 svg）
 *   svg   —— 我们自己的 SVG 画板（离线可用）
 */

export type GgbOp = any;

/** 一行 GGB 命令 + 可选的出现时延（毫秒） */
export type GgbStep = { cmd: string; at: number; key?: string; api?: GgbApiCall };

/** applet 原生 API 调用。
 *  实测：命令式 SetColor(A,23,127,71) 恒返回 false（图形全白、看不见），
 *  只有 applet 的 JS API setColor(label,r,g,b) 真正生效。 */
export type GgbApiCall =
  | { m: 'setColor'; a: [string, number, number, number] }
  | { m: 'setLineThickness'; a: [string, number] }
  | { m: 'setPointSize'; a: [string, number] }
  | { m: 'setLineStyle'; a: [string, number] }
  | { m: 'setFilling'; a: [string, number] }
  | { m: 'setLabelStyle'; a: [string, number] }
  | { m: 'setCaption'; a: [string, string] }
  | { m: 'setVisible'; a: [string, boolean] }
  | { m: 'setBackgroundColor'; a: [string, boolean] }
  | { m: 'setFontSize'; a: [string, number] };

/* ── 板书指令 → GGB 命令 ───────────────────────────────── */

/* SetColor 要「十进制整数」，不是 r,g,b 三段 */
const HEX: Record<string, [number, number, number]> = {
  blue: [37, 99, 217],
  red: [207, 58, 44],
  green: [23, 127, 71],
  orange: [194, 87, 14],
  purple: [116, 70, 214],
  teal: [11, 124, 140],
  rose: [191, 53, 119],
  gold: [151, 107, 0],
};

function col(name: string): [number, number, number] {
  return HEX[name] || HEX.blue;
}

/** 记录一次样式调用（等下按时间轴用 applet API 执行） */
function sty(c: any, m: GgbApiCall['m'], a: any[]) {
  c.cmds.push({ cmd: '', at: 0, api: { m, a } as GgbApiCall });
}

/** 把 (x,y) 世界坐标串改成「先建隐藏点，再引用」，免得 GGB 把裸坐标当自由点画出来 */
function ptRef(c: any, x: number, y: number): string {
  const nm = `T_${Math.round(x * 100)}_${Math.round(y * 100)}`;
  if (!c.pts[nm]) {
    c.pts[nm] = [x, y];
    c.cmds.push({ cmd: `${nm}=(${x.toFixed(3)},${y.toFixed(3)})`, at: c.t });
    c.cmds.push({ cmd: '', at: c.t, api: { m: 'setVisible', a: [nm, false] } });
  }
  return nm;
}

/** 把 point 名转成 GGB 合法标签：P1 → P_1，O → O */
function tag(name: string): string {
  return String(name || '').replace(/[^A-Za-z0-9_]/g, '_');
}

type Ctx = {
  cmds: GgbStep[];
  t: number;                       // 当前累计时间
  pts: Record<string, [number, number]>;
  moved: Record<string, [number, number]>;  // 本步被 move 的点最终位置
  orbit: Record<string, { c: string; r: number }>;
  spin: Record<string, number>;    // 向量标签 → 角度
  textSeq: number;                 // Text 对象计数（GGB 强制自动编号 text1..）
  hasAxis: boolean;
};

/* GGB 的 Text 命名规则（实测）：
 * 同一 applet 里只有「第一个」Text 吃自定义名（q_1），之后一律自动编号 text1/text2/...
 * 所以第 1 个用 q_1，第 2 个用 text1，第 3 个用 text2 … 否则后面的文字会互相覆盖 */
function nextTextId(c: Ctx): string {
  c.textSeq += 1;
  return c.textSeq === 1 ? 'q_1' : `text${c.textSeq - 1}`;
}

function push(c: Ctx, cmd: string, dur = 420, key?: string) {
  c.cmds.push({ cmd, at: c.t, key });
  c.t += dur;
}

function resolvePt(c: Ctx, v: any): string | null {
  if (Array.isArray(v)) {
    const nm = `Q_${Math.round(Number(v[0]) * 100)}_${Math.round(Number(v[1]) * 100)}`;
    if (!c.pts[nm]) {
      c.pts[nm] = [Number(v[0]), Number(v[1])];
      push(c, `${nm}=(${Number(v[0]).toFixed(3)},${Number(v[1]).toFixed(3)})`, 0);
    }
    return nm;
  }
  if (typeof v !== 'string') return null;
  const raw = v.trim();
  if (c.pts[tag(raw)]) return tag(raw);
  /* P+1@30 极坐标 */
  const m = raw.match(/^(.+?)\s*([+-])\s*([\d.]+)\s*@\s*(-?[\d.]+)$/);
  if (m) {
    const base = c.pts[tag(m[1].trim())];
    if (!base) return null;
    const rr = Number(m[3]) * (m[2] === '-' ? -1 : 1);
    const a = (Number(m[4]) * Math.PI) / 180;
    const nm = `R_${Math.round((base[0] + rr * Math.cos(a)) * 100)}_${Math.round((base[1] + rr * Math.sin(a)) * 100)}`;
    if (!c.pts[nm]) {
      c.pts[nm] = [base[0] + rr * Math.cos(a), base[1] + rr * Math.sin(a)];
      push(c, `${nm}=(${c.pts[nm][0].toFixed(3)},${c.pts[nm][1].toFixed(3)})`, 0);
    }
    return nm;
  }
  return null;
}

/** 主翻译器：吃一步的 board，吐一串 GGB 命令 */
export function boardToGgb(ops: GgbOp[]): GgbStep[] {
  const c: Ctx = { cmds: [], t: 0, pts: {}, moved: {}, orbit: {}, spin: {}, hasAxis: false, textSeq: 0 };

  for (const op of ops || []) {
    if (!op || !op.op) continue;

    if (op.op === 'axis') {
      if (c.hasAxis) continue;
      c.hasAxis = true;
      /* 坐标轴可见性由 appletOnLoad 的 setAxesVisible(true,true) 统一管 */
      continue;
    }

    if (op.op === 'point') {
      const nm = tag(op.name || 'P');
      if (c.pts[nm]) continue;
      c.pts[nm] = [Number(op.x ?? 0), Number(op.y ?? 0)];
      push(c, `${nm}=(${Number(op.x ?? 0).toFixed(3)},${Number(op.y ?? 0).toFixed(3)})`, 260, nm);
      sty(c, 'setPointSize', [nm, 4]);
      sty(c, 'setColor', [nm, ...col('green')]);
      sty(c, 'setLabelStyle', [nm, 3]);
      sty(c, 'setCaption', [nm, nm]);
      continue;
    }

    if (op.op === 'circle') {
      const cc = ptRef(c, Number(op.cx ?? 0), Number(op.cy ?? 0));
      if (!cc) continue;
      /* 若圆上有动点，用「圆心→动点」定半径，动起来才不散 */
      const orbit = (ops || []).find((o: any) => o.op === 'orbit' && Number(o.r) > 0);
      if (orbit) {
        const pn = tag(orbit.name || 'P');
        if (!c.pts[pn]) {
          const cx = Number(orbit.cx ?? 0), cy = Number(orbit.cy ?? 0), r = Number(orbit.r ?? 1);
          const a0 = (Number(orbit.from ?? 0) * Math.PI) / 180;
          c.pts[pn] = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
          push(c, `${pn}=Point(Circle((${cx.toFixed(3)},${cy.toFixed(3)}),${r.toFixed(3)}))`, 300, pn);
          sty(c, 'setPointSize', [pn, 4]);
          sty(c, 'setColor', [pn, ...col('rose')]);
          sty(c, 'setLabelStyle', [pn, 3]);
        }
        push(c, `circ=Circle(${cc},${pn})`, 500, 'circle');
      } else {
        push(c, `circ=Circle(${cc},${Number(op.r ?? 1).toFixed(3)})`, 500, 'circle');
      }
      sty(c, 'setLineThickness', ['circ', 4]);
      sty(c, 'setColor', ['circ', ...col('blue')]);
      continue;
    }

    if (op.op === 'orbit') {
      const nm = tag(op.name || 'P');
      const center = ptRef(c, Number(op.cx ?? 0), Number(op.cy ?? 0));
      if (!center || !c.pts[nm]) continue;
      c.orbit[nm] = { c: center, r: Math.abs(Number(op.r ?? 1)) };
      continue;
    }

    if (op.op === 'line') {
      const a = resolvePt(c, op.from), b = resolvePt(c, op.to);
      if (!a || !b) continue;
      const id = `seg_${a}_${b}`;
      push(c, `${id}=Segment(${a},${b})`, 420, id);
      sty(c, 'setLineStyle', [id, op.dash ? 1 : 0]);
      sty(c, 'setLineThickness', [id, op.dash ? 2 : 4]);
      sty(c, 'setColor', [id, ...col(op.dash ? 'gold' : 'teal')]);
      if (op.label) {
        sty(c, 'setCaption', [id, String(op.label).replace(/["\\]/g, '')]);
        sty(c, 'setLabelStyle', [id, 1]);
      }
      continue;
    }

    if (op.op === 'vector') {
      const a = resolvePt(c, op.from), b = resolvePt(c, op.to);
      if (!a || !b) continue;
      const id = `v_${a}_${b}`;
      push(c, `${id}=Vector(${a},${b})`, 480, id);
      sty(c, 'setLineThickness', [id, 4]);
      sty(c, 'setColor', [id, ...col('rose')]);
      if (op.label) {
        sty(c, 'setCaption', [id, String(op.label).replace(/["\\]/g, '')]);
        sty(c, 'setLabelStyle', [id, 1]);
      }
      continue;
    }

    if (op.op === 'polygon') {
      const names = (Array.isArray(op.points) ? op.points : []).map((v: any) => resolvePt(c, v)).filter(Boolean) as string[];
      if (names.length < 3) continue;
      const id = `poly_${names.join('_')}`;
      push(c, `${id}=Polygon(${names.join(',')})`, 620, id);
      sty(c, 'setLineThickness', [id, 4]);
      sty(c, 'setColor', [id, ...col('blue')]);
      if (op.fill && op.fill !== 'none') {
        sty(c, 'setFilling', [id, 0.16]);
      } else {
        sty(c, 'setFilling', [id, 0]);
      }
      continue;
    }

    if (op.op === 'func') {
      const expr = String(op.expr || '').replace(/\^/g, '^').replace(/\*\*/g, '^');
      if (!expr) continue;
      const id = `f_${Math.abs(hash(expr))}`;
      push(c, `${id}(x)=${expr}`, 620, id);
      sty(c, 'setLineThickness', [id, 4]);
      sty(c, 'setColor', [id, ...col('blue')]);
      continue;
    }

    if (op.op === 'arc') {
      /* arc 只有圆心和角度，没有三个点：用「圆心 + 圆上两点」近似成 Angle */
      const cc = ptRef(c, Number(op.cx ?? 0), Number(op.cy ?? 0));
      const r = Number(op.r ?? 0.4);
      const a0 = (Number(op.from ?? 0) * Math.PI) / 180;
      const a1 = (Number(op.to ?? 90) * Math.PI) / 180;
      const mk = (a: number, suf: string) => {
        const nm = `arc${suf}_${Math.round((op.cx ?? 0) * 100)}_${Math.round((op.cy ?? 0) * 100)}_${Math.round(Number(op.r ?? 0) * 100)}`;
        if (!c.pts[nm]) {
          c.pts[nm] = [(op.cx ?? 0) + r * Math.cos(a), (op.cy ?? 0) + r * Math.sin(a)];
          push(c, `${nm}=(${c.pts[nm][0].toFixed(3)},${c.pts[nm][1].toFixed(3)})`, 0);
          sty(c, 'setVisible', [nm, false]);
        }
        return nm;
      };
      const p0 = mk(a0, 'a'), p1 = mk(a1, 'b');
      const id = `arc_${p0}_${cc}_${p1}`;
      push(c, `${id}=Angle(${p0},${cc},${p1})`, 380, id);
      sty(c, 'setLineThickness', [id, 2]);
      sty(c, 'setColor', [id, ...col('orange')]);
      sty(c, 'setLineThickness', [id, 3]);
      continue;
    }

    if (op.op === 'angle') {
      const at = resolvePt(c, op.at);
      const pa = resolvePt(c, op.from);
      const pb = resolvePt(c, op.to);
      if (!at || !pa || !pb) continue;
      const id = `ang_${pa}_${at}_${pb}`;
      push(c, `${id}=Angle(${pa},${at},${pb})`, 420, id);
      sty(c, 'setLineThickness', [id, 2]);
      sty(c, 'setColor', [id, ...col('orange')]);
      if (op.label) {
        /* 数学角度显示 */
        sty(c, 'setCaption', [id, String(op.label).replace(/["\\]/g, '')]);
      }
      continue;
    }

    if (op.op === 'move') {
      const nm = tag(op.name || 'P');
      if (!Array.isArray(op.to) || !c.pts[nm]) continue;
      c.moved[nm] = [Number(op.to[0]), Number(op.to[1])];
      push(c, `SetCoords(${nm},${Number(op.to[0]).toFixed(3)},${Number(op.to[1]).toFixed(3)})`, 700, 'move_' + nm);
      continue;
    }

    if (op.op === 'note') {
      const x = Number(op.x ?? 0), y = Number(op.y ?? 0);
      const raw = prettyMath(String(op.text || '')).slice(0, 44);
      if (!raw) continue;
      /* 先按保守边界粗略夹一次；精确夹取在函数末尾按最终视野统一做 */
      const nx = Math.max(-6, Math.min(x, 12));
      const ny = Math.max(-6, Math.min(y, 12));
      const id = nextTextId(c);
      push(c, `${id}=Text("${raw}",(${nx.toFixed(3)},${ny.toFixed(3)}),false,false)`, 380, id);
      sty(c, 'setFontSize', [id, 15]);
      sty(c, 'setColor', [id, ...col(op.tone === 'warn' ? 'red' : op.tone === 'key' ? 'orange' : 'blue')]);
      sty(c, 'setBackgroundColor', [id, false]);
      continue;
    }

    if (op.op === 'label') {
      const raw = String(op.text || '').replace(/["\\]/g, '').slice(0, 8);
      if (!raw) continue;
      const id = `lb_${Math.abs(hash(raw))}`;
      const lx = Math.max(-6, Math.min(Number(op.x ?? 0), 12));
      const ly = Math.max(-6, Math.min(Number(op.y ?? 0), 12));
      push(c, `${id}=Text("${raw}",(${lx.toFixed(3)},${ly.toFixed(3)}),false,false)`, 240, id);
      sty(c, 'setFontSize', [id, 15]);
      sty(c, 'setColor', [id, ...col(op.tone === 'warn' ? 'red' : 'orange')]);
      sty(c, 'setBackgroundColor', [id, false]);
    }
  }

  /* 同一位置的文字气泡会互相覆盖：按出现顺序向下错开 */
  {
    const placed: { x: number; y: number }[] = [];
    for (const st of c.cmds) {
      if (!st.cmd || !/^(q_1|text\d+)=Text/.test(st.cmd)) continue;
      const m = /\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*$/.exec(st.cmd);
      if (!m) continue;
      let x = parseFloat(m[1]), y = parseFloat(m[2]);
      for (const q of placed) {
        if (Math.abs(q.x - x) < 2.2 && Math.abs(q.y - y) < 0.42) y = q.y - 0.42;
      }
      placed.push({ x, y });
      st.cmd = st.cmd.replace(/\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)\s*$/, `(${x.toFixed(3)},${y.toFixed(3)})`);
    }
  }

  /* 统一把文字气泡夹进最终视野：靠右/靠上的笔记会被画布裁掉 */
  const v = ggbView(ops);
  const span = v.xmax - v.xmin;
  const clampText = (cmd: string) => cmd.replace(/\((\s*-?[\d.]+\s*,\s*-?[\d.]+\s*)\)\s*$/, (_m, inner: string) => {
    const [sx, sy] = inner.split(',').map((t) => parseFloat(t));
    /* 文字宽度粗估：15px 字在 466px 宽、span 个单位的画面里，一个字符 ≈ span/31 */
    const len = (cmd.match(/Text\("([^"]*)"/)?.[1] || '').length;
    const estW = Math.min(span * 0.92, (len * span) / 31);
    let nx = sx;
    if (nx + estW > v.xmax - 0.06) nx = v.xmax - 0.06 - estW;   // 靠右溢出 → 整体左移
    if (nx < v.xmin + 0.06) nx = v.xmin + 0.06;
    const ny = Math.min(Math.max(sy, v.ymin + 0.16), v.ymax - 0.26);
    return `(${nx.toFixed(3)},${ny.toFixed(3)})`;
  });
  for (const st of c.cmds) {
    if (st.cmd && /^(q_1|text\d+)=Text/.test(st.cmd)) st.cmd = clampText(st.cmd);
  }

  return c.cmds;
}

/** 执行一次 applet API 调用；任一 API 不存在就静默跳过，不影响整张图 */
function applyApi(a: any, c: GgbApiCall) {
  try {
    if (c.m === 'setColor') { a.setColor(c.a[0], c.a[1], c.a[2], c.a[3]); return; }
    if (c.m === 'setCaption') { a.setCaption(c.a[0], c.a[1]); return; }
    if (c.m === 'setVisible') { a.setVisible(c.a[0], c.a[1]); return; }
    if (c.m === 'setBackgroundColor') { a.setBackgroundColor(c.a[0], c.a[1]); return; }
    if (c.m === 'setFontSize') { a.setLabelStyle && a.setFontSize(c.a[0], c.a[1]); return; }
    const fn = (a as any)[c.m];
    if (typeof fn === 'function') fn.call(a, c.a[0], c.a[1]);
  } catch { /* 单条样式失败可忽略 */ }
}

function prettyMath(src: string): string {
  let t = String(src || '')
    .replace(/\$+/g, '')
    .replace(/\\dfrac/g, '\\frac')
    .replace(/\\triangle\s*/g, '△')
    .replace(/\\angle/g, '∠')
    .replace(/\\times/g, '×')
    .replace(/\\cdot/g, '·')
    .replace(/\\circ/g, '°')
    .replace(/\\Rightarrow|\\rightarrow/g, '⇒')
    /* 先展开分数：\frac{√3}{2} → (√3)/(2)，必须在 \sqrt 之前 */
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
    .replace(/\\sqrt\s*/g, '√')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/"/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** 视口范围：把图形收进 GGB 视野 */
export function ggbView(ops: GgbOp[]): { xmin: number; xmax: number; ymin: number; ymax: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const add = (x: number, y: number, pad = 0.45) => {
    x0 = Math.min(x0, x - pad); x1 = Math.max(x1, x + pad);
    y0 = Math.min(y0, y - pad * 1.25); y1 = Math.max(y1, y + pad * 1.25);
  };
  for (const op of ops || []) {
    if (!op) continue;
    if (op.op === 'point') add(Number(op.x ?? 0), Number(op.y ?? 0));
    if (op.op === 'circle' || op.op === 'orbit') {
      add(Number(op.cx ?? 0) - Math.abs(Number(op.r ?? 1)), Number(op.cy ?? 0) - Math.abs(Number(op.r ?? 1)), 0.4);
      add(Number(op.cx ?? 0) + Math.abs(Number(op.r ?? 1)), Number(op.cy ?? 0) + Math.abs(Number(op.r ?? 1)), 0.4);
    }
    if (op.op === 'move' && Array.isArray(op.to)) add(Number(op.to[0]), Number(op.to[1]));
    if (op.op === 'note') add(Number(op.x ?? 0), Number(op.y ?? 0), 0.5);
  }
  if (!isFinite(x0)) return { xmin: -1.2, xmax: 3.4, ymin: -1.4, ymax: 2.4 };
  /* 讲解用的几何图只看第一象限：把原点压到左下角附近，
     左右各留一点呼吸位，而不是把负半轴也塞满画面 */
  const W_RATIO = 1.61; // 容器 468:290
  x0 = Math.min(x0, 0) - 0.18;
  x1 = Math.max(x1, 0) + 0.55;
  y0 = Math.min(y0, 0) - 0.22;
  y1 = Math.max(y1, 0) + 0.45;
  const w = x1 - x0, h = y1 - y0;
  if (w / h < W_RATIO) {
    /* 高度富余 → 只往上补（图形一般贴着 x 轴，往下补会浪费画面） */
    y1 += h * W_RATIO - w === 0 ? 0 : (w / W_RATIO) - h;
  } else {
    /* 宽度富余 → 只往右补（左边是 y 轴，不能再往左撑） */
    x1 += w / W_RATIO - h;
  }
  return { xmin: x0, xmax: x1, ymin: y0, ymax: y1 };
}

/* ── 加载 deployggb.js ──────────────────────────────────── */

let ggbPromise: Promise<any> | null = null;

function loadDeployGgb(): Promise<any> {
  if (typeof window !== 'undefined' && (window as any).GGBApplet) return Promise.resolve((window as any).GGBApplet);
  if (ggbPromise) return ggbPromise;
  ggbPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    /* 本地优先：/deployggb.js 由我们托管，免得被墙；它内部再拉 web3d 资源 */
    s.src = '/deployggb.js';
    s.async = true;
    s.onload = () => ((window as any).GGBApplet ? res((window as any).GGBApplet) : rej(new Error('GGBApplet 未定义')));
    s.onerror = () => rej(new Error('deployggb.js 加载失败'));
    document.head.appendChild(s);
  });
  return ggbPromise;
}

/* ── 组件 ──────────────────────────────────────────────── */

type Props = {
  ops: GgbOp[];
  /** 需要一次性重放的命令条数（切换步骤时变化） */
  replayKey: number;
  /** 只放出前 n 条命令，用来跟着讲解节奏长 */
  reveal?: number;
  onFail?: () => void;
  height?: number;
};

export default function GgbBoard({ ops, replayKey, reveal, onFail, height = 292 }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<any>(null);
  const doneRef = useRef<Set<number>>(new Set());
  const timersRef = useRef<number[]>([]);
  const [state, setState] = useState<'load' | 'ready' | 'fail'>('load');

  const steps = useMemo(() => boardToGgb(ops), [ops]);
  const view = useMemo(() => ggbView(ops), [ops]);
  const viewRef = useRef(view);
  viewRef.current = view;

  const clearTimers = () => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  };

  const mount = useCallback(async () => {
    const host = hostRef.current;
    if (!host) return;
    /* 容器宽度可能还没落定（父级 maxWidth + 图片行内回流），等它有宽度再注入，
       否则 GeoGebra 会用默认 318px 画布，右侧留一条白边、图形被挤偏 */
    await new Promise<void>((res) => {
      let n = 0;
      const tick = () => {
        const w = host.getBoundingClientRect().width;
        if (w >= 200 || n++ > 40) res();
        else requestAnimationFrame(tick);
      };
      tick();
    });
    if (!hostRef.current) return;
    try {
      const GGBApplet = await loadDeployGgb();
      if (!hostRef.current) return;
      host.innerHTML = '';
      /* clientWidth 在这里可能还是 0（父级 maxWidth 尚未布局完成），
         用 getBoundingClientRect 拿真实尺寸；再兜底到组件 height 参数 */
      const box = host.getBoundingClientRect();
      const W = Math.max(240, Math.round(box.width) || 420);
      const H = Math.max(200, Math.round(box.height) || height);
      const params = {
        appName: 'geometry',
        width: W,
        height: H,
        showToolBar: false,
        showAlgebraInput: false,
        showInputBar: false,
        showMenuBar: false,
        showToolBarHelp: false,
        showFullscreenButton: false,
        showResetIcon: false,
        enableRightClick: false,
        enableShiftDragZoom: true,
        perspective: 'G',
        language: 'zh',
        appletOnLoad(api: any) {
          apiRef.current = api;
          try { api.setSize(W, H); } catch { /* ignore */ }
          /* 必须显式切到「纯绘图」布局：applet 默认会留 134px 代数侧栏 + 16px 拖拽条，
             绘图区被挤到 318px，图形偏右且 setCoordSystem 被吞 */
          try { api.setPerspective('G'); } catch { /* ignore */ }
          try {
            try { api.setErrorDialogsActive(false); } catch { /* ignore */ }
        try { api.setAxesVisible(true, true); } catch { /* ignore */ }
        api.setGridVisible(false);
            api.setAxesVisible(true, true);
            api.setCoordSystem(view.xmin, view.xmax, view.ymin, view.ymax);
            api.setPointStyle?.('', 0);
          } catch { /* 老版本 API 差异，忽略 */ }
          setState('ready');
        },
      };
      const app = new GGBApplet(params, true);
      app.inject(host);
      /* 10 秒还没起来就认输，回退 SVG */
      const guard = window.setTimeout(() => {
        if (!apiRef.current) {
          setState('fail');
          onFail?.();
        }
      }, 10000);
      timersRef.current.push(guard);
    } catch {
      setState('fail');
      onFail?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 容器尺寸变化时让 applet 跟随，避免比例失真 */
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    let lastW = 0, lastH = 0;
    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      const w = Math.round(r.width), h = Math.round(r.height);
      if (w < 120 || h < 120) return;
      if (Math.abs(w - lastW) < 8 && Math.abs(h - lastH) < 8) return;
      lastW = w; lastH = h;
      const a = apiRef.current;
      if (!a) return;
      try { a.setSize(w, h); } catch { /* ignore */ }
      try { a.setCoordSystem(viewRef.current.xmin, viewRef.current.xmax, viewRef.current.ymin, viewRef.current.ymax); } catch { /* ignore */ }
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    mount();
    return () => {
      clearTimers();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 按时间轴逐条下发命令 */
  useEffect(() => {
    if (state !== 'ready') return;
    clearTimers();
    doneRef.current = new Set();
    const api = apiRef.current;
    /* applet 加载后第一次 setCoordSystem 常被吞，延后 240ms 再调一次 */
    try { api.setCoordSystem(view.xmin, view.xmax, view.ymin, view.ymax); } catch { /* ignore */ }
    const vw = Math.max(240, Math.round(hostRef.current?.getBoundingClientRect().width || 420));
    const vh = Math.max(200, Math.round(hostRef.current?.getBoundingClientRect().height || height));
    window.setTimeout(() => {
      const a = apiRef.current;
      if (!a) return;
      try { a.setSize(vw, vh); } catch { /* ignore */ }
      try { a.setCoordSystem(view.xmin, view.xmax, view.ymin, view.ymax); } catch { /* ignore */ }
    }, 260);

    const limit = reveal == null ? steps.length : Math.min(reveal, steps.length);
    let last = 0;
    for (let i = 0; i < limit; i++) {
      const st = steps[i];
      const delay = Math.max(0, st.at - last);
      last = st.at;
      const id = window.setTimeout(() => {
        const a = apiRef.current;
        if (!a || doneRef.current.has(i)) return;
        doneRef.current.add(i);
        if (st.api) {
          applyApi(a, st.api);
          return;
        }
        try {
          a.evalCommand(st.cmd);
        } catch { /* 单条失败不影响整体 */ }
        /* GGB 刚就绪时偶发吞命令：120ms 后补一次（几何构造类幂等，样式类已走 API） */
        if (/^(SetVisibleInView|SetCoords)/.test(st.cmd)) {
          window.setTimeout(() => {
            try { apiRef.current?.evalCommand(st.cmd); } catch { /* ignore */ }
          }, 120);
        }
      }, delay);
      timersRef.current.push(id);
    }
    return clearTimers;
  }, [steps, reveal, state, replayKey, view]);

  return (
    <div className="relative w-full h-full overflow-hidden rounded-[10px] bg-white">
      <div ref={hostRef} className="w-full h-full" />
      {state === 'load' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/80">
          <Loader2 className="w-4 h-4 animate-spin text-[#26834a]" />
          <span style={{ fontSize: 12, color: '#a99a80' }}>正在启动几何引擎…</span>
        </div>
      )}
    </div>
  );
}
