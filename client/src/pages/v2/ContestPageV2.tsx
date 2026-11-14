import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, Swords, Trophy, Timer as TimerIcon, Flame, RotateCcw,
  Loader2, Check, X, Crown, Zap, Home, ListOrdered, BookOpen, Coins, Gift, Sparkles,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { UserBadge } from '../../components/UserBadge';

/**
 * 实词大赛（一站到底玩法）
 *   ready   → 规则 + 奖池 + 我的最高纪录 + 开始挑战
 *   playing → 连对答题（每题限时，答错/超时即结束）
 *   over    → 本次成绩 + 历史最高 + 再来一局
 *   board   → 单独排行榜（按历史最高答题数）+ 奖励
 *
 * 配色：暖色高饱和（红 / 橙 / 金）营造「紧张感」，不使用黑色系。
 */

type Phase = 'ready' | 'playing' | 'over' | 'board';

interface QOption { label: string; text: string }
interface Q { index: number; stem: string; keyword: string; source: string; options: QOption[]; timeLimit: number }

interface FinalResult {
  score: number;
  best: number;
  newRecord: boolean;
  cleared: boolean;
  correctMeaning: string;
  correctLabel: string;
  timedOut: boolean;
}

/** 把 `**重点字**` 渲染成高亮（先去标签再转义，防注入） */
function stemHtml(stem: string): string {
  const noTags = String(stem || '').replace(/<[^>]*>/g, '');
  const esc = noTags.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/\*\*(.+?)\*\*/g, '<b class="ct-kw">$1</b>');
}

/** 选项字母配色（暖色系，与整体一致） */
const LABEL_CLS: Record<string, string> = {
  A: 'from-rose-400 to-red-500',
  B: 'from-orange-400 to-amber-500',
  C: 'from-amber-400 to-yellow-500',
  D: 'from-rose-500 to-orange-500',
};

/** 奖励兜底（服务端未返回时展示） */
const DEFAULT_POOL = 30000;
const DEFAULT_PARTICIPATION = 100;
const DEFAULT_TIERS = [
  { label: '第 1 名', amount: 3666 },
  { label: '第 2 名', amount: 2222 },
  { label: '第 3 名', amount: 1666 },
  { label: '第 4 ~ 10 名', amount: 1111 },
  { label: '第 11 ~ 20 名', amount: 666 },
];
const DEFAULT_SETTLE_DATE = '2026-10-24';
/** 提速阶梯兜底（服务端返回 timeLadder 时优先用它） */
const DEFAULT_LADDER = [
  { from: 0, sec: 15 },
  { from: 20, sec: 10 },
  { from: 50, sec: 6 },
  { from: 100, sec: 5 },
  { from: 150, sec: 3.5 },
  { from: 200, sec: 2.5 },
];

/* 暖色设计令牌 */
const BG = 'linear-gradient(168deg,#FFF4E9 0%,#FFE7D5 46%,#FFDCC6 100%)';
const INK = '#3A2318';
const INK_2 = '#8B6A57';
const RED = '#E8342A';
const ORANGE = '#FF8A2B';
const GOLD = '#FFB020';

export default function ContestPageV2() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [phase, setPhase] = useState<Phase>('ready');
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  const [runId, setRunId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [perQ, setPerQ] = useState(15);
  /** 当前这题的限时（秒）——随连对数递减 */
  const [curLimit, setCurLimit] = useState(15);
  /** 提速阶梯（服务端下发） */
  const [timeLadder, setTimeLadder] = useState<{ from: number; sec: number; label: string }[]>([]);
  /** >0 时显示「提速！」提示（值为新的限时秒数） */
  const [speedUp, setSpeedUp] = useState(0);
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [locked, setLocked] = useState(false);
  const [remaining, setRemaining] = useState(15);
  const [chosen, setChosen] = useState<string | null>(null);
  const [mark, setMark] = useState<{ correctLabel: string; correct: boolean; timedOut: boolean } | null>(null);
  const [final, setFinal] = useState<FinalResult | null>(null);

  const [myBest, setMyBest] = useState(0);
  const [myPlays, setMyPlays] = useState(0);
  const [myPrize, setMyPrize] = useState(0);
  const [prizeInfo, setPrizeInfo] = useState<{
    settleDate: string;
    topN: number;
    tiers: { label: string; amount: number }[];
    participation: number;
    pool: number;
    settled: boolean;
    participationNote: string;
  } | null>(null);

  const [board, setBoard] = useState<Awaited<ReturnType<typeof api.contest.leaderboard>> | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);

  const timerRef = useRef<number | null>(null);
  const deadlineRef = useRef(0);
  const runIdRef = useRef<number | null>(null);
  const questionsRef = useRef<Q[]>([]);
  const phaseRef = useRef<Phase>('ready');
  const lockedRef = useRef(false);
  const indexRef = useRef(0);
  const perQRef = useRef(15);
  const submitRef = useRef<(label: string | null, timeout: boolean) => void>(() => {});

  useEffect(() => { runIdRef.current = runId; }, [runId]);
  useEffect(() => { questionsRef.current = questions; }, [questions]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { lockedRef.current = locked; }, [locked]);
  useEffect(() => { indexRef.current = index; }, [index]);
  useEffect(() => { perQRef.current = perQ; }, [perQ]);

  /* ───────── 计时器 ───────── */
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(
    (sec: number) => {
      clearTimer();
      setCurLimit(sec);
      deadlineRef.current = Date.now() + sec * 1000;
      setRemaining(sec);
      timerRef.current = window.setInterval(() => {
        const left = Math.max(0, (deadlineRef.current - Date.now()) / 1000);
        setRemaining(left);
        if (left <= 0) {
          clearTimer();
          submitRef.current(null, true); // 超时算答错
        }
      }, 100);
    },
    [clearTimer]
  );

  useEffect(() => () => clearTimer(), [clearTimer]);

  /* 「提速！」提示 1.8s 后自动消失 */
  useEffect(() => {
    if (!speedUp) return;
    const t = window.setTimeout(() => setSpeedUp(0), 1800);
    return () => window.clearTimeout(t);
  }, [speedUp]);

  /* ───────── 拉我的纪录 + 奖励规则 ───────── */
  const loadMy = useCallback(() => {
    api.contest
      .leaderboard()
      .then((d) => {
        setMyBest(d.me.best || 0);
        setMyPlays(d.me.plays || 0);
        setMyPrize(d.me.prize || 0);
        setPrizeInfo(d.prize || null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { loadMy(); }, [loadMy]);

  /** 结算并进入结果页 */
  const finish = useCallback(
    (scoreVal: number, res: any) => {
      clearTimer();
      setFinal({
        score: scoreVal,
        best: typeof res?.best === 'number' ? res.best : scoreVal,
        newRecord: !!res?.newRecord,
        cleared: !!res?.cleared,
        correctMeaning: res?.correctMeaning || '',
        correctLabel: res?.correctLabel || '',
        timedOut: !!res?.timedOut,
      });
      setPhase('over');
      loadMy();
    },
    [clearTimer, loadMy]
  );

  /* ───────── 一次作答 ───────── */
  const doAnswer = useCallback(
    async (label: string | null, timeout: boolean) => {
      const rid = runIdRef.current;
      if (rid === null) return;
      if (lockedRef.current) return;
      setLocked(true);
      clearTimer();
      setChosen(label);

      const curIndex = indexRef.current;
      try {
        const res = await api.contest.answer({ runId: rid, index: curIndex, label: label || '', timeout });

        if (res.correct) {
          setMark({ correctLabel: res.correctLabel, correct: true, timedOut: false });
          setScore(res.score);
          const next = res.nextIndex ?? curIndex + 1;
          window.setTimeout(async () => {
            setMark(null);
            setChosen(null);
            if (next >= questionsRef.current.length) {
              try {
                const r = await api.contest.answer({ runId: rid, index: next, label: '' });
                finish(res.score, r);
              } catch {
                finish(res.score, null);
              }
            } else {
              const qs = questionsRef.current;
              const nextLimit = qs[next]?.timeLimit || perQRef.current;
              const prevLimit = qs[curIndex]?.timeLimit || perQRef.current;
              if (nextLimit < prevLimit) setSpeedUp(nextLimit); // 跨过提速线 → 弹提示
              setIndex(next);
              indexRef.current = next;
              setLocked(false);
              lockedRef.current = false;
              startTimer(nextLimit);
            }
          }, 620);
          return;
        }

        setMark({ correctLabel: res.correctLabel, correct: false, timedOut: !!res.timedOut });
        window.setTimeout(() => finish(res.score, res), 1250);
      } catch (e: any) {
        setErrMsg(e?.message || '判分失败');
        setLocked(false);
        lockedRef.current = false;
      }
    },
    [clearTimer, finish, startTimer]
  );

  useEffect(() => { submitRef.current = doAnswer; }, [doAnswer]);

  /* ───────── 开始一局 ───────── */
  const startGame = useCallback(async () => {
    setErrMsg('');
    setLoading(true);
    try {
      /* 【2026-10-11】原来是 150，答满就没题了；现请求题库全量（服务端会按题库大小截断） */
      const d = await api.contest.start(869);
      setRunId(d.runId);
      runIdRef.current = d.runId;
      setQuestions(d.questions);
      questionsRef.current = d.questions;
      setPerQ(d.perQuestionSec || 15);
      perQRef.current = d.perQuestionSec || 15;
      setTimeLadder(d.timeLadder || []);
      setIndex(0);
      indexRef.current = 0;
      setScore(0);
      setChosen(null);
      setMark(null);
      setFinal(null);
      setLocked(false);
      lockedRef.current = false;
      setSpeedUp(0);
      setPhase('playing');
      startTimer(d.questions[0]?.timeLimit || d.perQuestionSec || 15);
    } catch (e: any) {
      setErrMsg(e?.message || '开局失败');
    } finally {
      setLoading(false);
    }
  }, [startTimer]);

  /* ───────── 退出比赛 ───────── */
  const quitGame = useCallback(async () => {
    clearTimer();
    const rid = runIdRef.current;
    if (rid !== null && phaseRef.current === 'playing') {
      try { await api.contest.abandon(rid); } catch { /* ignore */ }
    }
    navigate('/');
  }, [clearTimer, navigate]);

  /* ───────── 排行榜 ───────── */
  const openBoard = useCallback(async () => {
    setPhase('board');
    setBoardLoading(true);
    try {
      setBoard(await api.contest.leaderboard());
    } catch {
      setBoard(null);
    } finally {
      setBoardLoading(false);
    }
  }, []);

  const cur = questions[index];
  const timerPct = Math.max(0, Math.min(100, (remaining / curLimit) * 100));
  const urgent = remaining <= 5 && remaining > 0;
  const timerColor = timerPct > 60 ? '#12B981' : timerPct > 30 ? GOLD : RED;

  const pool = prizeInfo?.pool || DEFAULT_POOL;
  const participation = prizeInfo?.participation ?? DEFAULT_PARTICIPATION;
  const tiers = prizeInfo?.tiers || DEFAULT_TIERS;

  /* ═════════════════════ 外壳 ═════════════════════ */
  const shell = (children: React.ReactNode, bg: string = BG) => (
    <div className="fixed inset-0 z-[60] overflow-y-auto" style={{ background: bg, color: INK }}>
      <style>{`
        .ct-kw{ color:#D7261A; font-weight:900; background:linear-gradient(180deg,rgba(255,180,60,.55),rgba(255,180,60,.28)); border-radius:6px; padding:0 3px; }
        .ct-scroll::-webkit-scrollbar{width:6px}
        .ct-scroll::-webkit-scrollbar-thumb{background:rgba(232,52,42,.25);border-radius:3px}
        @keyframes ctShine{ 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        .ct-shine{ background:linear-gradient(100deg,#FFE9A8 20%,#FFFDF5 40%,#FFD75E 55%,#FFE9A8 75%); background-size:200% 100%; animation:ctShine 2.6s linear infinite; }
        @keyframes ctPulse{ 0%,100%{transform:scale(1)} 50%{transform:scale(1.06)} }
        .ct-pulse{ animation:ctPulse .75s ease-in-out infinite; }
        @keyframes ctShake{ 0%,100%{transform:translateX(0)} 25%{transform:translateX(-3px)} 75%{transform:translateX(3px)} }
        .ct-shake{ animation:ctShake .35s ease-in-out infinite; }
      `}</style>
      {children}
    </div>
  );

  /* 暖色光晕装饰 */
  const glows = (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute rounded-full" style={{ top: '-12%', left: '-10%', width: 340, height: 340, background: 'radial-gradient(circle, rgba(255,138,43,.34), transparent 68%)', filter: 'blur(8px)' }} />
      <div className="absolute rounded-full" style={{ bottom: '-14%', right: '-12%', width: 380, height: 380, background: 'radial-gradient(circle, rgba(232,52,42,.28), transparent 68%)', filter: 'blur(10px)' }} />
      <div className="absolute rounded-full" style={{ top: '26%', right: '8%', width: 200, height: 200, background: 'radial-gradient(circle, rgba(255,176,32,.30), transparent 70%)', filter: 'blur(8px)' }} />
    </div>
  );

  /* ── 准备页 ── */
  if (phase === 'ready') {
    return shell(
      <div className="relative min-h-full flex flex-col">
        {glows}
        <header className="relative shrink-0 flex items-center px-4 pt-4">
          <button onClick={() => navigate('/')} className="w-10 h-10 -ml-1 flex items-center justify-center active:scale-90 transition-transform" style={{ color: INK }} aria-label="返回">
            <ChevronLeft className="w-7 h-7" strokeWidth={2.6} />
          </button>
        </header>

        <div className="relative flex-1 flex flex-col items-center justify-center px-5 pb-14">
          {/* 图标 */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 18 }}
            className="w-[86px] h-[86px] rounded-[1.7rem] flex items-center justify-center mb-4"
            style={{
              background: `linear-gradient(180deg,${ORANGE} 0%,${RED} 100%)`,
              boxShadow: '0 16px 34px rgba(232,52,42,.38), inset 0 3px 3px rgba(255,255,255,.5)',
            }}
          >
            <Swords className="w-11 h-11 text-white" strokeWidth={2.2} />
          </motion.div>

          <h1 className="text-[32px] font-black tracking-wide leading-none mb-2" style={{ background: `linear-gradient(135deg,${RED},${ORANGE})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
            实词大赛
          </h1>
          <p className="text-[13px] font-semibold mb-5" style={{ color: INK_2 }}>
            一站到底 · 答错为止 · 连对越多越强
          </p>

          {/* 奖池横幅 */}
          <div className="relative w-full max-w-md mb-4">
            <div className="ct-shine rounded-2xl px-5 py-3.5 flex items-center justify-center gap-2.5" style={{ boxShadow: '0 10px 24px rgba(232,52,42,.28), inset 0 0 0 2px rgba(255,255,255,.6)' }}>
              <Coins className="w-6 h-6" style={{ color: '#A35A00' }} strokeWidth={2.4} />
              <span className="text-[19px] font-black tracking-wide" style={{ color: '#7A3D00' }}>
                瓜分 {pool.toLocaleString()} 铜板
              </span>
              <Sparkles className="w-5 h-5" style={{ color: '#A35A00' }} />
            </div>
          </div>

          {/* 玩法 */}
          <div className="w-full max-w-md rounded-3xl bg-white/85 backdrop-blur-sm p-5 mb-4" style={{ boxShadow: '0 10px 26px rgba(200,120,80,.16)' }}>
            {[
              ['题目来自你的「文言实词」词库，看例句选释义', BookOpen],
              ['答对继续、答错即出局，成绩 = 连续答对题数', Flame],
              ['越答越快：20 题后 10 秒、50 题后 6 秒、100 题后 5 秒、150 题后 3.5 秒、200 题后 2.5 秒', TimerIcon],
              ['每题超时按答错处理', Zap],
            ].map(([txt, Icon]: any) => (
              <div key={txt} className="flex items-start gap-3 py-1.5">
                <span className="mt-0.5 w-6 h-6 shrink-0 rounded-lg flex items-center justify-center" style={{ background: 'rgba(232,52,42,.10)' }}>
                  <Icon className="w-3.5 h-3.5" style={{ color: RED }} strokeWidth={2.6} />
                </span>
                <span className="text-[13.5px] leading-6" style={{ color: INK }}>{txt}</span>
              </div>
            ))}
          </div>

          {/* 提速阶梯 */}
          <div className="flex items-center justify-center gap-2 mb-4 flex-wrap">
            {(timeLadder.length ? timeLadder : DEFAULT_LADDER).map((l, i) => (
              <span
                key={l.from}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-bold"
                style={{
                  background: i === 0 ? 'rgba(232,52,42,.10)' : `rgba(255,138,43,${0.12 + i * 0.06})`,
                  color: i === 0 ? INK_2 : '#C2410C',
                }}
              >
                {i === 0 ? '开局' : `≥${l.from}题`} {l.sec}s
              </span>
            ))}
          </div>

          {/* 奖励 */}
          <div className="w-full max-w-md rounded-3xl bg-white/90 p-5 mb-4" style={{ boxShadow: '0 10px 26px rgba(200,120,80,.18)', border: `2px solid rgba(255,176,32,.45)` }}>
            <div className="flex items-center gap-2 mb-3">
              <Gift className="w-4 h-4" style={{ color: GOLD }} />
              <span className="text-[15px] font-black" style={{ color: '#B26A00' }}>大赛奖励</span>
              <span className="ml-auto text-[11px] font-semibold" style={{ color: INK_2 }}>
                {prizeInfo?.settled ? '已结算' : `${prizeInfo?.settleDate || DEFAULT_SETTLE_DATE} 结算`}
              </span>
            </div>
            <div className="grid gap-1.5">
              {tiers.map((t) => (
                <div key={t.label} className="flex items-center justify-between text-[13px]">
                  <span style={{ color: INK_2 }}>{t.label}</span>
                  <span className="font-black" style={{ color: RED }}>{t.amount} 铜板</span>
                </div>
              ))}
              <div className="flex items-center justify-between text-[13px] pt-1.5 mt-1" style={{ borderTop: '1px dashed rgba(232,52,42,.22)' }}>
                <span className="flex items-center gap-1.5" style={{ color: INK_2 }}>
                  <Sparkles className="w-3.5 h-3.5" style={{ color: GOLD }} /> 参与奖
                </span>
                <span className="font-black" style={{ color: '#B26A00' }}>每人 {participation} 铜板</span>
              </div>
            </div>
            <div className="mt-2.5 text-[11.5px] leading-5" style={{ color: INK_2 }}>
              {(prizeInfo?.participationNote || '答对 ≥1 题即可获参与奖，可与名次奖叠加')}；按历史最高答题数排名，
              {prizeInfo?.settled ? '奖励已自动发放到账。' : `${prizeInfo?.settleDate || DEFAULT_SETTLE_DATE} 自动结算到账。`}
            </div>
            {prizeInfo?.settled && (
              <div className="mt-3 flex items-center gap-2 text-[13px] font-black" style={{ color: '#B26A00' }}>
                <Zap className="w-4 h-4" fill="currentColor" />
                {myPrize > 0 ? `你已获得 ${myPrize} 铜板` : '本赛你未获得奖励'}
              </div>
            )}
          </div>

          {/* 我的成绩 */}
          <div className="flex items-center gap-6 mb-6">
            <div className="text-center">
              <div className="text-[30px] font-black leading-none" style={{ color: RED }}>{myBest}</div>
              <div className="text-[11px] mt-1" style={{ color: INK_2 }}>历史最高答题数</div>
            </div>
            <span className="w-px h-10" style={{ background: 'rgba(232,52,42,.18)' }} />
            <div className="text-center">
              <div className="text-[30px] font-black leading-none" style={{ color: INK }}>{myPlays}</div>
              <div className="text-[11px] mt-1" style={{ color: INK_2 }}>已挑战次数</div>
            </div>
          </div>

          {errMsg && (
            <div className="mb-4 px-4 py-2 rounded-xl text-[13px] font-semibold text-white" style={{ background: RED }}>
              {errMsg}
            </div>
          )}

          <button
            onClick={startGame}
            disabled={loading}
            className="w-full max-w-md py-4 rounded-2xl font-black text-[18px] text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-70"
            style={{ background: `linear-gradient(135deg,${ORANGE},${RED})`, boxShadow: '0 12px 26px rgba(232,52,42,.40)' }}
          >
            {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <><Zap className="w-6 h-6" fill="white" /> 开始挑战</>}
          </button>

          <button
            onClick={openBoard}
            className="mt-3 w-full max-w-md py-3.5 rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform bg-white/80"
            style={{ color: RED, boxShadow: 'inset 0 0 0 2px rgba(232,52,42,.20)' }}
          >
            <ListOrdered className="w-5 h-5" /> 查看排行榜
          </button>
        </div>
      </div>
    );
  }

  /* ── 排行榜 ── */
  if (phase === 'board') {
    const list = board?.list ?? [];
    const me = board?.me;
    const medal = (r: number) => (r === 1 ? '#E8A020' : r === 2 ? '#9AA6B2' : r === 3 ? '#C97B3C' : INK_2);
    const medalBg = (r: number) => (r === 1 ? '#FFF0C2' : r === 2 ? '#EEF1F4' : r === 3 ? '#FBE7D6' : 'rgba(255,255,255,.85)');
    return shell(
      <div className="relative min-h-full flex flex-col">
        {glows}
        <header className="relative shrink-0 flex items-center gap-2 px-4 pt-4 pb-3">
          <button onClick={() => setPhase('ready')} className="w-10 h-10 -ml-1 flex items-center justify-center active:scale-90 transition-transform" style={{ color: INK }} aria-label="返回">
            <ChevronLeft className="w-7 h-7" strokeWidth={2.6} />
          </button>
          <div className="min-w-0">
            <h2 className="text-[18px] font-black">实词大赛 · 排行榜</h2>
            <div className="text-[11px] mt-0.5" style={{ color: INK_2 }}>
              最高答题数排名 · 参与奖 {participation} · 前 {board?.prize?.topN || 20} 名额外奖励 ·{' '}
              {board?.prize?.settled ? '已结算' : `${board?.prize?.settleDate || DEFAULT_SETTLE_DATE} 结算`}
            </div>
          </div>
        </header>

        <main className="relative flex-1 px-4 pb-4 ct-scroll">
          {boardLoading ? (
            <div className="flex items-center justify-center py-24"><Loader2 className="w-7 h-7 animate-spin" style={{ color: RED }} /></div>
          ) : list.length === 0 ? (
            <div className="text-center py-24 text-sm font-semibold" style={{ color: INK_2 }}>还没有人上榜，快去抢第一！</div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-1.5">
              {list.map((it, i) => (
                <motion.div
                  key={it.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.22, delay: Math.min(i * 0.03, 0.4) }}
                  className="flex items-center gap-3 py-2.5 px-3 rounded-2xl"
                  style={{
                    background: it.id === user?.id ? 'rgba(255,176,32,.16)' : 'rgba(255,255,255,.86)',
                    boxShadow: it.rank <= 3 ? `inset 0 0 0 2px ${medal(it.rank)}55` : '0 4px 14px rgba(200,120,80,.10)',
                  }}
                >
                  <span className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-[14px] font-black" style={{ background: medalBg(it.rank), color: medal(it.rank) }}>
                    {it.rank <= 3 ? <Crown className="w-4 h-4" style={{ color: medal(it.rank) }} /> : it.rank}
                  </span>
                  <span className="relative inline-flex shrink-0" style={{ width: 44, height: 44 }}>
                    <span className="block w-full h-full rounded-full overflow-hidden flex items-center justify-center" style={{ boxShadow: '0 0 0 2px rgba(232,52,42,.18)', background: 'linear-gradient(135deg,#FFB020,#FF6A3D)' }}>
                      {it.avatar_url ? (
                        <img src={it.avatar_url} alt={it.username} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <span className="text-white font-black text-base">{(it.username || '?').charAt(0).toUpperCase()}</span>
                      )}
                    </span>
                    {it.badge_label ? <UserBadge size={44} label={it.badge_label} /> : null}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-bold truncate" style={{ color: INK }}>{it.username}</div>
                  </div>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-[16px] font-black" style={{ color: RED }}>
                      {it.count}<span className="text-[11px] font-bold ml-1" style={{ color: INK_2 }}>题</span>
                    </span>
                    {it.prize > 0 && (
                      <span className="text-[11px] font-black px-2 py-0.5 rounded-full" style={{ background: 'linear-gradient(135deg,#FFE9A8,#FFD75E)', color: '#8A4B00' }}>
                        +{it.prize}
                      </span>
                    )}
                  </span>
                </motion.div>
              ))}
            </div>
          )}
        </main>

        {me && (
          <footer className="relative shrink-0 px-4 py-3 flex items-center gap-3 bg-white/90" style={{ boxShadow: '0 -6px 18px rgba(200,120,80,.16)' }}>
            <span className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-[13px] font-black" style={{ background: me.rank ? '#FFF0C2' : 'rgba(0,0,0,.05)', color: me.rank ? '#E8A020' : INK_2 }}>
              {me.rank ?? '--'}
            </span>
            <span className="w-10 h-10 rounded-full overflow-hidden shrink-0 flex items-center justify-center" style={{ boxShadow: '0 0 0 2px rgba(232,52,42,.18)', background: 'linear-gradient(135deg,#FFB020,#FF6A3D)' }}>
              {user?.avatar_url ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" /> : <span className="text-white font-black">{(user?.username || '?').charAt(0)}</span>}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-bold truncate" style={{ color: INK }}>{user?.username}</div>
              <div className="text-[11px]" style={{ color: INK_2 }}>{me.rank ? '已上榜' : '还没有成绩'} · 挑战 {me.plays} 次</div>
            </div>
            <div className="text-right shrink-0">
              <span className="text-[16px] font-black" style={{ color: RED }}>{me.best}<span className="text-[11px] font-bold ml-1" style={{ color: INK_2 }}>题</span></span>
              {me.prize > 0 && <div className="text-[11px] font-black" style={{ color: '#B26A00' }}>+{me.prize} 铜板</div>}
            </div>
          </footer>
        )}

        <div className="relative shrink-0 px-4 pb-6 pt-2 max-w-2xl w-full mx-auto">
          <button onClick={startGame} className="w-full py-3.5 rounded-2xl font-black text-[16px] text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-transform" style={{ background: `linear-gradient(135deg,${ORANGE},${RED})`, boxShadow: '0 10px 22px rgba(232,52,42,.34)' }}>
            <Zap className="w-5 h-5" fill="white" /> 开始挑战
          </button>
        </div>
      </div>
    );
  }

  /* ── 结束页 ── */
  if (phase === 'over' && final) {
    /* 【2026-10-09 修复】原先这里把 bg 写成了内层 <div> 的 JSX 属性：
     *     shell(<div ... bg={`linear-gradient(...)`}>)
     * 但 shell 的签名是 (children, bg)，bg 是**第二个位置参数**，不是 div 的属性。
     * 结果 bg 被当作非法 DOM 属性透传到 <div>，TS 报 TS2322（Property 'bg' does not
     * exist on type 'HTMLAttributes<HTMLDivElement>'），运行时也只是个无用的空属性 ——
     * 红色渐变背景从未生效过。现改为把渐变作为 shell 的第二参数传入。 */
    return shell(
      <div className="relative min-h-full flex flex-col items-center justify-center px-6 py-10">
        <motion.div
          initial={{ scale: 0.85, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 18 }}
          className="w-full max-w-md rounded-3xl bg-white p-7 text-center"
          style={{ boxShadow: '0 22px 50px rgba(120,10,0,.35)' }}
        >
          <div className="text-[13px] font-black mb-3" style={{ color: RED }}>
            {final.cleared ? '🏆 全部答对，通关！' : final.timedOut ? '⏰ 超时出局' : '💥 答错出局'}
          </div>

          <div className="text-[14px] font-bold mb-1" style={{ color: INK_2 }}>本次连对</div>
          <div className="flex items-end justify-center gap-1 mb-4">
            <span className="text-[66px] leading-none font-black" style={{ color: RED }}>{final.score}</span>
            <span className="text-xl font-black mb-2" style={{ color: INK_2 }}>题</span>
          </div>

          {final.newRecord && (
            <div className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-full mb-4 text-[13px] font-black ct-pulse" style={{ background: 'linear-gradient(135deg,#FFE08A,#FFB020)', color: '#6B3A00' }}>
              <Zap className="w-4 h-4" fill="#6B3A00" /> 新纪录！
            </div>
          )}

          {!final.cleared && final.correctMeaning && (
            <div className="mt-1 mb-5 px-4 py-3 rounded-2xl text-left text-[13px] leading-6" style={{ background: '#FFF4E9' }}>
              <div className="font-bold mb-1" style={{ color: INK_2 }}>正确答案是 {final.correctLabel}</div>
              <div className="font-semibold" style={{ color: INK }}>{final.correctMeaning}</div>
            </div>
          )}

          <div className="flex items-center justify-center gap-8 mb-6">
            <div className="text-center">
              <div className="text-[24px] font-black leading-none" style={{ color: INK }}>{final.best}</div>
              <div className="text-[11px] mt-1" style={{ color: INK_2 }}>历史最高</div>
            </div>
            <span className="w-px h-9" style={{ background: 'rgba(232,52,42,.18)' }} />
            <div className="text-center">
              <div className="text-[24px] font-black leading-none" style={{ color: INK }}>{myPlays}</div>
              <div className="text-[11px] mt-1" style={{ color: INK_2 }}>挑战次数</div>
            </div>
            <span className="w-px h-9" style={{ background: 'rgba(232,52,42,.18)' }} />
            <div className="text-center">
              <div className="text-[24px] font-black leading-none" style={{ color: '#B26A00' }}>{participation}</div>
              <div className="text-[11px] mt-1" style={{ color: INK_2 }}>参与奖</div>
            </div>
          </div>

          <button onClick={startGame} className="w-full py-3.5 rounded-2xl font-black text-[17px] text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-transform mb-3" style={{ background: `linear-gradient(135deg,${ORANGE},${RED})`, boxShadow: '0 12px 26px rgba(232,52,42,.38)' }}>
            <RotateCcw className="w-5 h-5" /> 再来一局
          </button>
          <div className="flex gap-3">
            <button onClick={openBoard} className="flex-1 py-3 rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform" style={{ background: '#FFF4E9', color: RED }}>
              <Trophy style={{ width: 18, height: 18 }} /> 排行榜
            </button>
            <button onClick={() => navigate('/')} className="flex-1 py-3 rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform" style={{ background: '#FFF4E9', color: INK }}>
              <Home style={{ width: 18, height: 18 }} /> 返回首页
            </button>
          </div>
        </motion.div>
      </div>,
      /* 结束页专用背景：暖橙 → 正红 的渐变（原来误写成 div 属性，从未生效） */
      `linear-gradient(160deg,${ORANGE} 0%,${RED} 62%,#C21B12 100%)`,
    );
  }

  /* ── 进行中 ── */
  return shell(
    <div className="relative min-h-full flex flex-col">
      {glows}

      {/* 提速提示 */}
      <AnimatePresence>
        {speedUp > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.92 }}
            className="absolute left-1/2 -translate-x-1/2 top-24 z-30 px-4 py-2 rounded-full font-black text-white text-[14px] whitespace-nowrap"
            style={{ background: `linear-gradient(135deg,${ORANGE},${RED})`, boxShadow: '0 10px 24px rgba(232,52,42,.42)' }}
          >
            ⚡ 提速！每题 {speedUp} 秒
          </motion.div>
        )}
      </AnimatePresence>

      <header className="relative shrink-0 px-4 pt-4">
        <div className="flex items-center justify-between">
          <button onClick={quitGame} className="w-10 h-10 -ml-1 flex items-center justify-center active:scale-90 transition-transform" style={{ color: INK }} aria-label="退出比赛">
            <X className="w-6 h-6" strokeWidth={2.8} />
          </button>
          <div className="text-[13px] font-bold" style={{ color: INK_2 }}>第 {(cur?.index ?? 0) + 1} 题</div>
          <div className={`flex items-center gap-1.5 px-3 h-8 rounded-full ${score > 0 ? 'ct-pulse' : ''}`} style={{ background: 'rgba(232,52,42,.12)' }}>
            <Flame className="w-4 h-4" style={{ color: RED }} fill={RED} />
            <span className="text-[15px] font-black" style={{ color: RED }}>{score}</span>
          </div>
        </div>

        {/* 计时条 —— 紧张感核心 */}
        <div className={`mt-3 flex items-center gap-2 ${urgent ? 'ct-shake' : ''}`}>
          <TimerIcon className="w-4 h-4 shrink-0" style={{ color: timerColor }} />
          <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(232,52,42,.12)' }}>
            <motion.div className="h-full rounded-full" style={{ background: timerColor }} animate={{ width: `${timerPct}%` }} transition={{ duration: 0.1, ease: 'linear' }} />
          </div>
          <span className="w-16 text-right text-[15px] font-black tabular-nums shrink-0" style={{ color: timerColor }}>
            {Math.ceil(remaining)}<span className="text-[10px] font-bold opacity-60">/{curLimit}s</span>
          </span>
        </div>
      </header>

      <main className="relative flex-1 flex flex-col px-5 pt-5 pb-6">
        <div className="max-w-2xl w-full mx-auto flex-1 flex flex-col">
          {/* 题干 */}
          <motion.div
            key={cur?.index}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28 }}
            className="rounded-3xl bg-white p-6 mb-5"
            style={{ boxShadow: '0 14px 34px rgba(200,120,80,.20)' }}
          >
            <div className="text-[12px] font-bold mb-3" style={{ color: INK_2 }}>下列加粗实词在句中的意思是？</div>
            <div className="text-[22px] leading-[1.7] font-semibold" style={{ color: INK }} dangerouslySetInnerHTML={{ __html: stemHtml(cur?.stem || '') }} />
            {cur?.source && <div className="text-[12px] mt-3 text-right" style={{ color: INK_2 }}>{cur.source}</div>}
          </motion.div>

          {/* 选项 */}
          <div className="grid gap-2.5 mt-auto">
            {(cur?.options || []).map((o) => {
              const isChosen = chosen === o.label;
              const isCorrect = mark && o.label === mark.correctLabel;
              const isWrongPick = mark && isChosen && !mark.correct;
              let style: React.CSSProperties = { background: '#FFFFFF', boxShadow: '0 6px 18px rgba(200,120,80,.16)' };
              if (isCorrect) style = { background: '#E7FBF3', boxShadow: 'inset 0 0 0 2.5px #12B981' };
              else if (isWrongPick) style = { background: '#FEECEA', boxShadow: 'inset 0 0 0 2.5px #E8342A' };
              return (
                <button
                  key={o.label}
                  disabled={locked}
                  onClick={() => doAnswer(o.label, false)}
                  className="w-full text-left rounded-2xl px-3.5 py-3.5 flex items-center gap-3 active:scale-[0.985] transition-transform disabled:cursor-default"
                  style={style}
                >
                  <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center font-black text-white bg-gradient-to-br ${LABEL_CLS[o.label] || 'from-rose-400 to-red-500'}`} style={{ boxShadow: '0 4px 10px rgba(232,52,42,.28)' }}>
                    {o.label}
                  </span>
                  <span className="flex-1 text-[15.5px] leading-6 font-semibold" style={{ color: INK }}>{o.text}</span>
                  {isCorrect && <Check className="w-5 h-5 shrink-0" style={{ color: '#12B981' }} strokeWidth={3} />}
                  {isWrongPick && <X className="w-5 h-5 shrink-0" style={{ color: RED }} strokeWidth={3} />}
                </button>
              );
            })}
          </div>

          <div className="h-6 mt-3 text-center text-[13px] font-black">
            <AnimatePresence mode="wait">
              {mark && (
                <motion.span
                  key={mark.correct ? 'ok' : 'no'}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  style={{ color: mark.correct ? '#12B981' : RED }}
                >
                  {mark.correct ? '答对了！继续～' : mark.timedOut ? '超时啦，比赛结束' : '答错了，比赛结束'}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}
