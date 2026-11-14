function splitMath(src) {
  const out = [];
  const text = String(src ?? "");
  if (!text) return out;
  /* 模型除了 $...$ 还会写 \(...\) / \[...\]，旧版只认 $ 会把
     \(\vec{CP}\) 原样显示成源码 —— 线上「先想一想」里就漏了一串。 */
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g;
  let last = 0;
  let m;
  const pushText = (s) => {
    if (s) out.push({ type: "text", text: s });
  };
  while (m = re.exec(text)) {
    pushText(text.slice(last, m.index));
    const display = m[1] !== void 0 || m[4] !== void 0;
    const latex = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (latex) out.push(display ? { type: "formula", latex, display: true } : { type: "formula", latex });
    last = m.index + m[0].length;
  }
  pushText(text.slice(last));
  return out.length ? out : [{ type: "text", text }];
}
function noteToParts(note) {
  const t = String(note || "").trim();
  if (!t) return [];
  if (t.includes("$")) return splitMath(t);
  const m = t.match(/^([^\x00-\x7F]*)\s*(.+)$/);
  if (m && /[\\^_{}=]/.test(m[2])) {
    const parts = [];
    if (m[1].trim()) parts.push({ type: "text", text: m[1].trim() + " " });
    parts.push({ type: "formula", latex: m[2].trim() });
    return parts;
  }
  return [{ type: "text", text: t }];
}
const RELS = ["\\Rightarrow", "\\Leftarrow", "\\Leftrightarrow", "\\therefore", "\\because", "\\to", "=", "<", ">", "\\le", "\\ge", "\\approx"];
const cellOf = (s) => String(s || "").replace(/^\s*\$+|\$+\s*$/g, "").trim();
function parseDerivationLine(line) {
  const t = String(line || "").trim();
  if (!t) return null;
  let note;
  const nm = t.match(/\s*[|｜]\s*([^|｜]+)$/);
  let body = t;
  if (nm) {
    note = nm[1].trim();
    body = t.slice(0, nm.index).trim();
  }
  const pack = (lhs, rel, rhs) => ({ lhs: cellOf(lhs), rel, rhs: cellOf(rhs), note });
  for (const rel of RELS) {
    const idx = body.indexOf(rel);
    if (idx > 0) return pack(body.slice(0, idx), rel, body.slice(idx + rel.length));
  }
  for (const sep of ["\u21D2", "\u27F9", "\u2192", "\u21D4", "\u2234", "\uFF0C\u5F97", ",\u5F97"]) {
    const idx = body.indexOf(sep);
    if (idx > 0) {
      return pack(body.slice(0, idx), sep === "\u21D2" || sep === "\u27F9" ? "\\Rightarrow" : sep, body.slice(idx + sep.length));
    }
  }
  return { lhs: cellOf(body), rel: "", rhs: "", note };
}
let seq = 0;
const nid = (p) => `${p}_${++seq}`;
function stepBlocks(step, index) {
  const blocks = [];
  const title = String(step?.title || "").trim();
  const text = String(step?.text || "").trim();
  const highlight = String(step?.highlight || "").trim();
  const lines = (step?.lines || step?.equations || []).map((s) => String(s || "").trim()).filter(Boolean);
  if (title) {
    blocks.push({
      id: nid("h"),
      type: "stage_heading",
      // stage_heading 读 e.parts，不是 e.title
      parts: [{ type: "text", text: title }],
      stage_index: index + 1,
      badge: step?.badge || void 0
    });
  }
  if (text) {
    /* 模型常把整步讲解塞成一段没有换行的长文本（线上实测单块高达 286px，
       一整堵字墙）。rhythm 只管块与块之间，块内仍会挤在一起，所以这里按
       句末标点切短，跳过 $...$ 内部避免把公式劈开，再合并成不超过 6 个
       独立 text 块 —— 每段之间才会走 L() 的 6~12px 段间节奏。 */
    const paras = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const sentences = [];
    for (const line of paras) {
      let buf = "";
      let inMath = false;
      for (const ch of Array.from(line)) {
        if (ch === "$") { inMath = !inMath; buf += ch; continue; }
        buf += ch;
        if (!inMath && /[。；！？;]/.test(ch) && buf.length >= 12) {
          sentences.push(buf.trim());
          buf = "";
        }
      }
      if (buf.trim()) sentences.push(buf.trim());
    }
    if (!sentences.length) sentences.push(text);
    const per = Math.max(1, Math.ceil(sentences.length / 6));
    for (let i = 0; i < sentences.length; i += per) {
      const chunk = sentences.slice(i, i + per).join("");
      blocks.push({ id: nid("p"), type: "text", paragraphs: [{ parts: splitMath(chunk) }] });
    }
  }
  const derivRows = lines.map((l) => ({ raw: l, d: parseDerivationLine(l) })).filter((x) => x.d);
  if (derivRows.length) {
    blocks.push({
      id: nid("d"),
      type: "derivation",
      rows: derivRows.map(({ d }) => ({
        id: nid("row"),
        lhs: d.lhs,
        rel: d.rel,
        rhs: d.rhs,
        // note 走 normalizeRichLeaf → 只认 part，所以这里必须显式包成 formula
        // （直接塞 "k=\frac{..}" 会当纯文本原样显示成源码）
        ...d.note ? { note: noteToParts(d.note) } : {}
      }))
    });
  } else if (lines.length) {
    blocks.push({ id: nid("p"), type: "text", paragraphs: lines.map((l) => ({ parts: splitMath(l) })) });
  }
  if (highlight) {
    blocks.push({
      id: nid("c"),
      type: "callout",
      kind: "key",
      content: [{ type: "paragraph", parts: splitMath(highlight) }]
    });
  }
  /* 每个块都标上所属步骤：Web 宿主按这个号把板书切成「一段一段」放出来。
     内核只读自己认识的字段，多一个 stage_index 不影响渲染。 */
  return blocks.map((b) => b.stage_index ? b : { ...b, stage_index: index + 1 });
}
const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const f2 = (n) => String(Number(n.toFixed(3)));
function toPlotExpr(src) {
  let s = String(src || "").trim();
  s = s.replace(/x\s*\*\s*x\s*\*\s*x/g, "x^{3}");
  s = s.replace(/x\s*\*\s*x/g, "x^{2}");
  s = s.replace(/\^(\d+)/g, (_, d) => `^{${d}}`);
  s = s.replace(/\*/g, "\\cdot ");
  return s;
}
function boardOpsToFigure(ops) {
  const list = Array.isArray(ops) ? ops : [];
  if (!list.length) return [];
  const cmds = [];
  const curves = [];
  const names = /* @__PURE__ */ new Map();
  let view = { axes: true, width: 470, height: 300 };
  let tmp = 0;
  const anon = () => `_q${++tmp}`;
  const ref = (v) => {
    if (Array.isArray(v)) {
      const n = anon();
      cmds.push(`${n}=(${f2(num(v[0]))},${f2(num(v[1]))})`);
      return n;
    }
    const s = String(v ?? "").trim();
    if (!s) return anon();
    const polar = s.match(/^([A-Za-z_]\w*)\s*([+-])\s*([\d.]+)@(-?[\d.]+)$/);
    if (polar) {
      const base = names.get(polar[1]);
      if (base) {
        const r = num(polar[3]) * (polar[2] === "-" ? -1 : 1);
        const a = num(polar[4]) * Math.PI / 180;
        const n = anon();
        cmds.push(`${n}=(${f2(base.x + r * Math.cos(a))},${f2(base.y + r * Math.sin(a))})`);
        return n;
      }
    }
    return s;
  };
  const setStyle = (id, color = "#7446d6") => cmds.push(`setcolor(${id},${color})`);
  for (const op of list) {
    switch (op?.op) {
      case "axis":
        view = {
          ...view,
          axes: true,
          xmin: num(op.xmin, -3),
          xmax: num(op.xmax, 4),
          ymin: num(op.ymin, -3),
          ymax: num(op.ymax, 4)
        };
        break;
      case "point": {
        const name = String(op.name || anon());
        const x = num(op.x), y = num(op.y);
        cmds.push(`${name}=(${f2(x)},${f2(y)})`);
        names.set(name, { x, y });
        break;
      }
      case "move": {
        const name = String(op.name || "");
        if (name && Array.isArray(op.to)) {
          const x = num(op.to[0]), y = num(op.to[1]);
          names.set(name, { x, y });
          cmds.push(`${name}=(${f2(x)},${f2(y)})`);
        }
        break;
      }
      case "circle": {
        const c = anon();
        cmds.push(`${c}=(${f2(num(op.cx))},${f2(num(op.cy))})`);
        const id = anon();
        cmds.push(`${id}=Circle(${c},${f2(num(op.r, 1))})`);
        setStyle(id);
        break;
      }
      case "line":
      case "vector": {
        const a = ref(op.from), b = ref(op.to);
        const id = anon();
        cmds.push(op.op === "vector" ? `${id}=Vector(${a},${b})` : `${id}=Segment(${a},${b})`);
        if (op.dash) cmds.push(`setlinestyle(${id},2)`);
        setStyle(id);
        break;
      }
      case "polygon": {
        const pts = (Array.isArray(op.points) ? op.points : []).map((p) => ref(p));
        if (pts.length >= 3) {
          const id = anon();
          cmds.push(`${id}=Polygon(${pts.join(",")})`);
          if (op.fill && op.fill !== "none") setStyle(id, String(op.fill));
        }
        break;
      }
      case "func":
        curves.push(`y=${toPlotExpr(String(op.expr || "x"))}`);
        break;
      case "note":
      case "label": {
        const x = num(op.x), y = num(op.y);
        const raw = String(op.text || "").slice(0, 80);
        /* 带 $..$ / 反斜杠的内容必须按 formula 画，否则会原样显示成 LaTeX 源码 */
        const isMath = raw.includes("$") || /[\\^_{}]/.test(raw);
        const val = isMath
          ? JSON.stringify({ formula: raw.replace(/\$+/g, "").trim() })
          : JSON.stringify(raw.replace(/[$"]/g, ""));
        const id = anon();
        cmds.push(`${id}=Text((${f2(x)},${f2(y)}),${val})`);
        if (op.tone === "key" || op.tone === "warn") setStyle(id, "#cf3a2c");
        break;
      }
      case "arc":
      case "angle": {
        const label = String(op.label || "");
        if (label) {
          const x = num(op.cx ?? op.x), y = num(op.cy ?? op.y);
          const id = anon();
          cmds.push(`${id}=Text((${f2(x)},${f2(y)}),"${label.replace(/[$"\\]/g, "")}")`);
          setStyle(id, "#cf3a2c");
        }
        break;
      }
      case "orbit": {
        const cx = num(op.cx), cy = num(op.cy), r = num(op.r, 1);
        const a = num(op.from) * Math.PI / 180;
        const name = String(op.name || "P");
        cmds.push(`${name}=(${f2(cx + r * Math.cos(a))},${f2(cy + r * Math.sin(a))})`);
        names.set(name, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
        break;
      }
      case "spin":
        break;
      default:
        break;
    }
  }
  const out = [];
  if (cmds.length) {
    out.push({
      id: nid("fig_geo"),
      type: "figure",
      engine: "boardggb",
      kind: "axis2d",
      commands: cmds,
      view
    });
  }
  if (curves.length) {
    out.push({
      id: nid("fig_plot"),
      type: "figure",
      engine: "boardcalc",
      kind: "axis2d",
      expressions: curves,
      view: {
        xmin: view.xmin ?? -3,
        xmax: view.xmax ?? 4,
        ymin: view.ymin ?? -3,
        ymax: view.ymax ?? 4,
        width: 470,
        height: 280
      }
    });
  }
  return out;
}
let REF_W = 520;
let SOL_W = 540;
let GAP = 40;
let PAD = 56;

/**
 * Web 顶层页面：画布宽度跟真实视口走，避免内核按固定 1212px 排版后在
 * 窄容器里被居中裁掉左栏（APK 里由原生 setSafeArea 负责，Web 由宿主负责）。
 */
export function setSceneWidth(viewportWidth) {
  const w = Math.max(760, Math.min(2000, Math.round(Number(viewportWidth) || 1212)));
  const inner = Math.max(560, w - 40 - 56 * 2);
  REF_W = Math.round(inner * 0.49);
  SOL_W = inner - REF_W;
  GAP = 40;
  PAD = 56;
  return w;
}
const RH = 18;
const H = {
  para: (parts, lineH = 30) => {
    const chars = parts.reduce((n, p) => n + (p.type === "formula" ? (p.latex || "").length * 0.8 : (p.text || "").length), 0);
    return Math.max(lineH, Math.ceil(chars / 24) * lineH);
  },
  heading: 44,
  derivation: (rows) => rows * 36 + 12,
  callout: (lines) => 44 + lines * 28,
  figure: 320
};
function planToBoardScene(plan, docId = "tutor") {
  seq = 0;
  const elements = [];
  let yLeft = PAD;
  let yRight = PAD;
  const orderedBlocks = [];
  const push = (block, h, column) => {
    // split_workspace 模式下内核用 layout.pane 判栏（boardBlockLane），
    // 非 split 的自动流式排版才读 layout.column —— 两个都给，才不会串栏。
    const tagged = {
      ...block,
      layout: {
        ...block.layout || {},
        column,
        pane: column === "left" ? "reference" : "solution"
      }
    };
    orderedBlocks.push(tagged);
    elements.push({
      id: block.id,
      kind: block.type,
      box: {
        column,
        lane: column === "left" ? "reference" : "solution",
        x: column === "left" ? PAD : PAD + REF_W + GAP,
        y: column === "left" ? yLeft : yRight,
        width: column === "left" ? REF_W : SOL_W,
        height: Math.max(28, h)
      },
      block: tagged
    });
    if (column === "left") yLeft += Math.max(28, h) + RH;
    else yRight += Math.max(28, h) + RH;
  };
  const pushLeft = (block, h) => push(block, h, "left");
  const pushRight = (block, h) => push(block, h, "right");
  const problem = String(plan?.problem || "").trim();
  const choices = (plan?.choices || []).map((s) => String(s || "").trim()).filter(Boolean);
  if (problem) {
    const paras = problem.split(/\n+/).map((p) => splitMath(p));
    // visual_id / p_stem 是内核 usesSplitWorkspace() 的开关：不给就退化成
    // 固定 506px 双列（右侧大片留白且没有浅蓝题目栏），给了才走欧拉原生分栏。
    pushLeft({
      id: "p_stem",
      kind: "problem.stem",
      visual_id: "problem-stem",
      type: "text",
      paragraphs: paras.map((p) => ({ parts: p }))
    }, H.para(paras.flat()));
  }
  if (choices.length) {
    /* 逆向 boarddoc.mjs / whiteboard.mjs 的结论：
       · 内核有原生 problem.choices 块，渲染成 .doc-choices > .doc-choice，
         每个选项自带 label + body；列数由 problemChoiceColumnCount(items, 栏宽)
         按内容宽度自动算（1~5 列），boardBlockLane 自动归到 reference 栏。
       · 原来把 4 个选项用空格 join 塞进普通 text 段落，空格在渲染时被折叠，
         于是 A/B/C/D 全挤成一行 —— 这就是「选项都在一行」的根因。
       · type 必须留在 PROJECTED_BLOCK_TYPES 里（text 可以），kind 才是分发键。 */
    /* 短选项（A.-4 这种）内核默认会算成 4 列全挤一行，观感就是「ABCD 都在
       一行」。给 item 标 content_kind 后 problemChoiceColumnCount 里的 D(item)
       从 ~56px 提到 >=220px，栏宽 520 只能放 2 列 —— 实测 2x2 排列。
       长选项不加强制，交给内核按真实宽度自适应，避免挤压。 */
    const shortChoices = choices.every((c) => String(c).trim().length <= 14);
    pushLeft({
      id: nid("choices"),
      type: "section",
      kind: "problem.choices",
      items: choices.map((c, i) => {
        const raw = String(c).trim();
        const m = raw.match(/^([A-Da-d])\s*[\.、．:：\)]\s*([\s\S]*)$/);
        return {
          id: nid("ch"),
          label: m ? m[1].toUpperCase() + "." : String.fromCharCode(65 + i) + ".",
          ...(shortChoices ? { content_kind: "mixed" } : {}),
          parts: splitMath(m ? m[2] : raw)
        };
      })
    }, Math.max(160, Math.ceil(choices.length / 2) * 52 + 24));
  }
  const allBoard = (plan?.steps || []).flatMap((s) => Array.isArray(s.board) ? s.board : []);
  const figures = boardOpsToFigure(allBoard);
  for (const fig of figures) pushLeft(fig, H.figure);
  if (plan?.figure && !figures.length) {
    pushLeft({ id: nid("qfig"), type: "figure", engine: "boardggb", ...plan.figure }, H.figure);
  }
  const think = (plan?.think || []).map((s) => String(s || "").trim()).filter(Boolean);
  if (think.length) {
    pushRight(
      {
        id: nid("think"),
        type: "callout",
        kind: "hint",
        title: "\u5148\u60F3\u4E00\u60F3",
        content: [{ type: "list", style: "bullet", items: think.map((s) => ({ parts: splitMath(s) })) }]
      },
      H.callout(think.length)
    );
  }
  for (const [i, step] of (plan?.steps || []).entries()) {
    const blocks = stepBlocks(step, i);
    for (const b of blocks) {
      let h = 60;
      if (b.type === "stage_heading") h = H.heading;
      else if (b.type === "text") h = H.para(b.paragraphs.flatMap((p) => p.parts));
      else if (b.type === "derivation") h = H.derivation(b.rows.length);
      else if (b.type === "callout") h = H.callout(1);
      else if (b.type === "figure") h = H.figure;
      pushRight(b, h);
    }
  }
  const keyMethod = String(plan?.keyMethod || "").trim();
  if (keyMethod) {
    pushRight(
      {
        id: nid("km"),
        type: "callout",
        kind: "important",
        title: "\u5173\u952E\u65B9\u6CD5",
        content: [{ type: "paragraph", parts: splitMath(keyMethod) }]
      },
      H.callout(2)
    );
  }
  const answer = String(plan?.answer || "").trim();
  if (answer) {
    pushRight(
      {
        id: nid("ans"),
        type: "callout",
        kind: "summary",
        title: "\u7B54\u6848",
        content: [{ type: "paragraph", parts: noteToParts(answer), variant: "display_formula" }]
      },
      H.callout(2)
    );
  }
  // 没有题面文本时（极少），也要保住原生分栏：给左栏首块打上视觉标记
  if (!orderedBlocks.some((b) => b.visual_id)) {
    const first = orderedBlocks.find((b) => b.layout?.pane === "reference") || orderedBlocks[0];
    if (first) {
      first.visual_id = "problem-stem";
      const el = elements.find((e) => e.id === first.id);
      if (el) el.block = first;
    }
  }

  const width = REF_W + GAP + SOL_W + PAD * 2;
  return {
    id: docId,
    type: "board_doc",
    version: 1,
    width,
    height: Math.max(800, Math.max(yLeft, yRight) + 60),
    elements,
    connectors: [],
    // renderDoc 真正读的是 doc.blocks；每个 block 自带 layout.column 决定分栏
    blocks: orderedBlocks,
    layout: {
      type: "split_workspace",
      // 分栏由每个 block.layout.column 决定，走内核的自动排版（gt()）。
      // positioned:true 会强行按 elements[].box 绝对定位，反而和自动分栏打架，
      // 导致左右内容串位 —— 实测关掉才对齐欧拉原版。
      positioned: false,
      stem: "reference_lane",
      orientation: "columns",
      gap: GAP,
      /* ★ 段间节奏开关。layoutBoardDoc 里 S=Boolean(l.rhythm)，
         再传给 L(prevBlock, block, S, Z) 算垂直间距：
           rhythm=false（原来的值）→ L() 直接返回 0，callout 也只给 4px，
           所有块贴在一起，就是「字全扎堆」的根因；
           rhythm=true → stage_heading 前 20/后 10、callout 20、
           paragraph 相邻 6、默认 12、choices 后 16、题目→图形 20~24。
         这是内核原生节奏，不要自己给每个 block 塞 margin。 */
      rhythm: true,
      width,
      safeArea: { top: PAD, right: PAD, bottom: PAD, left: PAD },
      // 手绘纸感（编号圆点、描边、--qb-draw-* 变量）全靠 layout.boardDraw 打开。
      // 之前是在 board.html 上硬写 class="qb-board-draw"，会被内核 toggle 掉——
      // 一旦掉了，小标题的编号圆点、卡片描边整片样式全失效。
      boardDraw: { enabled: true },
      columns: [
        { id: "left", lane: "reference", width: REF_W, prefers: ["problem_source", "top_to_bottom"] },
        { id: "right", lane: "solution", width: SOL_W, prefers: ["solution_main", "top_to_bottom"] }
      ]
    }
  };
}
export {
  boardOpsToFigure,
  parseDerivationLine,
  planToBoardScene,
  splitMath
};
