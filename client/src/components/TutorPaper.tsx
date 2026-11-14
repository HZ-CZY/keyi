import { useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import TutorBoard, { type Step } from './TutorBoard';
import GgbBoard from './GgbBoard';

/**
 * 讲解纸（欧拉讲题形态）
 * ─────────────────────────────────────────────────
 * 一页自上而下的纸：阶段标题 / 讲解句 / 居中公式 / 图块 / 纸片要点。
 * 逐行揭示，当前句带荧光笔底纹，像老师一边说一边写。
 */

export function renderTex(src: string, display = false): string {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: false, trust: false });
  } catch {
    return src;
  }
}

export function MixedText({ text, className = '' }: { text: string; className?: string }) {
  const parts = useMemo(() => {
    const out: { tex: boolean; display: boolean; v: string }[] = [];
    const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push({ tex: false, display: false, v: text.slice(last, m.index) });
      if (m[1] !== undefined) out.push({ tex: true, display: true, v: m[1] });
      else out.push({ tex: true, display: false, v: m[2] });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ tex: false, display: false, v: text.slice(last) });
    return out;
  }, [text]);

  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.tex ? (
          <span key={i} dangerouslySetInnerHTML={{ __html: renderTex(p.v, p.display) }} />
        ) : (
          <span key={i}>{p.v}</span>
        )
      )}
    </span>
  );
}

export type PaperLine =
  | { k: 'stage'; no: number; title: string; step: number }
  | { k: 'say'; text: string; step: number }
  | { k: 'math'; tex: string; step: number }
  | { k: 'figure'; step: number }
  | { k: 'callout'; title: string; text: string; tone: 'key' | 'summary' | 'warn' | 'method'; step: number };

/** 按中文句读切句，$...$ 内部不切 */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inMath = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '$') inMath = !inMath;
    buf += ch;
    if (!inMath && /[。；！？]/.test(ch)) {
      const t = buf.trim();
      if (t) out.push(t);
      buf = '';
    }
  }
  const rest = buf.trim();
  if (rest) out.push(rest);
  return out.length ? out : [text];
}

/** 整句就是一个公式 → 单独成行居中 */
const PURE_MATH = /^\$[^$]{2,80}\$$/;

export function buildPaper(steps: Step[]): PaperLine[] {
  const lines: PaperLine[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    lines.push({ k: 'stage', no: i + 1, title: s.title || `第 ${i + 1} 步`, step: i });
    for (const raw of splitSentences(String(s.text || ''))) {
      const t = raw.trim();
      if (!t) continue;
      if (PURE_MATH.test(t)) lines.push({ k: 'math', tex: t.slice(1, -1), step: i });
      else lines.push({ k: 'say', text: t, step: i });
    }
    if (Array.isArray(s.board) && s.board.length) lines.push({ k: 'figure', step: i });
    if (s.highlight) lines.push({ k: 'callout', title: '这一步的要点', text: s.highlight, tone: 'key', step: i });
  }
  return lines;
}

type Props = {
  steps: Step[];
  /** 已揭示的行数（父组件驱动） */
  revealed: number;
  playKey: number;
  think?: string[];
  keyMethod?: string;
  pitfall?: { wrong: string; right: string };
  answer?: string;
  model?: string;
  ms?: number;
};

export default function TutorPaper({ steps, revealed, playKey, think, keyMethod, pitfall, answer }: Props) {
  /* 真几何引擎优先；加载失败自动退回自绘 SVG，绝不让页面空着 */
  const [ggbFail, setGgbFail] = useState(false);
  const lines = useMemo(() => buildPaper(steps), [steps]);
  const curRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const shown = lines.slice(0, Math.max(0, revealed));
  const allDone = steps.length > 0 && revealed >= lines.length;

  useEffect(() => {
    const el = curRef.current;
    const box = el?.closest('.ol-scroll') as HTMLElement | null;
    if (!el || !box) return;
    /* offsetTop 依赖 offsetParent，滚动容器不一定是，改用 rect 差值最稳 */
    const rel = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTo({ top: Math.max(0, rel - box.clientHeight * 0.42), behavior: 'smooth' });
  }, [revealed]);

  /* 讲完后滚到底，把方法/易错/答案亮出来 */
  useEffect(() => {
    if (!allDone) return;
    const box = rootRef.current;
    if (!box) return;
    const t = setTimeout(() => box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }), 420);
    return () => clearTimeout(t);
  }, [allDone]);

  return (
    <div ref={rootRef} className="ol-root ol-scroll h-full overflow-y-auto px-5 sm:px-8 py-6">
      {/* 开场提示：无底色、标题带下划线（对齐欧拉 opening-hint） */}
      {!!think?.length && (
        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              fontSize: 15.5, fontWeight: 700, color: '#17171c',
              textDecoration: 'underline', textDecorationThickness: 1, textUnderlineOffset: 2,
              marginBottom: 7,
            }}
          >
            先想一想
          </div>
          <ol style={{ margin: 0, paddingInlineStart: 20 }}>
            {think.map((t, i) => (
              <li key={i} className="ol-p" style={{ fontSize: 15.5, lineHeight: 1.62, color: '#27262c', marginTop: i ? 5 : 0 }}>
                <MixedText text={t} />
              </li>
            ))}
          </ol>
        </div>
      )}

      {steps.length === 0 && !think?.length && (
        <div className="h-full flex items-center justify-center text-center">
          <p className="ol-p" style={{ color: '#b9b0a2', fontSize: 15 }}>
            识别出题目后点「开始讲解」
            <br />
            <span style={{ fontSize: 13 }}>我会一句一句写，图形跟着长出来</span>
          </p>
        </div>
      )}

      {shown.map((ln, i) => {
        const isCur = i === shown.length - 1 && !allDone;
        const ref = isCur ? curRef : undefined;

        if (ln.k === 'stage') {
          const first = i === 0;
          return (
            <div key={i} className="ol-line-in">
              <div
                className="ol-stage"
                style={{ borderTop: first ? 'none' : undefined, paddingTop: first ? 0 : 18, marginTop: first ? 0 : 6 }}
              >
                <span className="ol-stage-dot" />
                第 {ln.no} 步 · {ln.title}
              </div>
            </div>
          );
        }

        if (ln.k === 'say') {
          return (
            <div key={i} ref={ref} className="ol-line-in" style={{ marginTop: 12 }}>
              <p className="ol-p">
                <span className={isCur ? 'ol-mark' : ''}>
                  <MixedText text={ln.text} />
                </span>
              </p>
            </div>
          );
        }

        if (ln.k === 'math') {
          return (
            <div key={i} ref={ref} className="ol-line-in" style={{ marginTop: 4 }}>
              <div className="ol-mathline">
                <span className={isCur ? 'ol-mark' : ''} dangerouslySetInnerHTML={{ __html: renderTex(ln.tex, false) }} />
              </div>
            </div>
          );
        }

        if (ln.k === 'figure') {
          return (
            <div key={i} ref={ref} className="ol-line-in" style={{ marginTop: 10 }}>
              <div className="ol-figure" style={{ height: 292, maxWidth: 470, margin: '0 auto' }}>
                {ggbFail ? (
                  <TutorBoard steps={steps} stepIdx={ln.step} playKey={playKey} bare />
                ) : (
                  <GgbBoard
                    ops={steps.slice(0, ln.step + 1).flatMap((s) => s.board || [])}
                    replayKey={playKey + ln.step}
                    height={292}
                    onFail={() => setGgbFail(true)}
                  />
                )}
              </div>
            </div>
          );
        }

        const isLast = ln.step === steps.length - 1;
        if (!isLast) {
          return (
            <div key={i} ref={ref} className="ol-line-in" style={{ marginTop: 10 }}>
              <div
                style={{
                  borderLeft: '2px solid #cfe3d4', paddingLeft: 10, marginLeft: 2,
                  fontSize: 14, lineHeight: 1.6, color: '#5e7566', maxWidth: 460,
                }}
              >
                <MixedText text={ln.text} />
              </div>
            </div>
          );
        }
        return (
          <div key={i} ref={ref} className="ol-line-in" style={{ marginTop: 13 }}>
            <div className={`ol-callout ol-callout-${ln.tone}`} style={{ display: 'inline-block', maxWidth: '100%' }}>
              <div className="ol-callout-title">{ln.title}</div>
              <p className="ol-p" style={{ fontSize: 15.5, lineHeight: 1.62 }}>
                <MixedText text={ln.text} />
              </p>
            </div>
          </div>
        );
      })}

      {/* 收尾：方法 / 易错 / 答案，只在全部讲完后出现 */}
      {allDone && (keyMethod || pitfall?.right || answer) && (
        <div className="ol-line-in" style={{ marginTop: 20, paddingBottom: 76 }}>
          {keyMethod && (
            <div className="ol-callout ol-callout-method" style={{ marginTop: 0, display: 'inline-block', maxWidth: '100%' }}>
              <div className="ol-callout-title">这一类题的通法</div>
              <p className="ol-p" style={{ fontSize: 15.5, lineHeight: 1.62 }}>
                <MixedText text={keyMethod} />
              </p>
            </div>
          )}

          {pitfall?.wrong && (
            <div className="ol-callout ol-callout-warn" style={{ marginTop: 10, transform: 'rotate(0.4deg)', display: 'inline-block', maxWidth: '100%' }}>
              <div className="ol-callout-title">容易错在这</div>
              <p className="ol-p" style={{ fontSize: 15.5, lineHeight: 1.62, textDecoration: 'line-through', textDecorationColor: '#d98a8a' }}>
                <MixedText text={pitfall.wrong} />
              </p>
              {pitfall.right && (
                <p className="ol-p" style={{ fontSize: 15.5, lineHeight: 1.62, marginTop: 5 }}>
                  <MixedText text={pitfall.right} />
                </p>
              )}
            </div>
          )}

          {answer && (
            <div
              style={{
                marginTop: 14, paddingTop: 12, borderTop: '0.5px solid var(--ol-rule)',
                display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 700, color: '#6f7f72', letterSpacing: 0.4 }}>答案</span>
              <span style={{ fontSize: 21, fontWeight: 700 }}>
                <MixedText text={answer.includes('$') ? answer : `$${answer}$`} />
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
