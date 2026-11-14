import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { ChevronLeft, Loader2, ArrowDownLeft, ArrowUpRight } from 'lucide-react';

const INK = '#3A2318';
const INK2 = '#8B6A57';

interface LedgerItem {
  id: number;
  delta: number;
  balance: number;
  source: string;
  sourceLabel: string;
  day: string;
  createdAt: number;
}

/**
 * 铜板收支明细
 * - 顶部：当前余额 + 今日收入/支出
 * - 列表：每一笔流水（收入绿 / 支出红），显示来源、日期、变动后余额
 * - 分页：每次 50 条，可加载更多
 */
export default function CoinLedgerPageV2() {
  const navigate = useNavigate();
  const [items, setItems] = useState<LedgerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [balance, setBalance] = useState(0);
  const [today, setToday] = useState({ earned: 0, spent: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (offset: number) => {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);
    try {
      const [sum, page] = await Promise.all([
        offset === 0 ? api.coins.get() : Promise.resolve(null),
        api.coins.ledger(offset, 50),
      ]);
      if (sum) {
        setBalance(sum.balance);
        setToday({ earned: sum.todayEarned, spent: sum.todaySpent });
      }
      setTotal(page.total);
      setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { load(0); }, [load]);

  return (
    <div className="min-h-screen pb-12" style={{ background: 'linear-gradient(180deg,#FFF8F2 0%,#FDF1E8 100%)' }}>
      <header className="sticky top-0 z-20 bg-white/85 backdrop-blur-md border-b border-black/5">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 -ml-1 flex items-center justify-center active:scale-90 transition-transform"
            aria-label="返回"
          >
            <ChevronLeft className="w-6 h-6" style={{ color: INK }} strokeWidth={2.6} />
          </button>
          <h1 className="text-[17px] font-black" style={{ color: INK }}>铜板明细</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-4 space-y-4">
        <div className="rounded-3xl p-5 text-white shadow-lg" style={{ background: 'linear-gradient(135deg,#FF8A3D,#E8342A)' }}>
          <div className="text-[12px] opacity-80">当前铜板</div>
          <div className="text-[32px] font-black leading-tight">{balance}</div>
          <div className="flex gap-5 mt-2 text-[12px] font-semibold">
            <span>今日收入 +{today.earned}</span>
            <span>今日支出 -{today.spent}</span>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-7 h-7 animate-spin" style={{ color: '#E8342A' }} />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 text-[14px] font-semibold" style={{ color: INK2 }}>
            还没有铜板记录
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((it) => (
              <div key={it.id} className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white ring-1 ring-black/5 shadow-sm">
                <span
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: it.delta >= 0 ? 'rgba(16,185,129,.10)' : 'rgba(232,52,42,.08)' }}
                >
                  {it.delta >= 0 ? (
                    <ArrowDownLeft className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <ArrowUpRight className="w-4 h-4 text-rose-500" />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold truncate" style={{ color: INK }}>{it.sourceLabel}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: '#B08A76' }}>
                    {it.day} · 余额 {it.balance}
                  </div>
                </div>
                <div
                  className="text-[15px] font-black shrink-0"
                  style={{ color: it.delta >= 0 ? '#059669' : '#E8342A' }}
                >
                  {it.delta >= 0 ? '+' : ''}{it.delta}
                </div>
              </div>
            ))}

            {items.length < total && (
              <button
                onClick={() => load(items.length)}
                disabled={loadingMore}
                className="w-full py-3 rounded-2xl text-[13px] font-bold text-slate-600 bg-white/80 ring-1 ring-black/5 disabled:opacity-50"
              >
                {loadingMore ? '加载中…' : `加载更多（已显示 ${items.length}/${total}）`}
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
