import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { ArrowLeft, CheckCircle2, Brain, ChevronRight, RotateCcw } from 'lucide-react';
import { renderMarkup } from '../lib/markup';

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

type ReviewPhase = 'rating' | 'showing' | 'next';

export default function ReviewPage() {
  const { user, openLoginModal } = useAuth();
  // Non-logged-in skeleton
  if (!user) {
    return (
      <div className="min-h-[calc(100vh-200px)] flex flex-col items-center justify-center text-center px-4">
        <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
          <Brain className="w-10 h-10 text-gray-300" />
        </div>
        <h2 className="text-2xl font-bold text-gray-500 mb-2">请先登录</h2>
        <p className="text-gray-400 mb-6">登录后即可进行复习</p>
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

  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<ReviewPhase>('rating');
  const [rating, setRating] = useState<number | null>(null);
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, known: 0, unknown: 0 });
  const [sessionStart, setSessionStart] = useState(Date.now());

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api.auth.getSettings().catch(() => ({} as Record<string, string>));
      const reviewPerSession = parseInt((s as any).review_per_session) || 20;

      const data = await api.cards.due({
        deckId: deckId ? parseInt(deckId) : undefined,
        limit: reviewPerSession,
      });

      const reviewCards = data.filter((c: ReviewCard) => c.queue >= 2);
      setCards(reviewCards);
      setSessionStats({ reviewed: 0, known: 0, unknown: 0 });
      setCurrentIdx(0);
      setPhase('rating');
      setRating(null);
      setSessionStart(Date.now());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [deckId]);

  useEffect(() => { fetchCards(); }, [fetchCards]);

  const resetCardState = () => {
    setPhase('rating');
    setRating(null);
    setSessionStart(Date.now());
  };

  const handleRate = async (r: number) => {
    if (!cards[currentIdx] || rating !== null) return;
    setRating(r);
    const card = cards[currentIdx];
    const timeMs = Date.now() - sessionStart;

    try {
      await api.cards.answer(card.id, r, timeMs);
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

  const handleNext = () => {
    const wasLastCard = currentIdx >= cards.length - 1;
    setCards(prev => {
      const updated = [...prev];
      updated.splice(currentIdx, 1);
      return updated;
    });
    if (wasLastCard) {
      setCurrentIdx(Math.max(0, currentIdx - 1));
    }
    resetCardState();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (cards.length === 0) {
    const nothingToReview = sessionStats.reviewed === 0;
    return (
      <div className="max-w-lg mx-auto text-center py-16 px-4">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}>
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center mx-auto mb-6 shadow-lg">
            <CheckCircle2 className="w-10 h-10 text-white" />
          </div>
        </motion.div>
        {nothingToReview ? (
          <>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">今日已复习完</h2>
            <p className="text-gray-500 mb-8">请明天再来</p>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">复习完成！</h2>
            <p className="text-gray-500 mb-1">
              已复习 {sessionStats.reviewed} 张 · 认识 {sessionStats.known} · 需复习 {sessionStats.unknown}
            </p>
            <p className="text-gray-400 text-sm mb-8">坚持复习，记忆会越来越牢固</p>
          </>
        )}
        <div className="flex gap-3 justify-center">
          <button onClick={fetchCards} className="btn-primary shadow-md flex items-center gap-2">
            <RotateCcw className="w-4 h-4" /> 继续复习
          </button>
          <button onClick={() => navigate('/')} className="btn-secondary">返回首页</button>
        </div>
      </div>
    );
  }

  const card = cards[currentIdx];
  if (!card) return null;

  return (
    <div className="max-w-2xl mx-auto px-4 pb-32">
      <style>{`.mark-highlight { background: linear-gradient(120deg, #fde68a 0%, #fde68a 40%, #fbbf24 100%); padding: 0 4px; border-radius: 3px; font-weight: 600; }`}</style>
      <style>{`.study-bold { color: #7c3aed; font-weight: 700; background: #f3e8ff; padding: 0 2px; border-radius: 3px; }`}</style>

      {/* Header */}
      <div className="flex items-center justify-between py-4 mb-4">
        <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm">退出</span>
        </button>
        <div className="flex items-center gap-2.5 text-sm">
          <span className="px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1 bg-emerald-50 text-emerald-600">
            <Brain className="w-3.5 h-3.5" />
            复习
          </span>
          <span className="text-gray-400 font-medium">{currentIdx + 1}/{cards.length}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-gray-100 rounded-full mb-6 overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${((currentIdx + 1) / cards.length) * 100}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      {/* Card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={card.id}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -24 }}
          transition={{ duration: 0.25 }}
        >
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 sm:p-8 mb-5 study-card">
            {card.css && <style>{card.css}</style>}

            {/* Front: Question (rating phase) */}
            {phase === 'rating' && (
              <div className="text-center">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">回想含义</p>
                <div className="text-xl sm:text-2xl font-bold text-gray-900 leading-relaxed py-6"
                  dangerouslySetInnerHTML={{ __html: renderMarkup(card.question) }} />
              </div>
            )}

            {/* Back: Answer (showing phase) */}
            {phase === 'showing' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
              >
                <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100 mb-3">
                  <p className="text-xs text-indigo-400 font-medium mb-1">原文</p>
                  <div className="text-base font-semibold text-indigo-900 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: renderMarkup(card.fields?.[0] || card.question) }} />
                </div>
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
                  间隔: {formatInterval(card.interval)}
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Bottom Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-gradient-to-t from-white via-white/95 to-white pt-6 pb-5 px-4 border-t border-gray-100 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
        <div className="max-w-2xl mx-auto">
          {/* Rating phase: 3 rating buttons */}
          {phase === 'rating' && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <p className="text-center text-xs text-gray-400 mb-2">你觉得这张卡片掌握得怎么样？</p>
              <div className="grid grid-cols-3 gap-3">
                <button onClick={() => handleRate(1)}
                  className="flex flex-col items-center py-3.5 px-3 rounded-2xl border-2 border-red-100 bg-red-50 text-red-600 hover:bg-red-100 hover:border-red-200 transition-all">
                  <span className="text-base font-bold">不认识</span>
                  {card.nextStates?.again && (
                    <span className="text-[10px] text-red-400 mt-0.5">{card.nextStates.again.label}</span>
                  )}
                </button>
                <button onClick={() => handleRate(2)}
                  className="flex flex-col items-center py-3.5 px-3 rounded-2xl border-2 border-amber-100 bg-amber-50 text-amber-600 hover:bg-amber-100 hover:border-amber-200 transition-all">
                  <span className="text-base font-bold">模糊</span>
                  {card.nextStates?.hard && (
                    <span className="text-[10px] text-amber-400 mt-0.5">下次{formatInterval(card.nextStates.hard.interval)}</span>
                  )}
                </button>
                <button onClick={() => handleRate(3)}
                  className="flex flex-col items-center py-3.5 px-3 rounded-2xl border-2 border-green-100 bg-green-50 text-green-600 hover:bg-green-100 hover:border-green-200 transition-all">
                  <span className="text-base font-bold">认识</span>
                  {card.nextStates?.good && (
                    <span className="text-[10px] text-green-400 mt-0.5">下次{formatInterval(card.nextStates.good.interval)}</span>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {/* Showing phase: next button */}
          {phase === 'showing' && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <button onClick={handleNext}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-500 text-white font-medium text-base shadow-lg hover:shadow-xl hover:from-emerald-600 hover:to-green-600 transition-all flex items-center justify-center gap-2"
              >
                下一题 <ChevronRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
