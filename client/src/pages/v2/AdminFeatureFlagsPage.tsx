import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { fetchFlags } from '../../lib/featureFlags';
import { useAuth } from '../../context/AuthContext';

interface FlagRow {
  key: string;
  label: string;
  enabled: boolean;
}

/**
 * 后台功能开关管理页：
 * - 列出全部 feature_flags（中文 label + 开关 Toggle，白玻璃风）。
 * - 切换调用 PUT /api/admin/feature-flags/:key，成功后乐观更新并刷新前端缓存，
 *   使前台入口立即按新开关显隐 / 拦截，无需重新发版。
 */
export default function AdminFeatureFlagsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role !== 'admin') {
      navigate('/');
      return;
    }
    api.admin.featureFlags
      .list()
      .then((d: FlagRow[]) => setRows(d))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [user, navigate]);

  async function toggle(row: FlagRow): Promise<void> {
    if (busyKey) return;
    const next = !row.enabled;
    setBusyKey(row.key);
    // 乐观更新
    setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, enabled: next } : r)));
    try {
      await api.admin.featureFlags.set(row.key, next);
      // 刷新前端缓存，让前台入口立即生效
      await fetchFlags();
    } catch {
      // 失败回滚
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, enabled: row.enabled } : r)));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">功能开关</h1>
        <p className="text-sm text-gray-500 mt-1">
          一键启用 / 禁用主要模块。禁用后前台入口自动隐藏，直接访问会被拦截并提示「功能维护中」。
        </p>
      </div>

      <div className="glass rounded-3xl shadow-soft-lg p-5">
        {loading ? (
          <div className="py-10 text-center text-gray-400">加载中…</div>
        ) : (
          <ul className="divide-y divide-white/40">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center justify-between py-3.5">
                <div className="min-w-0">
                  <p className="font-medium text-gray-800">{r.label}</p>
                  <p className="text-xs text-gray-400 font-mono">{r.key}</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(r)}
                  disabled={busyKey === r.key}
                  aria-pressed={r.enabled}
                  className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ${
                    r.enabled ? 'bg-emerald-500' : 'bg-gray-300'
                  } ${busyKey === r.key ? 'opacity-60 cursor-wait' : ''}`}
                >
                  <span
                    className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${
                      r.enabled ? 'right-0.5' : 'left-0.5'
                    }`}
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
