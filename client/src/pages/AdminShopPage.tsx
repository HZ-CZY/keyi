import { useEffect, useState } from 'react';
import { api, AdminShopItem, AdminShopPurchase, AdminShopSummary } from '../lib/api';
import { AlertCircle, Check, Coins, Loader2, RefreshCw, RotateCcw, Save, Search, ShoppingBag } from 'lucide-react';

/* ============================================================
 * 商城管理（后台 /admin/shop）
 *   · 商品：改价 / 改文案 / 上下架 / 排序（改完即时生效，不用重新构建）
 *   · 购买记录：谁买了、实付多少、状态；可全额退款（退回原价 + 收回功能）
 * ============================================================ */

const fmtTime = (sec: number | null) => {
  if (!sec) return '—';
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function AdminShopPage() {
  const [items, setItems] = useState<AdminShopItem[]>([]);
  const [rows, setRows] = useState<AdminShopPurchase[]>([]);
  const [summary, setSummary] = useState<AdminShopSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [q, setQ] = useState('');

  // 正在编辑的商品草稿：key → {price,name,description,enabled,sort}
  const [drafts, setDrafts] = useState<Record<string, { price: string; name: string; description: string; enabled: boolean; sort: string }>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<number | null>(null);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 2800);
  };

  const load = () => {
    setLoading(true);
    Promise.all([api.admin.shop.items(), api.admin.shop.purchases(q ? { q } : undefined)])
      .then(([its, pur]) => {
        setItems(its);
        setRows(pur.rows);
        setSummary(pur.summary);
        // 重建草稿（不要在用户输入中被别的刷新覆盖：只在首次/保存后重建）
        setDrafts((prev) => {
          const next: typeof prev = {};
          for (const it of its) {
            next[it.key] = prev[it.key] && savingKey === it.key ? prev[it.key] : {
              price: String(it.price),
              name: it.name,
              description: it.description,
              enabled: !!it.enabled,
              sort: String(it.sort),
            };
          }
          return next;
        });
        setError('');
      })
      .catch((e: any) => setError(e?.message || '加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveItem = async (key: string) => {
    const d = drafts[key];
    if (!d) return;
    const price = Number(d.price);
    if (!Number.isInteger(price) || price < 0) {
      setError('价格必须是非负整数');
      return;
    }
    setSavingKey(key);
    try {
      await api.admin.shop.updateItem(key, {
        name: d.name,
        description: d.description,
        price,
        enabled: d.enabled,
        sort: Number(d.sort) || 0,
      });
      flash(`已保存「${d.name}」`);
      load();
    } catch (e: any) {
      setError(e?.message || '保存失败');
    } finally {
      setSavingKey(null);
    }
  };

  const refund = async (userId: number, itemKey: string, username: string, amount: number) => {
    if (!window.confirm(`给「${username}」退款 ${amount} 铜板，并收回功能？`)) return;
    setRefunding(userId);
    try {
      const res = await api.admin.shop.refund(userId, itemKey);
      flash(`已退 ${res.refunded} 铜板给 ${username}`);
      load();
    } catch (e: any) {
      setError(e?.message || '退款失败');
    } finally {
      setRefunding(null);
    }
  };

  const search = () => load();

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center">
          <ShoppingBag className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">商城管理</h1>
          <p className="text-xs text-gray-400">改价 / 上下架即时生效 · 退款会退回原价并收回功能</p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-white border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-100 text-rose-600 text-sm px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 text-sm px-4 py-3">
          <Check className="w-4 h-4 shrink-0" /> {notice}
        </div>
      )}

      {/* ── 商品 ── */}
      <h2 className="text-sm font-semibold text-gray-700 mb-2">商品</h2>
      <div className="space-y-3 mb-8">
        {loading && !items.length ? (
          <div className="py-10 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : (
          items.map((it) => {
            const d = drafts[it.key];
            if (!d) return null;
            const sum = summary.find((s) => s.item_key === it.key);
            const dirty =
              d.price !== String(it.price) ||
              d.name !== it.name ||
              d.description !== it.description ||
              d.enabled !== !!it.enabled ||
              d.sort !== String(it.sort);
            return (
              <div key={it.key} className="bg-white rounded-2xl border border-gray-100 p-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-500">{it.key}</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${it.enabled ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>
                    {it.enabled ? '已上架' : '已下架'}
                  </span>
                  <span className="text-xs text-gray-400">
                    已售 {sum?.active_count ?? 0} 份 · 收入 {sum?.income ?? 0} 铜板
                  </span>
                </div>

                <div className="mt-3 grid md:grid-cols-[1fr_120px_100px] gap-3">
                  <label className="block">
                    <span className="text-xs text-gray-400">名称</span>
                    <input
                      value={d.name}
                      onChange={(e) => setDrafts({ ...drafts, [it.key]: { ...d, name: e.target.value } })}
                      className="mt-1 w-full h-10 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-blue-400"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-gray-400">价格（铜板）</span>
                    <input
                      value={d.price}
                      inputMode="numeric"
                      onChange={(e) => setDrafts({ ...drafts, [it.key]: { ...d, price: e.target.value.replace(/[^\d]/g, '') } })}
                      className="mt-1 w-full h-10 px-3 rounded-lg border border-gray-200 text-sm tabular-nums focus:outline-none focus:border-blue-400"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-gray-400">排序</span>
                    <input
                      value={d.sort}
                      inputMode="numeric"
                      onChange={(e) => setDrafts({ ...drafts, [it.key]: { ...d, sort: e.target.value.replace(/[^\d-]/g, '') } })}
                      className="mt-1 w-full h-10 px-3 rounded-lg border border-gray-200 text-sm tabular-nums focus:outline-none focus:border-blue-400"
                    />
                  </label>
                </div>
                <label className="block mt-3">
                  <span className="text-xs text-gray-400">描述</span>
                  <input
                    value={d.description}
                    onChange={(e) => setDrafts({ ...drafts, [it.key]: { ...d, description: e.target.value } })}
                    className="mt-1 w-full h-10 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-blue-400"
                  />
                </label>

                <div className="mt-3 flex items-center gap-3">
                  <button
                    onClick={() => setDrafts({ ...drafts, [it.key]: { ...d, enabled: !d.enabled } })}
                    className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm ${
                      d.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    <Coins className="w-4 h-4" /> {d.enabled ? '上架中（点击下架）' : '已下架（点击上架）'}
                  </button>
                  <button
                    disabled={!dirty || savingKey === it.key}
                    onClick={() => saveItem(it.key)}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-blue-500 text-white text-sm font-medium disabled:opacity-40"
                  >
                    {savingKey === it.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    保存
                  </button>
                  {dirty && <span className="text-xs text-amber-600">有未保存的修改</span>}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── 购买记录 ── */}
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-sm font-semibold text-gray-700 flex-1">购买记录</h2>
        <div className="relative">
          <Search className="w-4 h-4 text-gray-300 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="按用户名筛选"
            className="h-9 w-48 pl-9 pr-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-blue-400"
          />
        </div>
        <button onClick={search} className="h-9 px-3.5 rounded-lg bg-gray-900 text-white text-sm">查询</button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">用户</th>
              <th className="text-left font-medium px-4 py-2.5">商品</th>
              <th className="text-right font-medium px-4 py-2.5">实付</th>
              <th className="text-left font-medium px-4 py-2.5">状态</th>
              <th className="text-left font-medium px-4 py-2.5">时间</th>
              <th className="text-right font-medium px-4 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">还没有人购买</td></tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.user_id}-${row.item_key}`} className="border-t border-gray-50">
                  <td className="px-4 py-2.5 text-gray-700">
                    {row.username} <span className="text-gray-300 text-xs">#{row.user_id}</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{row.item_key}</td>
                  <td className="px-4 py-2.5 text-right text-amber-600 tabular-nums">{row.price_paid}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                      row.status === 'active' ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'
                    }`}>
                      {row.status === 'active' ? '已拥有' : '已退款'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{fmtTime(row.created_at)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {row.status === 'active' ? (
                      <button
                        disabled={refunding === row.user_id}
                        onClick={() => refund(row.user_id, row.item_key, row.username, row.price_paid)}
                        className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-rose-50 text-rose-600 text-xs font-medium disabled:opacity-40"
                      >
                        {refunding === row.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        退款
                      </button>
                    ) : (
                      <span className="text-xs text-gray-300">{fmtTime(row.refunded_at)} 已退</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
