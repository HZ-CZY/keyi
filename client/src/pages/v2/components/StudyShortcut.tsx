import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, SlidersHorizontal, LineChart, ChevronRight } from 'lucide-react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import ShelfModal from './ShelfModal';

/**
 * Study shortcut card — v2 style:
 *   - Compact white rounded-3xl container (tight vertical gaps)
 *   - Top row: light tabs (01 / 02 / +) left-aligned + stats icon top-right
 *   - Header: deck name (left, large bold) + settings gear right next to it
 *   - Progress: dot + hairline bar + "0/869 词 >" on the right
 *   - Bottom: full-round pill buttons, solid bright blue, single-line
 *     (action name left, progress data right)
 */
export default function StudyShortcut() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [decks, setDecks] = useState<any[] | null>(null);
  const [tab, setTab] = useState<'01' | '02' | '03'>('01');
  // 书架弹窗（+ 号打开，用户自助添加牌组）
  const [showShelf, setShowShelf] = useState(false);
  // 学习设置：daily_groups（单日组数）+ study_per_session（单组词数）
  const [groups, setGroups] = useState(4);
  const [perSession, setPerSession] = useState(20);
  // 今日学习数据（todayNew/todayReview 来自 statsOverview）
  const [overview, setOverview] = useState<{ todayNew?: number; todayReview?: number } | null>(null);

  const loadDecks = () => {
    if (!user) { setDecks(null); return; }
    api.decks.list().then((d: any[]) => setDecks(d)).catch(() => setDecks([]));
  };

  useEffect(() => {
    // 未登录不请求；登录/登出（user 变化）时重新拉取，避免登录后牌组不显示
    if (!user) {
      setDecks(null);
      setOverview(null);
      return;
    }
    loadDecks();
    api.auth.getSettings()
      .then((s: any) => {
        setGroups(parseInt(s.daily_groups) || 4);
        setPerSession(parseInt(s.study_per_session) || 20);
      })
      .catch(() => {});
    api.cards.statsOverview()
      .then((d: any) => setOverview(d))
      .catch(() => {});
  }, [user]);

  const activeDeck = decks && decks.length > 0
    ? (decks[tab === '02' ? 1 : tab === '03' ? 2 : 0] || decks[0])
    : null;

  // 当天还剩：新学（组数+词数）/ 复习（词数）
  const todayNew = overview?.todayNew ?? 0;
  const remainingNewWords = Math.max(0, groups * perSession - todayNew);
  // 仿百词斩：新学按钮显示「已完成/总组数」
  const doneNewGroups = Math.min(groups, Math.floor(todayNew / Math.max(perSession, 1)));
  // 复习剩余 = 该牌组当前到期的复习卡数（decks.list() 返回的 review_count，
  // queue=2 且已到期）——不能用全站 todayReview 去减 per-deck 配额，两者维度不同
  const remainingReviewWords = activeDeck ? (activeDeck.review_count || 0) : 0;
  // 牌组已学词数（总数 - 未学新卡），仿百词斩「75/4135词」进度
  const learnedCount = activeDeck ? Math.max(0, (activeDeck.card_count || 0) - (activeDeck.new_count || 0)) : 0;
  const totalCount = activeDeck ? (activeDeck.card_count || 0) : 0;
  const learnedPct = totalCount > 0 ? Math.min(100, Math.round((learnedCount / totalCount) * 100)) : 0;
  const remainingReviewGroups = Math.ceil(remainingReviewWords / Math.max(perSession, 1));

  return (
    <div className="relative">
      {/* White rounded card — compact */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-3xl keyi-glass-panel p-4 md:p-5 flex flex-col gap-3 min-w-0"
      >
        {/* Top row: light tabs (left) + stats icon (right) */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-0.5 text-sm font-medium text-slate-400">
            <button
              onClick={() => setTab('01')}
              className={`px-2.5 py-1 rounded-lg transition-colors ${
                tab === '01'
                  ? 'text-slate-900  font-bold'
                  : 'hover:text-slate-600 '
              }`}
              title="第一个牌组"
            >01</button>
            <button
              onClick={() => decks && decks.length >= 2 && setTab('02')}
              className={`px-2.5 py-1 rounded-lg transition-colors ${
                tab === '02'
                  ? 'text-slate-900  font-bold'
                  : 'hover:text-slate-600 '
              }`}
              title={decks && decks.length >= 2 ? '第二个牌组' : '暂无第二个牌组'}
            >02</button>
            <button
              onClick={() => decks && decks.length >= 3 && setTab('03')}
              className={`px-2.5 py-1 rounded-lg transition-colors ${
                tab === '03'
                  ? 'text-slate-900  font-bold'
                  : decks && decks.length >= 3
                    ? 'hover:text-slate-600 '
                    : 'text-slate-200  cursor-default'
              }`}
              title={decks && decks.length >= 3 ? '第三个牌组' : '暂无第三个牌组'}
            >03</button>
            <button
              onClick={() => setShowShelf(true)}
              className="px-2 py-1 rounded-lg text-slate-300 hover:text-slate-500 hover:bg-slate-100/60 transition-colors"
              title="书架：添加牌组"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Stats icon top-right */}
          <button
            onClick={() => navigate('/stats')}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-300 hover:text-slate-500 hover:bg-slate-100/60 transition-colors"
            title="学习统计"
          >
            <LineChart className="w-5 h-5" />
          </button>
        </div>

        {/* Header: deck name (left, large bold) + gear right after it */}
        <div className="flex items-center gap-1">
          {activeDeck ? (
            <>
              {/* 【2026-10-10】牌组名改为可点击，进入该牌组的单词列表页
                  （展示全部卡片 + 学习状态，可筛选/排序/搜索）。
                  只在文字上做 hover 下划线，避免整行变色喧宾夺主；
                  右侧小箭头给出「可点」的明确暗示。 */}
              <button
                onClick={() => navigate(`/deck/${activeDeck.id}/words`)}
                className="group flex items-center gap-0.5 min-w-0 text-left"
                title="查看单词列表"
              >
                <span className="text-lg font-bold text-slate-800 truncate group-hover:text-[#3B6BE8] group-hover:underline decoration-[#3B6BE8]/40 decoration-2 underline-offset-4 transition-colors">
                  {activeDeck.name}
                </span>
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#3B6BE8] shrink-0 transition-colors" />
              </button>
              <button
                onClick={() => activeDeck && navigate(`/study-settings?deck=${activeDeck.id}`)}
                disabled={!activeDeck}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-slate-500 hover:bg-slate-100/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                title="学习设置（单日组数 / 每组词数 / 预计完成时间）"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            </>
          ) : (
            <span className="text-sm text-slate-400">还没有牌组</span>
          )}
        </div>

        {/* Progress row — 百词斩 style: blue dot + hairline bar + learned/total words */}
        {activeDeck && (
          <button
            onClick={() => navigate('/stats')}
            className="flex items-center gap-2.5 w-full group"
            title="查看学习统计"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#3B6BE8] shrink-0" />
            <div className="flex-1 h-[3px] rounded-full bg-slate-200/80 overflow-hidden">
              <div className="h-full bg-[#3B6BE8]/70 rounded-full transition-all duration-700" style={{ width: `${learnedPct}%` }} />
            </div>
            <span className="shrink-0 text-sm font-bold text-slate-800 tabular-nums">
              {learnedCount}/{totalCount}
              <span className="text-xs font-medium text-slate-400">词</span>
            </span>
            <svg className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        )}

        {/* Bottom: full-round pill buttons, solid baicizhan blue, single-line */}
        {activeDeck ? (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Link
              to={`/study/${activeDeck.id}`}
              className="study-btn rounded-full py-3 px-5 flex items-center justify-between"
            >
              <span className="text-[15px] font-semibold">新学</span>
              <span className="text-[13px] opacity-95 tabular-nums">{doneNewGroups}/{groups} 组</span>
            </Link>
            <Link
              to={`/review/${activeDeck.id}`}
              className="study-btn rounded-full py-3 px-5 flex items-center justify-between"
            >
              <span className="text-[15px] font-semibold">复习</span>
              <span className="text-xs opacity-90 tabular-nums">{remainingReviewGroups > 0 ? `剩 ${remainingReviewGroups} 组` : '0 组'}</span>
            </Link>
          </div>
        ) : (
          <Link
            to="/decks"
            className="study-btn pt-1 rounded-full py-3 px-4 text-center transition-all text-sm font-semibold"
          >
            去创建第一个牌组 →
          </Link>
        )}
      </motion.div>

      {/* 书架：+ 号打开，用户自助添加牌组 */}
      <ShelfModal
        open={showShelf}
        onClose={() => setShowShelf(false)}
        onAdded={loadDecks}
      />
    </div>
  );
}
