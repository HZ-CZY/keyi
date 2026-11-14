import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { BarChart3, Loader2, RefreshCw, MousePointerClick, Users, FileText } from 'lucide-react';

interface Overview {
  total: number;
  today: number;
  pages: { path: string; c: number }[];
  targets: { path: string; target: string; label: string; c: number }[];
  users: { user_id: number | null; username: string; c: number }[];
  daily: { day: string; c: number }[];
}

/**
 * 后台 · 点击统计
 * 展示全局埋点的聚合结果：总点击、今日、近 7 天趋势、热门页面、热门锚点、活跃用户。
 */
export default function AdminAnalyticsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.analytics
      .overview()
      .then((d) => setData(d as Overview))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // 仅 admin / 陈子洋 可查看埋点统计
    if (!['admin', '陈子洋'].includes(user?.username || '')) {
      navigate('/admin');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, navigate]);

  const maxDaily = Math.max(1, ...(data?.daily.map((d) => d.c) || [1]));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-blue-500" /> 点击统计
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            全站点击埋点汇总。锚点由元素自动生成（优先 data-track，其次文案 / aria-label）。
          </p>
        </div>
        <button
          onClick={load}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-gray-700 bg-white/70 hover:bg-white shadow-sm transition"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {loading ? (
        <div className="glass rounded-3xl shadow-soft-lg p-10 flex items-center justify-center gap-2 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" /> 加载中…
        </div>
      ) : !data ? (
        <div className="glass rounded-3xl shadow-soft-lg p-10 text-center text-gray-400">加载失败</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="glass rounded-3xl shadow-soft-lg p-5">
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <MousePointerClick className="w-4 h-4" /> 累计点击
              </div>
              <div className="mt-1 text-3xl font-black text-gray-900 tabular-nums">{data.total}</div>
            </div>
            <div className="glass rounded-3xl shadow-soft-lg p-5">
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <MousePointerClick className="w-4 h-4" /> 近 24 小时
              </div>
              <div className="mt-1 text-3xl font-black text-blue-600 tabular-nums">{data.today}</div>
            </div>
          </div>

          <div className="glass rounded-3xl shadow-soft-lg p-5">
            <div className="text-sm font-semibold text-gray-700 mb-3">近 7 天趋势</div>
            <div className="flex items-end gap-2 h-32">
              {data.daily.map((d) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-[10px] text-gray-400 tabular-nums">{d.c}</div>
                  <div
                    className="w-full rounded-t-lg bg-gradient-to-t from-blue-500 to-indigo-400"
                    style={{ height: `${Math.max(4, (d.c / maxDaily) * 100)}%` }}
                  />
                  <div className="text-[10px] text-gray-400">{d.day.slice(5)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="glass rounded-3xl shadow-soft-lg p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
                <FileText className="w-4 h-4" /> 热门页面
              </div>
              <ul className="space-y-2">
                {data.pages.map((p) => (
                  <li key={p.path} className="flex items-center gap-3 text-sm">
                    <span className="flex-1 min-w-0 truncate text-gray-700">{p.path}</span>
                    <span className="font-bold tabular-nums text-gray-900">{p.c}</span>
                  </li>
                ))}
                {data.pages.length === 0 && <li className="text-gray-400 text-sm">暂无数据</li>}
              </ul>
            </div>

            <div className="glass rounded-3xl shadow-soft-lg p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
                <Users className="w-4 h-4" /> 活跃用户
              </div>
              <ul className="space-y-2">
                {data.users.map((u) => (
                  <li key={String(u.user_id)} className="flex items-center gap-3 text-sm">
                    <span className="flex-1 min-w-0 truncate text-gray-700">{u.username}</span>
                    <span className="font-bold tabular-nums text-gray-900">{u.c}</span>
                  </li>
                ))}
                {data.users.length === 0 && <li className="text-gray-400 text-sm">暂无数据</li>}
              </ul>
            </div>
          </div>

          <div className="glass rounded-3xl shadow-soft-lg p-5">
            <div className="text-sm font-semibold text-gray-700 mb-3">热门锚点（Top 50）</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400">
                    <th className="py-1.5 pr-3 font-medium">页面</th>
                    <th className="py-1.5 pr-3 font-medium">锚点</th>
                    <th className="py-1.5 pr-3 font-medium">文案</th>
                    <th className="py-1.5 text-right font-medium">点击</th>
                  </tr>
                </thead>
                <tbody>
                  {data.targets.map((t, i) => (
                    <tr key={i} className="border-t border-black/5">
                      <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{t.path}</td>
                      <td className="py-2 pr-3 text-gray-700 font-mono text-xs break-all">{t.target}</td>
                      <td className="py-2 pr-3 text-gray-500 truncate max-w-[220px]">{t.label}</td>
                      <td className="py-2 text-right font-bold tabular-nums text-gray-900">{t.c}</td>
                    </tr>
                  ))}
                  {data.targets.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-gray-400">暂无数据</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
