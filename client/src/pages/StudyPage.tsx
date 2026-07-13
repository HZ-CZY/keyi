import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { ArrowLeft, CheckCircle2, Check, X, HelpCircle, Brain, ChevronRight } from 'lucide-react';
import { renderMarkup } from '../lib/markup';

interface StudyCard {
  id: number;
  noteId: number;
  deckId: number;
  originalDeckId?: number;
  queue: number;
  due: number;
  interval: number;
  reps: number;
  lapses: number;
  remaining_steps: number;
  question: string;
  answer: string;
  css: string;
  tags: string[];
  notetypeName?: string;
  fieldNames?: string[];
  fields?: string[];
  mcqOptions?: { options: { label: string; text: string; isCorrect: boolean }[]; correctAnswer: string };
  learningStep?: number;
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

export default function StudyPage() {
  const { user, openLoginModal } = useAuth();
  // Non-logged-in skeleton
  if (!user) {
    return (
      <div className="min-h-[calc(100vh-200px)] flex flex-col items-center justify-center text-center px-4">
        <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
          <Brain className="w-10 h-10 text-gray-300" />
        </div>
        <h2 className="text-2xl font-bold text-gray-500 mb-2">请先登录</h2>
        <p className="text-gray-400 mb-6">登录后即可开始学习</p>
        <button
          onClick={openLoginModal}
          className="px-8 py-3 rounded-full bg-gradient-to-r from-primary-600 to-indigo-600 text-white font-medium shadow-soft-lg hover:shadow-xl hover:translate-y-[-2px] transition-all duration-250 ease-premium"
        >
          登录
        </button>
      </div>
    );
  }
  const { deckId } = useParams();
  const navigate = useNavigate();
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionStart, setSessionStart] = useState(Date.now());
  const [rating, setRating] = useState<number | null>(null);
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, total: 0, mcqPromoted: 0 });
  const [selectedMcq, setSelectedMcq] = useState<string | null>(null);
  const [showMcqResult, setShowMcqResult] = useState(false);
  const mcqAutoRating = useRef<number>(0);
  const [autoFlipCountdown, setAutoFlipCountdown] = useState<number | null>(null);
  const autoFlipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Load settings fresh inside fetchCards to avoid race conditions
  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      // Always fetch latest settings before loading cards
      const s = await api.auth.getSettings().catch(() => ({} as Record<string, string>));
      const studyPerSession = parseInt((s as any).study_per_session) || 20;

      const data = await api.cards.due({
        deckId: deckId ? parseInt(deckId) : undefined,
        limit: studyPerSession,
      });

      // Only keep new cards (queue=0) for learning
      const newCards = data.filter((c: StudyCard) => c.queue === 0);

      // Fetch distractor pool: original deck (primary) + current deck + all cards (fallback)
      let originalDeckPool: { id: number; text: string; notetype: string }[] = [];
      let currentDeckPool: { id: number; text: string; notetype: string }[] = [];
      let allCardsPool: { id: number; text: string; notetype: string }[] = [];

      // Collect unique original deck IDs from cards
      const originalDeckIds = [...new Set(newCards.map(c => c.originalDeckId).filter(Boolean))];
      
      // Fetch from original small decks
      for (const odId of originalDeckIds) {
        try {
          const pool = await api.cards.distractors(odId!);
          originalDeckPool = [...originalDeckPool, ...pool.map((item: any, idx: number) => ({
            id: idx,
            text: item.text,
            notetype: item.notetype || '',
          }))];
        } catch { /* ignore */ }
      }

      // Fetch from current deck (if viewing a specific deck)
      if (deckId) {
        try {
          const pool = await api.cards.distractors(parseInt(deckId));
          currentDeckPool = pool.map((item: any, idx: number) => ({
            id: idx + 50000,
            text: item.text,
            notetype: item.notetype || '',
          }));
        } catch { /* ignore */ }
      }

      // Fetch from all user's cards (for fallback)
      try {
        const allPool = await api.cards.allDistractors();
        allCardsPool = allPool.map((item: any, idx: number) => ({
          id: idx + 100000,
          text: item.text,
          notetype: item.notetype || '',
        }));
      } catch { /* ignore */ }

      // Merge pools with priority: original > current > all
      const seen = new Set<string>();
      const mergedPool: { id: number; text: string; notetype: string }[] = [];
      for (const pool of [originalDeckPool, currentDeckPool, allCardsPool]) {
        for (const item of pool) {
          if (!seen.has(item.text)) {
            seen.add(item.text);
            mergedPool.push(item);
          }
        }
      }

      // Fallback: also include session cards in the pool
      if (mergedPool.length < 10) {
        const sessionPool = newCards
          .map((c: StudyCard, idx: number) => ({ id: idx, text: c.fields?.[1] || c.fields?.[0] || c.answer || '', notetype: c.notetypeName || '' }))
          .filter(a => a.text && a.text.length > 0 && a.text.length < 80);
        mergedPool.push(...sessionPool);
      }

      // Fisher-Yates shuffle helper
      const shuffle = <T,>(arr: T[]): T[] => {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      };

      const enriched = newCards.map((card: StudyCard) => {
        // New cards start at learning step 0
        card.learningStep = 0;

        if (!card.mcqOptions) {
          const correctText = card.fields?.[1] || card.fields?.[0] || card.answer || '';
          const correctLen = correctText.length;

          // Filter out self, deduplicate by text
          const seen = new Set<string>([correctText]);
          const candidates = mergedPool.filter(a => {
            if (seen.has(a.text)) return false;
            seen.add(a.text);
            return true;
          });

          // Score each candidate: prefer similar length + same notetype
          const scored = candidates.map(a => {
            let score = Math.abs(a.text.length - correctLen); // lower = more similar
            if (a.notetype === card.notetypeName) score -= 5; // bonus for same type
            return { ...a, score };
          });

          // Shuffle first to break ties randomly, then sort by score
          const shuffledCandidates = shuffle(scored).sort((a, b) => a.score - b.score);

          // Pick 3 random distractors from top candidates (not always the same 3)
          const topN = Math.min(shuffledCandidates.length, 8);
          const pool = shuffle(shuffledCandidates.slice(0, topN));
          const distractors = pool.slice(0, 3).map(c => c.text);

          // Fallback if not enough
          const fallbacks = shuffle(['以上都不对', '不确定', '忘记了', '无此选项', '其他答案', '暂无答案']);
          const allDistractors = [...distractors];
          let fi = 0;
          while (allDistractors.length < 3 && fi < fallbacks.length) {
            if (!allDistractors.includes(fallbacks[fi])) {
              allDistractors.push(fallbacks[fi]);
            }
            fi++;
          }

          // Build MCQ options
          const options = [
            { label: 'A', text: correctText, isCorrect: true },
            ...allDistractors.map((text: string, i: number) => ({
              label: String.fromCharCode(66 + i),
              text,
              isCorrect: false,
            })),
          ];
          const shuffledOptions = shuffle(options);
          const correctLabel = shuffledOptions.find(o => o.isCorrect)!.label;
          card.mcqOptions = {
            options: shuffledOptions,
            correctAnswer: correctLabel,
          };
        }
        return card;
      });

      setCards(enriched);
      setSessionStats({ reviewed: 0, total: newCards.length, mcqPromoted: 0 });
      setCurrentIdx(0);
      setIsFlipped(false);
      setSessionStart(Date.now());
      setRating(null);
      setSelectedMcq(null);
      setShowMcqResult(false);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [deckId]);

  useEffect(() => { fetchCards(); }, [fetchCards]);

  const resetCardState = () => {
    setIsFlipped(false);
    setRating(null);
    setSelectedMcq(null);
    setShowMcqResult(false);
    mcqAutoRating.current = 0;
    setSessionStart(Date.now());
    setAutoFlipCountdown(null);
    if (autoFlipTimerRef.current) {
      clearInterval(autoFlipTimerRef.current);
      autoFlipTimerRef.current = null;
    }
  };

  const handleManualFlip = () => {
    setAutoFlipCountdown(null);
    if (autoFlipTimerRef.current) {
      clearInterval(autoFlipTimerRef.current);
      autoFlipTimerRef.current = null;
    }
    setIsFlipped(true);
  };

  // Auto-flip countdown for review phase
  useEffect(() => {
    if (autoFlipTimerRef.current) {
      clearInterval(autoFlipTimerRef.current);
      autoFlipTimerRef.current = null;
    }
    setAutoFlipCountdown(null);

    if (!cards[currentIdx] || loading || cards.length === 0) return;
    if (isFlipped || rating !== null || showMcqResult) return;

    // Only auto-flip for step-0 non-MCQ cards
    const currentCard = cards[currentIdx];
    const isStep0NoMcq = currentCard.queue === 0 && (currentCard.learningStep ?? -1) === 0 && !(currentCard.mcqOptions && currentCard.mcqOptions.options.length > 0);
    if (!isStep0NoMcq) return;

    let countdown = 5;
    setAutoFlipCountdown(countdown);
    autoFlipTimerRef.current = setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        clearInterval(autoFlipTimerRef.current!);
        autoFlipTimerRef.current = null;
        setAutoFlipCountdown(null);
        setIsFlipped(true);
      } else {
        setAutoFlipCountdown(countdown);
      }
    }, 1000);

    return () => {
      if (autoFlipTimerRef.current) {
        clearInterval(autoFlipTimerRef.current);
        autoFlipTimerRef.current = null;
      }
    };
  }, [currentIdx, isFlipped, rating, showMcqResult, cards[currentIdx]?.id]);

  const handleRecallNext = () => {
    if (!cards[currentIdx] || rating === null) return;
    const isCorrect = rating >= 3;
    const INTERLEAVE_OFFSET = 3;

    if (isCorrect) {
      setCards(prev => {
        const updated = [...prev];
        const curCard = updated[currentIdx];
        const curStep = curCard.remaining_steps || 0;

        if (curStep >= 2) {
          // Step 3 完成 → 毕业，从队列移除
          updated.splice(currentIdx, 1);
          return updated;
        } else {
          // 进入下一阶段，重新插入到后面穿插
          const nextStep = curStep + 1;
          curCard.remaining_steps = nextStep;
          curCard.learningStep = nextStep;
          updated.splice(currentIdx, 1);
          const insertAt = Math.min(currentIdx + INTERLEAVE_OFFSET, updated.length);
          updated.splice(insertAt, 0, curCard);
          return updated;
        }
      });
    } else {
      // 答错 → 重置到第一步，重新插入到后面穿插
      setCards(prev => {
        const updated = [...prev];
        const curCard = updated[currentIdx];
        curCard.remaining_steps = 0;
        curCard.learningStep = 0;
        updated.splice(currentIdx, 1);
        const insertAt = Math.min(currentIdx + INTERLEAVE_OFFSET, updated.length);
        updated.splice(insertAt, 0, curCard);
        return updated;
      });
    }
    resetCardState();
  };

  const handleRate = async (r: number) => {
    if (!cards[currentIdx] || rating !== null) return;
    setRating(r);
    const card = cards[currentIdx];
    const timeMs = Date.now() - sessionStart;
    const isCorrect = r >= 3;
    try {
      await api.cards.answer(card.id, r, timeMs);
      setSessionStats(s => ({ ...s, reviewed: s.reviewed + 1 }));
    } catch (err) {
      console.error('Failed to save answer:', err);
    }

    // Recall steps: show full card, wait for "下一题" click
    const isRecallStep = (card.queue === 0 && (card.learningStep === 1 || card.learningStep === 2));
    // Step 0 without MCQ: also wait for "下一题" after rating
    const isStep0Recall = card.queue === 0 && card.learningStep === 0 && !hasMcqOptions;
    if (isRecallStep || isStep0Recall) {
      setIsFlipped(true);
      return;
    }

    const INTERLEAVE_OFFSET = 3;

    if (isCorrect) {
      setTimeout(() => {
        setCards(prev => {
          const updated = [...prev];
          const curCard = updated[currentIdx];
          const curStep = curCard.remaining_steps || 0;

          if (curStep >= 2) {
            // Step 3 完成 → 毕业，从队列移除
            updated.splice(currentIdx, 1);
            if (updated.length === 0) return [];
            // currentIdx 不变，自动指向下一个卡片
            return updated;
          } else {
            // 进入下一阶段，重新插入到后面穿插
            const nextStep = curStep + 1;
          curCard.remaining_steps = nextStep;
          curCard.learningStep = nextStep;
          // 从当前位置移除
            updated.splice(currentIdx, 1);
            // 间隔 offset 个位置后插入
            const insertAt = Math.min(currentIdx + INTERLEAVE_OFFSET, updated.length);
            updated.splice(insertAt, 0, curCard);
            return updated;
          }
        });
        resetCardState();
      }, 500);
    } else {
      // 答错 → 重置到第一步，重新插入到后面穿插
      setTimeout(() => {
        setCards(prev => {
          const updated = [...prev];
          const curCard = updated[currentIdx];
          curCard.remaining_steps = 0;
          curCard.learningStep = 0;
          updated.splice(currentIdx, 1);
          const insertAt = Math.min(currentIdx + 3, updated.length);
          updated.splice(insertAt, 0, curCard);
          return updated;
        });
        resetCardState();
      }, 500);
    }
  };

  const handleMcqSelect = (label: string) => {
    if (showMcqResult || isFlipped) return;
    const currentCard = cards[currentIdx];
    const mcq = currentCard?.mcqOptions;
    const correctAnswer = mcq?.correctAnswer || '';
    const isCorrect = label === correctAnswer;
    mcqAutoRating.current = isCorrect ? 3 : 1;

    setSelectedMcq(label);
    setShowMcqResult(true);
    // Auto-flip to show the answer/back side
    setTimeout(() => setIsFlipped(true), 600);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  // Session complete
  if (cards.length === 0) {
    return (
      <div className="max-w-lg mx-auto text-center py-16 px-4">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}>
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center mx-auto mb-6 shadow-lg">
            <CheckCircle2 className="w-10 h-10 text-white" />
          </div>
        </motion.div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">今日任务完成！</h2>
        <p className="text-gray-500 mb-1">已学习 {sessionStats.reviewed} 张卡片</p>
        <p className="text-gray-400 text-sm mb-8">坚持练习，记忆会越来越牢固</p>
        <div className="flex gap-3 justify-center">
          <button onClick={fetchCards} className="btn-primary shadow-md">继续学习</button>
          <button onClick={() => navigate('/')} className="btn-secondary">返回首页</button>
        </div>
      </div>
    );
  }

  const card = cards[currentIdx];
  if (!card) return null;

  const learningStep = card.learningStep ?? 0;
  const isMcqStep = learningStep === 0;
  const isRecallAnswerStep = learningStep === 2;
  const isRecallQuestionStep = learningStep === 1;
  const isRecallStep = isRecallAnswerStep || isRecallQuestionStep;
  const streak = card.remaining_steps || 0;
  const mcqOptions = card.mcqOptions;
  const hasMcqOptions = isMcqStep && mcqOptions && mcqOptions.options.length > 0;
  const correctAnswer = mcqOptions?.correctAnswer || '';
  const isCorrect = selectedMcq === correctAnswer;

  const stepLabels = ['选择题', '回想原句', '回想答案'];
  const stepLabel = learningStep >= 0 && learningStep <= 2 ? stepLabels[learningStep] : '';

  return (
    <div className="max-w-2xl mx-auto px-4 pb-32">
      <style>{`.mark-highlight { background: linear-gradient(120deg, #fde68a 0%, #fde68a 40%, #fbbf24 100%); padding: 0 4px; border-radius: 3px; font-weight: 600; }`}</style>
      <style>{`.study-bold { color: #7c3aed; font-weight: 700; background: #f3e8ff; padding: 0 2px; border-radius: 3px; }`}</style>
      <style>{`.study-card b { color: #7c3aed; font-weight: 700; background: #f3e8ff; padding: 0 2px; border-radius: 3px; }`}</style>

      {/* ── Header ── */}
      <div className="flex items-center justify-between py-4 mb-4">
        <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm">退出</span>
        </button>
        <div className="flex items-center gap-2.5 text-sm">
          <span className="px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1 bg-indigo-50 text-indigo-600">
            <Brain className="w-3.5 h-3.5" />
            {stepLabel || '学习'}
          </span>
          <span className="text-gray-400 font-medium">{currentIdx + 1}/{cards.length}</span>
        </div>
      </div>

      {/* ── Learning Progress (3 steps) ── */}
      <div className="mb-5">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-gray-400 font-medium">
              第 <strong className="text-indigo-500">{learningStep + 1}</strong>/3 步 · <strong className="text-indigo-500">{stepLabel}</strong>
            </span>
            <span className="text-gray-400">3步通过 → 进入复习</span>
          </div>
          {/* 3-segment progress bar */}
          <div className="w-full h-8 bg-gray-100 rounded-xl overflow-hidden flex shadow-inner">
            {/* Segment 1: 选择题 */}
            <motion.div
              initial={{ width: '33.33%' }}
              className={`flex items-center justify-center text-[10px] font-bold transition-all duration-300 ${
                learningStep >= 0
                  ? learningStep === 0
                    ? 'bg-gradient-to-r from-indigo-400 to-indigo-500 text-white shadow-sm'
                    : 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white'
                  : 'bg-gray-100 text-gray-300'
              }`}
              style={{ width: '33.33%' }}
            >
              ①选择题
            </motion.div>
            {/* Segment 2: 回想原句 */}
            <motion.div
              className={`flex items-center justify-center text-[10px] font-bold transition-all duration-300 ${
                learningStep >= 1
                  ? learningStep === 1
                    ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-white shadow-sm'
                    : 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white'
                  : 'bg-gray-100 text-gray-300'
              }`}
              style={{ width: '33.33%' }}
            >
              ②回想原句
            </motion.div>
            {/* Segment 3: 回想答案 */}
            <motion.div
              className={`flex items-center justify-center text-[10px] font-bold transition-all duration-300 ${
                learningStep >= 2
                  ? learningStep === 2
                    ? 'bg-gradient-to-r from-emerald-400 to-emerald-500 text-white shadow-sm'
                    : 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white'
                  : 'bg-gray-100 text-gray-300'
              }`}
              style={{ width: '33.34%' }}
            >
              ③回想答案
            </motion.div>
          </div>
        </div>

      {/* ── Main Card ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={card.id}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -24 }}
          transition={{ duration: 0.25 }}
        >
          {/* Card Body */}
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 sm:p-8 mb-5 study-card">
            {card.css && <style>{card.css}</style>}

            {/* ═══ MCQ Phase: Show options first ═══ */}
            {hasMcqOptions && !isFlipped && !showMcqResult && (
              <div>
                <div className="text-center mb-6">
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">请选择正确答案</p>
                  <div className="text-lg sm:text-xl font-bold text-gray-900 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: renderMarkup(card.fields?.[0] || card.question || '') }} />
                </div>
                <div className="space-y-2.5">
                  {mcqOptions.options.map((opt, i) => (
                    <motion.button
                      key={opt.label}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06 }}
                      onClick={() => handleMcqSelect(opt.label)}
                      className="w-full flex items-center gap-3 p-3.5 sm:p-4 rounded-2xl border-2 border-gray-100 bg-white hover:border-indigo-200 hover:bg-indigo-50/30 transition-all text-left group"
                    >
                      <span className="w-8 h-8 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center font-bold text-sm text-gray-500 group-hover:border-indigo-200 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-all flex-shrink-0">
                        {opt.label}
                      </span>
                      <span className="text-sm sm:text-base text-gray-700 leading-relaxed">{opt.text}</span>
                    </motion.button>
                  ))}
                </div>
              </div>
            )}

            {/* ═══ MCQ Result feedback ═══ */}
            {hasMcqOptions && showMcqResult && !isFlipped && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center"
              >
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium mb-5 ${
                  isCorrect ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {isCorrect ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                  {isCorrect ? '回答正确！' : '回答错误'}
                </div>
                <div className="text-lg sm:text-xl font-bold text-gray-900 mb-4 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: renderMarkup(card.fields?.[0] || card.question || '') }} />
                <div className="space-y-2">
                  {mcqOptions.options.map(opt => (
                    <div key={opt.label}
                      className={`flex items-center gap-3 p-3 sm:p-3.5 rounded-2xl border-2 text-left transition-all ${
                        opt.isCorrect
                          ? 'bg-green-50 border-green-300'
                          : opt.label === selectedMcq
                            ? 'bg-red-50 border-red-200'
                            : 'bg-gray-50 border-gray-100 opacity-50'
                      }`}
                    >
                      <span className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0 ${
                        opt.isCorrect
                          ? 'bg-green-100 text-green-700'
                          : opt.label === selectedMcq
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-400'
                      }`}>
                        {opt.isCorrect ? <Check className="w-4 h-4" /> : opt.label === selectedMcq ? <X className="w-4 h-4" /> : opt.label}
                      </span>
                      <span className={`text-sm sm:text-base leading-relaxed ${
                        opt.isCorrect ? 'text-green-800 font-medium' : 'text-gray-500'
                      }`}>{opt.text}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ═══ 回想答案 phase ═══ */}
            {isRecallAnswerStep && (
              <div className="text-center">
                <p className="text-xs text-indigo-500 uppercase tracking-wide mb-4 font-medium">
                  看原句，回想答案
                </p>
                <div className="mb-4 p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                  <p className="text-xs text-indigo-500 font-medium mb-2">原句</p>
                  <div className="text-lg font-bold text-indigo-900 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: renderMarkup(card.fields?.[0] || card.question) }} />
                </div>

                {rating === null && (
                  <div className="text-sm text-gray-400 leading-relaxed px-4 py-6 border-2 border-dashed border-gray-200 rounded-2xl">
                    你能回想出对应的答案吗？
                  </div>
                )}

                {rating !== null && isFlipped && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="mt-4 p-4 bg-green-50 rounded-2xl border border-green-100"
                  >
                    <p className="text-xs text-green-500 font-medium mb-2">答案</p>
                    <div className="text-lg font-bold text-green-900 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMarkup(card.answer) }} />
                    <div className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                      rating >= 3 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {rating >= 3 ? '✓ 认识' : '✗ 不认识'}
                    </div>
                  </motion.div>
                )}
              </div>
            )}

            {/* ═══ 回想原句 phase ═══ */}
            {isRecallQuestionStep && (
              <div className="text-center">
                <p className="text-xs text-amber-500 uppercase tracking-wide mb-4 font-medium">
                  看答案，回想原句
                </p>
                <div className="mb-4 p-4 bg-amber-50 rounded-2xl border border-amber-100">
                  <p className="text-xs text-amber-500 font-medium mb-2">答案</p>
                  <div className="text-lg font-bold text-amber-900 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: renderMarkup(card.fields?.[1] || card.answer || '') }} />
                </div>

                {rating === null && (
                  <div className="text-sm text-gray-400 leading-relaxed px-4 py-6 border-2 border-dashed border-gray-200 rounded-2xl">
                    你能回想出对应的原句吗？
                  </div>
                )}

                {rating !== null && isFlipped && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="mt-4 p-4 bg-indigo-50 rounded-2xl border border-indigo-100"
                  >
                    <p className="text-xs text-indigo-500 font-medium mb-2">原句</p>
                    <div className="text-lg font-bold text-indigo-900 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMarkup(card.fields?.[0] || card.question) }} />
                    <div className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                      rating >= 3 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {rating >= 3 ? '✓ 认识' : '✗ 不认识'}
                    </div>
                  </motion.div>
                )}
              </div>
            )}

            {/* ═══ Flipped: Show answer (MCQ result) ═══ */}
            {((isFlipped && !isRecallStep) || (!hasMcqOptions && !isRecallStep && !isFlipped)) && (
              <div>
                {/* Front / Question (shown when not flipped for regular cards) */}
                {!hasMcqOptions && !isFlipped && (
                  <div>
                    <div className="text-center mb-6">
                      <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">回想含义</p>
                    </div>
                    <div className="text-xl sm:text-2xl font-bold text-gray-900 leading-relaxed text-center py-6"
                      dangerouslySetInnerHTML={{ __html: renderMarkup(card.question) }}
                    />

                  </div>
                )}

                {/* Answer Side */}
                {isFlipped && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2 }}
                  >
                    {hasMcqOptions && (
                      <div className="p-4 bg-green-50 rounded-2xl border border-green-100 mb-4">
                        <p className="text-xs text-green-500 font-medium mb-1">正确答案</p>
                        <p className="text-green-800 font-semibold" dangerouslySetInnerHTML={{ __html: renderMarkup(mcqOptions.options.find(o => o.isCorrect)?.text || correctAnswer) }} />
                      </div>
                    )}
                    {/* 原文 */}
                    <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100 mb-3">
                      <p className="text-xs text-indigo-400 font-medium mb-1">原文</p>
                      <div className="text-base font-semibold text-indigo-900 leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: renderMarkup(card.fields?.[0] || card.question) }} />
                    </div>
                    {/* 翻译/答案 */}
                    <div className="p-3 bg-green-50 rounded-xl border border-green-100">
                      <p className="text-xs text-green-400 font-medium mb-1">翻译</p>
                      <div className="text-base font-semibold text-green-900 leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: renderMarkup(card.fields?.[2] || card.fields?.[1] || card.answer) }} />
                    </div>
                    {card.tags.length > 0 && (
                      <div className="flex gap-1.5 mt-4 flex-wrap">
                        {card.tags.map(tag => (
                          <span key={tag} className="px-2.5 py-1 bg-gray-100 text-gray-500 rounded-lg text-xs">{tag}</span>
                        ))}
                      </div>
                    )}
                    <div className="mt-4 pt-3 border-t border-gray-50 text-xs text-gray-400">
                      学习中 (第{learningStep + 1}/3步)
                    </div>
                  </motion.div>
                )}

              </div>
            )}
          </div>

        </motion.div>
      </AnimatePresence>

      {/* ═══ Fixed Bottom Action Bar ═══ */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-gradient-to-t from-white via-white/95 to-white pt-6 pb-5 px-4 border-t border-gray-100 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
        <div className="max-w-2xl mx-auto">
          {/* Step 1 (MCQ): choose answer, or show result */}
          {isMcqStep && !showMcqResult && (
            /* MCQ options already rendered in card body - no bottom button needed */
            null
          )}

          {/* Step 0 (MCQ fallback): Show answer button when no MCQ options */}
          {learningStep === 0 && !hasMcqOptions && !isFlipped && (
            <button onClick={handleManualFlip}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-medium text-base shadow-lg hover:shadow-xl hover:from-indigo-600 hover:to-purple-600 transition-all flex items-center justify-center gap-2"
            >
              显示答案
              {autoFlipCountdown !== null && (
                <span className="text-sm text-white/70 font-normal">({autoFlipCountdown}s)</span>
              )}
            </button>
          )}

          {/* Step 0 (MCQ fallback): Rating after flip */}
          {learningStep === 0 && !hasMcqOptions && isFlipped && rating === null && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <p className="text-center text-xs text-gray-400 mb-2">你回想对了吗？</p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => handleRate(1)}
                  className="flex flex-col items-center py-4 rounded-2xl border-2 border-red-100 bg-red-50 text-red-600 hover:bg-red-100 hover:border-red-200 transition-all">
                  <span className="text-base font-bold">没回想起来</span>
                  <span className="text-[10px] text-red-400 mt-0.5">重新学习</span>
                </button>
                <button onClick={() => handleRate(3)}
                  className="flex flex-col items-center py-4 rounded-2xl border-2 border-green-100 bg-green-50 text-green-600 hover:bg-green-100 hover:border-green-200 transition-all">
                  <span className="text-base font-bold">回想正确</span>
                  <span className="text-[10px] text-green-400 mt-0.5">进入下一步</span>
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 0 (MCQ fallback): Next button after rating */}
          {learningStep === 0 && !hasMcqOptions && isFlipped && rating !== null && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <button onClick={handleRecallNext}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-medium text-base shadow-lg hover:shadow-xl hover:from-indigo-600 hover:to-purple-600 transition-all flex items-center justify-center gap-2"
              >
                下一题 <ChevronRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {/* Step 2 & 3: 认识/不认识 buttons (before rating) */}
          {(isRecallAnswerStep || isRecallQuestionStep) && rating === null && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <p className="text-center text-xs text-gray-400 mb-2">你能回想出来吗？</p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => handleRate(1)}
                  className="flex flex-col items-center py-4 rounded-2xl border-2 border-red-100 bg-red-50 text-red-600 hover:bg-red-100 hover:border-red-200 transition-all">
                  <span className="text-base font-bold">不认识</span>
                  <span className="text-[10px] text-red-400 mt-0.5">回到第一步重新答</span>
                </button>
                <button onClick={() => handleRate(3)}
                  className="flex flex-col items-center py-4 rounded-2xl border-2 border-green-100 bg-green-50 text-green-600 hover:bg-green-100 hover:border-green-200 transition-all">
                  <span className="text-base font-bold">认识</span>
                  <span className="text-[10px] text-green-400 mt-0.5">进入下一步</span>
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 2 & 3: 下一题 button (after rating) */}
          {(isRecallAnswerStep || isRecallQuestionStep) && rating !== null && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <button onClick={handleRecallNext}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-medium text-base shadow-lg hover:shadow-xl hover:from-indigo-600 hover:to-purple-600 transition-all flex items-center justify-center gap-2"
              >
                下一题 <ChevronRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {/* MCQ: 下一题 button after answered + flipped */}
          {hasMcqOptions && showMcqResult && isFlipped && rating === null && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <button onClick={() => handleRate(mcqAutoRating.current)}
                className={`w-full py-4 rounded-2xl font-medium text-base shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 ${
                  mcqAutoRating.current === 3
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:from-indigo-600 hover:to-purple-600'
                    : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600'
                }`}
              >
                {'下一题'} <ChevronRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}

        </div>
      </div>
    </div>
  );
}
