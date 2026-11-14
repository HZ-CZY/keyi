import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Radio } from 'lucide-react';

/**
 * 对局中「实时战报」
 * ────────────────────────────────────────────────────────────
 * 一条可展开的窄条，贴在顶部比分横幅下面：
 *   · 收起：只显示最新一条（一行高，不抢答题区空间）
 *   · 展开：最近 6 条逐题战报
 *
 * 事件由 BattlePageV2 在「我方提交成功」和「轮询到对手作答」时生成，
 * 这里只负责展示，不参与任何判分。
 */

export type LiveEvent = {
  /** 去重键：me:2 / op:2 / lead:30:20 */
  key: string;
  /** good = 我方得分/领先，bad = 对手得分/落后，neutral = 中性 */
  tone: 'good' | 'bad' | 'neutral';
  text: string;
  at: number;
};

const TONE_CLS: Record<LiveEvent['tone'], string> = {
  good: 'text-emerald-600',
  bad: 'text-rose-500',
  neutral: 'text-slate-600',
};

export default function BattleFeed({ events }: { events: LiveEvent[] }) {
  const [open, setOpen] = useState(false);
  const latest = events[0];

  return (
    <div className="mx-auto max-w-3xl px-4 pt-2">
      <div className="overflow-hidden rounded-2xl bg-white/85 shadow-[0_8px_20px_rgba(76,45,140,0.12)] ring-1 ring-white/60 backdrop-blur">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
          aria-expanded={open}
        >
          <Radio className="h-3.5 w-3.5 shrink-0 text-orange-500" />
          <span className="shrink-0 text-[10.5px] font-extrabold tracking-wide text-slate-400">
            实时战报
          </span>
          {open ? (
            /* 展开时头部不再显示最新一条 —— 否则它会和列表第一项完全一样，看起来像重复 */
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-400">
              最近 {events.length} 条
            </span>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={latest?.key || 'idle'}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className={`min-w-0 flex-1 truncate text-[12px] font-bold ${
                  latest ? TONE_CLS[latest.tone] : 'text-slate-400'
                }`}
              >
                {latest?.text || '双方就位，等待第一题…'}
              </motion.span>
            </AnimatePresence>
          )}
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        <AnimatePresence initial={false}>
          {open ? (
            <motion.ul
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-t border-slate-100 px-3 py-1.5"
            >
              {events.length === 0 ? (
                <li className="py-1 text-[11.5px] text-slate-400">还没有战报</li>
              ) : (
                events.map((e) => (
                  <li key={e.key} className="flex items-center gap-2 py-[3px]">
                    <span
                      className={`h-1 w-1 shrink-0 rounded-full ${
                        e.tone === 'good'
                          ? 'bg-emerald-500'
                          : e.tone === 'bad'
                          ? 'bg-rose-500'
                          : 'bg-slate-300'
                      }`}
                    />
                    <span className={`min-w-0 flex-1 truncate text-[11.5px] ${TONE_CLS[e.tone]}`}>
                      {e.text}
                    </span>
                  </li>
                ))
              )}
            </motion.ul>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
