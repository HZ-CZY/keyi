import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronLeft, Volume2, X } from 'lucide-react';
import { pinyin } from 'pinyin-pro';
import { renderMarkup } from '../../../lib/markup';

/**
 * ImmersiveQuiz — 学习 / 复习 / 训练场三个答题界面共用的视觉外壳。
 *
 * ⚠️ 只负责「外观与结构」：不持有任何答题逻辑、判分逻辑或进度语义。
 *    调用方（学习页 / 复习页 / 训练场训练器）继续保留各自的交互与进度计算。
 */

/** 注入的富文本样式（与学习页保持一致） */
const STUDY_CSS = `
  .study-bold b, .study-main b, .study-main strong { color:inherit; font-weight:800; }
  .mark-highlight { background: linear-gradient(120deg,#fde68a 0%,#fde68a 40%,#fbbf24 100%); padding:0 4px; border-radius:3px; font-weight:600; }
`;

/**
 * 汉字 → 带声调拼音（离线，pinyin-pro）。
 * 仅用于展示，任何答题 / 判分逻辑都不依赖它；转换失败返回空串。
 */
export function toPinyin(text: string): string {
  if (!text) return '';
  try {
    return pinyin(text, { toneType: 'symbol' }) || '';
  } catch {
    return '';
  }
}

/** 拼音 Hook：随重点字变化重算（memo 缓存），失败返回空串 */
export function usePinyin(text: string): string {
  const kw = text || '';
  return useMemo(() => toPinyin(kw), [kw]);
}

/** 从例句中提取第一个《书名》出处，没有则返回空串 */
export function extractBookSource(text: string): string {
  const m = (text || '').match(/《([^》]{1,20})》/);
  return m ? `《${m[1]}》` : '';
}

/**
 * 均匀浅蓝渐变背景 + 富文本样式注入。
 * 页面 / 浮层的最外层容器（已去掉柔光晕）。
 */
export function ImmersiveBackdrop({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-[#cfe0f4] via-[#bcd3ec] to-[#a9c6e6]">
      <style>{STUDY_CSS}</style>
      {children}
    </div>
  );
}

/**
 * 顶部大胶囊：返回箭头 + 上一词两行 + 绿色进度条。
 * progress 为 0~100 的百分比，由调用方按自己的进度语义传入。
 * 「...」更多按钮由 menuSlot 传入，渲染在胶囊右下方外侧。
 */
export function StageTopPill({
  word,
  meaning,
  progress,
  onBack,
  menuSlot,
}: {
  /** 上一词（重点字 / 关键词） */
  word?: string | null;
  /** 上一词义项（渲染后的纯文本，此处统一截断 40 字） */
  meaning?: string | null;
  progress: number;
  onBack?: () => void;
  menuSlot?: ReactNode;
}) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
  const py = usePinyin(word || '');
  const hasWord = !!(word && word.trim());
  const meaningText = (meaning || '').trim().slice(0, 40);

  return (
    <div className="relative z-30 mx-4 mt-3">
      <div className="bg-white/70 backdrop-blur-xl rounded-[20px] shadow-sm px-4 pt-2.5 pb-2.5">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 w-6 h-6 -ml-1 mt-[2px] flex items-center justify-center rounded-full hover:bg-white/70 transition-colors"
            aria-label="返回"
          >
            <ChevronLeft className="w-4 h-4 text-slate-500" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] text-slate-700 truncate">
              {hasWord ? (
                <>
                  {word}
                  {py ? <span className="ml-2 text-slate-400">{py}</span> : null}
                </>
              ) : (
                '暂无上一词'
              )}
            </p>
            {hasWord && meaningText ? (
              <p className="mt-0.5 text-[13px] text-slate-500 truncate">{meaningText}</p>
            ) : null}
          </div>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-slate-200/80 overflow-hidden">
          <motion.div
            className="h-full bg-emerald-400/90 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      </div>
      {menuSlot ? <div className="absolute -bottom-4 right-4 z-30">{menuSlot}</div> : null}
    </div>
  );
}

/**
 * 底部固定区：与背景同色系的渐变淡出，内容全宽贴边（与图二排版一致）。
 * children = 主操作（显示答案 / 评分 / 下一题）；
 * left / center / right = 底部三键（斩 / 灯泡 / 喇叭）。
 */
export function StageBottomBar({
  children,
  left,
  center,
  right,
}: {
  children?: ReactNode;
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 px-5 pb-5 pt-5 bg-gradient-to-t from-[#a9c6e6]/90 via-[#a9c6e6]/50 to-transparent">
      <div className="w-full">
        {children}
        <div className="flex items-center justify-between">
          {left || <span />}
          {center || <span />}
          {right || <span />}
        </div>
      </div>
    </div>
  );
}

/** 底部三键的统一外观（可传 className 覆盖） */
export function StageToolButton({
  label,
  onClick,
  children,
  disabled,
  className,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`transition-all ${
        disabled ? 'opacity-25 cursor-not-allowed' : 'hover:opacity-70 hover:scale-110'
      } ${className || ''}`}
    >
      {children}
    </button>
  );
}

/** 半透明白答案卡（原文 / 翻译 / 解析等详情） */
export function StageCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`w-full bg-white/70 backdrop-blur rounded-3xl p-6 text-left shadow-[0_14px_40px_rgba(96,125,180,0.2)] ${className || ''}`}
    >
      {children}
    </div>
  );
}

/** 答案卡内的字段标签 */
export function StageCardLabel({ children }: { children: ReactNode }) {
  return <p className="text-xs text-slate-400 font-medium mb-1.5">{children}</p>;
}

/** 答案卡内的字段正文（带 study-main 富文本样式） */
export function StageCardText({ html }: { html: string }) {
  return (
    <div
      className="study-main text-base font-semibold text-slate-800 leading-relaxed"
      dangerouslySetInnerHTML={{ __html: renderMarkup(html) }}
    />
  );
}

/**
 * 中央超大重点字 + 发音行。
 * 单字 56px / 多字 40px（紧凑档，保证 iPad 横屏一屏显示）；拼音为空时整行隐藏。
 */
export function StageBigChar({
  char,
  py,
  onSpeak,
}: {
  char: string;
  py?: string;
  onSpeak?: () => void;
}) {
  if (!char) return null;
  const isSingle = char.trim().length <= 1;
  return (
    <div className="flex flex-col items-center">
      <div
        className={`font-serif font-bold text-slate-800 ${
          isSingle ? 'text-[44px] leading-none' : 'text-[34px] leading-none'
        }`}
      >
        {char}
      </div>
      {py ? (
        <button
          type="button"
          onClick={onSpeak}
          aria-label="发音"
          title="发音"
          className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/50 hover:bg-white/75 transition-colors text-[12px]"
        >
          <span className="text-slate-500">发音</span>
          <Volume2 className="w-3 h-3 text-slate-400" />
          <span className="text-slate-400">{py}</span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * 例句行（左对齐，与选项同宽同内边距）：喇叭 + 例句 + 出处。
 * 出处只取《书名》部分，取不到就不渲染这一行。
 */
export function StageSentence({
  html,
  source,
  onSpeak,
}: {
  html: string;
  source?: string;
  onSpeak?: () => void;
}) {
  return (
    <div className="w-full mt-5 px-1">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onSpeak}
          aria-label="朗读例句"
          title="朗读例句"
          className="shrink-0 mt-[4px] flex items-center justify-center hover:opacity-70 transition-opacity"
        >
          <Volume2 className="w-4 h-4 text-slate-500" />
        </button>
        <div className="flex-1 min-w-0">
          <div
            className="study-main text-[17px] font-semibold text-slate-800 font-serif leading-snug"
            dangerouslySetInnerHTML={{ __html: renderMarkup(html) }}
          />
          {source ? <p className="mt-1 text-[13px] text-slate-500">- {source}</p> : null}
        </div>
      </div>
    </div>
  );
}

/* ── 选项样式契约 ── */

/** 选项基础形状（不含背景色，供已作答态叠加染色使用，避免 bg 冲突） */
export const OPTION_SHAPE =
  'w-full text-left px-5 py-4 rounded-[14px] text-[15px] leading-relaxed transition-all';

/** 未作答选项 */
export const OPTION_BASE =
  'w-full text-left px-5 py-4 rounded-[14px] bg-white/45 hover:bg-white/80 active:scale-[0.99] backdrop-blur-sm transition-all text-slate-800 text-[15px] leading-relaxed shadow-sm';

/** 答后：正确项 */
export const OPTION_CORRECT = 'bg-emerald-400/25 border border-emerald-500/40 text-emerald-900 font-medium';

/** 答后：选错的项 */
export const OPTION_WRONG = 'bg-rose-400/25 border border-rose-500/40 text-rose-900';

/** 答后：其余项 */
export const OPTION_DIM = 'bg-white/30 text-slate-500 opacity-60';

/** 判定胶囊：回答正确 / 回答错误 */
export function StageVerdict({ correct }: { correct: boolean }) {
  return (
    <div className="w-full flex justify-center mb-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium text-white shadow-md ${
          correct ? 'bg-emerald-400/90' : 'bg-rose-400/90'
        }`}
      >
        {correct ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
        {correct ? '回答正确' : '回答错误'}
      </motion.div>
    </div>
  );
}

/** 题干上方的小提示行 */
export function StagePrompt({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-slate-500/80 tracking-[0.2em] mb-8">{children}</p>;
}

/** 居中超大题干 */
export function StageHeadline({ html }: { html: string }) {
  return (
    <div
      className="study-main stage-headline text-center text-[1.35rem] leading-relaxed font-bold text-slate-800 font-serif"
      dangerouslySetInnerHTML={{ __html: renderMarkup(html) }}
    />
  );
}

/* ═══════════════════════════ 渲染异常兜底 ═══════════════════════════ */

/**
 * 舞台级错误边界：包裹 Trainer / 任意 Stage 子组件。
 * 一旦子组件在渲染期抛错（字段缺失、数据契约异常等），不再让整页 React 树卸载成空白，
 * 而是就地展示一个可恢复的兜底卡片，并在开发期 console.error 具体错误栈，便于定位。
 */
interface StageErrorBoundaryProps {
  children: ReactNode;
  /** 兜底卡片「放弃本局」按钮触发（通常接父组件的放弃流程） */
  onReset?: () => void;
}

interface StageErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class StageErrorBoundary extends Component<StageErrorBoundaryProps, StageErrorBoundaryState> {
  state: StageErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): StageErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 开发期暴露具体错误栈，便于定位渲染期异常（字段不匹配 / 数据契约问题）
    console.error('[StageErrorBoundary] 捕获渲染异常：', error, info?.componentStack || '');
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const err = this.state.error;
      return (
        <div className="fixed inset-0 z-[55] bg-gradient-to-b from-[#cfe0f4] via-[#bcd3ec] to-[#a9c6e6] flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-white/85 backdrop-blur rounded-3xl p-6 text-center shadow-xl">
            <p className="text-[15px] font-bold text-slate-800">题目渲染出现问题</p>
            <p className="mt-2 text-[13px] text-slate-500 leading-relaxed">
              本局进度已为你保留，可重试本题或放弃本局。
            </p>
            {err ? (
              <p className="mt-3 text-left text-[11px] text-rose-500 font-mono break-words bg-rose-50/60 rounded-xl p-2 max-h-32 overflow-auto">
                {String(err.message || err)}
              </p>
            ) : null}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={this.handleRetry}
                className="flex-1 h-11 rounded-2xl bg-slate-100 text-slate-600 font-medium active:scale-95 transition-transform"
              >
                重试本题
              </button>
              <button
                type="button"
                onClick={() => this.props.onReset?.()}
                className="flex-1 h-11 rounded-2xl bg-rose-500 text-white font-medium active:scale-95 transition-transform"
              >
                放弃本局
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
