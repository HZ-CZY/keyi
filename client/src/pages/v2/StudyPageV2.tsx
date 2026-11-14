import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { CheckCircle2, Check, X, Brain, ChevronRight, ChevronLeft, MoreHorizontal, Volume2, Lightbulb, BookOpen, BookOpenText, Star } from 'lucide-react';
import { renderMarkup } from '../../lib/markup';
import V2PageShell from './components/V2PageShell';
import StudyLoadingScreen from './components/StudyLoadingScreen';
import {
  StageTopPill,
  StageBottomBar,
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
  /** 阶段2「据义选句」的句子选项（A-D），text 为原句纯文本 */
  sentenceOptions?: { label: string; text: string; isCorrect: boolean }[];
  /** 阶段2「据义选句」的正确选项标签 */
  sentenceCorrectLabel?: string;
  /** 阶段3「义意速判」展示的义项文本 */
  judgeMeaning?: string;
  /** 阶段3「义意速判」展示的义项是否就是本卡正确释义 */
  judgeIsCorrect?: boolean;
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

// Extract the bold keyword (重点字) from card front text, e.g. "**爱**其子" or "今其智<b>**乃**</b>反不能也" → "爱" / "乃"
function extractKeywordFromFront(front: string): string | null {
  if (!front) return null;
  const m = front.match(/\*\*([^*]+)\*\*/);
  if (!m) return null;
  const kw = m[1].replace(/<[^>]+>/g, '').trim();
  return kw && kw.length >= 1 && kw.length <= 6 ? kw : null;
}

// Strip markdown/html → plain text (for TTS)
function plainText(s: string): string {
  return (s || '').replace(/\*\*/g, '').replace(/<[^>]+>/g, '').trim();
}

export default function StudyPageV2() {
  const { user, openLoginModal } = useAuth();
  // Non-logged-in skeleton
  if (!user) {
    return (
      <V2PageShell title="学习">
        <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
          <div className="w-20 h-20 mx-auto mb-5 rounded-3xl bg-white shadow-md flex items-center justify-center">
            <Brain className="w-10 h-10 text-blue-400" />
          </div>
          <h2 className="text-2xl font-bold text-slate-700 mb-2">请先登录</h2>
          <p className="text-slate-400 mb-6">登录后即可开始学习</p>
          <button
            onClick={openLoginModal}
            className="px-8 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium shadow-md hover:shadow-lg hover:translate-y-[-1px] transition-all"
          >
            登录
          </button>
        </div>
      </V2PageShell>
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
  /* 【2026-10-22】本题是否点开过「解析」：看过则作答不算对（rating 强制为 1），
     否则学生可以先翻解析再作答，把「掌握」和铜板刷出来。 */
  const [hintUsed, setHintUsed] = useState(false);
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, total: 0, mcqPromoted: 0 });
  const [selectedMcq, setSelectedMcq] = useState<string | null>(null);
  const [showMcqResult, setShowMcqResult] = useState(false);
  const mcqAutoRating = useRef<number>(0);
  // 客观题（三阶段）本次作答是否正确；「下一题」用它决定提交给后端的 rating
  const [lastMcqCorrect, setLastMcqCorrect] = useState<boolean | null>(null);
  const [autoFlipCountdown, setAutoFlipCountdown] = useState<number | null>(null);
  const autoFlipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Extra UI state (v3 immersive style)
  const [showMenu, setShowMenu] = useState(false);
  // [2026-10-25] 单词本收藏状态
  const [favorited, setFavorited] = useState(false);
  useEffect(() => {
    const cid = cards[currentIdx]?.id;
    if (!cid) return;
    api.wordbook.isFavorite(cid).then(r => setFavorited(!!r.favorited)).catch(() => {});
  }, [cards, currentIdx]);
  const [showAnalysis, setShowAnalysis] = useState(false);
  // 真正学过的上一张卡（学习是穿插式的，不能靠 currentIdx-1 取）
  // word = 重点字（extractKeywordFromFront(fields[0])），meaning = 义项纯文本（fields[1]）
  const [lastStudied, setLastStudied] = useState<{ word: string; meaning: string } | null>(null);
  // 本次会话累计完成的学习步骤（每张卡需 3 步毕业），单调不减 → 进度条只进不退
  const [doneSteps, setDoneSteps] = useState(0);
  const [loaderPhase, setLoaderPhase] = useState<'active' | 'done' | 'gone'>('active');
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
      let allCardsPool: { id: number; text: string; notetype: string; keyword: string; front: string }[] = [];
      // Keyword pools: 重点字卡组 — group answer texts by bold keyword (e.g. **爱**) in the front field
      const keywordPools = new Map<string, string[]>();
      // 句子池（阶段2「据义选句」用）：按重点字分组存原句纯文本
      const keywordSentencePools = new Map<string, string[]>();

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
          keyword: item.keyword || '',
          front: item.front || '',
        }));
        // Build keyword pools from the full card pool (same logic as server-side /cards/due)
        for (const item of allCardsPool) {
          if (!item.keyword) continue;
          if (!keywordPools.has(item.keyword)) keywordPools.set(item.keyword, []);
          const arr = keywordPools.get(item.keyword)!;
          if (arr.length < 30 && !arr.includes(item.text)) arr.push(item.text);
          // 同一个重点字下的原句池（据义选句题型用）
          const sentence = plainText(item.front);
          if (sentence && sentence.length >= 4 && sentence.length <= 60) {
            if (!keywordSentencePools.has(item.keyword)) keywordSentencePools.set(item.keyword, []);
            const sArr = keywordSentencePools.get(item.keyword)!;
            if (sArr.length < 30 && !sArr.includes(sentence)) sArr.push(sentence);
          }
        }
      } catch { /* ignore */ }

      // 全局句子池（同重点字句子不足时的兜底）
      const globalSentencePool = [...new Set(
        allCardsPool.map(i => plainText(i.front)).filter(s => s.length >= 4 && s.length <= 60)
      )];
      // 全局义项池（义意速判取错误义项时的兜底）
      const globalMeaningPool = [...new Set(allCardsPool.map(i => i.text).filter(t => !!t))];

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
          const correctText = card.fields?.[1] || card.fields?.[0] || '';

          // Same distractor logic as server-side /cards/due inline generator:
          // pick 3 from same-keyword group (重点字卡组) first, then original small deck,
          // then current deck, then all cards
          const cardKeyword = extractKeywordFromFront(card.fields?.[0] || '');
          const keywordPool = cardKeyword ? (keywordPools.get(cardKeyword) || []) : [];
          const seen = new Set<string>([correctText]);
          const pickDistractors = (pool: string[], count: number): string[] => {
            const picked: string[] = [];
            for (const text of pool) {
              if (picked.length >= count) break;
              if (!seen.has(text) && text.length > 0 && text.length < 100) {
                seen.add(text);
                picked.push(text);
              }
            }
            return picked;
          };

          let distractors = pickDistractors(shuffle(keywordPool), 3);
          if (distractors.length < 3) {
            distractors = [...distractors, ...pickDistractors(shuffle(originalDeckPool.map(i => i.text)), 3 - distractors.length)];
          }
          if (distractors.length < 3) {
            distractors = [...distractors, ...pickDistractors(shuffle(currentDeckPool.map(i => i.text)), 3 - distractors.length)];
          }
          if (distractors.length < 3) {
            distractors = [...distractors, ...pickDistractors(shuffle(allCardsPool.map(i => i.text)), 3 - distractors.length)];
          }
          while (distractors.length < 3) {
            distractors.push(`其他答案 ${distractors.length + 1}`);
          }

          // Build MCQ options: correct + 3 distractors, shuffle, assign A-D
          const allTexts = [correctText, ...distractors];
          const shuffledTexts = shuffle(allTexts);
          const labels = ['A', 'B', 'C', 'D'];
          const correctLabel = labels[shuffledTexts.indexOf(correctText)];
          card.mcqOptions = {
            options: shuffledTexts.map((text: string, i: number) => ({
              label: labels[i],
              text,
              isCorrect: labels[i] === correctLabel,
            })),
            correctAnswer: correctLabel,
          };
        }

        // ── 阶段2「据义选句」：正确句 = 本卡原句纯文本，干扰句优先同重点字，其次全局兜底 ──
        const cardKw = extractKeywordFromFront(card.fields?.[0] || '');
        const correctSentence = plainText(card.fields?.[0] || card.question || '');
        const kwSentencePool = cardKw ? (keywordSentencePools.get(cardKw) || []) : [];
        const sentSeen = new Set<string>([correctSentence]);
        const pickSentences = (pool: string[], count: number): string[] => {
          const picked: string[] = [];
          for (const s of pool) {
            if (picked.length >= count) break;
            if (!s || s.length < 4 || s.length > 60) continue;
            if (sentSeen.has(s)) continue;
            sentSeen.add(s);
            picked.push(s);
          }
          return picked;
        };
        let sentDistractors = pickSentences(shuffle(kwSentencePool), 3);
        if (sentDistractors.length < 3) {
          sentDistractors = [...sentDistractors, ...pickSentences(shuffle(globalSentencePool), 3 - sentDistractors.length)];
        }
        const sentTexts = shuffle([correctSentence, ...sentDistractors]);
        const sentLabels = ['A', 'B', 'C', 'D'];
        const sentCorrectLabel = sentLabels[sentTexts.indexOf(correctSentence)];
        card.sentenceOptions = sentTexts.map((text: string, i: number) => ({
          label: sentLabels[i],
          text,
          isCorrect: sentLabels[i] === sentCorrectLabel,
        }));
        card.sentenceCorrectLabel = sentCorrectLabel;

        // ── 阶段3「义意速判」：50% 给正确义项，50% 给同重点字/全局的错误义项 ──
        const correctMeaning = card.fields?.[1] || card.fields?.[0] || card.answer || '';
        const kwMeaningPool = (cardKw ? (keywordPools.get(cardKw) || []) : [])
          .filter(t => !!t && t !== correctMeaning);
        const pickMeaning = (pool: string[]): string | null =>
          pool.length === 0 ? null : pool[Math.floor(Math.random() * pool.length)];
        const wrongMeaning = pickMeaning(kwMeaningPool)
          || pickMeaning(globalMeaningPool.filter(t => t !== correctMeaning));
        // 取不到错误义项时退化为判「正确」，保证始终有题可答
        const judgeUseCorrect = wrongMeaning === null ? true : Math.random() < 0.5;
        card.judgeIsCorrect = judgeUseCorrect;
        card.judgeMeaning = judgeUseCorrect ? correctMeaning : wrongMeaning!;

        return card;
      });

      setCards(enriched);
      setSessionStats({ reviewed: 0, total: newCards.length, mcqPromoted: 0 });
      setDoneSteps(0);
      setLastStudied(null);
      setCurrentIdx(0);
      setIsFlipped(false);
      setSessionStart(Date.now());
      setRating(null);
      setSelectedMcq(null);
      setShowMcqResult(false);
      setLastMcqCorrect(null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [deckId]);

  useEffect(() => { fetchCards(); }, [fetchCards]);

  // 一组学习完成（卡片全部毕业）→ 广播事件，让首页 3D 词球刷新「最近学习词」
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


  const resetCardState = () => {
    setIsFlipped(false);
    setRating(null);
    setSelectedMcq(null);
    setShowMcqResult(false);
    setLastMcqCorrect(null);
    setHintUsed(false);
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

  // 记录「上一词」：学习流程会把当前卡重新插到队列后方，currentIdx 不前进，
  // 因此单独记住刚学完的那张卡的关键词，供顶部胶囊显示
  const recordLastStudied = (c: StudyCard) => {
    const kw = extractKeywordFromFront(c.fields?.[0] || '')
      || plainText(c.fields?.[0] || c.question).slice(0, 6);
    if (kw) setLastStudied({ word: kw, meaning: plainText(c.fields?.[1] || '') });
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

  // 舞台重点字（仅用于展示）：耳机 Hook 必须在任何条件返回之前调用
  const stageCard = cards[currentIdx];
  const stageKeyword = stageCard ? (extractKeywordFromFront(stageCard.fields?.[0] || '') || '') : '';
  const stageKeywordPinyin = usePinyin(stageKeyword);

  /** 队列推进：毕业 / 穿插 / 答错归零重插（与改造前语义完全一致） */
  const advanceQueue = (isCorrect: boolean) => {
    const INTERLEAVE_OFFSET = 3;
    const updated = [...cards];
    const curCard = updated[currentIdx];
    if (!curCard) {
      resetCardState();
      return;
    }
    updated.splice(currentIdx, 1);

    if (isCorrect) {
      const curStep = curCard.remaining_steps || 0;
      if (curStep >= 2) {
        // 三阶段全部走完 → 毕业，从队列移除（不再插回）
      } else {
        // 进入下一阶段，重新插到后面穿插
        const nextStep = curStep + 1;
        curCard.remaining_steps = nextStep;
        curCard.learningStep = nextStep;
        const insertAt = Math.min(currentIdx + INTERLEAVE_OFFSET, updated.length);
        updated.splice(insertAt, 0, curCard);
      }
    } else {
      // 答错 → 重置到第一步，重新插到后面穿插
      curCard.remaining_steps = 0;
      curCard.learningStep = 0;
      const insertAt = Math.min(currentIdx + INTERLEAVE_OFFSET, updated.length);
      updated.splice(insertAt, 0, curCard);
    }

    if (updated.length === 0) {
      setCards([]);
      setCurrentIdx(0);
    } else {
      setCards(updated);
      setCurrentIdx(currentIdx >= updated.length ? 0 : currentIdx);
    }
    resetCardState();
  };

  /** 提交本次答题（客观题与「斩」自评共用的落库入口） */
  /** 收藏 / 取消收藏当前字词 */
  const toggleFavorite = async () => {
    const cid = cards[currentIdx]?.id;
    if (!cid) return;
    try {
      if (favorited) { await api.wordbook.unfavorite(cid); setFavorited(false); }
      else { await api.wordbook.favorite(cid); setFavorited(true); }
    } catch { /* ignore */ }
  };

  const submitRating = async (r: number) => {
    const card = cards[currentIdx];
    if (!card) return;
    // 答错（忘记）自动记入错题本
    if (r === 1) { api.wordbook.addWrong(card.id).catch(() => {}); }
    recordLastStudied(card);
    setDoneSteps(d => d + 1);
    setRating(r);
    const timeMs = Date.now() - sessionStart;
    try {
      await api.cards.answer(card.id, r, timeMs);
      setSessionStats(s => ({ ...s, reviewed: s.reviewed + 1 }));
    } catch (err) {
      console.error('Failed to save answer:', err);
    }
  };

  /** handleRate：提交评分并翻面展示完整答案卡，等用户点「下一题」（保留原自评入口行为） */
  const handleRate = async (r: number) => {
    if (!cards[currentIdx] || rating !== null) return;
    await submitRating(r);
    setIsFlipped(true);
  };

  /** handleRecallNext：「下一题」——客观题阶段用 lastMcqCorrect 决定 rating，随后推进队列 */
  const handleRecallNext = async () => {
    if (!cards[currentIdx]) return;
    const r = rating !== null
      ? rating
      : (mcqAutoRating.current || (lastMcqCorrect ? 3 : 1));
    if (rating === null) {
      await submitRating(r);
    }
    advanceQueue(r >= 3);
  };

  /** 客观题作答收尾：记录对错 → 立即判定 → 600ms 后翻面展示完整答案 */
  const finishObjective = (ok: boolean, selected: string) => {
    if (showMcqResult || isFlipped) return;
    /* 看过解析的题一律按「忘记」计（rating=1），不再因答对而被判掌握 */
    const effective = ok && !hintUsed;
    mcqAutoRating.current = effective ? 3 : 1;
    setLastMcqCorrect(ok);
    setSelectedMcq(selected);
    setShowMcqResult(true);
    setTimeout(() => setIsFlipped(true), 600);
  };

  /** 阶段1「据句选意」/ 阶段2「据义选句」：选择一个选项 */
  const handleMcqSelect = (label: string) => {
    const currentCard = cards[currentIdx];
    if (!currentCard) return;
    const right = (currentCard.learningStep ?? 0) === 1
      ? (currentCard.sentenceCorrectLabel || '')
      : (currentCard.mcqOptions?.correctAnswer || '');
    finishObjective(!!right && label === right, label);
  };

  /** 阶段3「义意速判」：判断给出的释义是否正确 */
  const handleJudgeSelect = (answer: boolean) => {
    const currentCard = cards[currentIdx];
    if (!currentCard) return;
    finishObjective(answer === (currentCard.judgeIsCorrect !== false), answer ? 'T' : 'F');
  };

  /* ══════════ Immersive light-blue chrome (replaces V2PageShell for the study flow) ══════════ */

  // 进入过渡屏：记忆曲线动画 + 进度条，加载完成淡出进入正题
  if (loading || loaderPhase !== 'gone') {
    return <StudyLoadingScreen mode="study" done={!loading} />;
  }


  // Session complete
  if (cards.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#d5e4f6] to-[#c2d9f2] flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm bg-white/80 backdrop-blur-xl rounded-[2rem] p-8 text-center shadow-[0_20px_50px_rgba(96,125,180,0.25)]"
        >
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}>
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/30">
              <CheckCircle2 className="w-10 h-10 text-white" />
            </div>
          </motion.div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">今日任务完成！</h2>
          <p className="text-slate-500 mb-1">已学习 {sessionStats.reviewed} 张卡片</p>
          <p className="text-slate-400 text-sm mb-8">坚持练习，记忆会越来越牢固</p>
          <div className="flex gap-3">
            <button onClick={fetchCards} className="flex-1 py-3 rounded-2xl bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-500/25 hover:bg-indigo-600 transition-all">继续学习</button>
            <button onClick={() => navigate('/v2')} className="flex-1 py-3 rounded-2xl bg-white border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-all">返回首页</button>
          </div>
        </motion.div>
      </div>
    );
  }

  const card = cards[currentIdx];
  if (!card) return null;

  // 三阶段全部为客观题：0=据句选意 1=据义选句 2=义意速判
  const learningStep = card.learningStep ?? 0;
  const isMcqStep = learningStep === 0;
  const isPickSentenceStep = learningStep === 1;
  const isJudgeStep = learningStep === 2;
  const streak = card.remaining_steps || 0;
  const mcqOptions = card.mcqOptions;
  const hasMcqOptions = isMcqStep && !!mcqOptions && mcqOptions.options.length > 0;
  const correctAnswer = mcqOptions?.correctAnswer || '';
  const sentenceOptions = card.sentenceOptions || [];
  const hasSentenceOptions = isPickSentenceStep && sentenceOptions.length > 0;
  const sentenceCorrectLabel = card.sentenceCorrectLabel || '';
  const judgeIsCorrect = card.judgeIsCorrect !== false;
  // 客观题选项（阶段1 = 义项选项，阶段2 = 原句选项）
  const activeOptions = isPickSentenceStep ? sentenceOptions : (mcqOptions?.options || []);
  const activeCorrectLabel = isPickSentenceStep ? sentenceCorrectLabel : correctAnswer;
  const hasOptions = hasMcqOptions || hasSentenceOptions;
  const isCorrect = isJudgeStep
    ? (!!selectedMcq && (selectedMcq === 'T') === judgeIsCorrect)
    : (!!selectedMcq && selectedMcq === activeCorrectLabel);

  const stepLabels = ['据句选意', '据义选句', '义意速判'];
  const stepLabel = learningStep >= 0 && learningStep <= 2 ? stepLabels[learningStep] : '';

  // ── Derived display data ──
  // 顶部胶囊：上一词的「字 + 义项」
  const prevWord = lastStudied ? lastStudied.word : null;
  const prevMeaning = lastStudied ? lastStudied.meaning : '';

  const frontHtml = card.fields?.[0] || card.question || '';
  const answerHtml = card.fields?.[1] || card.answer || '';
  const transHtml = card.fields?.[2] || card.fields?.[1] || card.answer || '';
  // 例句出处：只取《书名》部分
  const sourceBook = extractBookSource(frontHtml);

  // 阶段3「义意速判」展示的义项（可能是正确义项，也可能是干扰义项）
  // 义项可能已经带 HTML（如 <b>当</b>），也可能带 == == 标记；
  // 这里统一走 renderMarkup，但必须避免「已渲染过的 HTML 再渲染一次」导致二次转义。
  const rawJudgeMeaning = card.judgeMeaning || answerHtml;
  const judgeMeaningHtml = /<[a-z][^>]*>/i.test(rawJudgeMeaning)
    ? rawJudgeMeaning
    : renderMarkup(rawJudgeMeaning);
  const sourceTag = card.tags && card.tags.length > 0 ? card.tags[0] : null;
  // 判定后展示的「正确答案」文本
  const correctDisplayHtml = isJudgeStep
    ? (judgeIsCorrect ? `正确 · ${plainText(answerHtml)}` : `错误 · 正确释义：${plainText(answerHtml)}`)
    : isPickSentenceStep
      ? (sentenceOptions.find(o => o.isCorrect)?.text || plainText(frontHtml))
      : (mcqOptions?.options.find(o => o.isCorrect)?.text || correctAnswer);
  // 阶段3 的两个大按钮
  const judgeButtons = [
    { label: 'T', text: '✓ 正确', good: true },
    { label: 'F', text: '✗ 错误', good: false },
  ];

  // TTS — 朗读一段纯文本
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

  // TTS — read the main content aloud（阶段2 题干是释义，其余是原句）
  const speak = () => {
    speakRaw(plainText(isPickSentenceStep ? answerHtml : frontHtml));
  };

  // TTS — 朗读舞台重点字
  const speakKeyword = () => {
    speakRaw(stageKeyword);
  };

  // Quick-pick an option from the side shortcut pads
  const pickByIndex = (i: number) => {
    if (mcqActive && activeOptions[i]) {
      handleMcqSelect(activeOptions[i].label);
    }
  };

  const mcqActive = !!(hasOptions && !showMcqResult && !isFlipped);
  // 阶段3「义意速判」的两个大按钮可点
  const judgeActive = isJudgeStep && !showMcqResult && !isFlipped;
  // 进度 = 已完成步骤 / 本次会话总步骤（卡数 × 3 步）；看到答案补半步，让推进更平滑
  const totalSteps = Math.max(sessionStats.total || cards.length, 1) * 3;
  const halfStep = (isFlipped || showMcqResult) ? 0.5 : 0;
  const progress = Math.min(100, Math.round(((doneSteps + halfStep) / totalSteps) * 100));

  const shortcutPad = 'w-14 h-14 rounded-2xl bg-white/40 hover:bg-white/75 active:scale-95 transition-all shadow-sm';

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-[#cfe0f4] via-[#bcd3ec] to-[#a9c6e6]">
      <style>{`
        .study-bold b, .study-main b, .study-main strong {
          color:#7C3AED; font-weight:900;
          background:rgba(255,255,255,.62);
          padding:0 5px; border-radius:5px;
        }
        .mark-highlight { background: linear-gradient(120deg,#fde68a 0%,#fde68a 40%,#fbbf24 100%); padding:0 4px; border-radius:3px; font-weight:600; }
      `}</style>

      {/* ── 顶部大胶囊：返回 + 上一词两行 + 绿色进度条 ── */}
      <StageTopPill
        word={prevWord}
        meaning={prevMeaning}
        progress={progress}
        onBack={() => navigate('/')}
        menuSlot={
          <div className="relative">
            <button
              onClick={() => setShowMenu(v => !v)}
              className="w-9 h-9 rounded-full bg-white/80 hover:bg-white shadow-sm flex items-center justify-center transition-all"
              aria-label="更多"
            >
              <MoreHorizontal className="w-5 h-5 text-slate-500" />
            </button>
            <AnimatePresence>
              {showMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 mt-2 w-40 bg-white rounded-2xl shadow-xl py-1.5 overflow-hidden"
                >
                  <button
                    onClick={() => { setShowMenu(false); toggleFavorite(); }}
                    className="w-full px-4 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <Star className="w-4 h-4 text-amber-400" fill={favorited ? 'currentColor' : 'none'} />
                    {favorited ? '取消收藏' : '收藏到单词本'}
                  </button>
                  <button
                    onClick={() => { setShowMenu(false); setShowAnalysis(true); }}
                    className="w-full px-4 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <BookOpenText className="w-4 h-4 text-slate-400" /> 查看解析
                  </button>
                  <button
                    onClick={() => navigate('/')}
                    className="w-full px-4 py-2.5 text-left text-sm text-red-500 hover:bg-red-50 flex items-center gap-2"
                  >
                    <X className="w-4 h-4" /> 结束本次学习
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        }
      />

      {/* ── Body: side shortcut pads (xl+) + center stage ── */}
      <div className="relative z-10 max-w-[1400px] mx-auto flex items-stretch justify-between">

        {/* Left shortcuts */}
        <aside className="hidden xl:flex flex-col items-center gap-10 pt-56 pl-10">
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500/70 tracking-[0.35em] [writing-mode:vertical-rl]">快捷发音</span>
            <button onClick={speak} className={shortcutPad} aria-label="快捷发音：朗读" title="朗读" />
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500/70 tracking-[0.35em] [writing-mode:vertical-rl]">快捷选项</span>
            <div className="flex flex-col gap-4">
              <button onClick={() => pickByIndex(0)} className={shortcutPad} title="选项 1" />
              <button onClick={() => pickByIndex(1)} className={shortcutPad} title="选项 2" />
            </div>
          </div>
        </aside>

        {/* Center stage */}
        <main className="flex-1 min-w-0 flex flex-col items-center px-4 pt-14 pb-28 overflow-y-auto">
          {/* 题型徽标：据句选意 / 据义选句 / 义意速判 */}
          {stepLabel ? (
            <div className="mb-6 flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-white/70 text-xs font-medium text-slate-600 shadow-sm">
                {stepLabel}
              </span>
              <span className="text-xs text-slate-500/70">第 {learningStep + 1}/3 步</span>
            </div>
          ) : null}
          <AnimatePresence mode="wait">
            <motion.div
              key={`${card.id}-${learningStep}-${isFlipped ? 'b' : 'f'}`}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.22 }}
              className="w-full flex flex-col items-center"
            >
              {/* ── 舞台题干：按阶段渲染（据句选意 / 据义选句 / 义意速判） ── */}
              {!isFlipped && (
                <>
                  {/* 阶段1 据句选意：重点字大字 + 拼音 + 例句（重点字高亮）+ 出处 */}
                  {isMcqStep && stageKeyword ? (
                    <>
                      <StageBigChar char={stageKeyword} py={stageKeywordPinyin} onSpeak={speakKeyword} />
                      <StageSentence html={frontHtml} source={sourceBook} onSpeak={speak} />
                    </>
                  ) : null}
                  {isMcqStep && !stageKeyword ? (
                    <div
                      className="study-main text-center text-[1.35rem] leading-relaxed font-bold text-slate-800 font-serif"
                      dangerouslySetInnerHTML={{ __html: renderMarkup(frontHtml) }}
                    />
                  ) : null}

                  {/* 阶段2 据义选句：大号居中释义 → 选原句 */}
                  {isPickSentenceStep ? (
                    <div className="w-full flex flex-col items-center">
                      <p className="text-xs tracking-[0.3em] text-slate-400 font-medium">释义</p>
                      <div
                        className="study-main mt-3 px-4 text-center text-[1.5rem] leading-relaxed font-bold text-slate-800 font-serif"
                        dangerouslySetInnerHTML={{ __html: renderMarkup(answerHtml) }}
                      />
                      <p className="mt-4 text-sm text-slate-500/80">选出它对应的原句</p>
                    </div>
                  ) : null}

                  {/* 阶段3 义意速判：原句 + 提示 + 一个义项 → 判断对错 */}
                  {isJudgeStep ? (
                    <div className="w-full flex flex-col items-center">
                      <div
                        className="study-main text-center text-[1.35rem] leading-relaxed font-bold text-slate-800 font-serif"
                        dangerouslySetInnerHTML={{ __html: renderMarkup(frontHtml) }}
                      />
                      <p className="mt-6 text-sm text-slate-500/80">这个释义正确吗？</p>
                      <div
                        className="study-main mt-3 px-4 text-center text-[1.5rem] leading-relaxed font-bold text-slate-800 font-serif"
                        dangerouslySetInnerHTML={{ __html: judgeMeaningHtml }}
                      />
                    </div>
                  ) : null}

                  {card.css && <style>{card.css}</style>}

                  {/* 出处标签（仅在例句里没有书名时补显示） */}
                  {!sourceBook && sourceTag && (
                    <div className="mt-6 flex items-center gap-2.5">
                      <span className="px-2.5 py-1 rounded-lg bg-white/60 text-xs text-slate-500 font-medium">{sourceTag}</span>
                    </div>
                  )}
                </>
              )}

              {/* 客观题选项（阶段1 义项 / 阶段2 原句） */}
              {mcqActive && (
                <div className="w-full mt-8 space-y-3">
                  {activeOptions.map((opt, i) => (
                    <motion.button
                      key={opt.label}
                      type="button"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => handleMcqSelect(opt.label)}
                      className={OPTION_BASE}
                    >
                      {/* 义项可能带 ==高亮== 标记；原句可能带 **重点字**，统一走 renderMarkup 渲染 */}
                      <span dangerouslySetInnerHTML={{ __html: renderMarkup(opt.text) }} />
                    </motion.button>
                  ))}
                </div>
              )}

              {/* 阶段3 义意速判：两个大按钮 */}
              {judgeActive && (
                <div className="w-full mt-8 grid grid-cols-2 gap-3">
                  {judgeButtons.map((opt, i) => (
                    <motion.button
                      key={opt.label}
                      type="button"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => handleJudgeSelect(opt.good)}
                      className={`${OPTION_BASE} text-center text-[17px] font-bold ${
                        opt.good ? 'text-emerald-700' : 'text-rose-600'
                      }`}
                    >
                      {opt.text}
                    </motion.button>
                  ))}
                </div>
              )}

              {/* 客观题判定结果：判定胶囊 + 选项染色 */}
              {showMcqResult && !isFlipped && (
                <div className="w-full mt-8">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`mx-auto mb-6 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium text-white shadow-md ${
                      isCorrect ? 'bg-emerald-400/90' : 'bg-rose-400/90'
                    }`}
                  >
                    {isCorrect ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                    {isCorrect ? '回答正确' : '回答错误'}
                  </motion.div>
                  {isJudgeStep ? (
                    <div className="grid grid-cols-2 gap-3">
                      {judgeButtons.map(opt => (
                        <div
                          key={opt.label}
                          className={`${OPTION_SHAPE} text-center font-bold ${
                            opt.good === judgeIsCorrect
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
                  ) : (
                    <div className="space-y-3">
                      {activeOptions.map(opt => (
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
                          <span dangerouslySetInnerHTML={{ __html: renderMarkup(opt.text) }} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Flipped: full answer card（三阶段通用） ── */}
              {isFlipped && (
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full mt-8 bg-white/70 backdrop-blur rounded-3xl p-6 text-left shadow-[0_14px_40px_rgba(96,125,180,0.2)]"
                >
                  {(hasOptions || isJudgeStep) && (
                    <div className="mb-4 pb-4 border-b border-slate-200/70">
                      <p className="text-xs text-slate-400 font-medium mb-1.5">
                        {isPickSentenceStep ? '正确原句' : '正确答案'}
                      </p>
                      <p className="text-lg font-bold text-emerald-700 leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: renderMarkup(correctDisplayHtml) }} />
                    </div>
                  )}
                  {isPickSentenceStep && (
                    <div className="mb-4">
                      <p className="text-xs text-slate-400 font-medium mb-1.5">释义</p>
                      <div className="study-main text-base font-semibold text-slate-800 leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: renderMarkup(answerHtml) }} />
                    </div>
                  )}
                  <div className="mb-4">
                    <p className="text-xs text-slate-400 font-medium mb-1.5">原文</p>
                    <div className="study-main text-base font-semibold text-slate-800 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMarkup(frontHtml) }} />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 font-medium mb-1.5">翻译</p>
                    <div className="text-base font-semibold text-slate-700 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMarkup(transHtml) }} />
                  </div>
                  {card.tags.length > 0 && (
                    <div className="flex gap-1.5 mt-4 flex-wrap">
                      {card.tags.map(tag => (
                        <span key={tag} className="px-2.5 py-1 bg-white/80 text-slate-500 rounded-lg text-xs">{tag}</span>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 pt-3 border-t border-slate-200/60 text-xs text-slate-400">
                    学习中 · 第 {learningStep + 1}/3 步（{stepLabel}） · 3 步通过后进入复习
                  </div>
                </motion.div>
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Right shortcuts */}
        <aside className="hidden xl:flex flex-col items-center gap-10 pt-56 pr-10">
          <div className="flex items-center gap-4">
            <button onClick={speak} className={shortcutPad} aria-label="快捷发音：朗读" title="朗读" />
            <span className="text-xs text-slate-500/70 tracking-[0.35em] [writing-mode:vertical-rl]">快捷发音</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col gap-4">
              <button onClick={() => pickByIndex(2)} className={shortcutPad} title="选项 3" />
              <button onClick={() => pickByIndex(3)} className={shortcutPad} title="选项 4" />
            </div>
            <span className="text-xs text-slate-500/70 tracking-[0.35em] [writing-mode:vertical-rl]">快捷选项</span>
          </div>
        </aside>
      </div>

      {/* Analysis modal (bulb / AI / "..." menu) */}
      <AnimatePresence>
        {showAnalysis && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-slate-900/30 backdrop-blur-sm"
            onClick={() => setShowAnalysis(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-indigo-500" /> 卡片解析
                </h3>
                <button onClick={() => setShowAnalysis(false)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center" aria-label="关闭">
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-slate-400 font-medium mb-1">原文</p>
                  <div className="study-main text-base font-semibold text-slate-800 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: renderMarkup(frontHtml) }} />
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium mb-1">翻译</p>
                  <div className="text-base font-semibold text-slate-700 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: renderMarkup(transHtml) }} />
                </div>
                {(hasOptions || isJudgeStep) && (
                  <div>
                    <p className="text-xs text-slate-400 font-medium mb-1">
                      {isPickSentenceStep ? '正确原句' : '正确答案'}
                    </p>
                    <p className="text-base font-semibold text-emerald-700"
                      dangerouslySetInnerHTML={{ __html: renderMarkup(correctDisplayHtml) }} />
                  </div>
                )}
                {card.tags.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {card.tags.map(tag => (
                      <span key={tag} className="px-2.5 py-1 bg-slate-100 text-slate-500 rounded-lg text-xs">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ Fixed bottom: action buttons + icon toolbar ═══ */}
      <StageBottomBar
        left={
          <StageToolButton
            label="斩：标记掌握"
            onClick={() => { if (!mcqActive && !judgeActive && rating === null) handleRate(hintUsed ? 1 : 3); }}
            disabled={mcqActive || judgeActive || rating !== null}
            className="text-slate-700"
          >
            <span className="text-xl font-bold font-serif leading-none">斩</span>
          </StageToolButton>
        }
        center={
          <StageToolButton
            label={hintUsed ? '已看解析（本题不算对）' : '解析'}
            onClick={() => { setShowAnalysis(true); setHintUsed(true); }}
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
          {/* 兜底：本阶段没有客观题选项时，手动显示答案 */}
            {!hasOptions && !isJudgeStep && !showMcqResult && !isFlipped && rating === null && (
              <motion.button
                key="reveal"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                onClick={handleManualFlip}
                className="w-full mb-5 py-3 text-[15px] rounded-2xl bg-white/70 hover:bg-white/90 backdrop-blur text-slate-800 font-medium shadow-md transition-all flex items-center justify-center gap-2"
              >
                显示答案
                {autoFlipCountdown !== null && <span className="text-sm text-slate-400 font-normal">({autoFlipCountdown}s)</span>}
              </motion.button>
            )}

            {/* 兜底自评（无客观题选项时） */}
            {!hasOptions && !isJudgeStep && isFlipped && rating === null && (
              <motion.div
                key="rate"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="grid grid-cols-2 gap-2.5 mb-5"
              >
                <button
                  onClick={() => handleRate(1)}
                  className="py-3 rounded-2xl bg-rose-400/70 hover:bg-rose-400/85 backdrop-blur text-white font-bold shadow-md transition-all"
                >
                  <span className="block text-[15px]">不认识</span>
                  <span className="block text-[10px] text-white/75 mt-0.5">回到第一步重新答</span>
                </button>
                <button
                  onClick={() => handleRate(3)}
                  className="py-3 rounded-2xl bg-emerald-400/80 hover:bg-emerald-400/95 backdrop-blur text-white font-bold shadow-md transition-all"
                >
                  <span className="block text-[15px]">认识</span>
                  <span className="block text-[10px] text-white/80 mt-0.5">进入下一步</span>
                </button>
              </motion.div>
            )}

            {/* 下一题：三阶段客观题判定后 / 已提交评分后统一走 handleRecallNext */}
            {isFlipped && (rating !== null || showMcqResult) && (
              <motion.button
                key="next"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                onClick={() => { handleRecallNext(); }}
                className="w-full mb-5 py-3 text-[15px] rounded-2xl bg-indigo-500/90 hover:bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-500/25 transition-all flex items-center justify-center gap-1.5"
              >
                下一题 <ChevronRight className="w-4 h-4" />
              </motion.button>
            )}
        </AnimatePresence>
      </StageBottomBar>
    </div>
  );
}
