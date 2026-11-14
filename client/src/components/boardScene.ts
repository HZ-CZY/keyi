/**
 * DeepTutor 讲题结果 → 欧拉白板 board_scene（双栏版）
 * ──────────────────────────────────────────────────────────────
 * 为什么要换成 board_scene 而不是 board_doc：
 *
 *   欧拉原版讲题页是「左题目 + 右讲解」的双栏，那个布局在
 *   board_scene.layout.type = 'split_workspace' 里，不在 doc.layout 里。
 *   renderDoc 只能出单栏文字流，怎么调都做不出双栏。
 *
 * 结构（从 boarddoc.mjs 反出来的）：
 *   scene = { type:'board_scene', version:1, id, width, height,
 *             elements:[{ id, kind, box:{column,lane,y,...}, block }],
 *             connectors:[], layout:{ type:'split_workspace',
 *               columns:[{id:'left',lane:'reference'},{id:'right',lane:'solution'}],
 *               ... } }
 *
 *   elements[].block 有内容时，内核会自动把它拼成 board_doc 渲染。
 *   box.column 决定这块落在左栏还是右栏。
 *
 * 尺寸基准：内核默认 width 1100、单栏约 530，不是 506。
 * 所以外层 iframe 必须给到 ~1100 宽，窄屏再等比缩放。
 */

/** 欧拉 doc 里允许的文本 part */
export type BoardPart =
  | { type: 'text'; text: string }
  | { type: 'formula'; latex: string; display?: boolean }
  | { type: 'mark'; text?: string };

/** callout 内部能放的东西 */
export type CalloutContent =
  | { type: 'paragraph'; parts: BoardPart[]; variant?: 'display_formula' }
  | { type: 'list'; style?: 'bullet' | 'numbered'; items: { parts: BoardPart[] }[] };

export type BoardBlock =
  | { id: string; type: 'text'; paragraphs: { parts: BoardPart[] }[] }
  | { id: string; type: 'callout'; kind: 'important' | 'hint' | 'key' | 'tip' | 'summary'; title?: string; content: CalloutContent[] }
  | { id: string; type: 'stage_heading'; parts: BoardPart[]; stage_index?: number; badge?: string }
  | {
      id: string;
      type: 'derivation';
      rows: {
        id: string;
        /** 纯 LaTeX 字符串，不能是对象（内核 String() 强转） */
        lhs: string;
        rel: string;
        rhs: string;
        status?: 'check' | 'cross';
        /** 右侧蓝色批注，走 normalizeRichLeaf，可以带 part 结构 */
        note?: BoardPart[];
      }[];
    }
  | { id: string; type: 'outline'; items: { id: string; parts: BoardPart[]; status?: 'done' | 'active' | 'pending' }[] }
  | { id: string; type: 'figure'; engine: 'boardggb' | 'boardcalc'; kind?: string; [k: string]: unknown };

export type BoardSceneElement = {
  id: string;
  kind: string;
  /** positioned 模式下 box.x/y/width/height 才是硬定位，否则内核按流式从左上堆叠 */
  box: { column: 'left' | 'right'; lane?: string; x: number; y: number; width: number; height: number };
  block: BoardBlock;
};

/**
 * 最终交给内核的形状。
 *
 * 这里不是 board_scene，而是一个「带 layout + elements 的 board_doc」：
 * renderScene 会自己把 elements 合成 doc，把它身上的 boardDraw 丢掉；
 * renderDoc 则原样把 doc 交给 Tc，layout.boardDraw 才认得。
 * 所以必须走 renderDoc，并且在 doc 顶层挂 layout / elements。
 */
export type BoardDocScene = {
  id: string;
  type: 'board_doc';
  version: number;
  width: number;
  height: number;
  elements: BoardSceneElement[];
  connectors: unknown[];
  layout: Record<string, unknown>;
  blocks: BoardBlock[];
};

/* ── 解析讲解文字里的 $...$ / $$...$$ ─────────────────────── */

export function splitMath(src: string): BoardPart[] {
  const out: BoardPart[] = [];
  const text = String(src ?? '');
  if (!text) return out;

  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;

  const pushText = (s: string) => {
    if (s) out.push({ type: 'text', text: s });
  };

  while ((m = re.exec(text))) {
    pushText(text.slice(last, m.index));
    const display = m[1] !== undefined;
    const latex = (display ? m[1] : m[2]).trim();
    if (latex) out.push(display ? { type: 'formula', latex, display: true } : { type: 'formula', latex });
    last = m.index + m[0].length;
  }
  pushText(text.slice(last));

  return out.length ? out : [{ type: 'text', text }];
}

/* ── 推导等式行 ───────────────────────────────────────────── */

/**
 * 批注文字 → part。
 * 「点 P(0,1)」这种纯中文走 text；带反斜杠/等号/上下标的当公式。
 * 不能直接丢给 splitMath，因为它要求原文里有 $ 才认公式。
 */
function noteToParts(note: string): BoardPart[] {
  const t = String(note || '').trim();
  if (!t) return [];
  // 显式写了 $ 就按原样切
  if (t.includes('$')) return splitMath(t);
  // 形如 "斜率 k=\frac{\sqrt{3}}{3}"：中文前缀 + 公式尾巴
  const m = t.match(/^([^\x00-\x7F]*)\s*(.+)$/);
  if (m && /[\\^_{}=]/.test(m[2])) {
    const parts: BoardPart[] = [];
    if (m[1].trim()) parts.push({ type: 'text', text: m[1].trim() + ' ' });
    parts.push({ type: 'formula', latex: m[2].trim() });
    return parts;
  }
  return [{ type: 'text', text: t }];
}

const RELS = ['\\Rightarrow', '\\Leftarrow', '\\Leftrightarrow', '\\therefore', '\\because', '\\to', '=', '<', '>', '\\le', '\\ge', '\\approx'];

/**
 * derivation 的单元格只吃纯字符串：
 * board-structure.mjs 里是 `lhs: String(i.lhs ?? "")`，塞对象会变成 "[object Object]"。
 * 所以这里只做「剥掉 $ 包裹」的清洗，不构造 part 对象。
 */
const cellOf = (s: string) => String(s || '').replace(/^\s*\$+|\$+\s*$/g, '').trim();

/**
 * 把 "x=0 ⇒ −√3y+√3=0 ⇒ y=1" 拆成 lhs/rel/rhs。
 * 认 ⇒ ⟹ → ⇔ ∴ 这些符号，也认「, 得」「，得」这种中文写法。
 */
export function parseDerivationLine(line: string): { lhs: string; rel: string; rhs: string; note?: string } | null {
  const t = String(line || '').trim();
  if (!t) return null;

  // 「⟦批注⟧」写在行尾，切出去单独做 note
  let note: string | undefined;
  const nm = t.match(/\s*[|｜]\s*([^|｜]+)$/);
  let body = t;
  if (nm) {
    note = nm[1].trim();
    body = t.slice(0, nm.index).trim();
  }

  const pack = (lhs: string, rel: string, rhs: string) => ({ lhs: cellOf(lhs), rel, rhs: cellOf(rhs), note });

  for (const rel of RELS) {
    const idx = body.indexOf(rel);
    if (idx > 0) return pack(body.slice(0, idx), rel, body.slice(idx + rel.length));
  }
  for (const sep of ['⇒', '⟹', '→', '⇔', '∴', '，得', ',得']) {
    const idx = body.indexOf(sep);
    if (idx > 0) {
      return pack(body.slice(0, idx), sep === '⇒' || sep === '⟹' ? '\\Rightarrow' : sep, body.slice(idx + sep.length));
    }
  }
  // 没有关系符就整行放 lhs，靠 note 挂在右边
  return { lhs: cellOf(body), rel: '', rhs: '', note };
}

/* ── 逐步装配 ─────────────────────────────────────────────── */

let seq = 0;
const nid = (p: string) => `${p}_${++seq}`;

type RawStep = {
  title?: string;
  text?: string;
  highlight?: string;
  lines?: string[];
  /** 这一步的关键标签（欧拉那边是右上角红底「关键」） */
  badge?: string;
  /** 后端 TALK_SYSTEM 产出的板书指令；全部步骤合并后统一画在左栏 */
  board?: BoardOp[];
  /** 公式行（可选，用于 derivation） */
  equations?: string[];
};

function stepBlocks(step: RawStep, index: number): BoardBlock[] {
  const blocks: BoardBlock[] = [];
  const title = String(step?.title || '').trim();
  const text = String(step?.text || '').trim();
  const highlight = String(step?.highlight || '').trim();
  const lines = (step?.lines || step?.equations || []).map((s) => String(s || '').trim()).filter(Boolean);

  if (title) {
    blocks.push({
      id: nid('h'),
      type: 'stage_heading',
      // stage_heading 读 e.parts，不是 e.title
      parts: [{ type: 'text', text: title }],
      stage_index: index + 1,
      badge: step?.badge || undefined,
    });
  }

  if (text) {
    const paras = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    blocks.push({ id: nid('p'), type: 'text', paragraphs: paras.map((p) => ({ parts: splitMath(p) })) });
  }

  // 公式行优先做成 derivation，这样才有「右挂批注」的排版
  const derivRows = lines
    .map((l) => ({ raw: l, d: parseDerivationLine(l) }))
    .filter((x) => x.d) as { raw: string; d: NonNullable<ReturnType<typeof parseDerivationLine>> }[];

  if (derivRows.length) {
    blocks.push({
      id: nid('d'),
      type: 'derivation',
      rows: derivRows.map(({ d }) => ({
        id: nid('row'),
        lhs: d.lhs,
        rel: d.rel,
        rhs: d.rhs,
        // note 走 normalizeRichLeaf → 只认 part，所以这里必须显式包成 formula
        // （直接塞 "k=\frac{..}" 会当纯文本原样显示成源码）
        ...(d.note ? { note: noteToParts(d.note) } : {}),
      })),
    });
  } else if (lines.length) {
    blocks.push({ id: nid('p'), type: 'text', paragraphs: lines.map((l) => ({ parts: splitMath(l) })) });
  }

  if (highlight) {
    blocks.push({
      id: nid('c'),
      type: 'callout',
      kind: 'key',
      content: [{ type: 'paragraph', parts: splitMath(highlight) }],
    });
  }

  // 图形统一由 planToBoardScene 收集所有步骤的 board[] 后画在左栏，
  // 不在这里逐步骤塞 figure —— 否则图会被打散进右栏文字流里。

  return blocks;
}

/* ── 后端 board[] 指令 → 欧拉 figure ──────────────────────────
 *
 * 后端 TALK_SYSTEM 本来就产出 steps[].board[]（14 种 op），经典皮肤
 * 用自研的 TutorBoard.tsx 画。欧拉皮肤分支之前把 board 整个丢了，
 * 所以「没有画图环节」。这里把它翻译成欧拉内核原生 figure：
 *
 *   axis / func  → engine:'boardcalc'（自绘坐标系 + y=f(x) 曲线）
 *   point/circle/line/vector/polygon/note/label/angle/arc
 *                → engine:'boardggb'（commands 字符串，GeoGebra 风格）
 *
 * 两种同时出现就出两个 figure 块，左栏上下排列。
 * orbit/spin/move 是动画指令，静态图里取最终/初始位置，
 * 等接 play 引擎时再还原逐帧。
 * ────────────────────────────────────────────────────────────── */

export type BoardOp = { op: string; [k: string]: unknown };

const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const f2 = (n: number) => String(Number(n.toFixed(3)));

/** 后端写的 x*x/2-1 这种 JS 式子 → boardcalc 能吃的 LaTeX-ish 表达式 */
function toPlotExpr(src: string): string {
  let s = String(src || '').trim();
  // x*x → x^2，x*x*x → x^3，避免解析器不认连乘
  s = s.replace(/x\s*\*\s*x\s*\*\s*x/g, 'x^{3}');
  s = s.replace(/x\s*\*\s*x/g, 'x^{2}');
  s = s.replace(/\^(\d+)/g, (_, d) => `^{${d}}`);
  s = s.replace(/\*/g, '\\cdot ');
  return s;
}

/**
 * 把一条 board 指令翻译成欧拉命令/表达式。
 * 返回 { commands, expressions, view, hasGeometry, hasPlot }
 */
export function boardOpsToFigure(ops: unknown): BoardBlock[] {
  const list: BoardOp[] = Array.isArray(ops) ? (ops as BoardOp[]) : [];
  if (!list.length) return [];

  const cmds: string[] = [];
  const curves: string[] = [];
  const names = new Map<string, { x: number; y: number }>();
  let view: Record<string, unknown> = { axes: true, width: 470, height: 300 };
  let tmp = 0;
  const anon = () => `_q${++tmp}`;

  /** from/to 可以是坐标数组、点名、或「点名±半径@角度」 */
  const ref = (v: unknown): string => {
    if (Array.isArray(v)) {
      const n = anon();
      cmds.push(`${n}=(${f2(num(v[0]))},${f2(num(v[1]))})`);
      return n;
    }
    const s = String(v ?? '').trim();
    if (!s) return anon();
    const polar = s.match(/^([A-Za-z_]\w*)\s*([+-])\s*([\d.]+)@(-?[\d.]+)$/);
    if (polar) {
      const base = names.get(polar[1]);
      if (base) {
        const r = num(polar[3]) * (polar[2] === '-' ? -1 : 1);
        const a = (num(polar[4]) * Math.PI) / 180;
        const n = anon();
        cmds.push(`${n}=(${f2(base.x + r * Math.cos(a))},${f2(base.y + r * Math.sin(a))})`);
        return n;
      }
    }
    return s;
  };

  const setStyle = (id: string, color = '#7446d6') => cmds.push(`setcolor(${id},${color})`);

  for (const op of list) {
    switch (op?.op) {
      case 'axis':
        view = {
          ...view,
          axes: true,
          xmin: num(op.xmin, -3), xmax: num(op.xmax, 4),
          ymin: num(op.ymin, -3), ymax: num(op.ymax, 4),
        };
        break;

      case 'point': {
        const name = String(op.name || anon());
        const x = num(op.x), y = num(op.y);
        cmds.push(`${name}=(${f2(x)},${f2(y)})`);
        names.set(name, { x, y });
        break;
      }

      case 'move': {
        const name = String(op.name || '');
        if (name && Array.isArray(op.to)) {
          // 静态图取最终位置：直接覆盖同名点（后面引用它的命令会用新值）
          const x = num(op.to[0]), y = num(op.to[1]);
          names.set(name, { x, y });
          cmds.push(`${name}=(${f2(x)},${f2(y)})`);
        }
        break;
      }

      case 'circle': {
        const c = anon();
        cmds.push(`${c}=(${f2(num(op.cx))},${f2(num(op.cy))})`);
        const id = anon();
        cmds.push(`${id}=Circle(${c},${f2(num(op.r, 1))})`);
        setStyle(id);
        break;
      }

      case 'line':
      case 'vector': {
        const a = ref(op.from), b = ref(op.to);
        const id = anon();
        cmds.push(op.op === 'vector'
          ? `${id}=Vector(${a},${b})`
          : `${id}=Segment(${a},${b})`);
        if (op.dash) cmds.push(`setlinestyle(${id},2)`);
        setStyle(id);
        break;
      }

      case 'polygon': {
        const pts = (Array.isArray(op.points) ? op.points : []).map((p: unknown) => ref(p));
        if (pts.length >= 3) {
          const id = anon();
          cmds.push(`${id}=Polygon(${pts.join(',')})`);
          if (op.fill && op.fill !== 'none') setStyle(id, String(op.fill));
        }
        break;
      }

      case 'func':
        curves.push(`y=${toPlotExpr(String(op.expr || 'x'))}`);
        break;

      case 'note':
      case 'label': {
        const x = num(op.x), y = num(op.y);
        const txt = String(op.text || '').replace(/[$"\\]/g, '').slice(0, 40);
        const id = anon();
        cmds.push(`${id}=Text((${f2(x)},${f2(y)}),"${txt}")`);
        if (op.tone === 'key' || op.tone === 'warn') setStyle(id, '#cf3a2c');
        break;
      }

      case 'arc':
      case 'angle': {
        // 欧拉的 Angle/Arc 命令未逐个验证，先用文字标注保证角度信息不丢
        const label = String(op.label || '');
        if (label) {
          const x = num(op.cx ?? op.x), y = num(op.cy ?? op.y);
          const id = anon();
          cmds.push(`${id}=Text((${f2(x)},${f2(y)}),"${label.replace(/[$"\\]/g, '')}")`);
          setStyle(id, '#cf3a2c');
        }
        break;
      }

      case 'orbit': {
        // 动点取起始角位置，保证圆上看得见这个点
        const cx = num(op.cx), cy = num(op.cy), r = num(op.r, 1);
        const a = (num(op.from) * Math.PI) / 180;
        const name = String(op.name || 'P');
        cmds.push(`${name}=(${f2(cx + r * Math.cos(a))},${f2(cy + r * Math.sin(a))})`);
        names.set(name, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
        break;
      }

      case 'spin':
        // 旋转动画静态化：先不额外生成，避免和已有向量重复
        break;

      default:
        break;
    }
  }

  const out: BoardBlock[] = [];

  // 几何构图：boardggb
  if (cmds.length) {
    out.push({
      id: nid('fig_geo'),
      type: 'figure',
      engine: 'boardggb',
      kind: 'axis2d',
      commands: cmds,
      view,
    } as BoardBlock);
  }

  // 函数曲线：boardcalc（自带坐标系）
  if (curves.length) {
    out.push({
      id: nid('fig_plot'),
      type: 'figure',
      engine: 'boardcalc',
      kind: 'axis2d',
      expressions: curves,
      view: {
        xmin: view.xmin ?? -3, xmax: view.xmax ?? 4,
        ymin: view.ymin ?? -3, ymax: view.ymax ?? 4,
        width: 470, height: 280,
      },
    } as BoardBlock);
  }

  return out;
}

/* ── 整份讲题 → scene ─────────────────────────────────────── */

export type TutorPlanLike = {
  title?: string;
  /** 左栏题目原文（含选项） */
  problem?: string;
  choices?: string[];
  think?: string[];
  steps?: RawStep[];
  keyMethod?: string;
  pitfall?: { wrong?: string; right?: string };
  answer?: string;
  /** 题目配图（boardggb 图元） */
  figure?: unknown;
};

const REF_W = 520;   // 左栏
const SOL_W = 540;   // 右栏
const GAP = 40;
const PAD = 56;      // 画布内边距（小标题的编号圆点带负偏移，左边要给够）
/** 块与块之间的竖向间距 */
const RH = 18;

/**
 * 高度估算。
 * 不估准会导致块重叠（positioned 模式下内核不会自动让位），
 * 但估太大会散成一堆空白，所以按下表贴着实际行高估。
 */
const H = {
  para: (parts: BoardPart[], lineH = 30) => {
    const chars = parts.reduce((n, p) => n + (p.type === 'formula' ? (p.latex || '').length * 0.8 : (p.text || '').length), 0);
    return Math.max(lineH, Math.ceil(chars / 24) * lineH);
  },
  heading: 44,
  derivation: (rows: number) => rows * 36 + 12,
  callout: (lines: number) => 44 + lines * 28,
  figure: 320,
};

export function planToBoardScene(plan: TutorPlanLike, docId = 'tutor'): BoardDocScene {
  seq = 0;
  const elements: BoardSceneElement[] = [];
  let yLeft = PAD;
  let yRight = PAD;

  /**
   * 分栏靠 block.layout.column（boarddoc.mjs 的 gt() 读它），
   * 不是 elements[].box.column —— 后者只在 positioned 绝对定位时用。
   * 所以每个 block 都要显式带上 column，否则内核按「left 填满再切 right」
   * 的流式规则排，左右内容就会串位。
   */
  const orderedBlocks: BoardBlock[] = [];
  const push = (block: BoardBlock, h: number, column: 'left' | 'right') => {
    const tagged = {
      ...block,
      layout: { ...(((block as Record<string, unknown>).layout as object) || {}), column },
    } as BoardBlock;
    orderedBlocks.push(tagged);
    elements.push({
      id: block.id,
      kind: block.type,
      box: {
        column,
        lane: column === 'left' ? 'reference' : 'solution',
        x: column === 'left' ? PAD : PAD + REF_W + GAP,
        y: column === 'left' ? yLeft : yRight,
        width: column === 'left' ? REF_W : SOL_W,
        height: Math.max(28, h),
      },
      block: tagged,
    });
    if (column === 'left') yLeft += Math.max(28, h) + RH;
    else yRight += Math.max(28, h) + RH;
  };
  const pushLeft = (block: BoardBlock, h: number) => push(block, h, 'left');
  const pushRight = (block: BoardBlock, h: number) => push(block, h, 'right');

  /* 左栏：题目 + 选项 + 图 */
  const problem = String(plan?.problem || '').trim();
  const choices = (plan?.choices || []).map((s) => String(s || '').trim()).filter(Boolean);

  if (problem) {
    const paras = problem.split(/\n+/).map((p) => splitMath(p));
    pushLeft({ id: nid('q'), type: 'text', paragraphs: paras.map((p) => ({ parts: p })) }, H.para(paras.flat()));
  }
  if (choices.length) {
    // 选项两两一行，跟欧拉原版一致
    const rows: string[][] = [];
    for (let i = 0; i < choices.length; i += 2) rows.push(choices.slice(i, i + 2));
    pushLeft(
      { id: nid('q'), type: 'text', paragraphs: rows.map((r) => ({ parts: splitMath(r.join('    ')) })) },
      rows.length * 38 + 8,
    );
  }
  // 后端约定「每一步只给这一步新增的图形」，所以要把全部步骤的 board 合并，
  // 再一次性翻译成欧拉 figure 画在左栏题目下方。
  const allBoard: BoardOp[] = (plan?.steps || []).flatMap((s) => (Array.isArray(s.board) ? s.board : []));
  const figures = boardOpsToFigure(allBoard);
  for (const fig of figures) pushLeft(fig, H.figure);

  // 兼容调用方直接传 figure 对象的情况
  if (plan?.figure && !figures.length) {
    pushLeft({ id: nid('qfig'), type: 'figure', engine: 'boardggb', ...(plan.figure as object) } as BoardBlock, H.figure);
  }

  /* 右栏：先想一想 → 步骤 → 关键方法 → 答案 */
  const think = (plan?.think || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (think.length) {
    pushRight(
      {
        id: nid('think'),
        type: 'callout',
        kind: 'hint',
        title: '先想一想',
        content: [{ type: 'list', style: 'bullet', items: think.map((s) => ({ parts: splitMath(s) })) }],
      },
      H.callout(think.length),
    );
  }

  for (const [i, step] of (plan?.steps || []).entries()) {
    const blocks = stepBlocks(step, i);
    for (const b of blocks) {
      let h = 60;
      if (b.type === 'stage_heading') h = H.heading;
      else if (b.type === 'text') h = H.para(b.paragraphs.flatMap((p) => p.parts));
      else if (b.type === 'derivation') h = H.derivation(b.rows.length);
      else if (b.type === 'callout') h = H.callout(1);
      else if (b.type === 'figure') h = H.figure;
      pushRight(b, h);
    }
  }

  const keyMethod = String(plan?.keyMethod || '').trim();
  if (keyMethod) {
    pushRight(
      {
        id: nid('km'),
        type: 'callout',
        kind: 'important',
        title: '关键方法',
        content: [{ type: 'paragraph', parts: splitMath(keyMethod) }],
      },
      H.callout(2),
    );
  }

  const answer = String(plan?.answer || '').trim();
  if (answer) {
    pushRight(
      {
        id: nid('ans'),
        type: 'callout',
        kind: 'summary',
        title: '答案',
        content: [{ type: 'paragraph', parts: splitMath(answer), variant: 'display_formula' }],
      },
      H.callout(2),
    );
  }

  const width = REF_W + GAP + SOL_W + PAD * 2;
  return {
    id: docId,
    type: 'board_doc',
    version: 1,
    width,
    height: Math.max(800, Math.max(yLeft, yRight) + 60),
    elements,
    connectors: [],
    // renderDoc 真正读的是 doc.blocks；每个 block 自带 layout.column 决定分栏
    blocks: orderedBlocks,
    layout: {
      type: 'split_workspace',
      // 分栏由每个 block.layout.column 决定，走内核的自动排版（gt()）。
      // positioned:true 会强行按 elements[].box 绝对定位，反而和自动分栏打架，
      // 导致左右内容串位 —— 实测关掉才对齐欧拉原版。
      positioned: false,
      stem: 'reference_lane',
      orientation: 'columns',
      gap: GAP,
      width,
      safeArea: { top: PAD, right: PAD, bottom: PAD, left: PAD },
      // 手绘纸感（编号圆点、描边、--qb-draw-* 变量）全靠 layout.boardDraw 打开。
      // 之前是在 board.html 上硬写 class="qb-board-draw"，会被内核 toggle 掉——
      // 一旦掉了，小标题的编号圆点、卡片描边整片样式全失效。
      boardDraw: { enabled: true },
      columns: [
        { id: 'left', lane: 'reference', width: REF_W, prefers: ['problem_source', 'top_to_bottom'] },
        { id: 'right', lane: 'solution', width: SOL_W, prefers: ['solution_main', 'top_to_bottom'] },
      ],
    },
  };
}
