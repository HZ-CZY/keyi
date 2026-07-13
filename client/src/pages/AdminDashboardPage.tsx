import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { motion } from 'framer-motion';
import ScrollReveal from '../components/ScrollReveal';
import {
  Users, Shield, FileText, BarChart3,
  TrendingUp, UserPlus, Hash, Wifi
} from 'lucide-react';

interface DashboardData {
  totalUsers: number;
  totalAdmins: number;
  totalCards: number;
  totalNotes: number;
  onlineUsers: number;
  onlineUserList: { id: number; username: string }[];
  dailyRegistrations: { date: string; count: number }[];
  activeUsers: number;
  recentUsers: { id: number; username: string; created_at: number }[];
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.admin.dashboard()
      .then(setData)
      .catch((err: any) => setError(err.message || '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50/90 backdrop-blur-sm border border-red-200 rounded-2xl p-6 text-center">
        <p className="text-red-700">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const maxReg = Math.max(...data.dailyRegistrations.map(d => d.count), 1);

  const statsCards = [
    { icon: Users, label: '普通用户', value: data.totalUsers, color: 'from-blue-400 to-blue-600', bg: 'bg-blue-50', text: 'text-blue-700' },
    { icon: Wifi, label: '当前在线', value: data.onlineUsers, color: 'from-green-400 to-green-600', bg: 'bg-green-50', text: 'text-green-700' },
    { icon: Shield, label: '管理员', value: data.totalAdmins, color: 'from-amber-400 to-amber-600', bg: 'bg-amber-50', text: 'text-amber-700' },
    { icon: FileText, label: '笔记', value: data.totalNotes, color: 'from-purple-400 to-purple-600', bg: 'bg-purple-50', text: 'text-purple-700' },
    { icon: Hash, label: '卡片', value: data.totalCards, color: 'from-pink-400 to-pink-600', bg: 'bg-pink-50', text: 'text-pink-700' },
    { icon: TrendingUp, label: '本周活跃', value: data.activeUsers, color: 'from-cyan-400 to-cyan-600', bg: 'bg-cyan-50', text: 'text-cyan-700' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <ScrollReveal variant="fade-up">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <BarChart3 className="w-8 h-8 text-indigo-500" />
              总览仪表盘
            </h1>
            <p className="text-gray-500 mt-1">系统整体数据概览</p>
          </div>
        </div>
      </ScrollReveal>

      {/* Stats Cards Grid */}
      <ScrollReveal variant="fade-up" delay={100}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          {statsCards.map((card, i) => (
            <ScrollReveal key={card.label} variant="fade-up" delay={100 + i * 40}>
              <div className={`${card.bg} rounded-2xl p-4 border border-white/50 card-shadow-hover`}>
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center mb-3`}>
                  <card.icon className="w-5 h-5 text-white" />
                </div>
                <div className="text-2xl font-bold text-gray-900">{card.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{card.label}</div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </ScrollReveal>

      {/* Online Users */}
      <ScrollReveal variant="fade-up" delay={150}>
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/40 p-5 shadow-soft card-shadow-hover">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Wifi className="w-5 h-5 text-green-500" />
            当前在线用户
            <span className="text-sm font-normal text-gray-400 ml-1">（{data.onlineUsers} 人）</span>
          </h3>
          {data.onlineUserList.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">暂无在线用户</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.onlineUserList.map((u, i) => (
                <motion.div
                  key={u.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: i * 0.05 }}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-green-50 border border-green-200/60"
                >
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm font-medium text-gray-800">{u.username}</span>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </ScrollReveal>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Daily Registrations Chart */}
        <ScrollReveal variant="fade-up" delay={200}>
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/40 p-5 shadow-soft card-shadow-hover">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-indigo-500" />
              近7日注册趋势
            </h3>
            <div className="flex items-end justify-between gap-2 h-40 pt-2">
              {data.dailyRegistrations.map((day, i) => {
                const height = day.count > 0 ? (day.count / maxReg) * 100 : 0;
                const dateObj = new Date(day.date);
                const label = dateObj.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
                return (
                  <div key={day.date} className="flex-1 flex flex-col items-center gap-1.5">
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.max(height, 4)}%` }}
                      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: i * 0.08 }}
                      className={`w-full max-w-[40px] rounded-t-lg ${
                        day.count > 0
                          ? 'bg-gradient-to-t from-indigo-500 to-purple-500'
                          : 'bg-gray-100'
                      }`}
                      style={{ minHeight: day.count > 0 ? '8px' : '4px' }}
                    />
                    <span className="text-xs font-medium text-gray-600">
                      {day.count > 0 ? day.count : ''}
                    </span>
                    <span className="text-[10px] text-gray-400">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </ScrollReveal>

        {/* Recent Registrations */}
        <ScrollReveal variant="fade-up" delay={250}>
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/40 p-5 shadow-soft card-shadow-hover">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-indigo-500" />
              最近注册
            </h3>
            {data.recentUsers.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">暂无用户</p>
            ) : (
              <div className="space-y-2">
                {data.recentUsers.map((u, i) => (
                  <motion.div
                    key={u.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: i * 0.04 }}
                    className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/60 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {u.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{u.username}</div>
                      <div className="text-xs text-gray-400">
                        {new Date(u.created_at * 1000).toLocaleDateString('zh-CN')}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </ScrollReveal>

      </div>
    </div>
  );
}
