import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen, CalendarCheck, Flame, ListTodo, Loader2, Repeat, Coins, Target, Gift,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import V2PageShell from './components/V2PageShell';

/**
 * 任务中心（V2 · 罐子版 UI）
 *   数据源与「一起背」任务小车一致：api.tasks.today()
 *   领奖走 api.coins.taskClaim(key)，服务端权威校验进度
 *   UI 参考：浅蓝背景 + 玻璃罐进度 + 白卡任务列表
 * ============================================================ */

/**
 * 任务类型。后三种是【2026-10-14】按间隔重复理念新增的，
 * 共同点是都不看「单日复习张数」，只看节奏与质量。
 */
type TaskType = 'learn' | 'review' | 'checkin' | 'due' | 'accuracy' | 'streak';

interface TaskItem {
  id: number;
  key: string;
  type: TaskType;
  title: string;
  target: number;
  reward: number;
  sort: number;
  progress: number;
  done: boolean;
  claimed: boolean;
  /** due 任务专用：没有复习卡 → 不适用（按钮改为「去学习」） */
  notApplicable?: boolean;
}

interface TodayData {
  date: string;
  /** 每日任务：当天可完成，隔天重置 */
  tasks: TaskItem[];
  /**
   * 长期成就（连续达标 N 天）。
   * 【2026-10-15】服务端已把它从 tasks 里拆出来，混在每日任务中会被误读成
   * 「今天必须完成」—— 学生反馈「持续复习 30 天为什么算是每日任务」。
   */
  achievements?: TaskItem[];
}

/**
 * 各类型任务的图标与「去完成」跳转目标。
 * grad 统一橙色渐变（对齐参考稿的徽章观感）；unit 用于行内进度单位。
 */
const TYPE_META: Record<TaskType, { icon: typeof BookOpen; grad: string; go: string; unit: string }> = {
  learn: { icon: BookOpen, grad: 'from-amber-300 to-orange-400', go: '/study', unit: '词' },
  checkin: { icon: CalendarCheck, grad: 'from-amber-300 to-orange-400', go: '/', unit: '' },
  review: { icon: Repeat, grad: 'from-amber-300 to-orange-400', go: '/review', unit: '张' },
  due: { icon: Target, grad: 'from-amber-300 to-orange-400', go: '/review', unit: '%' },
  accuracy: { icon: Target, grad: 'from-amber-300 to-orange-400', go: '/review', unit: '%' },
  streak: { icon: Flame, grad: 'from-amber-300 to-orange-400', go: '/review', unit: '天' },
};

/** 玻璃罐进度（SVG）：填充高度随「已领任务数 / 任务总数」变化 */
function Jar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  const fillTop = 46 + (1 - pct) * 96;
  return (
    <svg viewBox="0 0 200 172" className="w-44 h-40 mx-auto" style={{ filter: 'drop-shadow(0 10px 14px rgba(90,130,180,0.28))' }}>
      <defs>
        <clipPath id="jar-clip">
          <path d="M62 42 Q100 34 138 42 L150 132 Q100 158 50 132 Z" />
        </clipPath>
      </defs>
      {/* 瓶盖 */}
      <rect x="56" y="12" width="88" height="16" rx="8" fill="#D9AF7F" />
      <ellipse cx="100" cy="28" rx="47" ry="11" fill="#C79A67" />
      {/* 瓶内填充（先画，压在瓶身玻璃下面） */}
      <rect x="38" y={fillTop} width="124" height={172 - fillTop} fill="#FFE7BE" clipPath="url(#jar-clip)" />
      {/* 瓶身玻璃 */}
      <path
        d="M62 42 Q100 34 138 42 L150 132 Q100 158 50 132 Z"
        fill="rgba(255,255,255,0.72)" stroke="#FFFFFF" strokeWidth="4" strokeLinejoin="round"
      />
      {/* 高光 */}
      <path d="M72 52 Q80 96 68 128" stroke="rgba(255,255,255,0.9)" strokeWidth="5" fill="none" strokeLinecap="round" />
      {/* 数字 */}
      <text x="100" y="102" textAnchor="middle" fontSize="36" fontWeight="800" fill="#3D4C63">{done}</text>
      <text x="100" y="124" textAnchor="middle" fontSize="14" fontWeight="700" fill="#93A1B3">/{total}</text>
    </svg>
  );
}


/**
 * 单条任务行 —— 每日任务与长期成就共用同一份渲染。
 * 抽出来是为了让两个区块长得一致，且改样式只需改一处。
 */
function TaskRow({
  t, claiming, onClaim,
}: {
  t: TaskItem;
  claiming: string | null;
  onClaim: (t: TaskItem) => void;
}) {
  const meta = TYPE_META[t.type] || TYPE_META.review;
  const Icon = meta.icon;
  const isClaiming = claiming === t.key;
  const shown = Math.min(t.progress, t.target);
  const pct = t.target > 0 ? Math.min(100, Math.round((t.progress / t.target) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      {/* 橙色徽章 + 奖励角标 */}
      <div className="relative shrink-0">
        <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${meta.grad} flex items-center justify-center shadow-md`}>
          <Icon className="w-6 h-6 text-white" strokeWidth={2.2} />
        </div>
        <span className="absolute -bottom-1 -left-1.5 h-5 min-w-[26px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center shadow ring-2 ring-white">
          x{t.reward}
        </span>
      </div>

      {/* 标题 + 进度 */}
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-bold text-slate-800 truncate">
          {t.title}{' '}
          <span className="text-[12px] font-semibold text-slate-400">
            ({t.notApplicable
              ? '暂无复习任务'
              : t.type === 'checkin'
                ? (t.done ? '已完成' : '未完成')
                : `${shown}/${t.target}${meta.unit}`})
          </span>
        </p>
        {/* 细进度条 */}
        <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${t.claimed ? 'bg-emerald-400' : t.done ? 'bg-orange-400' : 'bg-sky-300'}`}
            style={{ width: `${t.claimed ? 100 : pct}%` }}
          />
        </div>
      </div>

      {/* 右侧动作 */}
      {t.claimed ? (
        <span className="shrink-0 h-9 px-4 inline-flex items-center rounded-full bg-slate-100 text-slate-400 text-[13px] font-bold">
          已领取
        </span>
      ) : t.done ? (
        <button
          disabled={isClaiming}
          onClick={() => onClaim(t)}
          className="shrink-0 h-9 px-5 inline-flex items-center rounded-full bg-gradient-to-r from-orange-400 to-amber-500 text-white text-[13px] font-bold shadow-md active:scale-95 transition-transform disabled:opacity-60"
        >
          {isClaiming ? <Loader2 className="w-4 h-4 animate-spin" /> : '领取'}
        </button>
      ) : (
        <Link
          to={t.notApplicable ? '/study' : meta.go}
          className="shrink-0 h-9 px-4 inline-flex items-center rounded-full bg-sky-100 text-sky-600 text-[13px] font-bold active:scale-95 transition-transform"
        >
          {t.notApplicable ? '去学习' : '去完成'}
        </Link>
      )}
    </div>
  );
}

export default function TasksPageV2() {
  const { user, openLoginModal } = useAuth();

  // ── 状态（置于最前，保证 hook 顺序稳定） ──
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  // ── 拉取今日任务（每次挂载/登录后自动刷新进度） ──
  const load = useCallback(() => {
    if (!user) return;
    setLoading(true);
    api.tasks.today()
      .then(d => setData(d))
      .catch(() => { setData(null); showToast('任务加载失败，请稍后重试'); })
      .finally(() => setLoading(false));
  }, [user, showToast]);

  useEffect(() => { load(); }, [load]);

  // ── 领奖 ──
  const claim = async (t: TaskItem) => {
    if (claiming || !t.done || t.claimed) return;
    setClaiming(t.key);
    try {
      const res = await api.coins.taskClaim(t.key);
      /* 两组都要更新：长期成就与每日任务同在一份数据里，领完要立刻反映 */
      setData(d => {
        if (!d) return d;
        const mark = (x: TaskItem) => (x.key === t.key ? { ...x, claimed: true } : x);
        return { ...d, tasks: d.tasks.map(mark), achievements: (d.achievements || []).map(mark) };
      });
      showToast(`+${res.added} 铜板已入账`);
    } catch (e: any) {
      if (e instanceof TypeError) return; // 网络异常静默
      showToast(e?.message || '领取失败，请稍后再试');
    } finally {
      setClaiming(null);
    }
  };

  // ── 未登录：居中提示 ──
  if (!user) {
    return (
      <V2PageShell title="任务中心" backTo="/">
        <div className="min-h-[70vh] flex flex-col items-center justify-center px-6 text-center">
          <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center mb-4 shadow-md">
            <ListTodo className="w-9 h-9 text-slate-300" />
          </div>
          <h2 className="text-lg font-bold text-slate-800 mb-1">请先登录</h2>
          <p className="text-sm text-slate-500 mb-5">登录后完成每日任务，领取铜板奖励</p>
          <button
            onClick={openLoginModal}
            className="px-8 py-2.5 rounded-full text-white text-sm font-bold shadow-lg hover:scale-105 active:scale-95 transition-transform"
            style={{ background: 'linear-gradient(135deg,#5B8BF5,#3B6BE8)' }}
          >
            立即登录
          </button>
        </div>
      </V2PageShell>
    );
  }

  const tasks = data?.tasks ?? [];
  const achievements = data?.achievements ?? [];
  const claimedCount = tasks.filter(t => t.claimed).length;
  const claimableCount = tasks.filter(t => t.done && !t.claimed).length;
  const claimableReward = tasks
    .filter(t => t.done && !t.claimed)
    .reduce((s, t) => s + t.reward, 0);
  const allDone = tasks.length > 0 && claimedCount === tasks.length;

  return (
    <V2PageShell title="任务中心" backTo="/">
      <div className="max-w-2xl mx-auto px-4 pt-1 pb-8">
        {/* ── 玻璃罐：今日全勤进度 ── */}
        <div className="relative pt-2">
          <Jar done={claimedCount} total={tasks.length} />
          <Gift className="absolute right-1 top-6 w-9 h-9 text-white/90 rotate-12 drop-shadow-md" strokeWidth={1.8} />
          <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-white/85 backdrop-blur px-4 py-3 shadow-sm">
            <p className="text-[13px] leading-snug text-slate-600">
              完成任务得铜板，集齐 <span className="font-bold text-sky-500">{tasks.length}</span> 个今日全勤
              {claimableCount > 0 && (
                <span className="ml-1 font-bold text-orange-500">· 可领 +{claimableReward}</span>
              )}
            </p>
            <span
              className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold ${
                allDone ? 'bg-gradient-to-r from-orange-400 to-amber-500 text-white shadow' : 'bg-slate-100 text-slate-400'
              }`}
            >
              {allDone ? '已全勤 🎉' : '进行中'}
            </span>
          </div>
        </div>

        {/* ── 每日任务 ── */}
        <h2 className="mt-6 mb-2 px-1 text-[15px] font-bold text-slate-700">每日任务</h2>
        <div className="bg-white/90 backdrop-blur rounded-3xl shadow-sm divide-y divide-slate-100 overflow-hidden">
          {loading ? (
            <div className="py-14 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="py-14 text-center text-sm text-slate-400">今天暂时没有任务</div>
          ) : (
            tasks.map(t => (
              <TaskRow key={t.id} t={t} claiming={claiming} onClaim={claim} />
            ))
          )}
        </div>

        {/* ── 坚持成就（长期目标）──
             刻意与「每日任务」分开一段：学生反馈「持续复习 30 天为什么算是每日任务」
             「这怎么完成」—— 30 天里程碑出现在今日待办里，看着就像今天必须做完的事。 */}
        {achievements.length > 0 && (
          <>
            <h2 className="mt-6 mb-2 px-1 text-[15px] font-bold text-slate-700">坚持成就</h2>
            <div className="bg-white/90 backdrop-blur rounded-3xl shadow-sm divide-y divide-slate-100 overflow-hidden">
              {achievements.map(t => (
                <TaskRow key={t.id} t={t} claiming={claiming} onClaim={claim} />
              ))}
            </div>
            <p className="mt-2 px-1 text-[12px] text-slate-400">
              长期目标，不用今天完成 · 断一天会重新计数
            </p>
          </>
        )}

        <p className="pt-3 text-center text-[12px] text-slate-400">
          任务每天 0 点刷新 · 奖励自动计入铜板余额
        </p>
      </div>

      {/* ── 轻量 toast ── */}
      {toast && (
        <div className="fixed left-1/2 top-16 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full bg-slate-800/90 text-white text-sm shadow-lg backdrop-blur">
          {toast}
        </div>
      )}
    </V2PageShell>
  );
}
