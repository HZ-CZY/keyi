import { formatCoins } from '../../lib/coins';
import { useCallback, useEffect, useState } from 'react';
import {
  Award, Check, Coins, Image as ImageIcon, Loader2, Lock, Megaphone, Shield, ShoppingBag, Sparkles, User as UserIcon,
} from 'lucide-react';
import { api, ShopItemInfo } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import V2PageShell from './components/V2PageShell';

/* ============================================================
 * 商城（V2 · 电商卡片版 UI）
 *   价格、可购性一律以服务端 /api/shop/items 为准 —— 前端只负责展示与发起。
 *   扣费在服务端事务里做（余额校验 + 主键防重复购买），前端改不动价格。
 *   UI 参考：电商双列卡片 —— 大图区 + 标签 + 名称 + 描述 + 价格 + 购买钮
 * ============================================================ */

/** 商品 key → 展示样式。新增商品在这里补一行即可（或用默认样式）。 */
const ITEM_STYLE: Record<string, { icon: typeof ImageIcon; box: string; tag: string }> = {
  home_bg: { icon: ImageIcon, tint: 'bg-sky-50 text-sky-600', tag: '个性装扮' },
  /* 对战道具：解锁后决斗对局中出现嘲讽按钮 */
  battle_taunt: { icon: Megaphone, tint: 'bg-rose-50 text-rose-600', tag: '对战道具' },
  /* 部落道具：消耗品，购买后直接延长护盾 */
  village_shield_3d: { icon: Shield, tint: 'bg-emerald-50 text-emerald-600', tag: '部落道具' },
  /* 称号类：买断后在排行榜昵称旁展示，可在已拥有的称号之间随时切换 */
  title_xuehai: { icon: Award, tint: 'bg-violet-50 text-violet-600', tag: '称号' },
  title_buyan: { icon: Award, tint: 'bg-emerald-50 text-emerald-600', tag: '称号' },
  title_heng: { icon: Award, tint: 'bg-rose-50 text-rose-600', tag: '称号' },
  title_bolan: { icon: Award, tint: 'bg-amber-50 text-amber-700', tag: '称号' },
};
const DEFAULT_STYLE = { icon: Sparkles, tint: 'bg-slate-100 text-slate-600', tag: '虚拟商品' };

/** 剩余保护时长：天/小时/分钟，够用就好 */
function shieldLeftText(until?: number): string {
  if (!until) return '';
  const ms = until * 1000 - Date.now();
  if (ms <= 0) return '';
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  if (d > 0) return `剩 ${d} 天 ${h} 小时`;
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `剩 ${h} 小时 ${m} 分`;
}

/** Unix 秒 → 「10 月 22 日 10:45」 */
function fmtUntil(until: number): string {
  const d = new Date(until * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function ShopPageV2() {
  const { user, openLoginModal } = useAuth();
  const [items, setItems] = useState<ShopItemInfo[]>([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [activeTitle, setActiveTitle] = useState('');

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3200);
  }, []);

  useEffect(() => {
    setActiveTitle((user as any)?.badge_label || '');
  }, [user]);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const res = await api.shop.items();
      setItems(res.items);
      setBalance(res.balance);
    } catch (e: any) {
      showToast(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [user, showToast]);

  useEffect(() => { load(); }, [load]);

  /** 在「已拥有的称号」之间切换（免费） */
  const activateTitle = async (key: string) => {
    setBusy(key);
    try {
      const res = await api.shop.activateTitle(key);
      setActiveTitle(res.badge);
      showToast(`已戴上「${res.badge}」称号`);
    } catch (e: any) {
      showToast(e?.message || '切换失败');
    } finally {
      setBusy(null);
    }
  };

  const buy = async (key: string) => {
    setBusy(key);
    try {
      const res = await api.shop.buy(key);
      setBalance(res.balance);
      showToast(
        res.shieldUntil
          ? `部落保护已生效，${fmtUntil(res.shieldUntil)} 到期`
          : `已解锁「${res.name}」`
      );
      setConfirming(null);
      await load();
    } catch (e: any) {
      showToast(e?.message || '购买失败');
    } finally {
      setBusy(null);
    }
  };

  /* ── 未登录 ── */
  if (!user) {
    return (
      <V2PageShell title="商城">
        <div className="keyi-shop-page px-5 pt-16">
          <div className="bg-white/95 backdrop-blur rounded-3xl shadow-md border border-slate-100 p-8 text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-slate-100 flex items-center justify-center">
              <ShoppingBag className="w-8 h-8 text-white" />
            </div>
            <h2 className="mt-4 text-lg font-bold text-slate-800">欢迎来到商城</h2>
            <p className="mt-1.5 text-sm text-slate-500">登录后可以用学习赚来的铜板解锁好玩的装扮</p>
            <button
              onClick={openLoginModal}
              className="mt-6 inline-flex items-center gap-2 h-11 px-7 rounded-full bg-[#3B6BE8] text-white text-sm font-semibold active:scale-95 transition-transform"
            >
              <UserIcon className="w-4 h-4" /> 去登录
            </button>
          </div>
        </div>
      </V2PageShell>
    );
  }

  return (
    <V2PageShell title="商城">
      <div className="keyi-shop-page px-4 pt-2 pb-8 max-w-2xl mx-auto">
        {/* 铜板余额条 */}
        <div className="keyi-glass flex items-center justify-between rounded-2xl px-4 py-3">
          <span className="flex items-center gap-2 text-sm text-slate-600">
            <Coins className="w-4 h-4 text-amber-500" />
            我的铜板
          </span>
          <span className="text-lg font-bold text-amber-700 tabular-nums">{formatCoins(balance)}</span>
        </div>

        {/* ── 商品网格（电商双列卡片） ── */}
        {loading ? (
          <div className="py-20 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-20 text-center text-sm text-slate-400">商城暂时没有上架的商品</div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {items.map(item => {
              const st = ITEM_STYLE[item.key] || DEFAULT_STYLE;
              const Icon = st.icon;
              const canAfford = balance >= item.price;
              const isConfirming = confirming === item.key;
              const isBusy = busy === item.key;
              const isTitle = item.kind === 'title';
              return (
                <div
                  key={item.key}
                  className={`relative bg-white rounded-2xl border p-3 flex flex-col ${
                    item.owned ? 'border-[#3B6BE8]/25' : 'border-slate-200/70'
                  }`}
                >
                  {/* 顶行：类型图标 + 分类；拥有状态用小字，不再盖角标 */}
                  <div className="flex items-start justify-between">
                    <span className={`w-8 h-8 rounded-[10px] grid place-items-center shrink-0 ${st.tint}`}>
                      <Icon className="w-[17px] h-[17px]" strokeWidth={2} />
                    </span>
                    <span className={`text-[10px] font-medium ${item.owned ? 'text-[#3B6BE8]' : 'text-slate-400'}`}>
                      {item.owned ? '已拥有' : st.tag}
                    </span>
                  </div>

                  <h3 className="mt-2 text-[13.5px] font-semibold text-slate-900 leading-snug">
                    {item.name}
                  </h3>
                  <p className="mt-1 text-[11px] leading-[1.55] text-slate-500 flex-1 overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]">
                    {item.description}
                  </p>

                  {item.shieldUntil && item.shieldUntil * 1000 > Date.now() ? (
                    <p className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] font-semibold text-emerald-600">
                      <Shield className="w-3 h-3" />
                      {shieldLeftText(item.shieldUntil)}
                    </p>
                  ) : null}

                  {/* 价格 + 动作 */}
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 text-slate-800">
                      <Coins className="w-3.5 h-3.5 text-amber-500" />
                      <span className="text-[15px] font-bold tabular-nums leading-none">{item.price}</span>
                    </div>

                    {item.owned ? (
                      isTitle ? (
                        activeTitle === item.name ? (
                          <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-slate-100 text-slate-500 text-[11px] font-semibold">
                            当前称号
                          </span>
                        ) : (
                          <button
                            disabled={isBusy}
                            onClick={() => activateTitle(item.key)}
                            className="h-7 px-2.5 rounded-full bg-slate-900 text-white text-[11px] font-semibold active:scale-95 transition-transform disabled:opacity-60"
                          >
                            设为称号
                          </button>
                        )
                      ) : item.key === 'home_bg' ? (
                        <a href="/settings" className="text-[11px] font-semibold text-slate-500 active:scale-95">
                          去设置 →
                        </a>
                      ) : item.key === 'battle_taunt' ? (
                        <a href="/arena" className="text-[11px] font-semibold text-slate-500 active:scale-95">
                          去竞技场 →
                        </a>
                      ) : null
                    ) : !item.enabled ? (
                      <span className="h-7 px-2.5 inline-flex items-center rounded-full bg-slate-100 text-slate-400 text-[11px] font-semibold">已下架</span>
                    ) : isConfirming ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setConfirming(null)}
                          className="h-7 px-2 rounded-full bg-slate-100 text-slate-500 text-[11px] font-semibold active:scale-95"
                        >
                          取消
                        </button>
                        <button
                          disabled={isBusy}
                          onClick={() => buy(item.key)}
                          className="h-7 px-2.5 rounded-full bg-[#3B6BE8] text-white text-[11px] font-semibold active:scale-95 disabled:opacity-60"
                        >
                          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '确认'}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirming(item.key)}
                        className={`h-7 px-3 rounded-full text-[11px] font-semibold active:scale-95 transition-transform inline-flex items-center gap-0.5 ${
                          canAfford ? 'bg-[#3B6BE8] text-white' : 'bg-slate-100 text-slate-400'
                        }`}
                      >
                        {!canAfford && <Lock className="w-3 h-3" />}购买
                      </button>
                    )}
                  </div>

                  {!item.owned && item.enabled && !canAfford && !isConfirming && (
                    <p className="mt-1 text-[10px] text-slate-400">还差 {item.price - balance} 铜板</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="pt-4 text-center text-[12px] text-slate-400">
          铜板来自学习与复习，不支持充值 · 有问题找老师
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
