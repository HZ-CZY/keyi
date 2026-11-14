/**
 * DeepTutor 讲题结果 → 欧拉白板 board_doc
 * ──────────────────────────────────────────────────────────────
 * 目标是让讲题页直接用欧拉（有道 miniboard）的渲染内核，
 * 而不是我们自己在 GeoGebra 上东拼西凑。
 *
 * 逆向出来的 schema（关键，别乱改）：
 *   doc.blocks 在顶层
 *   text 块用 paragraphs[].parts[]，part 类型 formula/student_input/blank/mark
 *   formula part 写作 { type: 'formula', latex } —— 不是 'latex'
 *   callout 的 content[] 元素必须是 { type:'paragraph', parts } 这种形状
 *   derivation 的行是 { id, lhs, rel, rhs, status }
 *
 * 坐标系画图（axis/point/circle/... 这堆 op）欧拉那边走的是
 * figure + engine:'boardcalc'，expressions 只吃 y=f(x) 这种曲线，
 * 纯几何构图并不在它的强项里 —— 所以这一层先把「文字 + 公式 +
 * 关键结论 + 纠错」做实，图形继续交给现有 GgbBoard 组件。
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
  | { id: string; type: 'formula'; latex: string }
  | { id: string; type: 'callout'; kind: 'key' | 'summary' | 'warn'; title?: string; content: CalloutContent[] }
  | { id: string; type: 'stage_heading'; parts: BoardPart[]; stage_index?: number }
  | { id: string; type: 'derivation'; rows: { id: string; lhs: string; rel: string; rhs: string; status?: string }[] }
  | { id: string; type: 'outline'; items: { id: string; parts: BoardPart[]; status?: 'done' | 'active' | 'pending' }[] };

export type BoardDoc = {
  id: string;
  type: 'board_doc';
  version: number;
  blocks: BoardBlock[];
};

/* ── 解析讲解文字里的 $...$ / $$...$$ ─────────────────────── */

/**
 * 把一句「可含 LaTeX」的话切成 text / formula 两种 part。
 * 认两种写法：$...$ 行内，$$...$$ 独立成行。
 * 数学里允许出现 \\$ 当转义美元符，不做特殊处理——讲题内容里基本不会遇到。
 */
export function splitMath(src: string): BoardPart[] {
  const out: BoardPart[] = [];
  const text = String(src ?? '');
  if (!text) return out;

  // $$...$$ 优先，再处理 $...$
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;

  const pushText = (s: string) => {
    if (!s) return;
    out.push({ type: 'text', text: s });
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

/* ── 一步讲解 → 若干 block ────────────────────────────────── */

type RawStep = {
  title?: string;
  text?: string;
  highlight?: string;
  board?: unknown[];
};

let seq = 0;
const nextId = (p: string) => `${p}_${++seq}`;

/**
 * 单步展开：小标题 → 正文 → （要点收进 callout）。
 * 要点用 callout 而不是普通段落，是因为欧拉那边 callout 自带
 * 黄纸片底色 + 图钉图标，视觉上「这是重点」的信号最强。
 */
export function stepToBlocks(step: RawStep, index: number): BoardBlock[] {
  const blocks: BoardBlock[] = [];
  const title = String(step?.title || '').trim();
  const text = String(step?.text || '').trim();
  const highlight = String(step?.highlight || '').trim();

  // stage_heading 的正文走 parts（渲染器读 e.parts），不是 title；title 会被忽略，出空 h2。
  if (title) blocks.push({
    id: nextId('h'),
    type: 'stage_heading',
    parts: [{ type: 'text', text: `${index + 1}. ${title}` }],
    stage_index: index + 1,
  });

  if (text) {
    // 按换行切段，空段丢掉
    const paras = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (paras.length === 1) {
      blocks.push({ id: nextId('p'), type: 'text', paragraphs: [{ parts: splitMath(paras[0]) }] });
    } else {
      blocks.push({ id: nextId('p'), type: 'text', paragraphs: paras.map((p) => ({ parts: splitMath(p) })) });
    }
  }

  if (highlight) {
    blocks.push({
      id: nextId('c'),
      type: 'callout',
      kind: 'key',
      content: [{ type: 'paragraph', parts: splitMath(highlight) }],
    });
  }

  return blocks;
}

/* ── 整份讲题 → doc ───────────────────────────────────────── */

export type TutorPlanLike = {
  title?: string;
  think?: string[];
  steps?: RawStep[];
  keyMethod?: string;
  pitfall?: { wrong?: string; right?: string };
  answer?: string;
};

export function planToBoardDoc(plan: TutorPlanLike, docId = 'tutor'): BoardDoc {
  seq = 0;
  const blocks: BoardBlock[] = [];

  const title = String(plan?.title || '').trim();
  if (title) blocks.push({ id: nextId('h'), type: 'stage_heading', parts: [{ type: 'text', text: title }] });

  // 引导思考：先抛问题，不给答案 —— 这是欧拉讲题的第一个动作
  const think = (plan?.think || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (think.length) {
    blocks.push({
      id: nextId('o'),
      type: 'outline',
      items: think.map((s, i) => ({
        id: `think_${i + 1}`,
        parts: splitMath(s),
        status: i === 0 ? 'active' : 'pending',
      })),
    });
  }

  for (const [i, step] of (plan?.steps || []).entries()) {
    blocks.push(...stepToBlocks(step, i));
  }

  const keyMethod = String(plan?.keyMethod || '').trim();
  if (keyMethod) {
    blocks.push({
      id: nextId('c'),
      type: 'callout',
      kind: 'summary',
      title: '这类题的通法',
      content: [{ type: 'paragraph', parts: splitMath(keyMethod) }],
    });
  }

  const wrong = String(plan?.pitfall?.wrong || '').trim();
  const right = String(plan?.pitfall?.right || '').trim();
  if (wrong || right) {
    const content: CalloutContent[] = [];
    if (wrong) content.push({ type: 'paragraph', parts: [{ type: 'text', text: `常见错解：` }, ...splitMath(wrong)] });
    if (right) content.push({ type: 'paragraph', parts: [{ type: 'text', text: `正确做法：` }, ...splitMath(right)] });
    blocks.push({ id: nextId('c'), type: 'callout', kind: 'warn', title: '易错点', content });
  }

  const answer = String(plan?.answer || '').trim();
  if (answer) {
    blocks.push({
      id: nextId('c'),
      type: 'callout',
      kind: 'summary',
      title: '答案',
      content: [{ type: 'paragraph', parts: splitMath(answer), variant: 'display_formula' }],
    });
  }

  return { id: docId, type: 'board_doc', version: 1, blocks };
}
