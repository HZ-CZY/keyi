import { getTabId } from '../../lib/tabId';
import { formatCoins } from '../../lib/coins';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ScrollText, BookOpenText, PenLine, Feather, Sparkles, Check, X,
  Loader2, Volume2, Lightbulb, Coins, Flame, Target, RotateCcw, ChevronRight,
  Library, type LucideIcon,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useFeatureFlags, isFeatureEnabled } from '../../lib/featureFlags';
import BottomNav from './components/BottomNav';
import {
  ImmersiveBackdrop, StageTopPill, StageBottomBar, StageCard, StageCardLabel,
  StageHeadline, StageBigChar, StageSentence, StageVerdict, usePinyin, extractBookSource,
  StageToolButton, StageErrorBoundary,
  OPTION_BASE, OPTION_CORRECT, OPTION_WRONG, OPTION_DIM, OPTION_SHAPE,
} from './components/ImmersiveQuiz';

/* ═══════════════════════════ 基础工具（与 TrainingPageV2 同款） ═══════════════════════════ */

const pad2 = (n: number) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** 去掉 markup / 加粗 / 高亮，得到纯文本 */
function plainText(s: string): string {
  return (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/==(.+?)==/g, '$1')
    .trim();
}

/** 随机打乱（不修改原数组） */
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/** 答案比对用的归一化：忽略大小写、空白与中英文标点 */
const PUNC_RE = /[\s，。、；：？！“”‘’（）《》「」『』【】·—…~`"'_,.!?:;()[\]{}<>/\\|-]/g;
function norm(s: string): string {
  return (s || '').replace(PUNC_RE, '').trim().toLowerCase();
}

/** 把毫秒格式化成 mm:ss */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

/* ═══════════════════════════ 中文诵读 ═══════════════════════════ */

const SPEECH_OK =
  typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';

/** 用中文语音朗读文言句（`____` 读作「什么」），返回是否成功发起 */
function speakZh(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  try {
    if (!SPEECH_OK) return false;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(t.replace(/____/g, '什么'));
    u.lang = 'zh-CN';
    u.rate = 0.82;
    const voice = synth.getVoices().find((v) => /zh[-_]/i.test(v.lang));
    if (voice) u.voice = voice;
    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}

function stopSpeak(): void {
  try {
    if (SPEECH_OK) window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

/* ═══════════════════════════ 模式定义 ═══════════════════════════ */

type ModeId = 's2m' | 'm2s' | 'cloze' | 'judge' | 'couplet';

interface ModeDef {
  id: ModeId;
  title: string;
  sub: string;
  icon: LucideIcon;
  grad: string;
  tag?: string;
}

const MODES: ModeDef[] = [
  { id: 's2m', title: '据句选义', sub: '看文言例句，选正确义项', icon: ScrollText, grad: 'from-blue-500 to-indigo-500', tag: 'HOT' },
  { id: 'm2s', title: '据义选句', sub: '给一个义项，找对应原句', icon: BookOpenText, grad: 'from-sky-500 to-cyan-600' },
  { id: 'cloze', title: '挖空默写', sub: '句子挖去重点字词，补全它', icon: PenLine, grad: 'from-amber-500 to-orange-500', tag: '新' },
  { id: 'judge', title: '义项速判', sub: '这个解释对不对，一眼定夺', icon: Feather, grad: 'from-fuchsia-500 to-pink-600' },
  { id: 'couplet', title: '名句接龙', sub: '给上句，补出下句', icon: Sparkles, grad: 'from-emerald-500 to-teal-600' },
];

/** 单人入场费（仅用于前端展示，真实扣费在服务端） */
const ENTRY_FEE = 3;

/** 服务端下发的题目结构（不含 answer） */
interface ArenaQuestion {
  index: number;
  mode: string;
  type: 'choice' | 'bool' | 'input';
  /** 题干（可能含 markup），用 dangerouslySetInnerHTML 渲染 */
  stem: string;
  /** 题干纯文本（朗读 / 兜底） */
  stemPlain: string;
  /** 考点字（s2m 大字展示） */
  keyword: string;
  /** 出处《书名》 */
  source: string;
  /** 卡牌义项（接龙/上词胶囊用） */
  meaning: string;
  options?: string[];
  /** 辅助提示（judge=义项 / cloze=义项 / couplet=出处） */
  hint?: string;
  /** 答后揭晓的补充内容（译文等） */
  reveal?: string;
}

/* ═══════════════════════════ 题目字段归一化（防渲染空白） ═══════════════════════════ */

/**
 * 把服务端下发的 arena 题目规整为 Stage 组件需要的稳定形状：
 * - 保证 stem / stemPlain / keyword / source / meaning 永远是非空字符串（缺省回退，避免渲染空白）；
 * - type 收敛到已知三态（choice / bool / input），未知值降级为 input，保证一定有交互形态；
 * - options 保证为数组或 undefined（不传空数组，避免空选项区）。
 * 这样即使将来数据契约出现字段缺失 / 类型漂移，Trainer 也不会因读取 undefined 而整页抛错空白。
 */
function normalizeArenaQuestion(q: ArenaQuestion): ArenaQuestion {
  const type: ArenaQuestion['type'] =
    q.type === 'choice' || q.type === 'bool' || q.type === 'input' ? q.type : 'input';
  return {
    index: Number.isFinite(q.index as number) ? (q.index as number) : 0,
    mode: q.mode || '',
    type,
    stem: q.stem || q.stemPlain || '',
    stemPlain: q.stemPlain || q.stem || '',
    keyword: q.keyword || '',
    source: q.source || '',
    meaning: q.meaning || '',
    options: Array.isArray(q.options) && q.options.length > 0 ? q.options : undefined,
    hint: q.hint,
    reveal: q.reveal,
  };
}

/* ═══════════════════════════ 训练器（服务端驱动作答） ═══════════════════════════ */

function Trainer({
  mode,
  questions,
  sessionId,
  onRequestAbandon,
  onFinish,
}: {
  mode: ModeDef;
  questions: ArenaQuestion[];
  sessionId: number;
  onRequestAbandon: () => void;
  onFinish: (r: { total: number; correct: number }) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);
  const [boolPick, setBoolPick] = useState<null | 'true' | 'false'>(null);
  const [typed, setTyped] = useState('');
  const [judged, setJudged] = useState<boolean | null>(null);
  /** 每题判分结果（服务端真相，用于高亮与统计） */
  const [results, setResults] = useState<(boolean | null)[]>(() => questions.map(() => null));
  /** 服务端返回的正确答案（用于揭晓 / 高亮正确项） */
  const [correctAnswers, setCorrectAnswers] = useState<(string | null)[]>(() => questions.map(() => null));
  const [prevWord, setPrevWord] = useState<{ word: string; meaning: string } | null>(null);
  const [showExplain, setShowExplain] = useState(false);
  /* 【2026-10-22】本题是否点开过解析：看过则不计分（服务端也会拒绝计分） */
  const [hintUsed, setHintUsed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const startedAt = useRef<number>(Date.now());
  const correctCount = useRef(0);
  const explainRef = useRef<HTMLDivElement>(null);

  const q = questions[idx];

  // 舞台重点字与拼音（仅用于展示）
  const stageKeyword = q ? q.keyword || '' : '';
  const stageKeywordPinyin = usePinyin(stageKeyword);

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  // 答题后把解析卡滚进视口
  useEffect(() => {
    if (judged === null) return;
    const t = window.setTimeout(() => {
      explainRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    return () => window.clearTimeout(t);
  }, [judged]);

  useEffect(() => () => stopSpeak(), []);

  /** 调服务端判分并落本地结果 */
  const submitAnswer = useCallback(
    async (choiceArg?: number, textArg?: string) => {
      if (judged !== null || !q || submitting) return;
      setSubmitting(true);
      try {
        const body: { sessionId: number; index: number; choice?: number; text?: string; hinted?: boolean } = {
          sessionId,
          index: idx,
        };
        if (choiceArg !== undefined) body.choice = choiceArg;
        if (textArg !== undefined) body.text = textArg;
        if (hintUsed) body.hinted = true;
        const resp = (await api.arena.answer(body)) as any;
        /* counted = 服务端认可计入的正确（hinted 时为 false） */
        const ok = resp?.counted !== undefined ? !!resp.counted : !!resp?.correct;
        setJudged(ok);
        if (ok) correctCount.current += 1;
        setResults((r) => {
          const n = r.slice();
          n[idx] = ok;
          return n;
        });
        setCorrectAnswers((a) => {
          const n = a.slice();
          n[idx] = resp?.correctAnswer ?? null;
          return n;
        });
      } catch {
        // 网络失败：保持未判定，允许重试
      } finally {
        setSubmitting(false);
      }
    },
    [judged, q, idx, sessionId, submitting]
  );

  /** 进入下一题 / 完成（全部答完触发结算） */
  const advance = useCallback(() => {
    if (q) setPrevWord({ word: q.keyword || '', meaning: q.meaning || '' });
    setShowExplain(false);
    setHintUsed(false);
    if (idx + 1 >= questions.length) {
      onFinish({ total: questions.length, correct: correctCount.current });
      return;
    }
    setIdx((i) => i + 1);
    setChoice(null);
    setBoolPick(null);
    setTyped('');
    setJudged(null);
  }, [idx, questions.length, q, onFinish]);

  /** 斩：跳过本题（视为答错，服务端照记） */
  const skipCurrent = useCallback(async () => {
    if (judged !== null || !q || submitting) return;
    setSubmitting(true);
    try {
      const resp = (await api.arena.answer({ sessionId, index: idx })) as any; // 无 choice/text => 跳过
      setResults((r) => {
        const n = r.slice();
        n[idx] = false;
        return n;
      });
      setCorrectAnswers((a) => {
        const n = a.slice();
        n[idx] = resp?.correctAnswer ?? null;
        return n;
      });
    } catch {
      /* 忽略，本地不计 */
    } finally {
      setSubmitting(false);
    }
    advance();
  }, [judged, q, idx, sessionId, submitting, advance]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (judged === null) return;
      if (e.key === 'Enter') advance();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [judged, advance]);

  /* ── 结算页（交由父组件 ArenaResultModal 渲染，这里只负责触发 onFinish） ── */

  if (!q) return null;

  const progress = ((idx + (judged !== null ? 1 : 0)) / questions.length) * 100;

  return (
    <motion.div
      initial={{ y: 28, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 28, opacity: 0 }}
      transition={{ duration: 0.22 }}
      className="fixed inset-0 z-50 overflow-y-auto"
    >
      <ImmersiveBackdrop>
        <StageTopPill
          word={prevWord ? prevWord.word : null}
          meaning={prevWord ? prevWord.meaning : ''}
          progress={progress}
          onBack={onRequestAbandon}
        />

        <main className="relative z-10 flex flex-col items-center px-4 pt-14 pb-28 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${q.index}-${idx}`}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.22 }}
              className="w-full flex flex-col items-center"
            >
              {/* 「据句选义」：重点字 + 发音 + 例句 + 出处；其余模式维持原有题干 */}
              {mode.id === 's2m' && stageKeyword ? (
                <>
                  <StageBigChar char={stageKeyword} py={stageKeywordPinyin} onSpeak={() => speakZh(stageKeyword)} />
                  <StageSentence
                    html={q.stem}
                    source={extractBookSource(q.stem)}
                    onSpeak={() => speakZh(q.stemPlain)}
                  />
                </>
              ) : (
                <StageHeadline html={q.stem} />
              )}

              {/* 辅助提示（义项 / 出处 / 引导语） */}
              {q.hint && (
                <div className="w-full flex justify-center mt-8">
                  <StageCard className="p-5">
                    <StageCardLabel>{q.type === 'bool' ? '义项' : '提示'}</StageCardLabel>
                    <div className="font-serif text-base font-semibold text-slate-800 leading-relaxed whitespace-pre-wrap">
                      {q.hint}
                    </div>
                  </StageCard>
                </div>
              )}

              {/* 选择题：半透明白选项 */}
              {q.type === 'choice' && (
                <div className="w-full mt-8 space-y-3">
                  {(q.options || []).map((opt, i) => {
                    const isAnswer = correctAnswers[idx] != null && opt === correctAnswers[idx];
                    const isPicked = choice === i;
                    const tone =
                      judged === null
                        ? OPTION_BASE
                        : isAnswer
                          ? `${OPTION_SHAPE} ${OPTION_CORRECT}`
                          : isPicked
                            ? `${OPTION_SHAPE} ${OPTION_WRONG}`
                            : `${OPTION_SHAPE} ${OPTION_DIM}`;
                    return (
                      <motion.button
                        key={`${q.index}-${i}`}
                        type="button"
                        disabled={judged !== null || submitting}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        onClick={() => {
                          if (judged !== null || submitting) return;
                          setChoice(i);
                          submitAnswer(i);
                        }}
                        className={`${tone} font-serif`}
                      >
                        <span className="block leading-relaxed">{opt}</span>
                        {judged !== null && isAnswer && <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />}
                        {judged !== null && isPicked && !isAnswer && <X className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />}
                      </motion.button>
                    );
                  })}
                </div>
              )}

              {/* 默写 / 接龙：输入框 */}
              {q.type === 'input' && (
                <div className="w-full flex justify-center mt-8">
                  <StageCard>
                    <StageCardLabel>{judged === null ? '写出答案' : '正确答案'}</StageCardLabel>
                    <input
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        if (judged !== null || submitting) return;
                        const v = typed.trim();
                        if (v) submitAnswer(undefined, v);
                      }}
                      disabled={judged !== null || submitting}
                      placeholder="写出答案后按回车"
                      className={`w-full h-14 rounded-2xl bg-white/70 backdrop-blur px-5 text-[17px] font-serif outline-none transition-all ${
                        judged === null
                          ? 'text-slate-800 focus:bg-white/90'
                          : judged
                            ? 'bg-emerald-400/25 text-emerald-900'
                            : 'bg-rose-400/25 text-rose-900'
                      }`}
                    />
                    {judged === null && (
                      <p className="mt-3 text-[12px] text-slate-400">写出答案后按回车提交</p>
                    )}
                    {judged !== null && (
                      <p className="mt-4 font-serif text-[17px] font-bold text-slate-800 leading-relaxed">
                        {correctAnswers[idx]}
                      </p>
                    )}
                  </StageCard>
                </div>
              )}

              {/* 答后：判定胶囊 */}
              {judged !== null && (
                <div className="w-full mt-8">
                  <StageVerdict correct={judged} />
                </div>
              )}

              {/* 解析卡：答后自动展开，也可以点「灯泡」提前查看 */}
              {(judged !== null || showExplain) && (
                <div ref={explainRef} className="w-full flex justify-center scroll-mt-24">
                  <StageCard>
                    <StageCardLabel>解析</StageCardLabel>
                    {q.reveal && (
                      <div className="font-serif text-base font-semibold text-slate-800 leading-relaxed whitespace-pre-wrap">
                        {q.reveal}
                      </div>
                    )}
                    {q.type === 'choice' && (
                      <div className={q.reveal ? 'mt-3' : ''}>
                        <StageCardLabel>正确答案</StageCardLabel>
                        <div className="font-serif text-base font-semibold text-emerald-700 leading-relaxed">
                          {correctAnswers[idx]}
                        </div>
                      </div>
                    )}
                    {q.type === 'bool' && (
                      <div className={q.reveal ? 'mt-3' : ''}>
                        <StageCardLabel>正确解释</StageCardLabel>
                        <div className="font-serif text-base font-semibold text-emerald-700 leading-relaxed">
                          {correctAnswers[idx] === 'true' ? '解释正确' : '解释错误'}
                        </div>
                      </div>
                    )}
                    {q.type === 'input' && (
                      <div className={q.reveal ? 'mt-3' : ''}>
                        <StageCardLabel>正确答案</StageCardLabel>
                        <div className="font-serif text-base font-semibold text-emerald-700 leading-relaxed">
                          {correctAnswers[idx]}
                        </div>
                      </div>
                    )}
                    {judged !== null && (
                      <div className="mt-4 pt-3 border-t border-slate-200/60 text-xs text-slate-400 flex items-center gap-1.5">
                        <Coins className="w-3.5 h-3.5 text-amber-500" />
                        {judged ? '+1 铜板' : '+0 铜板'}
                      </div>
                    )}
                  </StageCard>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        <StageBottomBar
          left={
            <StageToolButton label="斩：跳过本题" onClick={skipCurrent} className="text-slate-700" disabled={judged !== null}>
              <span className="text-xl font-bold font-serif leading-none">斩</span>
            </StageToolButton>
          }
          center={
            <StageToolButton
              label={hintUsed ? '已看解析（本题不计分）' : '解析'}
              onClick={() => { setShowExplain(true); setHintUsed(true); }}
              className={hintUsed ? 'text-amber-600' : 'text-slate-600'}
            >
              <Lightbulb className="w-5 h-5" />
            </StageToolButton>
          }
          right={
            SPEECH_OK ? (
              <StageToolButton label="朗读" onClick={() => speakZh(q.stemPlain)} className="text-slate-600">
                <Volume2 className="w-5 h-5" />
              </StageToolButton>
            ) : null
          }
        >
          {/* 判断题：两档按钮（解释正确 / 解释错误） */}
          {q.type === 'bool' && (
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-5 grid grid-cols-2 gap-3"
            >
              {(['true', 'false'] as const).map((v) => {
                const isAnswer = correctAnswers[idx] === v;
                const isPicked = boolPick === v;
                let cls = 'py-3 rounded-2xl font-bold shadow-md transition-all flex items-center justify-center gap-2 ';
                if (judged === null) {
                  cls += v === 'true'
                    ? 'bg-emerald-400/80 hover:bg-emerald-400/95 text-white'
                    : 'bg-rose-400/70 hover:bg-rose-400/85 text-white';
                } else if (isAnswer) {
                  cls += 'bg-emerald-400/25 border border-emerald-500/40 text-emerald-900';
                } else if (isPicked) {
                  cls += 'bg-rose-400/25 border border-rose-500/40 text-rose-900';
                } else {
                  cls += 'bg-white/30 text-slate-500 opacity-60';
                }
                return (
                  <button
                    key={v}
                    type="button"
                    disabled={judged !== null || submitting}
                    onClick={() => {
                      if (judged !== null || submitting) return;
                      setBoolPick(v);
                      submitAnswer(v === 'true' ? 1 : 0);
                    }}
                    className={cls}
                  >
                    {v === 'true' ? (
                      <><Check className="w-4 h-4" /> 解释正确</>
                    ) : (
                      <><X className="w-4 h-4" /> 解释错误</>
                    )}
                  </button>
                );
              })}
            </motion.div>
          )}

          {/* 默写题：提交 */}
          {q.type === 'input' && judged === null && (
            <motion.button
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              type="button"
              onClick={() => {
                const v = typed.trim();
                if (v) submitAnswer(undefined, v);
              }}
              disabled={!typed.trim() || submitting}
              className="w-full mb-5 py-3 text-[15px] rounded-2xl bg-white/70 hover:bg-white/90 disabled:opacity-40 backdrop-blur text-slate-800 font-medium shadow-md transition-all"
            >
              提交
            </motion.button>
          )}

          {/* 答后：下一题 / 看结果 */}
          {judged !== null && (
            <motion.button
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              type="button"
              onClick={advance}
              className="w-full mb-5 py-3 text-[15px] rounded-2xl bg-indigo-500/90 hover:bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-500/25 transition-all flex items-center justify-center gap-1.5"
            >
              {idx + 1 >= questions.length ? '看结果' : '下一题'}
              <ChevronRight className="w-4 h-4" />
            </motion.button>
          )}

          {judged === null && (
            <p className="mb-5 text-center text-[11px] text-slate-500/70">答完后按回车可直接进入下一题</p>
          )}
        </StageBottomBar>

        {/* 放弃本局（弹窗确认在父组件） */}
        <button
          type="button"
          onClick={onRequestAbandon}
          className="fixed top-4 right-4 z-50 px-3 h-9 rounded-full bg-white/85 shadow-soft text-[13px] font-medium text-rose-500 hover:bg-white transition-colors"
        >
          放弃本局
        </button>
      </ImmersiveBackdrop>
    </motion.div>
  );
}

/* ═══════════════════════════ 统一结算页 ═══════════════════════════ */

function TrophyGlyph() {
  return (
    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

function ArenaResultModal({
  data,
  onAgain,
  onPk,
  onHome,
  pkEnabled = true,
}: {
  data: {
    kind: 'finish' | 'abandon';
    reward: number;
    correctCount: number;
    total?: number;
    refund?: number;
    capped?: boolean;
    dailyCap?: number;
  };
  onAgain: () => void;
  onPk: () => void;
  onHome: () => void;
  pkEnabled?: boolean;
}) {
  const total = data.total ?? data.correctCount;
  const acc = total > 0 ? Math.round((data.correctCount / total) * 100) : 0;
  const refund = data.refund ?? 0;
  // 一题未答的放弃会全额退入场费，净收支要把退费算进来，否则会误显 -3
  const net = data.reward + refund - ENTRY_FEE;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[60] bg-white overflow-y-auto"
    >
      <div className="mx-auto max-w-[592px] min-h-full flex flex-col items-center justify-center px-6 py-10">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 18 }}
          className="w-24 h-24 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-orange-500/25"
        >
          <TrophyGlyph />
        </motion.div>
        <h2 className="mt-5 text-2xl font-bold text-slate-900">
          {data.kind === 'abandon' ? '已放弃本局' : acc >= 80 ? '这组稳了！' : acc >= 60 ? '还行，再抠细节' : '回去再读两遍'}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {data.kind === 'abandon'
            ? refund > 0
              ? '本局未扣币 · 入场费已全额退还'
              : '已答对的照发铜板 · 入场费不退'
            : '单人练习 · 完成'}
        </p>

        <div className="mt-7 grid grid-cols-3 gap-3 w-full">
          <div className="rounded-2xl bg-white border border-black/5 py-3 text-center">
            <p className="text-[19px] font-bold tabular-nums text-blue-600">
              {data.correctCount}/{total}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">答对题数</p>
          </div>
          <div className="rounded-2xl bg-white border border-black/5 py-3 text-center">
            <p className="text-[19px] font-bold tabular-nums text-slate-800">{acc}%</p>
            <p className="mt-0.5 text-[11px] text-slate-400">正确率</p>
          </div>
          <div className="rounded-2xl bg-white border border-black/5 py-3 text-center">
            <p className={`text-[19px] font-bold tabular-nums ${net >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
              {net >= 0 ? '+' : ''}
              {net}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">铜板</p>
          </div>
        </div>

        {data.kind === 'abandon' && refund > 0 && (
          <div className="mt-4 w-full flex items-center justify-center gap-2 rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-[13px] text-emerald-700">
            <Coins className="w-4 h-4 text-emerald-500 shrink-0" />
            本局未扣币，已退费 {refund} 铜板，余额不受影响
          </div>
        )}

        {data.capped && (
          <div className="mt-4 w-full flex items-start gap-2 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-[13px] leading-relaxed text-amber-700">
            <Coins className="w-4 h-4 text-amber-500 shrink-0 mt-[2px]" />
            <span>
              今日训练场铜板已达上限 <b>{data.dailyCap ?? 300}</b>，本局超出部分不再发放，明天 0 点重置。
            </span>
          </div>
        )}

        <div className="mt-8 w-full space-y-3">
          <button
            type="button"
            onClick={onAgain}
            className="w-full h-12 rounded-2xl bg-slate-900 text-white font-semibold text-[15px] active:scale-[0.98] transition-transform"
          >
            再练一局
          </button>
          {pkEnabled ? (
            <button
              type="button"
              onClick={onPk}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-rose-500 to-orange-500 text-white font-semibold text-[15px] active:scale-[0.98] transition-transform"
            >
              匹配对战
            </button>
          ) : (
            <div className="w-full rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-center text-[13px] text-amber-700">
              真人 PK 正在升级优化中，敬请期待~
            </div>
          )}
          <button
            type="button"
            onClick={onHome}
            className="w-full h-12 rounded-2xl border border-black/10 text-slate-700 font-semibold text-[15px] active:scale-[0.98] transition-transform"
          >
            回首页
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════ 页面：选择 → 对局 → 结算 ═══════════════════════════ */

/**
 * 切后台宽限期：只是短暂切后台（iPad 上被通知打断、接个电话、切去查个东西）
 * 不该把本局终结掉——回来时局还在，体验才连贯。所以 visibilitychange→hidden
 * 不立即结算，而是等 BACKGROUND_GRACE_MS；45 秒内回前台就取消定时器、本局继续。
 * 为什么是 45 秒：
 * - 下限：常见的「看一眼别处再回来」多在几十秒内完成，45s 足够覆盖，不会误杀；
 * - 上限：开局未结算时，用户的本金与已答收益都悬着，拖太久（几分钟）反而更难受，
 *   也不利于账目及时落定；45s 是「宽容但不久挂」的折中。
 * 注意：真离开（unmount / pagehide）不走宽限期，立即结算，保证不漏。
 */
const BACKGROUND_GRACE_MS = 45_000;

export default function ArenaPracticePage() {
  const navigate = useNavigate();
  // 真人 PK 开关（与竞技场入口一致）：关闭时结果页不再显示「匹配对战」入口
  useFeatureFlags();
  const pkEnabled = isFeatureEnabled('battle');
  const [decks, setDecks] = useState<{ id: number; name: string }[]>([]);
  const [deckId, setDeckId] = useState<number | ''>('');
  const [modeKey, setModeKey] = useState<ModeId | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  // [2026-10-25] 今日训练场剩余额度（用于开局提示）
  const [arenaRemaining, setArenaRemaining] = useState<number | null>(null);

  const [phase, setPhase] = useState<'select' | 'playing' | 'result'>('select');
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<ArenaQuestion[]>([]);
  const [resultData, setResultData] = useState<{
    kind: 'finish' | 'abandon';
    reward: number;
    correctCount: number;
    total?: number;
    refund?: number;
    capped?: boolean;
    dailyCap?: number;
  } | null>(null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [starting, setStarting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200);
  }, []);

  /**
   * 「开过的局一定会被结算」——离开页面兜底。
   * openSessionRef：当前尚未结算的 sessionId（用 ref 而非 state，事件回调里不会拿到旧闭包值）；
   * 开局时写入，finish/abandon 成功后清空，所以已终结的局不会再被兜底发送。
   */
  const openSessionRef = useRef<number | null>(null);
  /** 已发过兜底 abandon 的 sessionId，保证每局最多发一次（第二道闸） */
  const bailoutSentRef = useRef<Set<number>>(new Set());

  /**
   * 兜底结算：unmount / 切后台 / 关标签页时补发一次 abandon。
   * 用 fetch + keepalive（页面正在关闭也能把请求发出去；sendBeacon 带不了
   * Authorization 头，故不用它）。失败静默——服务端 sweepOpenSessions 还会兜底，
   * 此时用户已经离开页面，弹错误只会打扰人。
   */
  const bailoutSettle = useCallback(() => {
    const sid = openSessionRef.current;
    if (sid == null) return;
    if (bailoutSentRef.current.has(sid)) return;
    bailoutSentRef.current.add(sid);
    openSessionRef.current = null; // 先清再发，避免同一帧内多个事件重复触发
    try {
      const token = localStorage.getItem('token');
      void fetch('/api/arena/abandon', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'X-KEYI-TAB': getTabId(),
        },
        body: JSON.stringify({ sessionId: sid }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      /* 静默：服务端清扫兜底 */
    }
  }, []);

  useEffect(() => {
    /** 切后台宽限期定时器：hidden 时启动，回前台 / 真离开时清除 */
    let graceTimer: number | null = null;
    const clearGraceTimer = () => {
      if (graceTimer !== null) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // 短暂切后台：不立刻结算，先给 BACKGROUND_GRACE_MS 宽限期，超时才兜底
        clearGraceTimer(); // 防止 hidden 连续触发时叠加多个定时器
        graceTimer = window.setTimeout(() => {
          graceTimer = null;
          bailoutSettle();
        }, BACKGROUND_GRACE_MS);
      } else {
        // 宽限期内回到前台：取消结算，本局继续
        clearGraceTimer();
      }
    };
    // 页面真的被卸载 / 冻结（关标签页、进 bfcache）：立即结算，不走宽限期
    const onPageHide = () => {
      clearGraceTimer();
      bailoutSettle();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      // 组件卸载（路由跳走 / 返回上一页）= 真离开：清掉宽限定时器并立即结算。
      // 先 clearTimeout 再结算，避免定时器回调与这里重复触发；
      // 即便极端情况下两边都跑了，bailoutSentRef 也保证每局只发一次 abandon。
      clearGraceTimer();
      bailoutSettle();
    };
  }, [bailoutSettle]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [d, c] = await Promise.all([
          api.decks.list().catch(() => [] as any[]),
          api.coins.get().catch(() => null),
        ]);
        if (!alive) return;
        setDecks(Array.isArray(d) ? (d as { id: number; name: string }[]) : []);
        setBalance(c ? (c as { balance: number }).balance : null);
        setArenaRemaining(c ? Number((c as any).arenaRemaining ?? 0) : null);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const startMode = useCallback(async () => {
    if (starting) return;
    if (!modeKey) {
      showToast('请先选择一种训练模式');
      return;
    }
    if (balance != null && balance < ENTRY_FEE) {
      showToast('铜板不足，先去做任务赚铜板');
      return;
    }
    setStarting(true);
    try {
      const body: { mode: string; deckId?: number } = { mode: modeKey };
      if (deckId !== '') body.deckId = deckId;
      const resp = (await api.arena.start(body)) as any;
      openSessionRef.current = Number(resp.sessionId); // 登记为「未结算」，离开页面时兜底
      setSessionId(resp.sessionId);
      setQuestions((resp.questions as ArenaQuestion[]).map(normalizeArenaQuestion));
      setBalance(resp.balance);
      setResultData(null);
      setPhase('playing');
    } catch (e: any) {
      showToast(e?.message || '开局失败，请稍后重试');
    } finally {
      setStarting(false);
    }
  }, [starting, modeKey, balance, deckId, showToast]);

  const handleFinish = useCallback(
    async (r: { total: number; correct: number }) => {
      if (sessionId == null) return;
      try {
        const resp = (await api.arena.finish({ sessionId })) as any;
        openSessionRef.current = null; // 已主动结算，不再兜底
        setResultData({
          kind: 'finish',
          reward: resp.reward ?? 0,
          correctCount: resp.correctCount ?? r.correct,
          total: resp.total ?? r.total,
          capped: !!resp.capped,
          dailyCap: resp.dailyCap,
        });
        setPhase('result');
        // 结算后刷新余额与今日剩余额度（入场费已扣 + 奖励已发）
        api.coins.get()
          .then((c: any) => {
            setBalance(c?.balance ?? null);
            setArenaRemaining(c ? Number(c.arenaRemaining ?? 0) : null);
          })
          .catch(() => undefined);
      } catch (e: any) {
        showToast(e?.message || '结算失败，请点「看结果」重试');
      }
    },
    [sessionId, showToast]
  );

  const handleAbandon = useCallback(async () => {
    setConfirmAbandon(false);
    if (sessionId == null) return;
    try {
      const resp = (await api.arena.abandon({ sessionId })) as any;
      openSessionRef.current = null; // 已主动放弃，不再兜底
      setResultData({
        kind: 'abandon',
        reward: resp.reward ?? 0,
        correctCount: resp.correctCount ?? 0,
        refund: resp.refund ?? 0,
        capped: !!resp.capped,
        dailyCap: resp.dailyCap,
      });
      setPhase('result');
    } catch (e: any) {
      showToast(e?.message || '放弃失败');
    }
  }, [sessionId, showToast]);

  /* 【2026-11-06 修反馈 112 / 148】
     ① keepMode=true 时不再清掉已选模式 —— 「再来一局」直接开打，不用重选。
     ② 顺带把 arenaRemaining 一起重拉：原来只更新余额，今日额度还是进页面时那份，
        打完一局得切出去再进来才刷新（反馈 148 说的就是这个）。 */
  const resetToSelect = useCallback((keepMode = false) => {
    setPhase('select');
    setSessionId(null);
    setQuestions([]);
    setResultData(null);
    if (!keepMode) setModeKey(null);
    setStarting(false);
    api.coins.get()
      .then((c: any) => {
        setBalance(c?.balance ?? null);
        setArenaRemaining(c ? Number(c.arenaRemaining ?? 0) : null);
      })
      .catch(() => undefined);
  }, []);

  const activeMode = useMemo(() => MODES.find((m) => m.id === modeKey) || null, [modeKey]);

  /* ── 选择模式界面 ── */
  if (phase === 'select') {
    return (
      <div className="keyi-arena-practice min-h-screen bg-[#F6F8FB] pb-24">
        <div className="mx-auto max-w-[592px] px-4">
          <header className="flex items-center justify-between pt-5 pb-3">
            <div>
              <button
                type="button"
                onClick={() => navigate('/arena')}
                className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600"
              >
                <ChevronRight className="w-4 h-4 rotate-180" /> 返回竞技场
              </button>
              <h1 className="text-[26px] font-bold text-slate-900 tracking-tight mt-1">单人练习</h1>
              <p className="mt-0.5 text-[13px] text-slate-400">选模式开练，每局 -{ENTRY_FEE} 铜板，答对 +1/题</p>
              <p className="mt-1 text-[11.5px] text-slate-400">
                今日训练场还可净赚 <b className="text-amber-600 tabular-nums">{arenaRemaining ?? '—'}</b> 铜板（每日净收益上限 300，入场费不占额度）
              </p>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-white border border-black/5 px-3 py-1.5">
              <span className="w-3.5 h-3.5 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 ring-2 ring-orange-300/60" />
              <span className="text-[13px] font-bold text-slate-800 tabular-nums">{formatCoins(balance)}</span>
            </div>
          </header>

          {/* 模式网格 */}
          <section className="mt-2">
            <h2 className="text-[15px] font-bold text-slate-900 mb-2.5">训练模式</h2>
            <div className="grid grid-cols-2 gap-3">
              {MODES.map((m) => {
                const selected = modeKey === m.id;
                const ModeIcon = m.icon;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModeKey(m.id)}
                    className={`relative overflow-hidden rounded-3xl bg-white border px-4 py-4 text-left transition-transform ${
                      selected ? 'border-primary-500 ring-2 ring-primary-300' : 'border-black/5'
                    } ${starting ? 'opacity-60' : 'active:scale-[0.98]'}`}
                  >
                    {m.tag && (
                      <span className="absolute top-3 right-3 rounded-full bg-rose-500/10 text-rose-500 text-[10px] font-bold px-1.5 py-0.5">
                        {m.tag}
                      </span>
                    )}
                    <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${m.grad} flex items-center justify-center shadow-sm`}>
                      <ModeIcon className="w-5 h-5 text-white" />
                    </div>
                    <p className="mt-3 text-[15px] font-bold text-slate-900">{m.title}</p>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-slate-400 line-clamp-2">{m.sub}</p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 卡组选择 */}
          <label className="block mt-5 mb-1 text-sm text-slate-500">选择卡组（默认全部卡组）</label>
          <select
            value={deckId}
            onChange={(e) => setDeckId(e.target.value === '' ? '' : Number(e.target.value))}
            className="w-full h-11 rounded-2xl bg-white border border-slate-200 px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-300"
          >
            {decks.length === 0 ? (
              <option value="" disabled>
                暂无可用卡组（先用默认全部）
              </option>
            ) : (
              <>
                <option value="">默认（全部卡组）</option>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </>
            )}
          </select>

          <button
            type="button"
            onClick={startMode}
            disabled={starting || !modeKey}
            className="mt-5 w-full h-12 rounded-2xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-semibold shadow-glow-primary transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
          >
            {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
            {starting ? '正在开局…' : '开始练习'}
          </button>

          <p className="mt-4 text-center text-[11px] text-slate-300 flex items-center justify-center gap-1">
            <RotateCcw className="w-3 h-3" />
            中途可「放弃本局」，已答对的照发铜板
          </p>
        </div>

        <BottomNav />

        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[70] rounded-full bg-slate-900/90 text-white text-[13px] px-4 py-2.5 shadow-lg"
          >
            {toast}
          </motion.div>
        )}
      </div>
    );
  }

  /* ── 对局 / 结算 ── */
  return (
    <>
      {phase === 'playing' && sessionId != null && questions.length > 0 && activeMode && (
        <StageErrorBoundary onReset={() => setConfirmAbandon(true)}>
          <Trainer
            mode={activeMode}
            questions={questions}
            sessionId={sessionId}
            onRequestAbandon={() => setConfirmAbandon(true)}
            onFinish={handleFinish}
          />
        </StageErrorBoundary>
      )}

      <AnimatePresence>
        {phase === 'result' && resultData && (
          <ArenaResultModal
            data={resultData}
            onAgain={() => resetToSelect(true)}
            onPk={() => navigate('/arena/pk')}
            pkEnabled={pkEnabled}
            onHome={() => navigate('/arena')}
          />
        )}
      </AnimatePresence>

      {/* 放弃确认弹窗 */}
      {confirmAbandon && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center px-8">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl"
          >
            <h3 className="text-lg font-bold text-slate-900">放弃本局？</h3>
            <p className="mt-2 text-sm text-slate-500 leading-relaxed">
              已答对的题会照发铜板，但本局入场费 {ENTRY_FEE} 不退，未答部分不计分。
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmAbandon(false)}
                className="flex-1 h-11 rounded-2xl bg-slate-100 text-slate-600 font-medium active:scale-95 transition-transform"
              >
                继续答题
              </button>
              <button
                type="button"
                onClick={handleAbandon}
                className="flex-1 h-11 rounded-2xl bg-rose-500 text-white font-medium active:scale-95 transition-transform"
              >
                确认放弃
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
}
