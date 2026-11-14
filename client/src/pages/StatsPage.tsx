import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BarChart3, Layers, Clock, Brain, BookOpen, TrendingUp, CalendarDays } from 'lucide-react';
import MemoryMascot from './v2/components/MemoryMascot';
import {
  ReviewPlanChart,
  MasteryChart,
  ProgressStackChart,
  StageBreakdown,
} from './v2/components/StatsCharts';

/**
 * 统计页（百词斩风格改版 · 2026-09-28）
 *
 * 信息层级自上而下：
 *   ① 吉祥物 + 智能提示气泡（有到期卡时强调「最佳复习时机」）
 *   ② 6 个关键数字卡（保留原设计，信息密度高且实用）
 *   ③ 我的复习计划 —— 未来 10 天到期分布柱状图
 *   ④ 我的掌握现状 —— 五档记忆阶段柱状图
 *   ⑤ 我的掌握进展 —— 近 11 天阶段堆叠面积图 + 文字明细
 *
 * 数据来源：
 *   /cards/stats/overview      原有总览（数字卡）
 *   /cards/stats/review-plan   未来 10 天计划（新增）
 *   /cards/stats/stages        记忆阶段现状与趋势（新增）
 */
export default function StatsPage() {
  const { user, openLoginModal } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [stages, setStages] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // 部分接口失败的提示（不是全失败时用轻量横幅，而不是整页替换）
  const [partialFailed, setPartialFailed] = useState(false);

  // 【2026-09-28 修复】依赖从 [user] 改为 [user?.id]：
  // user 是对象，每次 AuthContext 刷新都会产生新引用，导致重复拉取；
  // 而切换账号时若引用恰好相同又不会重新拉取。用 id 做依赖才正确。
  const userId = user?.id;

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    setPartialFailed(false);
    // 三个请求并行，各自失败互不影响
    Promise.allSettled([
      api.cards.statsOverview(),
      api.cards.reviewPlan(),
      api.cards.stages(),
    ])
      .then(([o, p, s]) => {
        if (o.status === 'fulfilled') setStats(o.value);
        if (p.status === 'fulfilled') setPlan(p.value);
        if (s.status === 'fulfilled') setStages(s.value);
        const results = [o, p, s];
        const okCount = results.filter((r) => r.status === 'fulfilled').length;
        // 【2026-09-28 修复】原先要求「三个全失败」才提示错误，
        // 于是部分失败时图表区静默消失、用户完全不知道发生了什么。
        // 现改为：全失败 → 整页错误态；部分失败 → 顶部轻量提示。
        if (okCount === 0) setFailed(true);
        else if (okCount < results.length) setPartialFailed(true);
      })
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    );
  }

  /* ── 未登录骨架屏（保留原交互，让访客知道登录后能看什么） ── */
  if (!user) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-400">统计</h1>
          <p className="text-gray-300 mt-1">追踪你的学习进度</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { icon: Layers, label: '总卡片', color: 'bg-blue-50 text-blue-200' },
            { icon: Clock, label: '明天复习', color: 'bg-orange-50 text-orange-200' },
            { icon: Brain, label: '今日待复习', color: 'bg-green-50 text-green-200' },
            { icon: BookOpen, label: '今日已复习', color: 'bg-purple-50 text-purple-200' },
            { icon: TrendingUp, label: '连续天数', color: 'bg-red-50 text-red-200' },
            { icon: CalendarDays, label: '卡片/天', color: 'bg-indigo-50 text-indigo-200' },
          ].map((item, i) => (
            <div
              key={i}
              className="bg-white/40 backdrop-blur-sm rounded-2xl border-2 border-dashed border-gray-200 p-4"
            >
              <div
                className={`w-10 h-10 rounded-xl ${item.color} flex items-center justify-center mb-3`}
              >
                <item.icon className="w-5 h-5" />
              </div>
              <div className="text-2xl font-bold text-gray-300">---</div>
              <div className="text-sm text-gray-400">{item.label}</div>
            </div>
          ))}
        </div>
        <div className="text-center py-4">
          <button
            onClick={openLoginModal}
            className="px-6 py-2.5 rounded-full bg-gradient-to-r from-primary-600 to-indigo-600 text-white text-sm font-medium shadow-soft hover:shadow-lg hover:translate-y-[-1px] transition-all duration-250 ease-premium"
          >
            登录查看完整统计
          </button>
        </div>
      </div>
    );
  }

  const dueCount = plan?.todayCount ?? 0;
  const hasDue = dueCount > 0;

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-8">
      {/* ① 吉祥物 + 提示气泡 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative"
      >
        <div className="glass rounded-3xl p-4 sm:p-5 flex items-center gap-3 sm:gap-5 overflow-hidden">
          {/* 背景装饰光斑 */}
          <div className="absolute -top-10 -right-6 w-40 h-40 rounded-full bg-indigo-200/25 blur-2xl pointer-events-none" />
          <div className="shrink-0">
            <MemoryMascot size={104} mood={hasDue ? 'happy' : 'idle'} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] sm:text-base leading-relaxed text-slate-700 font-medium">
              {hasDue ? (
                <>
                  咩，扫描到{' '}
                  <span className="text-indigo-600 font-bold">{dueCount}</span> 张卡片正处于
                  <span className="text-rose-500 font-bold">「最佳复习时机」</span>，请前往复习。
                </>
              ) : (
                <>
                  咩，今天没有到期的卡片，你的记忆曲线很健康
                  <span className="text-indigo-600 font-bold"> ✦</span>
                </>
              )}
            </p>
            {hasDue && (
              <button
                onClick={() => navigate('/review')}
                className="mt-3 px-5 py-2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-semibold shadow-soft-lg hover:translate-y-[-1px] hover:shadow-xl transition-all duration-250"
              >
                立即复习
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {/* ② 关键数字卡 */}
      {stats && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-6 gap-3"
        >
          <StatCard icon={Layers} label="总卡片" value={stats.totalCards} color="bg-blue-50 text-blue-600" />
          <StatCard icon={Clock} label="明天复习" value={stats.dueTomorrow} color="bg-orange-50 text-orange-600" />
          <StatCard icon={Brain} label="今日待复习" value={stats.dueToday} color="bg-green-50 text-green-600" />
          <StatCard icon={BookOpen} label="今日已复习" value={stats.todayReviews} color="bg-purple-50 text-purple-600" />
          <StatCard icon={TrendingUp} label="连续天数" value={stats.streak} color="bg-red-50 text-red-600" />
          <StatCard icon={CalendarDays} label="累计复习" value={stats.totalReviews} color="bg-indigo-50 text-indigo-600" />
        </motion.div>
      )}

      {/* ③ 部分模块加载失败提示（全失败时下面走整页错误态） */}
      {partialFailed && !failed && (
        <div className="glass rounded-2xl px-4 py-3 flex items-center gap-2.5 text-sm text-amber-700">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
          部分统计模块加载失败，已展示可用数据。可下拉刷新重试。
        </div>
      )}

      {failed && !stats && !plan && !stages && (
        <div className="text-center py-16 glass rounded-2xl">
          <BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">统计数据加载失败，请稍后重试</p>
        </div>
      )}

      {!stats && !plan && !stages && !failed && (
        <div className="text-center py-16 glass rounded-2xl">
          <BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">开始复习即可查看统计数据</p>
        </div>
      )}

      {/* ③ 我的复习计划 */}
      {plan && (
        <Section title="我的复习计划" delay={0.1}>
          <ReviewPlanChart days={plan.days} overdue={plan.overdue} />
        </Section>
      )}

      {/* ④ 我的掌握现状 */}
      {stages && (
        <Section title="我的掌握现状" delay={0.15}>
          <MasteryChart now={stages.now} />
        </Section>
      )}

      {/* ⑤ 我的掌握进展 */}
      {stages && (
        <Section title="我的掌握进展" delay={0.2}>
          <ProgressStackChart trend={stages.trend} />
          <StageBreakdown now={stages.now} percent={stages.percent} total={stages.total} />
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  children,
  delay = 0,
}: {
  title: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.4, 0, 0.2, 1] }}
      className="glass rounded-3xl p-5 sm:p-6"
    >
      <h2 className="text-lg sm:text-xl font-bold text-slate-800 mb-5">{title}</h2>
      {children}
    </motion.section>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: any;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="glass rounded-2xl p-4 text-center">
      <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center mx-auto mb-3`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="text-2xl font-bold text-gray-900 tabular-nums">{value || 0}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}
