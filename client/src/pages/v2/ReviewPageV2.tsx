import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { CheckCircle2, Brain, ChevronRight, RotateCcw, Volume2, Lightbulb, Check, X } from 'lucide-react';
import { renderMarkup } from '../../lib/markup';
import StudyLoadingScreen from './components/StudyLoadingScreen';
import {
  ImmersiveBackdrop,
  StageTopPill,
  StageBottomBar,
  StageCard,
  StageCardLabel,
  StageCardText,
  StageToolButton,
  StageBigChar,
  StageSentence,
  usePinyin,
  extractBookSource,
  OPTION_SHAPE,
  OPTION_BASE,
  OPTION_CORRECT,
  OPTION_WRONG,
  OPTION_DIM,
} from './components/ImmersiveQuiz';

/** 复习固定每组 10 张卡（不读 review_per_session 设置）；10 张 × 2 阶段 = 20 题/组 */
const REVIEW_GROUP_SIZE = 10;

interface ReviewCard {
  id: number;
  noteId: number;
  deckId: number;
  queue: number;
  due: number;
  interval: number;
  reps: number;
  lapses: number;
  remainingSteps: number;
  question: string;
  answer: string;
  css: string;
  tags: string[];
  notetypeName?: string;
  fields?: string[];
  /** 阶段1「据句选意」的选项（前端本地生成，复习卡服务端不生成） */
  mcqOptions?: { options: { label: string; text: string; isCorrect: boolean }[]; correctAnswer: string };
  nextStates?: {
    again: { queue: number; interval: number; label: string };
    hard: { queue: number; interval: number; label: string };
    good: { queue: number; interval: number; label: string };
  };
}

function formatInterval(interval: number): string {
  if (interval <= 0) return '立即';
  if (interval < 1) {
    const mins = Math.round(interval * 60);
    return mins < 60 ? `${mins}分钟` : `${Math.round(mins / 60)}小时`;
  }
  if (interval < 30) return `${interval}天`;
  if (interval < 365) return `${Math.round(interval / 30)}个月`;
  return `${(interval / 365).toFixed(1)}年`;
}

/** 富文本 → 纯文本（用于朗读 / 比对） */
function plainText(s: string): string {
  return (s || '').replace(/\*\*/g, '').replace(/<[^>]+>/g, '').trim();
}

/** 提取例句里的重点字（**加粗**），取不到返回 null */
function extractKeywordFromFront(front: string): string | null {
  if (!front) return null;
  const m = front.match(/\*\*([^*]+)\*\*/);
  if (!m) return null;
  const kw = m[1].replace(/<[^>]+>/g, '').trim();
  return kw && kw.length >= 1 && kw.length <= 6 ? kw : null;
}

/** Fisher-Yates 洗牌 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 复习两阶段：stage1 = 据句选意，stage2 = 挖空默写，showing = 看答案 */
type ReviewPhase = 'stage1' | 'stage2' | 'showing';

export default function ReviewPageV2() {
  const { user, openLoginModal } = useAuth();
  // Non-logged-in skeleton
  if (!user) {
    return (
      <ImmersiveBackdrop>
        <div className="relative z-10 min-h-screen flex flex-col items-center justify-center text-center px-6">
          <div className="w-full max-w-sm bg-white/80 backdrop-blur-xl rounded-[2rem] p-8 text-center shadow-[0_20px_50px_rgba(96,125,180,0.25)]">
            <div className="w-20 h-20 mx-auto mb-5 rounded-3xl bg-white shadow-[0_10px_30px_rgba(96,125,180,0.18)] flex items-center justify-center">
              <Brain className="w-10 h-10 text-indigo-400" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">请先登录</h2>
            <p className="text-slate-400 mb-6">登录后即可进行复习</p>
            <button
              onClick={openLoginModal}
              className="px-8 py-3 rounded-2xl bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-500/25 hover:bg-indigo-600 transition-all"
            >
              登录
            </button>
          </div>
        </div>
      </ImmersiveBackdrop>
    );
  }
  const { deckId } = useParams();
  const navigate = useNavigate();

  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<ReviewPhase>('stage1');
  const [rating, setRating] = useState<number | null>(null);
  /* 【2026-10-22】看过「解析」的卡不再算对：两阶段成绩一律按 0 计，
     「斩」也降为「忘记」，否则先看解析再点斩就能白拿掌握与铜板。 */
  const [hintUsed, setHintUsed] = useState(false);
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, known: 0, unknown: 0 });
  const [sessionStart, setSessionStart] = useState(Date.now());
  const [loaderPhase, setLoaderPhase] = useState<'active' | 'done' | 'gone'>('active');
  // 上一张复习过的卡（顶部胶囊显示用）：word = 重点字，meaning = 义项
  const [lastReviewed, setLastReviewed] = useState<{ word: string; meaning: string } | null>(null);
  // 灯泡：提前展开答案解析（纯展示，不影响评分状态机）
  const [showDetail, setShowDetail] = useState(false);
  // 阶段1 据句选意
  const [selectedMcq, setSelectedMcq] = useState<string | null>(null);
  const [showMcqResult, setShowMcqResult] = useState(false);
  const [stage1Correct, setStage1Correct] = useState<boolean | null>(null);
  // 阶段2 挖空默写
  const [blankInput, setBlankInput] = useState('');
  const [stage2Correct, setStage2Correct] = useState<boolean | null>(null);
  // 铜板飘字（满 10 张成组时后端补发 +5）
  const [coinToast, setCoinToast] = useState<number | null>(null);
  /* 日上限提示：0 = 不显示；>0 = 已达上限的额度。
     撞到上限时飘字是 +0，学生只看到「答对了却没加钱」，必须说明原因。 */
  const [capNotice, setCapNotice] = useState(0);
  // 挖空默写输入框引用 + 输入法组合状态（解决首键丢失 / 输入到一半无响应）
  const blankInputRef = useRef<HTMLInputElement | null>(null);
  const isComposingRef = useRef(false);

  // 舞台重点字与拼音（仅用于展示）；Hook 必须在条件返回之前调用
  const stageCard = cards[currentIdx];
  const stageKeyword = stageCard ? (extractKeywordFromFront(stageCard.fields?.[0] || '') || '') : '';
  const stageKeywordPinyin = usePinyin(stageKeyword);

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      // 复习固定 10 张一组，不再读 review_per_session 设置
      // ⚠️ mode:'review' 必须带上：不然服务端按「新卡优先」返回，10 张全是 queue=0 的新卡，
      //    下面的 queue>=2 过滤后为空 → 用户看到「复习不了」（2026-09-22 修复）
      const data = await api.cards.due({
        deckId: deckId ? parseInt(deckId) : undefined,
        limit: REVIEW_GROUP_SIZE,
        mode: 'review',
      });

      const reviewCards: ReviewCard[] = data
        .filter((c: ReviewCard) => c.queue >= 2)
        .slice(0, REVIEW_GROUP_SIZE);

      // 阶段1「据句选意」需要 4 个义项选项：拉全局干扰项池本地生成
      let pool: { text: string; notetype: string; keyword?: string; front?: string }[] = [];
      try {
        pool = await api.cards.allDistractors();
      } catch { /* ignore */ }

      const keywordPools = new Map<string, string[]>();
      for (const item of pool) {
        if (!item.keyword) continue;
        if (!keywordPools.has(item.keyword)) keywordPools.set(item.keyword, []);
        const arr = keywordPools.get(item.keyword)!;
        if (arr.length < 30 && !arr.includes(item.text)) arr.push(item.text);
      }
      const globalMeaningPool = [...new Set(pool.map(i => i.text).filter(t => !!t))];

      for (const card of reviewCards) {
        const correctText = card.fields?.[1] || card.fields?.[0] || card.answer || '';
        const cardKeyword = extractKeywordFromFront(card.fields?.[0] || '');
        const keywordPool = cardKeyword ? shuffle(keywordPools.get(cardKeyword) || []) : [];
        const seen = new Set<string>([correctText]);
        const pickDistractors = (src: string[], count: number): string[] => {
          const picked: string[] = [];
          for (const text of src) {
            if (picked.length >= count) break;
            if (!text || text.length === 0 || text.length >= 100) continue;
            if (seen.has(text)) continue;
            seen.add(text);
            picked.push(text);
          }
          return picked;
        };
        let distractors = pickDistractors(keywordPool, 3);
        if (distractors.length < 3) {
          distractors = [...distractors, ...pickDistractors(shuffle(globalMeaningPool), 3 - distractors.length)];
        }
        while (distractors.length < 3) {
          distractors.push(`其他答案 ${distractors.length + 1}`);
        }
        const allTexts = shuffle([correctText, ...distractors]);
        const labels = ['A', 'B', 'C', 'D'];
        const correctLabel = labels[allTexts.indexOf(correctText)];
        card.mcqOptions = {
          options: allTexts.map((text: string, i: number) => ({
            label: labels[i],
            text,
            isCorrect: labels[i] === correctLabel,
          })),
          correctAnswer: correctLabel,
        };
      }

      setCards(reviewCards);
      setSessionStats({ reviewed: 0, known: 0, unknown: 0 });
      setCurrentIdx(0);
      setPhase('stage1');
      setRating(null);
      setSelectedMcq(null);
      setShowMcqResult(false);
      setStage1Correct(null);
      setBlankInput('');
      setStage2Correct(null);
      setShowDetail(false);
      setHintUsed(false);
      setSessionStart(Date.now());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [deckId]);

  useEffect(() => { fetchCards(); }, [fetchCards]);

  // 一组复习完成 → 广播事件，让首页 3D 词球刷新「最近学习词」
  useEffect(() => {
    if (!loading && cards.length === 0 && sessionStats.reviewed > 0) {
      window.dispatchEvent(new Event('keyi:words-updated'));
    }
  }, [loading, cards.length, sessionStats.reviewed]);

  // 进入过渡屏控制（仿百词斩记忆曲线加载页）：加载中显示，完成后进度冲满 850ms 再进入
  useEffect(() => {
    if (loading) setLoaderPhase('active');
    else if (loaderPhase === 'active') setLoaderPhase('done');
  }, [loading]);
  useEffect(() => {
    if (loaderPhase !== 'done') return;
    const t = setTimeout(() => setLoaderPhase('gone'), 850);
    return () => clearTimeout(t);
  }, [loaderPhase]);

  // 铜板飘字 2 秒后自动消失
  useEffect(() => {
    if (coinToast === null) return;
    const t = setTimeout(() => setCoinToast(null), 2000);
    return () => clearTimeout(t);
  }, [coinToast]);

  useEffect(() => {
    if (!capNotice) return;
    const id = window.setTimeout(() => setCapNotice(0), 6000);
    return () => window.clearTimeout(id);
  }, [capNotice]);

  // 进入阶段2 时主动聚焦输入框：autoFocus 在 AnimatePresence 阶段切换时常常失效，
  // 导致输入焦点落在 body 上 → 首键丢失 / 「输入到一半按键无响应」。用 ref 兜底聚焦。
  useEffect(() => {
    if (phase === 'stage2' && stage2Correct === null) {
      const t = window.setTimeout(() => blankInputRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [phase, stage2Correct]);

  const resetCardState = () => {
    setPhase('stage1');
    setRating(null);
    setSelectedMcq(null);
    setShowMcqResult(false);
    setStage1Correct(null);
    setBlankInput('');
    setStage2Correct(null);
    setShowDetail(false);
    setHintUsed(false);
    setSessionStart(Date.now());
  };

  /**
   * 每张卡「恰好一次」提交：两阶段都答完后统一结算
   * 两题全对 → 3；一对一错 → 2；两题全错 → 1
   */
  const submitCard = async (r: number) => {
    const card = cards[currentIdx];
    if (!card) return;
    // 答错（含部分错）自动记入错题本
    if (r < 3) { api.wordbook.addWrong(card.id).catch(() => {}); }
    setRating(r);
    const timeMs = Date.now() - sessionStart;
    try {
      const res = await api.cards.answer(card.id, r, timeMs);
      const awarded = Number((res as any)?.coinsAwarded) || 0;
      if (awarded > 0) setCoinToast(awarded);
      /* 【2026-10-15 按反馈】撞到日上限时给出明确说明。
         反馈里有 4 条是「学习了没加铜板」「复习了好多没有收入」「铜板获取有上限吗」——
         上限本身是对的（奖励按节奏而非刷量），问题只在于学生完全不知情。 */
      if ((res as any)?.coinsCapped) setCapNotice(Number((res as any)?.dailyStudyCap) || 80);
      setSessionStats(s => ({
        ...s,
        reviewed: s.reviewed + 1,
        known: r >= 3 ? s.known + 1 : s.known,
        unknown: r < 3 ? s.unknown + 1 : s.unknown,
      }));
    } catch (err) {
      console.error('Failed to save answer:', err);
    }
    setPhase('showing');
  };

  /** 阶段1 据句选意：选中一个义项（仅本地判分，不调 answer） */
  const handleStage1Select = (label: string) => {
    if (showMcqResult) return;
    const right = cards[currentIdx]?.mcqOptions?.correctAnswer || '';
    const ok = !!right && label === right;
    setSelectedMcq(label);
    setShowMcqResult(true);
    setStage1Correct(ok);
  };

  /** 阶段1 → 阶段2；取不到重点字时跳过默写，直接按阶段1 结果结算 */
  const handleGoStage2 = () => {
    const card = cards[currentIdx];
    if (!card) return;
    const kw = extractKeywordFromFront(card.fields?.[0] || '');
    if (!kw) {
      submitCard(stage1Correct ? 3 : 1);
      return;
    }
    setPhase('stage2');
    setShowDetail(false);
  };

  /** 阶段2 挖空默写：提交填空并结算本卡（每张卡仅此一次 answer） */
  const handleBlankSubmit = () => {
    const card = cards[currentIdx];
    if (!card || rating !== null) return;
    const kw = extractKeywordFromFront(card.fields?.[0] || '') || '';
    const ok = blankInput.trim() === kw && kw.length > 0;
    setStage2Correct(ok);
    /* 看过解析：两阶段都不计入，直接按「忘记」结算 */
    const stage1 = stage1Correct && !hintUsed;
    const stage2 = ok && !hintUsed;
    const rightCount = (stage1 ? 1 : 0) + (stage2 ? 1 : 0);
    submitCard(rightCount === 2 ? 3 : rightCount === 1 ? 2 : 1);
  };

  /** 看完答案 → 下一张 */
  const handleNext = () => {
    const done = cards[currentIdx];
    if (done) {
      setLastReviewed({
        word: extractKeywordFromFront(done.fields?.[0] || '') || plainText(done.fields?.[0] || done.question).slice(0, 6),
        meaning: plainText(done.fields?.[1] || ''),
      });
    }
    setCards(prev => prev.filter((_, i) => i !== currentIdx));
    setCurrentIdx(0);
    resetCardState();
  };

  /** 「斩：标记认识」——直接按 3 结算本卡，保证每张卡仍只提交一次 */
  const handleZhan = () => {
    if (!cards[currentIdx] || rating !== null) return;
    submitCard(hintUsed ? 1 : 3);
  };

  // 进入过渡屏：记忆曲线动画 + 进度条，加载完成淡出进入正题
  if (loading || loaderPhase !== 'gone') {
    return <StudyLoadingScreen mode="review" done={!loading} />;
  }


  if (cards.length === 0) {
    const nothingToReview = sessionStats.reviewed === 0;
    return (
      <ImmersiveBackdrop>
        <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 py-12">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-sm bg-white/80 backdrop-blur-xl rounded-[2rem] p-8 text-center shadow-[0_20px_50px_rgba(96,125,180,0.25)]"
          >
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}>
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/30">
                <CheckCircle2 className="w-10 h-10 text-white" />
              </div>
            </motion.div>
            {nothingToReview ? (
              <>
                <h2 className="text-2xl font-bold text-slate-800 mb-2">今日已复习完</h2>
                <p className="text-slate-500 mb-8">请明天再来</p>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-slate-800 mb-2">复习完成！</h2>
                <p className="text-slate-500 mb-1">
                  已复习 {sessionStats.reviewed} 张 · 认识 {sessionStats.known} · 需复习 {sessionStats.unknown}
                </p>
                <p className="text-slate-400 text-sm mb-8">坚持复习，记忆会越来越牢固</p>
              </>
            )}
            <div className="flex gap-3">
              <button
                onClick={fetchCards}
                className="flex-1 py-3 rounded-2xl bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-500/25 hover:bg-indigo-600 transition-all flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" /> 继续复习
              </button>
              <button
                onClick={() => navigate('/')}
                className="flex-1 py-3 rounded-2xl bg-white/80 border border-white text-slate-600 font-medium hover:bg-white transition-all"
              >
                返回首页
              </button>
            </div>
          </motion.div>
        </div>
      </ImmersiveBackdrop>
    );
  }

  const card = cards[currentIdx];
  if (!card) return null;

  const frontHtml = card.fields?.[0] || card.question || '';
  const answerHtml = card.fields?.[1] || card.answer || '';
  const transHtml = card.fields?.[2] || card.fields?.[1] || card.answer || '';
  // 例句出处：只取《书名》部分
  const sourceBook = extractBookSource(frontHtml);
  // 阶段2 挖空：把重点字位置替换为醒目的下划线空位
  const blankHtml = frontHtml.replace(
    /\*\*([^*]+)\*\*/g,
    '<span class="blank-slot">___</span>'
  );
  const stage1Options = card.mcqOptions?.options || [];
  const stage1Active = phase === 'stage1' && !showMcqResult;
  const stage1IsCorrect = selectedMcq === (card.mcqOptions?.correctAnswer || '');

  // 进度：每张卡 2 个阶段
  const stageDone = phase === 'stage1' ? 0 : phase === 'stage2' ? 1 : 2;
  const progress = ((currentIdx * 2 + stageDone) / (cards.length * 2)) * 100;

  /** 返回：优先回退上一页，没有历史记录则回 /v2 */
  const handleBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/v2');
  };

  /** 朗读一段纯文本 */
  const speakRaw = (raw: string) => {
    try {
      if (!raw || !('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(raw);
      u.lang = 'zh-CN';
      u.rate = 0.85;
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  };

  /** 朗读当前卡片正面内容 */
  const speak = () => {
    speakRaw(plainText(frontHtml));
  };

  /** 朗读舞台重点字 */
  const speakKeyword = () => {
    speakRaw(stageKeyword);
  };

  /** 详情卡（原文 + 翻译 + 标签 + 间隔）：看答案与「灯泡」提前查看共用 */
  const detailCard = (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="w-full flex justify-center mt-8"
    >
      <StageCard>
        <div className="mb-4">
          <StageCardLabel>原文</StageCardLabel>
          <StageCardText html={frontHtml} />
        </div>
        <div className="mb-4">
          <StageCardLabel>释义</StageCardLabel>
          <StageCardText html={answerHtml} />
        </div>
        <div>
          <StageCardLabel>翻译</StageCardLabel>
          <StageCardText html={transHtml} />
        </div>
        {card.tags.length > 0 && (
          <div className="flex gap-1.5 mt-4 flex-wrap">
            {card.tags.map(tag => (
              <span key={tag} className="px-2.5 py-1 bg-white/80 text-slate-500 rounded-lg text-xs">{tag}</span>
            ))}
          </div>
        )}
        <div className="mt-4 pt-3 border-t border-slate-200/60 text-xs text-slate-400">
          间隔: {formatInterval(card.interval)}
        </div>
      </StageCard>
    </motion.div>
  );

  return (
    <ImmersiveBackdrop>
      <style>{`
        .blank-slot {
          display:inline-block; min-width:3.2em; margin:0 2px; text-align:center;
          color:#4f46e5; font-weight:800; letter-spacing:2px;
          border-bottom:3px solid #6366f1; line-height:1.1;
        }
      `}</style>

      {/* 铜板飘字：满 10 张成组时后端补发 +5 */}
      <AnimatePresence>
        {coinToast !== null && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -18, scale: 0.95 }}
            transition={{ duration: 0.25 }}
            className="fixed top-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-amber-400/95 text-white text-[15px] font-bold shadow-lg"
          >
            +{coinToast} 铜板
          </motion.div>
        )}
      </AnimatePresence>

      {/* 日上限说明：答对了却没加钱时给出原因，避免被当成系统故障 */}
      <AnimatePresence>
        {capNotice > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="fixed top-36 left-1/2 -translate-x-1/2 z-50 max-w-[92vw] px-4 py-2.5 rounded-2xl bg-slate-800/92 text-white text-[13px] leading-snug text-center shadow-lg backdrop-blur"
          >
            今日学习奖励已达上限（{capNotice} 铜板）
            <span className="block text-[12px] text-white/75 mt-0.5">
              继续学习仍会记入记忆计划，只是不再加铜板
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <StageTopPill
        word={lastReviewed ? lastReviewed.word : null}
        meaning={lastReviewed ? lastReviewed.meaning : ''}
        progress={progress}
        onBack={handleBack}
      />

      <main className="relative z-10 flex flex-col items-center px-4 pt-14 pb-28 overflow-y-auto">
        {/* 进度指示：第 3/10 张 · 阶段 1/2 */}
        <div className="mb-6 flex items-center gap-2">
          <span className="px-3 py-1 rounded-full bg-white/70 text-xs font-medium text-slate-600 shadow-sm">
            第 {currentIdx + 1}/{cards.length} 张 · 阶段 {phase === 'stage1' ? 1 : 2}/2
          </span>
          <span className="text-xs text-slate-500/70">
            {phase === 'stage1' ? '据句选意' : phase === 'stage2' ? '挖空默写' : '看答案'}
          </span>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={`${card.id}-${phase}`}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -24 }}
            transition={{ duration: 0.25 }}
            className="w-full flex flex-col items-center"
          >
            {card.css && <style>{card.css}</style>}

            {/* ── 阶段1 据句选意：重点字 + 发音 + 例句 + 4 个义项选项 ── */}
            {phase === 'stage1' && (
              <>
                {stageKeyword ? (
                  <>
                    <StageBigChar char={stageKeyword} py={stageKeywordPinyin} onSpeak={speakKeyword} />
                    <StageSentence html={frontHtml} source={sourceBook} onSpeak={speak} />
                  </>
                ) : (
                  <div
                    className="study-main text-center text-[1.35rem] leading-relaxed font-bold text-slate-800 font-serif"
                    dangerouslySetInnerHTML={{ __html: renderMarkup(frontHtml) }}
                  />
                )}
                {showDetail && detailCard}
              </>
            )}

            {/* ── 阶段2 挖空默写 ── */}
            {phase === 'stage2' && (
              <div className="w-full flex flex-col items-center">
                <p className="text-xs tracking-[0.3em] text-slate-400 font-medium">补全重点字</p>
                <div
                  className="study-main mt-4 px-4 text-center text-[1.35rem] leading-relaxed font-bold text-slate-800 font-serif"
                  dangerouslySetInnerHTML={{ __html: renderMarkup(blankHtml) }}
                />
                {stage2Correct === null ? (
                  <>
                    <input
                      ref={blankInputRef}
                      autoFocus
                      value={blankInput}
                      onChange={e => setBlankInput(e.target.value)}
                      onCompositionStart={() => { isComposingRef.current = true; }}
                      onCompositionEnd={() => { isComposingRef.current = false; }}
                      onKeyDown={e => {
                        // 输入法组合中（含 keyCode 229）不拦截回车，避免吞掉正在输入的候选字
                        const composing = isComposingRef.current || (e as any).isComposing || (e as any).nativeEvent?.isComposing || (e as any).keyCode === 229;
                        if (e.key === 'Enter' && !composing) handleBlankSubmit();
                      }}
                      maxLength={6}
                      placeholder="输入重点字"
                      aria-label="挖空默写输入重点字"
                      className="mt-8 w-48 text-center text-[2rem] font-bold font-serif text-slate-800 bg-white/70 border-2 border-indigo-300 rounded-2xl py-3 px-4 outline-none focus:border-indigo-500 shadow-sm"
                    />
                    <p className="mt-3 text-xs text-slate-400">按回车提交</p>
                  </>
                ) : null}
                {stage2Correct !== null && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`mt-8 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium text-white shadow-md ${
                      stage2Correct ? 'bg-emerald-400/90' : 'bg-rose-400/90'
                    }`}
                  >
                    {stage2Correct
                      ? <><Check className="w-4 h-4" /> ✓ 正确</>
                      : <><X className="w-4 h-4" /> ✗ 正确应为：{stageKeyword}</>}
                  </motion.div>
                )}
                {showDetail && detailCard}
              </div>
            )}

            {/* ── 看答案阶段 ── */}
            {phase === 'showing' && (
              <>
                {stage2Correct !== null && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`mb-2 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium text-white shadow-md ${
                      stage2Correct ? 'bg-emerald-400/90' : 'bg-rose-400/90'
                    }`}
                  >
                    {stage2Correct
                      ? <><Check className="w-4 h-4" /> ✓ 正确</>
                      : <><X className="w-4 h-4" /> ✗ 正确应为：{stageKeyword}</>}
                  </motion.div>
                )}
                {detailCard}
              </>
            )}
          </motion.div>
        </AnimatePresence>

        {/* 阶段1 选项与判定（放在动画容器外，避免与详情卡重叠抖动） */}
        {phase === 'stage1' && stage1Active && (
          <div className="w-full mt-8 space-y-3">
            {stage1Options.map((opt, i) => (
              <motion.button
                key={opt.label}
                type="button"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => handleStage1Select(opt.label)}
                className={OPTION_BASE}
              >
                {opt.text}
              </motion.button>
            ))}
          </div>
        )}
        {phase === 'stage1' && showMcqResult && (
          <div className="w-full mt-8">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`mx-auto mb-6 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium text-white shadow-md ${
                stage1IsCorrect ? 'bg-emerald-400/90' : 'bg-rose-400/90'
              }`}
            >
              {stage1IsCorrect ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
              {stage1IsCorrect ? '回答正确' : '回答错误'}
            </motion.div>
            <div className="space-y-3">
              {stage1Options.map(opt => (
                <div
                  key={opt.label}
                  className={`${OPTION_SHAPE} ${
                    opt.isCorrect
                      ? OPTION_CORRECT
                      : opt.label === selectedMcq
                        ? OPTION_WRONG
                        : OPTION_DIM
                  }`}
                >
                  {opt.text}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <StageBottomBar
        left={
          <StageToolButton
            label="斩：标记认识"
            onClick={handleZhan}
            disabled={rating !== null}
            className="text-slate-700"
          >
            <span className="text-xl font-bold font-serif leading-none">斩</span>
          </StageToolButton>
        }
        center={
          <StageToolButton
            label={hintUsed ? '已看解析（本题不算对）' : '解析'}
            onClick={() => { setShowDetail(true); setHintUsed(true); }}
            className={hintUsed ? 'text-amber-600' : 'text-slate-600'}
          >
            <Lightbulb className="w-5 h-5" />
          </StageToolButton>
        }
        right={
          <StageToolButton label="朗读" onClick={speak} className="text-slate-600">
            <Volume2 className="w-5 h-5" />
          </StageToolButton>
        }
      >
        <AnimatePresence mode="wait">
          {/* 阶段1 未作答：等待选择义项 */}
          {phase === 'stage1' && !showMcqResult && (
            <motion.p
              key="s1-hint"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="mb-5 text-center text-xs text-slate-400"
            >
              根据例句选出正确的释义
            </motion.p>
          )}

          {/* 阶段1 判定后 → 进入阶段2 默写 */}
          {phase === 'stage1' && showMcqResult && (
            <motion.button
              key="s1-next"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              onClick={handleGoStage2}
              className="w-full mb-5 py-3 text-[15px] rounded-2xl bg-indigo-500/90 hover:bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-500/25 transition-all flex items-center justify-center gap-1.5"
            >
              进入默写 <ChevronRight className="w-4 h-4" />
            </motion.button>
          )}

          {/* 阶段2 默写：提交 */}
          {phase === 'stage2' && stage2Correct === null && (
            <motion.button
              key="s2-submit"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              onClick={handleBlankSubmit}
              disabled={blankInput.trim().length === 0}
              className="w-full mb-5 py-3 text-[15px] rounded-2xl bg-indigo-500/90 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium shadow-lg shadow-indigo-500/25 transition-all"
            >
              提交
            </motion.button>
          )}

          {/* 看答案阶段：下一张 */}
          {phase === 'showing' && (
            <motion.button
              key="next"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              onClick={handleNext}
              className="w-full mb-5 py-3 text-[15px] rounded-2xl bg-indigo-500/90 hover:bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-500/25 transition-all flex items-center justify-center gap-1.5"
            >
              下一张 <ChevronRight className="w-4 h-4" />
            </motion.button>
          )}
        </AnimatePresence>
      </StageBottomBar>
    </ImmersiveBackdrop>
  );
}
