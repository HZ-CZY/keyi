import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, BookOpen, PenLine, Check, X, RotateCcw, ArrowRight, Lightbulb, Star, Flame, Eye,
} from 'lucide-react';
import { CRASH_PIECES, ALL_QUIZ, type FlatQuiz } from '../../data/crashCourse';
import {
  CRASH_CHECKLIST, TRAP_WORDS, CHECKLIST_NOTES, STAR_LEGEND, EXTRA_HINTS,
} from '../../data/crashChecklist';

/**
 * 考前突击 · 选必一（2026-10-11 新增）
 * ---------------------------------------------------------------
 * 入口：首页右侧竖栏「考前突击」（位于「训练场」与「会员」之间）→ /crash
 *
 * 三种模式：
 *   速览  —— 按篇目读原文 + 重点字词 + 常考默写句（可标记「已背」，存 localStorage）
 *   清单  —— 名句默写高频清单（7 篇必背，按出题概率排序，带考点与易错字）
 *   自测  —— **提示 → 回想整句**：题面只给「提示」（与清单里同款考点提示），
 *           学生自己回想出**完整那句**，再点开核对并自评，全程不需要打字
 *
 * 为什么这样设计：
 *   1) 回忆本身才是记忆的关键动作，打字会把注意力从「回想」转移到「敲字」上；
 *   2) 题面给考点提示（而不是直接给上句补下句），逼着回想**完整句子**，
 *      既复习了「考什么」，也练了「怎么写」，更接近考场的理解性默写；
 *   3) 自评用 Anki 那套「记住了 / 没记住」，节奏快、能连刷。
 */

const DONE_KEY = 'keyi_crash_done_v1';


function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function loadDone(): Set<string> {
  try {
    const raw = localStorage.getItem(DONE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveDone(set: Set<string>): void {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...set]));
  } catch {
    // 隐私模式等场景忽略
  }
}

export default function CrashCoursePageV2() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'read' | 'list' | 'quiz'>('read');
  const [readId, setReadId] = useState(CRASH_PIECES[0].id);
  const [done, setDone] = useState<Set<string>>(() => loadDone());

  const piece = CRASH_PIECES.find((p) => p.id === readId) ?? CRASH_PIECES[0];

  // 用 useRef 持有最新 done，避免闭包过期
  const doneRef = useRef(done);
  doneRef.current = done;

  const toggleDone = (key: string) => {
    const next = new Set(doneRef.current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setDone(next);
    saveDone(next);
  };

  const totalLines = useMemo(
    () => CRASH_PIECES.reduce((s, p) => s + p.quiz.length, 0),
    []
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#EAF4FF] via-[#F6FAFF] to-[#E9F1FB] pb-20">
      {/* 顶部栏 */}
      <header className="sticky top-0 z-20 border-b border-white/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-3">
          <button
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 active:scale-95"
            aria-label="返回"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <div className="min-w-0 flex-1">
            {/* 窄屏下三个标签会占掉不少宽度，标题的「· 选必一」在小屏隐藏，避免被截成「考前突击·…」 */}
            <h1 className="truncate text-[17px] font-bold text-slate-800">
              考前突击<span className="hidden sm:inline"> · 选必一</span>
            </h1>
            <p className="truncate text-[11px] text-slate-400">
              共 10 篇 · 已背 {done.size}/{totalLines}
            </p>
          </div>
          {/* 模式切换 */}
          <div className="flex shrink-0 rounded-full bg-slate-100/90 p-0.5">
            <ModeBtn active={mode === 'read'} onClick={() => setMode('read')} icon={<BookOpen className="h-3.5 w-3.5" />} label="速览" />
            <ModeBtn active={mode === 'list'} onClick={() => setMode('list')} icon={<Star className="h-3.5 w-3.5" />} label="清单" />
            <ModeBtn active={mode === 'quiz'} onClick={() => setMode('quiz')} icon={<PenLine className="h-3.5 w-3.5" />} label="自测" />
          </div>
        </div>
      </header>

      {mode === 'read' ? (
        <ReadPanel
          readId={readId}
          onPick={setReadId}
          done={done}
          onToggleDone={toggleDone}
          piece={piece}
        />
      ) : mode === 'list' ? (
        <ListPanel />
      ) : (
        <QuizPanel onBack={() => setMode('read')} />
      )}
    </div>
  );
}

function ModeBtn({
  active, onClick, icon, label,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-medium transition-all ${
        active ? 'bg-white text-[#3B6BE8] shadow-sm' : 'text-slate-500'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/* ============================== 速览 ============================== */

function ReadPanel({
  readId, onPick, done, onToggleDone, piece,
}: {
  readId: string;
  onPick: (id: string) => void;
  done: Set<string>;
  onToggleDone: (key: string) => void;
  piece: (typeof CRASH_PIECES)[number];
}) {
  return (
    <main className="mx-auto max-w-2xl px-3">
      {/* 篇目切换：横向滚动 chips */}
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {CRASH_PIECES.map((p) => {
          const active = p.id === readId;
          const fullyDone = p.quiz.length > 0 && p.quiz.every((_, i) => done.has(`${p.id}#${i}`));
          return (
            <button
              key={p.id}
              onClick={() => onPick(p.id)}
              className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-all ${
                active
                  ? 'bg-[#3B6BE8] text-white shadow-[0_4px_14px_rgba(59,107,232,0.35)]'
                  : 'bg-white/85 text-slate-600 shadow-[0_1px_4px_rgba(30,60,110,0.06)]'
              }`}
            >
              {fullyDone ? '✓ ' : ''}
              {p.title}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.section
          key={piece.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
          className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(59,107,232,0.10)]"
        >
          <div className="mb-1 flex items-center gap-2">
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${
                piece.genre === '文言文'
                  ? 'bg-indigo-50 text-indigo-600'
                  : 'bg-rose-50 text-rose-500'
              }`}
            >
              {piece.genre}
            </span>
            <h2 className="text-[19px] font-bold text-slate-800">{piece.title}</h2>
          </div>
          <p className="mb-4 text-[12.5px] text-slate-400">{piece.author}</p>

          {/* 正文 */}
          <div className="space-y-3.5">
            {piece.paragraphs.map((para, i) => (
              <p key={i} className="whitespace-pre-line text-[15.5px] leading-[1.95] tracking-wide text-slate-800">
                {para}
              </p>
            ))}
          </div>

          {/* 重点字词 */}
          <div className="mt-6 rounded-2xl bg-slate-50/80 p-4">
            <p className="mb-2.5 text-[12.5px] font-semibold text-slate-500">重点字词</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              {piece.notes.map((n) => (
                <div key={n.word} className="flex gap-1.5 text-[12px] leading-relaxed">
                  <span className="shrink-0 font-semibold text-[#3B6BE8]">{n.word}</span>
                  <span className="text-slate-500">{n.meaning}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 常考默写句 */}
          <div className="mt-5">
            <p className="mb-2.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-500">
              <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
              常考默写句（点圆圈标记「已背」）
            </p>
            <ul className="space-y-1.5">
              {piece.quiz.map((q, i) => {
                const key = `${piece.id}#${i}`;
                const checked = done.has(key);
                return (
                  <li key={key}>
                    <button
                      onClick={() => onToggleDone(key)}
                      className={`flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-colors ${
                        checked ? 'bg-emerald-50' : 'bg-amber-50/60 hover:bg-amber-50'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                          checked
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : 'border-slate-300 bg-white'
                        }`}
                      >
                        {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                      </span>
                      <span
                        className={`text-[14px] leading-relaxed ${
                          checked ? 'text-emerald-700/70 line-through' : 'text-slate-700'
                        }`}
                      >
                        {q.a}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </motion.section>
      </AnimatePresence>
    </main>
  );
}

/* ============================== 清单 ============================== */

/** 出题概率星级：亮的 5 颗为满分，未点亮的是灰星 */
function Stars({ n }: { n: number }) {
  return (
    <span className="shrink-0 text-[11px] leading-none tracking-[1px]">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= n ? 'text-amber-400' : 'text-slate-200'}>
          ★
        </span>
      ))}
    </span>
  );
}

/**
 * 「清单」模式 —— 名句默写高频清单
 * 数据来源：crashChecklist.ts（7 篇必背，按出题概率排序，每句带考点与易错字）。
 * 与速览的区别：速览给全文（背），清单给考点（抓分），两者互补。
 */
function ListPanel() {
  return (
    <main className="mx-auto max-w-2xl px-3 py-4">
      {/* 概览 */}
      <div className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(59,107,232,0.10)]">
        <h2 className="text-[17px] font-bold text-slate-800">名句默写高频清单</h2>
        <p className="mt-1 text-[12.5px] text-slate-400">
          按出题概率排序 · 共 7 篇必背 · 附易错字速查
        </p>
        <div className="mt-3.5 space-y-1.5">
          {STAR_LEGEND.map((s) => (
            <div key={s.star} className="flex items-center gap-2">
              <Stars n={s.star} />
              <span className="shrink-0 text-[12.5px] font-semibold text-slate-600">{s.label}</span>
              <span className="truncate text-[12.5px] text-slate-400">{s.pieces}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 各篇 */}
      <div className="mt-4 space-y-3.5">
        {CRASH_CHECKLIST.map((p, pi) => (
          <section
            key={p.id}
            className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(59,107,232,0.10)]"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#3B6BE8] text-[11px] font-bold text-white">
                {pi + 1}
              </span>
              <h3 className="min-w-0 truncate text-[16.5px] font-bold text-slate-800">{p.title}</h3>
              <Stars n={p.star} />
            </div>

            <p className="mt-2.5 rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] leading-relaxed text-slate-500">
              {p.tip}
            </p>

            <ul className="mt-3 space-y-2.5">
              {p.lines.map((l, li) => (
                <li key={p.id + '#' + li} className="border-l-2 border-slate-100 pl-3">
                  <p className="text-[14.5px] leading-relaxed tracking-wide text-slate-800">{l.line}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                    <span className="text-slate-400">{l.point}</span>
                    {l.trap ? (
                      <span className="rounded-md bg-rose-50 px-1.5 py-0.5 font-medium text-rose-500">
                        易错 · {l.trap}
                      </span>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/* 易错字速查 */}
      <section className="mt-4 rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(59,107,232,0.10)]">
        <p className="flex items-center gap-1.5 text-[13px] font-bold text-slate-800">
          <Flame className="h-4 w-4 text-rose-500" />
          易错字速查 · 考前 5 分钟扫一遍
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {TRAP_WORDS.map((w) => (
            <span
              key={w}
              className="rounded-lg bg-rose-50 px-2 py-1 text-[12.5px] font-medium text-rose-500"
            >
              {w}
            </span>
          ))}
        </div>
      </section>

      {/* 考前提醒 */}
      <section className="mt-4 space-y-2.5">
        {CHECKLIST_NOTES.map((n) => (
          <div key={n.title} className="rounded-2xl bg-amber-50/70 px-4 py-3">
            <p className="text-[12.5px] font-semibold text-amber-600">{n.title}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">{n.text}</p>
          </div>
        ))}
      </section>

      <p className="mt-5 text-center text-[11.5px] text-slate-400">
        内容以教材为准，如与课本用字不一致请以课本为准
      </p>
    </main>
  );
}

/* ============================== 自测 ============================== */

/** 归一化：去掉标点、空白，用于把题库整句与清单句子对上 */
const PUNCT = /[\s，。！？；：、“”‘’（）《》〈〉…—·,.!?;:'"()<>［］【】「」]/g;
function normalize(s: string): string {
  return (s || '').replace(PUNCT, '');
}

/**
 * 取一句的「提示」（和清单里同款的考点提示）：
 *   ① 先查补充表 EXTRA_HINTS（自读课文 + 清单未收录的必背句）
 *   ② 再拿整句去同篇的清单里比对，命中即用清单的考点
 *   ③ 都没命中 → 通用兜底
 */
function hintFor(pieceId: string, q: string, full: string): string {
  const extra = EXTRA_HINTS[q];
  if (extra) return extra;
  const n = normalize(full);
  const cp = CRASH_CHECKLIST.find((p) => p.id === pieceId);
  if (cp) {
    let best = '';
    let bestLen = 0;
    for (const l of cp.lines) {
      const ln = normalize(l.line);
      // 阈值取 6：清单里最短的句子是「朝闻道，夕死可矣。」（7 字），
      // 再短就容易被别的句子误命中。
      if (ln.length >= 6 && (n.includes(ln) || ln.includes(n)) && ln.length > bestLen) {
        best = l.point;
        bestLen = ln.length;
      }
    }
    if (best) return best;
  }
  return '回想这一句的完整内容。';
}

/**
 * 「自测」模式 —— 给提示，回想整句
 * 题面只给考点提示，学生自己想出完整那句，再点开核对并自评。
 * 键盘：空格 / 回车看整句，然后 1 = 没记住、2 = 记住了。
 */
function QuizPanel({ onBack }: { onBack: () => void }) {
  const [scope, setScope] = useState<'all' | string>('all');
  const [phase, setPhase] = useState<'pick' | 'run' | 'end'>('pick');
  const [list, setList] = useState<FlatQuiz[]>([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [known, setKnown] = useState(0);
  const [missed, setMissed] = useState<FlatQuiz[]>([]);

  const start = (source: FlatQuiz[]) => {
    if (source.length === 0) return;
    setList(shuffle(source));
    setIdx(0);
    setRevealed(false);
    setKnown(0);
    setMissed([]);
    setPhase('run');
  };

  const current = list[idx];
  /** 完整那句 = 题库里的「上句 + 下句」拼回原文 */
  const full = current ? current.q + current.a : '';
  const hint = current ? hintFor(current.pieceId, current.q, full) : '';

  /** 自评后推进到下一题 */
  const mark = (ok: boolean) => {
    if (!current) return;
    if (ok) setKnown((k) => k + 1);
    else setMissed((m) => [...m, current]);
    if (idx + 1 >= list.length) setPhase('end');
    else {
      setIdx(idx + 1);
      setRevealed(false);
    }
  };

  // 键盘快捷键（桌面端）
  useEffect(() => {
    if (phase !== 'run') return;
    const onKey = (e: KeyboardEvent) => {
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed) {
        if (e.key === '1') {
          e.preventDefault();
          mark(false);
        } else if (e.key === '2') {
          e.preventDefault();
          mark(true);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, revealed, idx, list]);

  /* ---------- 选择范围 ---------- */
  if (phase === 'pick') {
    return (
      <main className="mx-auto max-w-2xl px-3 py-4">
        <div className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(59,107,232,0.10)]">
          <h2 className="text-[16px] font-bold text-slate-800">回想自测</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-slate-400">
            每题只给一句提示，自己把<strong className="font-semibold text-slate-500">整句</strong>想出来，
            再点开核对 —— 不用打字。
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => setScope('all')}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-all ${
                scope === 'all'
                  ? 'bg-[#3B6BE8] text-white shadow-[0_4px_14px_rgba(59,107,232,0.35)]'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              全部篇目（{ALL_QUIZ.length} 句）
            </button>
            {CRASH_PIECES.map((p) => (
              <button
                key={p.id}
                onClick={() => setScope(p.id)}
                className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-all ${
                  scope === p.id
                    ? 'bg-[#3B6BE8] text-white shadow-[0_4px_14px_rgba(59,107,232,0.35)]'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {p.title}（{p.quiz.length}）
              </button>
            ))}
          </div>

          <button
            onClick={() =>
              start(scope === 'all' ? ALL_QUIZ : ALL_QUIZ.filter((q) => q.pieceId === scope))
            }
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#3B6BE8] py-3 text-[15px] font-semibold text-white shadow-[0_8px_22px_rgba(59,107,232,0.35)] transition-transform active:scale-[0.98]"
          >
            开始自测
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </main>
    );
  }

  /* ---------- 结算 ---------- */
  if (phase === 'end') {
    const total = list.length;
    const rate = total ? Math.round((known / total) * 100) : 0;
    return (
      <main className="mx-auto max-w-2xl px-3 py-4">
        <div className="rounded-3xl bg-white p-6 text-center shadow-[0_8px_30px_rgba(59,107,232,0.10)]">
          <p className="text-[13px] text-slate-400">本轮完成</p>
          <p className="mt-1 text-[42px] font-bold leading-none text-[#3B6BE8]">
            {rate}
            <span className="text-[20px]">%</span>
          </p>
          <p className="mt-2 text-[13px] text-slate-500">
            共 {total} 句 · 记住 <span className="font-semibold text-emerald-600">{known}</span> · 没记住{' '}
            <span className="font-semibold text-rose-500">{missed.length}</span>
          </p>

          {missed.length > 0 ? (
            <div className="mt-5 rounded-2xl bg-rose-50/70 p-4 text-left">
              <p className="mb-2 text-[12.5px] font-semibold text-rose-500">没记住的句子</p>
              <ul className="space-y-2.5">
                {missed.map((w, i) => (
                  <li key={i} className="text-[13px] leading-relaxed">
                    <span className="text-slate-400">[{w.pieceTitle}] </span>
                    <span className="font-semibold text-slate-800">{w.q + w.a}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-5 text-[13px] font-medium text-emerald-600">全部回想出来了，稳了！</p>
          )}

          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <button
              onClick={() => (missed.length ? start(missed) : start(list))}
              className="flex items-center justify-center gap-1.5 rounded-2xl bg-[#3B6BE8] py-2.5 text-[13.5px] font-semibold text-white transition-transform active:scale-[0.98]"
            >
              <RotateCcw className="h-4 w-4" />
              {missed.length ? '重练没记住的' : '再来一轮'}
            </button>
            <button
              onClick={onBack}
              className="flex items-center justify-center gap-1.5 rounded-2xl bg-slate-100 py-2.5 text-[13.5px] font-semibold text-slate-600 transition-transform active:scale-[0.98]"
            >
              <BookOpen className="h-4 w-4" />
              回到速览
            </button>
          </div>
        </div>
      </main>
    );
  }

  /* ---------- 回想 ---------- */
  if (!current) return null;
  const pct = ((idx + (revealed ? 1 : 0)) / list.length) * 100;

  return (
    <main className="mx-auto max-w-2xl px-3 py-4">
      {/* 进度 */}
      <div className="mb-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/80">
          <div
            className="h-full rounded-full bg-[#3B6BE8] transition-all duration-300"
            style={{ width: pct + '%' }}
          />
        </div>
        <span className="shrink-0 text-[12px] font-medium text-slate-500">
          {idx + 1} / {list.length}
        </span>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(59,107,232,0.10)]">
        <p className="mb-3 text-[11.5px] text-slate-400">[{current.pieceTitle}] 看提示，回想整句</p>

        {/* 提示（与清单同款的考点提示） */}
        <div className="rounded-2xl bg-amber-50/70 px-4 py-4">
          <p className="text-[11px] font-medium text-amber-600/80">提示</p>
          <p className="mt-1.5 text-[15.5px] font-medium leading-relaxed text-slate-700">{hint}</p>
        </div>

        {!revealed ? (
          <button
            onClick={() => setRevealed(true)}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#3B6BE8] py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_22px_rgba(59,107,232,0.32)] transition-transform active:scale-[0.98]"
          >
            <Eye className="h-4 w-4" />
            想好了，看整句
          </button>
        ) : (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
            <div className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3.5">
              <p className="text-[11px] font-medium text-emerald-600/70">完整句子</p>
              <p className="mt-1 text-[17px] font-semibold leading-[1.9] tracking-wide text-emerald-800">
                {full}
              </p>
            </div>

            <p className="mb-2 mt-4 text-center text-[12px] text-slate-400">刚才想全了吗？</p>
            <div className="flex gap-2.5">
              <button
                onClick={() => mark(false)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-rose-50 py-3 text-[15px] font-semibold text-rose-500 transition-transform active:scale-[0.98]"
              >
                <X className="h-4 w-4" strokeWidth={3} />
                没记住
              </button>
              <button
                onClick={() => mark(true)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-emerald-500 py-3 text-[15px] font-semibold text-white shadow-[0_8px_22px_rgba(16,185,129,0.3)] transition-transform active:scale-[0.98]"
              >
                <Check className="h-4 w-4" strokeWidth={3} />
                记住了
              </button>
            </div>
          </motion.div>
        )}
      </div>

      <p className="mt-3 hidden text-center text-[11.5px] text-slate-400 sm:block">
        空格 / 回车看整句 · 然后按 1 没记住、2 记住了
      </p>
    </main>
  );
}
