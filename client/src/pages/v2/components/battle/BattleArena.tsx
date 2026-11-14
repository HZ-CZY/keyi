import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2, Timer, X } from 'lucide-react';
import {
  StageBigChar,
  StageSentence,
  StageHeadline,
  toPinyin,
} from '../ImmersiveQuiz';
import type { Question } from './types';

/**
 * 对局答题区：白底题干卡 + 双列选项卡 + 两段式提交。
 *
 * 交互语义（仅渲染层改动，计分仍由后端判定）：
 *   picked        = 当前「选中待提交」的选项（未提交）
 *   revealedIndex = 提交后后端返回的正确项（用于染色对错）
 */

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

/** 选项卡片：不同状态的边框 / 底色 */
function optionClass(i: number, picked: number | null, revealedIndex: number | null): string {
  const base =
    'w-full text-left flex items-start gap-3 rounded-xl border px-3.5 py-3.5 text-[15px] leading-relaxed transition-all';
  if (revealedIndex === null) {
    return i === picked
      ? `${base} border-[#4f46e5] bg-indigo-50 text-slate-900 shadow-sm`
      : `${base} border-slate-200 bg-white text-slate-800 hover:border-[#7c5cf0] hover:shadow-sm`;
  }
  if (i === revealedIndex) return `${base} border-emerald-500 bg-emerald-50 text-emerald-900`;
  if (i === picked) return `${base} border-rose-400 bg-rose-50 text-rose-900`;
  return `${base} border-slate-200 bg-white/60 text-slate-400 opacity-60`;
}

/** 左侧字母徽标：不同状态的配色 */
function letterClass(i: number, picked: number | null, revealedIndex: number | null): string {
  const base =
    'mt-[1px] flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[13px] font-extrabold';
  if (revealedIndex === null) {
    return i === picked
      ? `${base} bg-[#4f46e5] text-white`
      : `${base} bg-slate-100 text-slate-500`;
  }
  if (i === revealedIndex) return `${base} bg-emerald-500 text-white`;
  if (i === picked) return `${base} bg-rose-500 text-white`;
  return `${base} bg-slate-100 text-slate-400`;
}

export default function BattleArena({
  question,
  total,
  picked,
  revealedIndex,
  submitting,
  waitingOpponent,
  opponentRemain,
  roundWaiting,
  roundNumber,
  error,
  onPick,
  onSubmit,
  deadline = null,
  limitSeconds = 25,
}: {
  question: Question | null;
  total: number;
  picked: number | null;
  revealedIndex: number | null;
  submitting: boolean;
  waitingOpponent: boolean;
  opponentRemain: number;
  roundWaiting?: boolean;
  roundNumber?: number;
  error: string;
  onPick: (i: number) => void;
  onSubmit: () => void;
  /** 本题截止时刻（ms，服务端下发）；null = 未开始计时 */
  deadline?: number | null;
  /** 单题限时秒数 */
  limitSeconds?: number;
}) {
  // 已提交（revealedIndex 有值）或本题已答过 → 锁定所有选项
  const locked = revealedIndex !== null || submitting || !!question?.alreadyAnswered;

  // 单题倒计时（服务端权威判超时；这里只做展示，25 秒内不作答后端会按答错推进）
  const [remainMs, setRemainMs] = useState<number>(() =>
    deadline ? Math.max(0, deadline - Date.now()) : 0
  );
  useEffect(() => {
    if (!deadline) {
      setRemainMs(0);
      return;
    }
    const tick = (): void => setRemainMs(Math.max(0, deadline - Date.now()));
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [deadline]);

  const timerActive = !!deadline && !locked && !waitingOpponent && !roundWaiting && !!question;
  const secs = Math.ceil(remainMs / 1000);
  const urgent = timerActive && remainMs <= 5000;
  const timeUp = timerActive && remainMs <= 0;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-28 pt-3">
      {/* 单题限时条：25 秒倒数，剩 5 秒变红 */}
      {timerActive ? (
        <div className="mb-3 flex items-center gap-3 rounded-full bg-white/85 px-4 py-2 shadow-[0_6px_18px_rgba(76,45,140,0.10)] ring-1 ring-white/60 backdrop-blur">
          <Timer className={`h-4 w-4 ${urgent ? 'text-rose-500' : 'text-[#7c5cf0]'}`} />
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/70">
            <div
              className={`h-full rounded-full ${urgent ? 'bg-rose-500' : 'bg-[#6a58f2]'}`}
              style={{ width: `${Math.max(0, Math.min(100, (remainMs / (limitSeconds * 1000)) * 100))}%` }}
            />
          </div>
          <span
            className={`w-9 text-right text-sm font-extrabold tabular-nums ${urgent ? 'text-rose-500' : 'text-slate-700'}`}
          >
            {timeUp ? '超时' : `${secs}s`}
          </span>
        </div>
      ) : null}
      {/* 我方答完，等待对手 */}
      {waitingOpponent ? (
        <div className="mt-10 flex flex-col items-center rounded-[24px] bg-white/85 px-6 py-12 shadow-[0_14px_36px_rgba(76,45,140,0.18)] ring-1 ring-white/60 backdrop-blur">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }}
            className="text-[#7c5cf0]"
          >
            <Loader2 className="h-9 w-9" strokeWidth={2.2} />
          </motion.div>
          <p className="mt-5 text-base font-extrabold text-slate-700">等待对手完成…</p>
          <p className="mt-1.5 text-xs text-slate-400">对手还剩 {Math.max(0, opponentRemain)} 题</p>
        </div>
      ) : null}

      {/* 逐题等待：我方已答第 k 题，等对手答完同一题再进下一题 */}
      {roundWaiting ? (
        <div className="mt-10 flex flex-col items-center rounded-[24px] bg-white/85 px-6 py-12 shadow-[0_14px_36px_rgba(76,45,140,0.18)] ring-1 ring-white/60 backdrop-blur">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }}
            className="text-[#7c5cf0]"
          >
            <Loader2 className="h-9 w-9" strokeWidth={2.2} />
          </motion.div>
          <p className="mt-5 text-base font-extrabold text-slate-700">等待对方作答第 {roundNumber} 题…</p>
          <p className="mt-1.5 text-xs text-slate-400">对方答完本题后自动进入下一题</p>
        </div>
      ) : null}

      {/* 题目区 */}
      {question && !waitingOpponent ? (
        <div className="rounded-[24px] bg-white/90 px-4 py-5 text-left shadow-[0_14px_36px_rgba(76,45,140,0.18)] ring-1 ring-white/60 backdrop-blur sm:px-6 sm:py-6">
          {question.keyword ? (
            <>
              <StageBigChar char={question.keyword} py={toPinyin(question.keyword)} />
              <StageSentence html={question.stem} source={question.source} />
            </>
          ) : (
            <StageHeadline html={question.stem} />
          )}

          {/* 双列选项卡 */}
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {question.options.map((opt, i) => (
              <button
                key={i}
                type="button"
                disabled={locked}
                onClick={() => onPick(i)}
                className={`${optionClass(i, picked, revealedIndex)} disabled:cursor-default`}
              >
                <span className={letterClass(i, picked, revealedIndex)}>
                  {OPTION_LETTERS[i] || i + 1}
                </span>
                <span className="flex-1 text-slate-800 leading-relaxed">{opt}</span>
                {revealedIndex !== null && i === revealedIndex ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : null}
                {revealedIndex !== null && i === picked && i !== revealedIndex ? (
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                ) : null}
              </button>
            ))}
          </div>

          {/* 提交按钮：选中后可用，提交后隐藏 */}
          {revealedIndex === null && !question.alreadyAnswered ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 flex justify-end"
            >
              <button
                type="button"
                onClick={onSubmit}
                disabled={picked === null || submitting}
                className={`rounded-full px-8 py-2.5 text-[15px] font-extrabold transition-transform active:scale-95 ${
                  picked === null || submitting
                    ? 'bg-slate-200 text-slate-400'
                    : 'bg-[#6a58f2] text-white shadow-[0_8px_20px_rgba(106,88,242,0.4)]'
                }`}
              >
                {submitting ? '提交中…' : '提交'}
              </button>
            </motion.div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-2xl bg-rose-500/90 px-4 py-2 text-center text-[13px] font-semibold text-white shadow">
          {error}
        </p>
      ) : null}

      {/* 未答完但题目未就绪时的兜底提示（避免空白） */}
      {!question && !waitingOpponent && !roundWaiting ? (
        <p className="mt-10 text-center text-sm text-white/80">题目加载中…</p>
      ) : null}
      <p className="sr-only">共 {total} 题</p>
    </div>
  );
}
