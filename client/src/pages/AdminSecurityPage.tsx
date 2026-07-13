import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { motion } from 'framer-motion';
import ScrollReveal from '../components/ScrollReveal';
import {
  Shield, Wifi, Clock, Search, UserCheck, UserX,
  Users, Activity, Loader2
} from 'lucide-react';

interface OnlineUser {
  userId: number;
  username: string;
  ip: string;
  userAgent: string;
  deviceInfo: string;
  lastActive: string;
}

interface LoginLog {
  id: number;
  user_id: number;
  username: string;
  ip: string;
  user_agent: string;
  device_info: string;
  login_method: string;
  success: number;
  created_at: number;
}

export default function AdminSecurityPage() {
  const [activeTab, setActiveTab] = useState<'online' | 'history'>('online');
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [loginLogs, setLoginLogs] = useState<LoginLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchOnline = useCallback(async () => {
    setOnlineLoading(true);
    try {
      const data = await api.admin.onlineUsers();
      setOnlineUsers(data);
    } catch (err: any) {
      console.error('Failed to fetch online users:', err);
    } finally {
      setOnlineLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    setError('');
    try {
      let data: LoginLog[];
      if (searchQuery.trim()) {
        // Search by username
        const allUsers = await api.admin.users();
        const matchedUser = allUsers.find((u: any) => u.username.includes(searchQuery.trim()));
        if (matchedUser) {
          data = await api.admin.userLoginHistory(matchedUser.id);
        } else {
          data = [];
        }
      } else {
        data = await api.admin.loginLogs({ limit: 100 });
      }
      setLoginLogs(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setHistoryLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchOnline(), fetchHistory()]).finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh online users every 30s
  useEffect(() => {
    if (activeTab === 'online') {
      const interval = setInterval(fetchOnline, 30000);
      return () => clearInterval(interval);
    }
  }, [activeTab, fetchOnline]);

  const formatTime = (timestamp: number): string => {
    const now = Date.now() / 1000;
    const diff = now - timestamp;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    return Math.floor(diff / 86400) + '天前';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <ScrollReveal variant="fade-up">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Shield className="w-8 h-8 text-indigo-500" />
              安全管理
            </h1>
            <p className="text-gray-500 mt-1">监控用户登录和设备信息</p>
          </div>
        </div>
      </ScrollReveal>

      {/* Tab Navigation */}
      <ScrollReveal variant="fade-up" delay={100}>
        <div className="flex gap-2 bg-gray-100 rounded-xl p-1">
          <button
            onClick={() => setActiveTab('online')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'online'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Wifi className="w-4 h-4 text-green-500" />
            在线用户
            {onlineUsers.length > 0 && (
              <span className="bg-green-100 text-green-700 text-xs px-1.5 py-0.5 rounded-full">
                {onlineUsers.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'history'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Clock className="w-4 h-4 text-blue-500" />
            登录历史
          </button>
        </div>
      </ScrollReveal>

      {/* Online Users Tab */}
      {activeTab === 'online' && (
        <ScrollReveal variant="fade-up" delay={150}>
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/40 shadow-soft card-shadow-hover">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-green-500" />
                当前在线用户
              </h3>
              <button
                onClick={fetchOnline}
                disabled={onlineLoading}
                className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 disabled:opacity-50"
              >
                <Activity className="w-3.5 h-3.5" />
                {onlineLoading ? '刷新中...' : '刷新'}
              </button>
            </div>
            {onlineUsers.length === 0 ? (
              <div className="text-center py-16">
                <Wifi className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">暂无在线用户</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {onlineUsers.map((user, i) => (
                  <motion.div
                    key={user.userId}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="p-5 hover:bg-gray-50/50 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                        <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-gray-900">{user.username}</span>
                          <span className="text-xs text-gray-400">ID: {user.userId}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                          <span className="flex items-center gap-1">
                            <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">
                              {user.ip || '-'}
                            </span>
                          </span>
                          <span className="flex items-center gap-1">
                            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            {user.deviceInfo || '-'}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          最后活跃: {user.lastActive}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </ScrollReveal>
      )}

      {/* Login History Tab */}
      {activeTab === 'history' && (
        <ScrollReveal variant="fade-up" delay={150}>
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/40 shadow-soft card-shadow-hover">
            <div className="p-5 border-b border-gray-100">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Clock className="w-5 h-5 text-blue-500" />
                  <span className="font-semibold text-gray-900">登录记录</span>
                  <span className="text-sm text-gray-400">（{loginLogs.length} 条）</span>
                </div>
                <div className="relative flex-1 max-w-xs sm:ml-auto">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && fetchHistory()}
                    className="input-field pl-9 py-2 text-sm w-full"
                    placeholder="搜索用户名..."
                  />
                  {searchQuery && (
                    <button
                      onClick={() => { setSearchQuery(''); fetchHistory(); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {error && (
              <div className="mx-5 mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
                {error}
              </div>
            )}

            {historyLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : loginLogs.length === 0 ? (
              <div className="text-center py-16">
                <UserX className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">暂无登录记录</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="text-left px-5 py-3 font-medium text-gray-500">用户</th>
                      <th className="text-left px-5 py-3 font-medium text-gray-500">IP</th>
                      <th className="text-left px-5 py-3 font-medium text-gray-500">设备</th>
                      <th className="text-left px-5 py-3 font-medium text-gray-500">状态</th>
                      <th className="text-left px-5 py-3 font-medium text-gray-500">时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {loginLogs.map((log, i) => (
                      <motion.tr
                        key={log.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.02 }}
                        className="hover:bg-gray-50/30 transition-colors"
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            {log.success ? (
                              <UserCheck className="w-4 h-4 text-green-500 flex-shrink-0" />
                            ) : (
                              <UserX className="w-4 h-4 text-red-400 flex-shrink-0" />
                            )}
                            <span className="font-medium text-gray-900">
                              {log.username || '未知'}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                            {log.ip || '-'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-gray-500 max-w-[200px] truncate">
                          {log.device_info || '-'}
                        </td>
                        <td className="px-5 py-3.5">
                          {log.success ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                              <UserCheck className="w-3 h-3" />
                              成功
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                              <UserX className="w-3 h-3" />
                              失败
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-gray-400 text-xs whitespace-nowrap">
                          {formatTime(log.created_at)}
                          <span className="block text-[10px] text-gray-300 mt-0.5">
                            {new Date(log.created_at * 1000).toLocaleString('zh-CN')}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </ScrollReveal>
      )}
    </div>
  );
}
