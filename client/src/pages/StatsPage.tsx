import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { motion } from 'framer-motion';
import ScrollReveal from '../components/ScrollReveal';
import { BarChart3, TrendingUp, CalendarDays, Clock, BookOpen, Brain, Layers } from 'lucide-react';

export default function StatsPage() {
  const { user, openLoginModal } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.cards.statsOverview()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    );
  }

  // Non-logged-in skeleton
  if (!user) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-400">统计</h1>
          <p className="text-gray-300 mt-1">追踪你的学习进度</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {[{icon: Layers, label:'总卡片', color:'bg-blue-50 text-blue-200'},{icon: Clock, label:'明天复习', color:'bg-orange-50 text-orange-200'},{icon: Brain, label:'今日待复习', color:'bg-green-50 text-green-200'},{icon: BookOpen, label:'今日已复习', color:'bg-purple-50 text-purple-200'},{icon: TrendingUp, label:'连续天数', color:'bg-red-50 text-red-200'},{icon: CalendarDays, label:'卡片/天', color:'bg-indigo-50 text-indigo-200'}].map((item, i) => (
            <div key={i} className="bg-white/40 backdrop-blur-sm rounded-2xl border-2 border-dashed border-gray-200 p-4">
              <div className={`w-10 h-10 rounded-xl ${item.color} flex items-center justify-center mb-3`}>
                <item.icon className="w-5 h-5" />
              </div>
              <div className="text-2xl font-bold text-gray-300">---</div>
              <div className="text-sm text-gray-400">{item.label}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="bg-white/40 backdrop-blur-sm rounded-2xl border-2 border-dashed border-gray-200 p-6">
            <h3 className="font-semibold text-gray-400 mb-4">总览</h3>
            <div className="space-y-4">
              {[1,2,3].map(i => <div key={i} className="h-4 bg-gray-100 rounded" />)}
            </div>
          </div>
          <div className="bg-white/40 backdrop-blur-sm rounded-2xl border-2 border-dashed border-gray-200 p-6">
            <h3 className="font-semibold text-gray-400 mb-4">活动</h3>
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-4 bg-gray-100 rounded w-3/4" />)}
            </div>
          </div>
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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <ScrollReveal variant="fade-up">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">统计</h1>
          <p className="text-gray-500 mt-1">追踪你的学习进度</p>
        </div>
      </ScrollReveal>

      {!stats ? (
        <div className="text-center py-16 bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover border border-white/40">
          <BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">开始复习即可查看统计数据</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Key Stats */}
          <ScrollReveal variant="fade-up" delay={100}>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <StatCard icon={Layers} label="总卡片" value={stats.totalCards} color="bg-blue-50 text-blue-600" delay={0} />
              <StatCard icon={Clock} label="明天复习" value={stats.dueTomorrow} color="bg-orange-50 text-orange-600" delay={50} />
              <StatCard icon={Brain} label="今日待复习" value={stats.dueToday} color="bg-green-50 text-green-600" delay={100} />
              <StatCard icon={BookOpen} label="今日已复习" value={stats.todayReviews} color="bg-purple-50 text-purple-600" delay={150} />
              <StatCard icon={TrendingUp} label="连续天数" value={stats.streak} color="bg-red-50 text-red-600" delay={200} />
              <StatCard icon={CalendarDays} label="卡片/天" value={stats.todayReviews || 0} color="bg-indigo-50 text-indigo-600" delay={250} />
            </div>
          </ScrollReveal>

          {/* Learning overview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <ScrollReveal variant="fade-up" delay={150}>
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-6 border border-white/40">
                <h3 className="font-semibold text-gray-900 mb-4">总览</h3>
                <div className="space-y-4">
                  <ProgressBar label="成熟卡片" current={stats.totalCards - stats.newCards - stats.dueToday} total={stats.totalCards} color="bg-gradient-to-r from-green-400 to-green-500" />
                  <ProgressBar label="新卡片" current={stats.newCards} total={stats.totalCards} color="bg-gradient-to-r from-blue-400 to-blue-500" />
                  <ProgressBar label="明天到期" current={stats.dueTomorrow} total={stats.totalCards} color="bg-gradient-to-r from-orange-400 to-orange-500" />
                </div>
              </div>
            </ScrollReveal>

            <ScrollReveal variant="fade-up" delay={200}>
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-6 border border-white/40">
                <h3 className="font-semibold text-gray-900 mb-4">活动</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-100 to-blue-100 flex items-center justify-center">
                        <BookOpen className="w-5 h-5 text-primary-600" />
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900">{stats.todayReviews}</div>
                        <div className="text-sm text-gray-500">今日已复习</div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-100 to-emerald-100 flex items-center justify-center">
                        <TrendingUp className="w-5 h-5 text-green-600" />
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900">{stats.streak}</div>
                        <div className="text-sm text-gray-500">连续天数</div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-100 to-fuchsia-100 flex items-center justify-center">
                        <Brain className="w-5 h-5 text-purple-600" />
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900">{stats.totalCards}</div>
                        <div className="text-sm text-gray-500">总卡片</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </ScrollReveal>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, delay }: { icon: any; label: string; value: number; color: string; delay?: number }) {
  return (
    <ScrollReveal variant="fade-up" delay={delay || 0}>
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-4 text-center border border-white/40">
        <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center mx-auto mb-3`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="text-2xl font-bold text-gray-900">{value || 0}</div>
        <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      </div>
    </ScrollReveal>
  );
}

function ProgressBar({ label, current, total, color }: { label: string; current: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="text-gray-900 font-medium">{current}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ease-premium ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
