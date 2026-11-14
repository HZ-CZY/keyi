import { formatCoins } from '../../lib/coins';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ScrollText, BookOpenText, PenLine, Feather, Sparkles, Check, X,
  Loader2, Volume2, Lightbulb, Search, Coins, Flame, Target, RotateCcw, ChevronRight,
  Library, type LucideIcon,
} from 'lucide-react';
import { api } from '../../lib/api';
import BottomNav from './components/BottomNav';
import {
  ImmersiveBackdrop, StageTopPill, StageBottomBar, StageCard, StageCardLabel,
  StageHeadline, StageToolButton, StageVerdict,
  StageBigChar, StageSentence, usePinyin, extractBookSource,
  OPTION_BASE, OPTION_CORRECT, OPTION_WRONG, OPTION_DIM, OPTION_SHAPE,
} from './components/ImmersiveQuiz';

/* ═══════════════════════════ 基础工具 ═══════════════════════════ */

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

/* ═══════════════════════════ 文言卡片解析 ═══════════════════════════ */

/**
 * 后端 GET /cards/deck/:id 返回的 fields 是 JSON 字符串（/due 才是数组），
 * 这里做防御性解析，两种形态都能兼容。
 */
function parseFields(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(v => String(v ?? ''));
  const s = typeof raw === 'string' ? raw : '';
  try {
    const p = JSON.parse(s);
    if (Array.isArray(p)) return p.map(v => String(v ?? ''));
  } catch {
    /* 不是 JSON，走分隔符兜底 */
  }
  return s.split('\x1f');
}

/** 文言卡片 */
interface TrainCard {
  id: number;
  /** 原始 fields（保留 markup，用于渲染） */
  fields: string[];
  /** 文言例句原文（保留 markup） */
  f0: string;
  /** 义项 */
  f1: string;
  /** 白话译文 */
  f2: string;
  /** 考点字（挖空/默写的答案） */
  kw: string | null;
}

/** 由后端原始记录构造卡片，过滤掉正反面为空的脏数据 */
function toTrainCard(raw: any): TrainCard | null {
  const fields = parseFields(raw?.fields);
  const f0raw = String(fields[0] ?? '');
  const f1raw = String(fields[1] ?? '');
  if (!plainText(f0raw) || !plainText(f1raw)) return null;
  return {
    id: Number(raw?.id) || 0,
    fields,
    f0: f0raw,
    f1: f1raw,
    f2: String(fields[2] ?? ''),
    kw: extractKeyword(f0raw),
  };
}

/**
 * 提取考点字（**加粗** 的重点字词），优先级：
 *   1. `**字**`（可能外套 <b>）
 *   2. 「…中的“字”…」问句式
 *   3. 首个中文引号内的短串
 * 取不到返回 null —— 该卡不参与挖空类题型，但选择题型仍可用。
 */
function extractKeyword(f0: string): string | null {
  const raw = String(f0 || '');
  const strip = (s: string) => s.replace(/<[^>]+>/g, '').trim();

  const m1 = raw.match(/\*\*([^*]+)\*\*/);
  if (m1) {
    const kw = strip(m1[1]).replace(/\*\*/g, '');
    if (kw && kw.length >= 1 && kw.length <= 6) return kw;
  }
  const m2 = raw.match(/中的[“"]([^”"]{1,6})[”"]/);
  if (m2) return m2[1];
  const m3 = raw.match(/[“"]([^”"]{1,8})[”"]/);
  if (m3) return m3[1];
  return null;
}

/** 把例句中的考点字挖成 `____`，得到默写题干；失败返回 null */
function makeCloze(card: TrainCard): string | null {
  if (!card.kw) return null;
  let base = plainText(card.f0);

  // 问句式（「“……”中的“X”是什么意思？」）→ 还原为纯句子
  if (/是什么意思|意思是/.test(base)) {
    const q = base.match(/[“"]([^”"]{2,80})[”"]/);
    if (!q) return null;
    base = q[1];
  }
  base = base.trim();
  if (!base.includes(card.kw)) return null;
  return base.split(card.kw).join('____');
}

/** 名句切分：返回「上句 / 下句 / 出处」，切不出返回 null */
function splitVerse(f0: string): { head: string; tail: string; source: string } | null {
  let s = plainText(f0).trim();
  if (/是什么意思|意思是/.test(s)) return null;

  let source = '';
  const sm = s.match(/[（(]?《([^》]{1,20})》[）)]?/);
  if (sm) {
    source = `《${sm[1]}》`;
    s = s.replace(sm[0], '').trim();
  }
  const parts = s.split(/[，。、；？！]/).map(x => x.trim()).filter(x => x.length >= 3);
  if (parts.length < 2) return null;
  const head = parts[0];
  const tail = parts.slice(1).join('，');
  if (head.length < 3 || tail.length < 3 || head.length > 40 || tail.length > 40) return null;
  return { head, tail, source };
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
    const voice = synth.getVoices().find(v => /zh[-_]/i.test(v.lang));
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

/* ═══════════════════════════ 本地战绩 ═══════════════════════════ */

const DECK_KEY = 'keyi_training_deck';
const STREAK_KEY = 'keyi_training_streak';

interface DayStat {
  done: number;
  correct: number;
}

const dayStorageKey = (d = new Date()) => `keyi_training_${dateKey(d)}`;

function loadDayStat(): DayStat {
  try {
    const raw = localStorage.getItem(dayStorageKey());
    if (raw) {
      const p = JSON.parse(raw) as Partial<DayStat>;
      return {
        done: Number(p.done) || 0,
        correct: Number(p.correct) || 0,
      };
    }
  } catch {
    /* ignore */
  }
  return { done: 0, correct: 0 };
}

function saveDayStat(s: DayStat): void {
  try {
    localStorage.setItem(dayStorageKey(), JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** 连续训练天数：昨天或今天练过才算数 */
function visibleStreak(): number {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (!raw) return 0;
    const p = JSON.parse(raw) as { last?: string; days?: number };
    const days = Number(p.days) || 0;
    const last = String(p.last || '');
    if (!last) return 0;
    if (last === dateKey()) return days;
    const y = new Date();
    y.setDate(y.getDate() - 1);
    if (last === dateKey(y)) return days;
  } catch {
    /* ignore */
  }
  return 0;
}

function bumpStreak(): number {
  const today = dateKey();
  let last = '';
  let days = 0;
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { last?: string; days?: number };
      last = String(p.last || '');
      days = Number(p.days) || 0;
    }
  } catch {
    /* ignore */
  }
  if (last === today) return days;
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const next = last === dateKey(y) ? days + 1 : 1;
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify({ last: today, days: next }));
  } catch {
    /* ignore */
  }
  return next;
}

function readSavedDeck(): number | null {
  try {
    const n = Number(localStorage.getItem(DECK_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/* ═══════════════════════════ 数据模型 ═══════════════════════════ */

type ModeId = 's2m' | 'm2s' | 'cloze' | 'judge' | 'couplet';

interface ModeDef {
  id: ModeId;
  title: string;
  sub: string;
  icon: LucideIcon;
  grad: string;
  tag?: string;
}

interface Question {
  card: TrainCard;
  kind: 'choice' | 'bool' | 'input';
  /** 主题干（可能含 markup），用 dangerouslySetInnerHTML 渲染 */
  promptHtml: string;
  /** 题干纯文本（用于朗读 / 兜底） */
  promptPlain: string;
  /** 辅助提示（如：义项、出处） */
  hint?: string;
  options?: string[];
  /** choice: 正确选项文本；bool: 'true' | 'false'；input: 正确答案 */
  answer: string;
  /** choice 正确下标，其余为 -1 */
  answerIndex: number;
  /** 答题后揭晓的补充内容（译文等） */
  reveal?: string;
}

/** 一组训练的题量 */
const ROUND_SIZE = 10;

const MODES: ModeDef[] = [
  {
    id: 's2m', title: '据句选义', sub: '看文言例句，选正确义项',
    icon: ScrollText, grad: 'from-blue-500 to-indigo-500', tag: 'HOT',
  },
  {
    id: 'm2s', title: '据义选句', sub: '给一个义项，找对应原句',
    icon: BookOpenText, grad: 'from-sky-500 to-cyan-600',
  },
  {
    id: 'cloze', title: '挖空默写', sub: '句子挖去重点字词，补全它',
    icon: PenLine, grad: 'from-amber-500 to-orange-500', tag: '新',
  },
  {
    id: 'judge', title: '义项速判', sub: '这个解释对不对，一眼定夺',
    icon: Feather, grad: 'from-fuchsia-500 to-pink-600',
  },
  {
    id: 'couplet', title: '名句接龙', sub: '给上句，补出下句',
    icon: Sparkles, grad: 'from-emerald-500 to-teal-600',
  },
];

/* ═══════════════════════════ 干扰项池 ═══════════════════════════ */

interface Pools {
  /** 义项池（用于「据句选义」「义项速判」） */
  meanings: string[];
  /** 例句池（用于「据义选句」） */
  sentences: string[];
}

/** 是否是「……是什么意思？」问句式（不适合当文言句子选项/原句目标） */
function isQuestionForm(s: string): boolean {
  return /是什么意思|意思是/.test(String(s || ''));
}

/** 判断更像文言句子还是义项释义 */
function looksLikeSentence(s: string): boolean {
  const t = (s || '').trim();
  if (!t) return false;
  if (/《|》/.test(t)) return true;
  if (/[，。；？！、]/.test(t)) return true;
  return t.length >= 9;
}

function pushUnique(arr: string[], v: string): void {
  if (v && !arr.includes(v)) arr.push(v);
}

/** 构建干扰项池：服务端全局干扰项 + 本卡组义项 + 本卡组例句 */
function buildPools(cards: TrainCard[], dist: { text?: string; keyword?: string }[]): Pools {
  const meanings: string[] = [];
  const sentences: string[] = [];

  for (const d of dist) {
    const t = plainText(d?.text || '');
    if (!t || t.length > 30) continue;
    if (/是什么意思/.test(t)) continue;
    if (looksLikeSentence(t)) pushUnique(sentences, t);
    else pushUnique(meanings, t);
  }
  for (const c of cards) {
    const m = plainText(c.f1);
    if (m.length <= 30) pushUnique(meanings, m);
  }
  for (const c of cards) {
    const s = plainText(c.f0);
    if (s.length <= 42 && !isQuestionForm(s)) pushUnique(sentences, s);
  }
  return { meanings, sentences };
}

/** 挑 n 个干扰项：优先同组候选（最难、最有训练价值），不足时退回全局池 */
function pickDistractors(correct: string, preferred: string[], fallback: string[], n: number): string[] {
  const seen = new Set<string>([norm(correct)]);
  const out: string[] = [];
  const take = (pool: string[]) => {
    for (const s of shuffle(pool)) {
      if (out.length >= n) return;
      const t = String(s || '').trim();
      if (!t || t.length > 60) continue;
      const k = norm(t);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  };
  take(preferred);
  take(fallback);
  return out;
}

/* ═══════════════════════════ 出题 ═══════════════════════════ */

interface BuildCtx {
  cards: TrainCard[];
  pools: Pools;
}

/** 该模式下哪些卡片可用（用于「可练 N 题」计数，结果稳定，不随随机波动） */
function eligibleCards(mode: ModeId, ctx: BuildCtx): TrainCard[] {
  const { cards, pools } = ctx;
  const base = cards.filter(c => plainText(c.f0) && plainText(c.f1));
  switch (mode) {
    case 's2m':
      return base;
    case 'm2s':
      return base.length >= 2 ? base.filter(c => !isQuestionForm(plainText(c.f0))) : [];
    case 'cloze':
      return base.filter(c => makeCloze(c) !== null);
    case 'judge':
      return pools.meanings.length >= 2 ? base : [];
    case 'couplet':
      return base.filter(c => splitVerse(c.f0) !== null);
    default:
      return [];
  }
}

/** 构造单题，构造不出来返回 null（调用方换一张卡重试） */
function buildQuestion(mode: ModeId, card: TrainCard, ctx: BuildCtx): Question | null {
  const { cards, pools } = ctx;
  const sentence = plainText(card.f0);
  const meaning = plainText(card.f1);
  const translation = plainText(card.f2);
  if (!sentence || !meaning) return null;

  const reveal = translation ? `译文：${translation}` : undefined;

  if (mode === 's2m') {
    // 看例句 → 选义项
    const preferred = cards.map(c => plainText(c.f1));
    const ds = pickDistractors(meaning, preferred, pools.meanings, 3);
    if (ds.length < 1) return null;
    const options = shuffle([meaning, ...ds]);
    return {
      card, kind: 'choice',
      promptHtml: card.f0, promptPlain: sentence, reveal,
      options, answer: meaning, answerIndex: options.indexOf(meaning),
    };
  }

  if (mode === 'm2s') {
    // 看义项 → 选例句
    if (isQuestionForm(sentence)) return null;
    const preferred = cards
      .filter(c => c.id !== card.id && !isQuestionForm(plainText(c.f0)))
      .map(c => plainText(c.f0));
    const fallback = pools.sentences.concat(pools.meanings);
    const ds = pickDistractors(sentence, preferred, fallback, 3);
    if (ds.length < 1) return null;
    const options = shuffle([sentence, ...ds]);
    return {
      card, kind: 'choice',
      promptHtml: card.f1, promptPlain: meaning, reveal,
      options, answer: sentence, answerIndex: options.indexOf(sentence),
    };
  }

  if (mode === 'cloze') {
    // 挖空 → 默写重点字词
    const masked = makeCloze(card);
    if (!masked || !card.kw) return null;
    return {
      card, kind: 'input',
      promptHtml: masked, promptPlain: masked, reveal,
      hint: meaning.length > 60 ? `${meaning.slice(0, 57)}…` : meaning,
      answer: card.kw, answerIndex: -1,
    };
  }

  if (mode === 'judge') {
    // 判断给出的义项对不对
    const wrongPool = cards
      .filter(c => c.id !== card.id)
      .map(c => plainText(c.f1))
      .concat(pools.meanings)
      .filter(m => norm(m) !== norm(meaning) && m.length <= 60);
    if (wrongPool.length < 1) return null;
    const truth = Math.random() < 0.5;
    const shown = truth ? meaning : wrongPool[Math.floor(Math.random() * wrongPool.length)];
    return {
      card, kind: 'bool',
      promptHtml: card.f0, promptPlain: sentence,
      hint: shown, answer: truth ? 'true' : 'false', answerIndex: -1,
      reveal: reveal ? `${reveal}\n正确释义：${meaning}` : `正确释义：${meaning}`,
    };
  }

  if (mode === 'couplet') {
    // 名句接龙
    const v = splitVerse(card.f0);
    if (!v) return null;
    return {
      card, kind: 'input',
      promptHtml: v.head, promptPlain: v.head, reveal,
      hint: v.source ? `出处 ${v.source}` : undefined,
      answer: v.tail, answerIndex: -1,
    };
  }

  return null;
}

/** 生成一组题（不重复用卡），构造不出返回空数组 */
function buildRound(mode: ModeId, ctx: BuildCtx, size = ROUND_SIZE): Question[] {
  const pool = shuffle(eligibleCards(mode, ctx));
  const out: Question[] = [];
  const used = new Set<number>();
  for (const card of pool) {
    if (out.length >= size) break;
    if (used.has(card.id)) continue;
    const q = buildQuestion(mode, card, ctx);
    if (!q) continue;
    used.add(card.id);
    out.push(q);
  }
  return out;
}

/* ═══════════════════════════ 小组件 ═══════════════════════════ */

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

function StatBox({ label, value, tone }: { label: string; value: string; tone: 'blue' | 'slate' | 'amber' }) {
  const cls =
    tone === 'blue' ? 'text-blue-600'
      : tone === 'amber' ? 'text-amber-600'
        : 'text-slate-800';
  return (
    <div className="rounded-2xl bg-white border border-black/5 py-3 text-center">
      <p className={`text-[19px] font-bold tabular-nums ${cls}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-400">{label}</p>
    </div>
  );
}

/* ═══════════════════════════ 训练器 ═══════════════════════════ */

function Trainer({
  mode, questions, onExit, onFinish,
}: {
  mode: ModeDef;
  questions: Question[];
  onExit: () => void;
  onFinish: (r: { total: number; correct: number; ms: number }) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);
  const [boolPick, setBoolPick] = useState<null | 'true' | 'false'>(null);
  const [typed, setTyped] = useState('');
  const [judged, setJudged] = useState<boolean | null>(null);
  const [result, setResult] = useState<{ total: number; correct: number; ms: number } | null>(null);
  /** 上一题的词（顶部胶囊显示用）：word = card.kw，meaning = 义项 */
  const [prevWord, setPrevWord] = useState<{ word: string; meaning: string } | null>(null);
  /** 灯泡：提前展开解析卡 */
  const [showExplain, setShowExplain] = useState(false);
  /* 【2026-10-22】本题是否点开过解析：看了解析再作答不计正确，
     否则等于允许「先抄答案再点选」，正确率与铜板都能刷。 */
  const [hintUsed, setHintUsed] = useState(false);
  const startedAt = useRef<number>(Date.now());
  const correctCount = useRef(0);
  /** 解析卡引用：答完后自动滚动过去，避免被底部固定栏挡住 */
  const explainRef = useRef<HTMLDivElement>(null);

  const q = questions[idx];

  // 舞台重点字与拼音（仅用于展示）；Hook 必须在条件返回之前调用
  const stageKeyword = q ? (q.card.kw || '') : '';
  const stageKeywordPinyin = usePinyin(stageKeyword);

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  // 答题后把解析卡滚进视口（nearest：已经可见就不动）
  useEffect(() => {
    if (judged === null || result) return;
    const t = window.setTimeout(() => {
      explainRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    return () => window.clearTimeout(t);
  }, [judged, result]);

  useEffect(() => () => stopSpeak(), []);

  const report = useCallback((cardId: number, ok: boolean, ms: number) => {
    try {
      const p = api.cards.answer(cardId, ok ? 3 : 1, ms) as any;
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      /* 上报失败不影响答题流程 */
    }
  }, []);

  const advance = useCallback(() => {
    // 记下本题的词，供下一题顶部胶囊的「上一词」显示
    if (q) setPrevWord({ word: q.card.kw || '', meaning: plainText(q.card.f1) });
    setShowExplain(false);
    setHintUsed(false);
    if (idx + 1 >= questions.length) {
      setResult({ total: questions.length, correct: correctCount.current, ms: Date.now() - startedAt.current });
      return;
    }
    setIdx(i => i + 1);
    setChoice(null);
    setBoolPick(null);
    setTyped('');
    setJudged(null);
  }, [idx, questions.length, q]);

  const judgeAnswer = useCallback((ok: boolean) => {
    if (judged !== null || !q) return;
    /* 看过解析的题一律按「未答对」处理：不计正确数、不上报正确，铜板也不发 */
    const effective = ok && !hintUsed;
    setJudged(effective);
    if (effective) correctCount.current += 1;
    report(q.card.id, effective, Date.now() - startedAt.current);
  }, [judged, q, report, hintUsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (judged === null) return;
      if (e.key === 'Enter') advance();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [judged, advance]);

  /* ── 结算页 ── */
  if (result) {
    const acc = result.total > 0 ? Math.round((result.correct / result.total) * 100) : 0;
    return (
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="fixed inset-0 z-50 bg-white overflow-y-auto"
      >
        <div className="mx-auto max-w-[592px] min-h-full flex flex-col items-center justify-center px-6 py-10">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 18 }}
            className="w-24 h-24 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-orange-500/25"
          >
            <TrophyGlyph />
          </motion.div>
          <h2 className="mt-5 text-2xl font-bold text-slate-900">
            {acc >= 80 ? '这组稳了！' : acc >= 60 ? '还行，再抠细节' : '回去再读两遍'}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {mode.title} · 完成 {result.total} 题
          </p>

          <div className="mt-7 grid grid-cols-3 gap-3 w-full">
            <StatBox label="正确率" value={`${acc}%`} tone="blue" />
            <StatBox label="用时" value={formatDuration(result.ms)} tone="slate" />
            <StatBox label="铜板" value={`+${result.correct}`} tone="amber" />
          </div>

          <div className="mt-8 w-full space-y-3">
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setIdx(0);
                setChoice(null);
                setBoolPick(null);
                setTyped('');
                setJudged(null);
                setPrevWord(null);
                setShowExplain(false);
                setHintUsed(false);
                correctCount.current = 0;
                startedAt.current = Date.now();
              }}
              className="w-full h-12 rounded-2xl bg-slate-900 text-white font-semibold text-[15px] active:scale-[0.98] transition-transform"
            >
              再来一组
            </button>
            <button
              type="button"
              onClick={() => onFinish(result)}
              className="w-full h-12 rounded-2xl border border-black/10 text-slate-700 font-semibold text-[15px] active:scale-[0.98] transition-transform"
            >
              返回训练场
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  if (!q) return null;

  const progress = ((idx + (judged !== null ? 1 : 0)) / questions.length) * 100;

  return (
    <motion.div
      initial={{ y: 28, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 28, opacity: 0 }}
      transition={{ duration: 0.22 }}
      className="fixed inset-0 z-50 overflow-y-auto"
    >
      <ImmersiveBackdrop>
        <StageTopPill
          word={prevWord ? prevWord.word : null}
          meaning={prevWord ? prevWord.meaning : ''}
          progress={progress}
          onBack={onExit}
        />

        <main className="relative z-10 flex flex-col items-center px-4 pt-14 pb-28 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${q.card.id}-${idx}`}
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
                    html={q.card.f0}
                    source={extractBookSource(q.card.f0)}
                    onSpeak={() => speakZh(q.promptPlain)}
                  />
                </>
              ) : (
                <StageHeadline html={q.promptHtml} />
              )}

              {/* 辅助提示（义项 / 出处 / 引导语） */}
              {q.hint && (
                <div className="w-full flex justify-center mt-8">
                  <StageCard className="p-5">
                    <StageCardLabel>{q.kind === 'bool' ? '义项' : '提示'}</StageCardLabel>
                    <div className="font-serif text-base font-semibold text-slate-800 leading-relaxed whitespace-pre-wrap">
                      {q.hint}
                    </div>
                  </StageCard>
                </div>
              )}

              {/* 选择题：半透明白选项（已去掉 A/B/C/D 字母标签） */}
              {q.kind === 'choice' && (
                <div className="w-full mt-8 space-y-3">
                  {(q.options || []).map((opt, i) => {
                    const isAnswer = i === q.answerIndex;
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
                        key={`${q.card.id}-${i}`}
                        type="button"
                        disabled={judged !== null}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        onClick={() => {
                          if (judged !== null) return;
                          setChoice(i);
                          judgeAnswer(i === q.answerIndex);
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
              {q.kind === 'input' && (
                <div className="w-full flex justify-center mt-8">
                  <StageCard>
                    <StageCardLabel>{judged === null ? '写出答案' : '正确答案'}</StageCardLabel>
                    <input
                      value={typed}
                      onChange={e => setTyped(e.target.value)}
                      onKeyDown={e => {
                        if (e.key !== 'Enter') return;
                        if (judged !== null) return;
                        const v = typed.trim();
                        if (v) judgeAnswer(norm(v) === norm(q.answer));
                      }}
                      disabled={judged !== null}
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
                        {q.answer}
                      </p>
                    )}
                  </StageCard>
                </div>
              )}

              {/* 答后：判定胶囊 */}
              {judged !== null && (
                <div className="w-full mt-8">
                  <StageVerdict correct={judged} />
                  {hintUsed && (
                    <p className="mt-2 text-center text-[12px] font-medium text-amber-600">
                      本题点开过解析，不计正确
                    </p>
                  )}
                </div>
              )}

              {/* 解析卡：答后自动展开，也可以点「灯泡」提前查看（作答依然有效） */}
              {(judged !== null || showExplain) && (
                <div ref={explainRef} className="w-full flex justify-center scroll-mt-24">
                  <StageCard>
                    <StageCardLabel>解析</StageCardLabel>
                    {q.reveal && (
                      <div className="font-serif text-base font-semibold text-slate-800 leading-relaxed whitespace-pre-wrap">
                        {q.reveal}
                      </div>
                    )}
                    {q.kind === 'choice' && (
                      <div className={q.reveal ? 'mt-3' : ''}>
                        <StageCardLabel>正确答案</StageCardLabel>
                        <div className="font-serif text-base font-semibold text-emerald-700 leading-relaxed">
                          {q.answer}
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
            <StageToolButton label="斩：跳过本题" onClick={advance} className="text-slate-700">
              <span className="text-xl font-bold font-serif leading-none">斩</span>
            </StageToolButton>
          }
          center={
            <StageToolButton
              label={hintUsed ? '已看解析（本题不计对）' : '解析'}
              onClick={() => { setShowExplain(true); setHintUsed(true); }}
              className={hintUsed ? 'text-amber-600' : 'text-slate-600'}
            >
              <Lightbulb className="w-5 h-5" />
            </StageToolButton>
          }
          right={
            SPEECH_OK ? (
              <StageToolButton label="朗读" onClick={() => speakZh(q.promptPlain)} className="text-slate-600">
                <Volume2 className="w-5 h-5" />
              </StageToolButton>
            ) : null
          }
        >
          {/* 判断题：两档按钮（解释正确 / 解释错误） */}
          {q.kind === 'bool' && (
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-5 grid grid-cols-2 gap-3"
            >
              {(['true', 'false'] as const).map(v => {
                const isAnswer = v === q.answer;
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
                    disabled={judged !== null}
                    onClick={() => {
                      if (judged !== null) return;
                      setBoolPick(v);
                      judgeAnswer(v === q.answer);
                    }}
                    className={cls}
                  >
                    {v === 'true'
                      ? <><Check className="w-4 h-4" /> 解释正确</>
                      : <><X className="w-4 h-4" /> 解释错误</>}
                  </button>
                );
              })}
            </motion.div>
          )}

          {/* 默写题：提交 */}
          {q.kind === 'input' && judged === null && (
            <motion.button
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              type="button"
              onClick={() => {
                const v = typed.trim();
                if (v) judgeAnswer(norm(v) === norm(q.answer));
              }}
              disabled={!typed.trim()}
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
      </ImmersiveBackdrop>
    </motion.div>
  );
}

/* ═══════════════════════════ 卡组选择面板 ═══════════════════════════ */

interface Deck {
  id: number;
  name: string;
  card_count?: number;
}

function DeckPicker({
  decks, current, onPick, onClose,
}: {
  decks: Deck[];
  current: number | null;
  onPick: (id: number) => void;
  onClose: () => void;
}) {
  const [kw, setKw] = useState('');
  const list = useMemo(() => {
    const k = kw.trim();
    if (!k) return decks;
    return decks.filter(d => String(d.name || '').includes(k));
  }, [decks, kw]);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-black/40 flex items-end justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-[592px] h-[76vh] rounded-t-3xl bg-white flex flex-col overflow-hidden"
      >
        <div className="px-5 pt-4 pb-3 border-b border-black/5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[17px] font-bold text-slate-900">选择训练范围</h3>
            <button type="button" onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={kw}
              onChange={e => setKw(e.target.value)}
              placeholder="搜索实词 / 课文，如「安」"
              className="w-full h-11 rounded-xl bg-slate-100 pl-9 pr-3 text-[15px] outline-none text-slate-900 placeholder:text-slate-400"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {list.length === 0 ? (
            <p className="text-center text-[13px] text-slate-400 py-10">没有匹配的卡组</p>
          ) : (
            list.map(d => {
              const active = d.id === current;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => { onPick(d.id); onClose(); }}
                  className={`w-full flex items-center gap-3 rounded-2xl px-3.5 py-3 mb-1.5 text-left transition-colors ${
                    active ? 'bg-blue-50' : 'hover:bg-slate-50:bg-slate-800'
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'
                  }`}>
                    <Library className="w-4 h-4" />
                  </div>
                  <span className="flex-1 min-w-0">
                    <span className={`block truncate text-[15px] font-medium ${active ? 'text-blue-700' : 'text-slate-800'}`}>
                      {d.name}
                    </span>
                    <span className="block text-[12px] text-slate-400 mt-0.5">{d.card_count ?? 0} 张卡</span>
                  </span>
                  {active && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ═══════════════════════════ 页面主体 ═══════════════════════════ */

export default function TrainingPageV2() {
  const navigate = useNavigate();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deckId, setDeckId] = useState<number | null>(null);
  const [cards, setCards] = useState<TrainCard[]>([]);
  const [dist, setDist] = useState<{ text?: string; keyword?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dayStat, setDayStat] = useState<DayStat>({ done: 0, correct: 0 });
  const [streak, setStreak] = useState(0);
  const [activeMode, setActiveMode] = useState<ModeId | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  // 服务器铜板：余额 + 今日训练所得（首页卡片展示用）
  const [coinsInfo, setCoinsInfo] = useState<{ balance: number; todayEarned: number }>({ balance: 0, todayEarned: 0 });
  // 防止入场扣费期间重复点击；组件卸载后不再 setState
  const mountedRef = useRef(true);
  const startBusyRef = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(t => (t === msg ? null : t)), 2200);
  }, []);

  /** 拉取铜板余额与今日训练所得（失败静默显示占位 0） */
  const refreshCoins = useCallback(async () => {
    try {
      const c = await api.coins.get();
      if (mountedRef.current) setCoinsInfo({ balance: c.balance, todayEarned: c.todayEarned });
    } catch {
      /* 占位 0 */
    }
  }, []);

  /* ── 拉取卡组列表 ── */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await api.decks.list() as any;
        const arr: Deck[] = Array.isArray(list) ? list : Array.isArray(list?.decks) ? list.decks : [];
        if (!alive) return;
        setDecks(arr);
        if (arr.length > 0) {
          const saved = readSavedDeck();
          const hit = saved && arr.some(d => d.id === saved);
          setDeckId(hit ? saved! : arr[0].id);
        }
      } catch {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  /* ── 拉取当前卡组卡片 + 干扰项 ── */
  useEffect(() => {
    if (deckId === null) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const [rows, gd, dd] = await Promise.all([
          api.cards.deckCards(deckId) as Promise<any[]>,
          api.cards.allDistractors().catch(() => [] as any[]),
          api.cards.distractors(deckId).catch(() => [] as any[]),
        ]);
        if (!alive) return;
        const list = Array.isArray(rows) ? rows : [];
        setCards(list.map(toTrainCard).filter((c): c is TrainCard => c !== null));
        setDist([...(Array.isArray(dd) ? dd : []), ...(Array.isArray(gd) ? gd : [])]);
      } catch {
        if (alive) {
          setCards([]);
          setDist([]);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId]);

  /* ── 本地战绩 + 服务器铜板 ── */
  useEffect(() => {
    mountedRef.current = true;
    setDayStat(loadDayStat());
    setStreak(visibleStreak());
    refreshCoins();
    return () => { mountedRef.current = false; };
  }, [refreshCoins]);

  const pools = useMemo(() => buildPools(cards, dist), [cards, dist]);
  const ctx = useMemo<BuildCtx>(() => ({ cards, pools }), [cards, pools]);

  /** 各模式可练题数 */
  const counts = useMemo(() => {
    const m = {} as Record<ModeId, number>;
    for (const mode of MODES) m[mode.id] = Math.min(eligibleCards(mode.id, ctx).length, ROUND_SIZE);
    return m;
  }, [ctx]);

  const currentDeck = decks.find(d => d.id === deckId) || null;
  const bestMode = MODES.reduce((a, b) => (counts[b.id] > counts[a.id] ? b : a), MODES[0]);

  const accuracy = dayStat.done > 0 ? Math.round((dayStat.correct / dayStat.done) * 100) : 0;

  /* ── 开始某个模式（先扣 6 铜板入场，成功才出题） ── */
  const startMode = async (mode: ModeDef) => {
    if (startBusyRef.current) return;
    if (counts[mode.id] < 1) {
      showToast('这个模式暂无可练内容，换个卡组试试');
      return;
    }
    startBusyRef.current = true;
    try {
      await api.coins.trainingEntry(mode.id);
    } catch (e: any) {
      startBusyRef.current = false;
      showToast(e?.message || '铜板不足，无法开始训练');
      return;
    }
    try {
      const qs = buildRound(mode.id, ctx);
      if (qs.length === 0) {
        showToast('题目生成失败，换个卡组试试');
        return;
      }
      setQuestions(qs);
      setActiveMode(mode.id);
    } finally {
      startBusyRef.current = false;
    }
  };

  /* ── 一组训练结束：本地统计保留，铜板改为后端记账上报 ── */
  const finishRound = async (r: { total: number; correct: number; ms: number }) => {
    const next: DayStat = {
      done: dayStat.done + r.total,
      correct: dayStat.correct + r.correct,
    };
    saveDayStat(next);
    setDayStat(next);
    setStreak(bumpStreak());
    setActiveMode(null);
    setQuestions([]);
    // 答对上报（每题 +1），失败静默不阻塞返回
    try {
      await api.coins.trainingReport(r.correct);
    } catch {
      /* 静默 */
    }
    refreshCoins();
  };

  /* ── 空状态 / 加载中 ── */
  if (loading && cards.length === 0) {
    return (
      <div className="min-h-screen bg-[#F6F8FB] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-7 h-7 text-blue-500 animate-spin" />
          <p className="text-[13px] text-slate-400">正在准备训练题目…</p>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F6F8FB] pb-24">
      <div className="mx-auto max-w-[592px] px-4">
        {/* 标题 */}
        <header className="flex items-center justify-between pt-5 pb-3">
          <div>
            <h1 className="text-[26px] font-bold text-slate-900 tracking-tight">训练场</h1>
            <p className="mt-0.5 text-[13px] text-slate-400">文言实词，练到不看释义也能译</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-white border border-black/5 px-3 py-1.5">
            <Flame className="w-3.5 h-3.5 text-orange-500" />
            <span className="text-[13px] font-bold text-slate-800 tabular-nums">{streak}</span>
            <span className="text-[11px] text-slate-400">天</span>
          </div>
        </header>

        {/* 今日训练 */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 px-5 py-5 shadow-lg shadow-blue-600/20">
          <div className="absolute -top-10 -right-8 w-36 h-36 rounded-full bg-white/10" />
          <div className="absolute -bottom-14 -left-10 w-32 h-32 rounded-full bg-white/[0.08]" />
          <div className="relative">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-white/70 text-[12px]">今日战绩</p>
                <p className="mt-1 text-white text-[30px] font-bold leading-none tabular-nums">
                  {dayStat.done}
                  <span className="ml-1 text-[14px] font-medium text-white/60">题</span>
                </p>
              </div>
              <div className="text-right">
                <div className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1">
                  <Coins className="w-3.5 h-3.5 text-amber-200" />
                  <span className="text-[12px] font-semibold text-white tabular-nums">今日 +{coinsInfo.todayEarned}</span>
                </div>
                <p className="mt-1.5 text-[12px] text-white/60">余额 {formatCoins(coinsInfo.balance)} 铜板</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/15 px-3 py-2.5">
                <p className="text-[11px] text-white/60">正确率</p>
                <p className="mt-0.5 text-[18px] font-bold text-white tabular-nums">{accuracy}%</p>
              </div>
              <div className="rounded-2xl bg-white/15 px-3 py-2.5">
                <p className="text-[11px] text-white/60">当前范围</p>
                <p className="mt-0.5 text-[15px] font-bold text-white truncate">
                  {currentDeck?.name || '未选择'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => startMode(bestMode)}
              className="mt-4 w-full h-12 rounded-2xl bg-white text-blue-700 font-bold text-[15px] shadow-sm active:scale-[0.98] transition-transform flex items-center justify-center gap-1.5"
            >
              <Target className="w-4 h-4" />
              开始训练 · {bestMode.title}
            </button>
          </div>
        </section>

        {/* 训练范围切换 */}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="mt-3 w-full flex items-center gap-3 rounded-2xl bg-white border border-black/5 px-4 py-3.5 active:scale-[0.99] transition-transform"
        >
          <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Library className="w-4.5 h-4.5" />
          </div>
          <span className="flex-1 min-w-0 text-left">
            <span className="block text-[11px] text-slate-400">训练范围</span>
            <span className="block text-[15px] font-semibold text-slate-900 truncate">
              {currentDeck?.name || '未选择卡组'}
            </span>
          </span>
          <span className="text-[12px] text-slate-400 shrink-0">{cards.length} 张卡</span>
          <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
        </button>

        {/* 模式网格 */}
        <section className="mt-4">
          <h2 className="text-[15px] font-bold text-slate-900 mb-2.5">训练模式</h2>
          {cards.length === 0 ? (
            <div className="rounded-3xl bg-white border border-black/5 py-12 flex flex-col items-center">
              <ScrollText className="w-10 h-10 text-slate-200" />
              <p className="mt-3 text-[14px] text-slate-500">这个范围内还没有可以训练的词</p>
              {/* 【2026-10-15】原指向 /learning 课程中心，该页已下线删除；改去词库挑一个牌组学新词 */}
              <button
                type="button"
                onClick={() => navigate('/decks')}
                className="mt-4 h-10 px-5 rounded-xl bg-blue-600 text-white text-[14px] font-semibold active:scale-95 transition-transform"
              >
                去学习新词
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {MODES.map(mode => {
                const n = counts[mode.id];
                const disabled = n < 1;
                const ModeIcon = mode.icon;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => startMode(mode)}
                    className={`relative overflow-hidden rounded-3xl bg-white border border-black/5 px-4 py-4 text-left transition-transform ${
                      disabled ? 'opacity-50' : 'active:scale-[0.98]'
                    }`}
                  >
                    {mode.tag && !disabled && (
                      <span className="absolute top-3 right-3 rounded-full bg-rose-500/10 text-rose-500 text-[10px] font-bold px-1.5 py-0.5">
                        {mode.tag}
                      </span>
                    )}
                    <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${mode.grad} flex items-center justify-center shadow-sm`}>
                      <ModeIcon className="w-5 h-5 text-white" />
                    </div>
                    <p className="mt-3 text-[15px] font-bold text-slate-900">{mode.title}</p>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-slate-400 line-clamp-2">{mode.sub}</p>
                    <p className="mt-2 text-[11px] text-slate-400">
                      {disabled ? '先去学习新词' : `可练 ${n} 题`}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* 小提示 */}
        <p className="mt-5 text-center text-[11px] text-slate-300 flex items-center justify-center gap-1">
          <RotateCcw className="w-3 h-3" />
          每组 {ROUND_SIZE} 题，答完记得回来复盘
        </p>
      </div>

      <BottomNav />

      {/* 训练器 */}
      <AnimatePresence>
        {activeMode && questions.length > 0 && (
          <Trainer
            mode={MODES.find(m => m.id === activeMode)!}
            questions={questions}
            onExit={() => { setActiveMode(null); setQuestions([]); stopSpeak(); }}
            onFinish={finishRound}
          />
        )}
      </AnimatePresence>

      {/* 卡组选择 */}
      <AnimatePresence>
        {pickerOpen && (
          <DeckPicker
            decks={decks}
            current={deckId}
            onClose={() => setPickerOpen(false)}
            onPick={(id) => {
              setDeckId(id);
              try { localStorage.setItem(DECK_KEY, String(id)); } catch { /* ignore */ }
            }}
          />
        )}
      </AnimatePresence>

      {/* 轻提示 */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
            className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[70] rounded-full bg-slate-900/90 text-white text-[13px] px-4 py-2.5 shadow-lg"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
