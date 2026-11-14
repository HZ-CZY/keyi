import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle, Check, Coins, Image as ImageIcon, Loader2, Lock, Trash2, Upload, User as UserIcon,
} from 'lucide-react';
import { api, ShopBackgroundInfo } from '../../lib/api';

/* ============================================================
 * 个人中心 → 我的背景（商城商品「更换首页背景图片」的使用界面）
 *   · 未解锁：显示价格 + 去商城
 *   · 已解锁：上传 / 选择 / 删除，最多 MAX 张（配额来自服务端）
 *   图片只对自己首页可见；压缩与体积限制都在服务端做。
 * ============================================================ */

export default function MyBackgroundTab({ user, openLoginModal }: { user: any; openLoginModal: () => void }) {
  const [loading, setLoading] = useState(true);
  const [owned, setOwned] = useState(false);
  const [max, setMax] = useState(5);
  const [items, setItems] = useState<ShopBackgroundInfo[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | 'upload' | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /* 【2026-10-19】首页背景遮罩浓度（%，0~80）。和背景图一起存服务端，
     换设备也保持一致；拖动时只改本地（即时预览），停手 500ms 才落库。 */
  const [mask, setMask] = useState(30);
  const maskTimer = useRef<number | null>(null);
  const maskRef = useRef(30);        // 最新值（卸载时补发用）
  const maskDirty = useRef(false);   // 有未落库的调整

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [bg, shop, st] = await Promise.all([
        api.shop.backgrounds(),
        api.shop.items(),
        api.auth.getSettings().catch(() => null),
      ]);
      setOwned(bg.owned);
      setMax(bg.max);
      setItems(bg.items);
      setActiveId(bg.activeId);
      setPrice(shop.items.find((i) => i.key === 'home_bg')?.price ?? null);
      const m = Number(st?.home_bg_mask);
      if (Number.isFinite(m)) {
        const val = Math.max(0, Math.min(80, m));
        setMask(val);
        maskRef.current = val;
      }
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || '加载失败' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) load();
    else setLoading(false);
  }, [user, load]);

  const flash = (kind: 'ok' | 'err', text: string) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 3600);
  };

  /* 遮罩浓度：拖动时只改本地（即时预览），停手 500ms 才落库 ——
     否则滑一次 0→80 会打出十几个 PUT 请求。 */
  const applyMask = (v: number) => {
    const val = Math.max(0, Math.min(80, Math.round(v)));
    setMask(val);
    maskRef.current = val;
    maskDirty.current = true;
    if (maskTimer.current) window.clearTimeout(maskTimer.current);
    maskTimer.current = window.setTimeout(() => {
      maskTimer.current = null;
      maskDirty.current = false;
      api.auth.updateSettings({ home_bg_mask: String(val) }).catch(() => {
        flash('err', '遮罩没保存成功，稍后再拖一下试试');
      });
    }, 500);
  };

  /* 离开页面太快（< 500ms）时，最后一次调整还没落库，这里补发一次 */
  useEffect(() => () => {
    if (maskTimer.current) {
      window.clearTimeout(maskTimer.current);
      maskTimer.current = null;
    }
    if (maskDirty.current) {
      void api.auth.updateSettings({ home_bg_mask: String(maskRef.current) }).catch(() => {});
    }
  }, []);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许连续选同一个文件
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      flash('err', '请选择图片文件');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      flash('err', '图片不能超过 5MB');
      return;
    }
    setBusy('upload');
    try {
      await api.shop.uploadBackground(file);
      await load();
      flash('ok', '上传成功，已在首页生效');
    } catch (err: any) {
      flash('err', err?.message || '上传失败');
    } finally {
      setBusy(null);
    }
  };

  const use = async (id: number) => {
    setBusy(id);
    try {
      await api.shop.setActiveBackground(id);
      await load();
      flash('ok', '已切换，首页马上生效');
    } catch (e: any) {
      flash('err', e?.message || '切换失败');
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    setBusy(0);
    try {
      await api.shop.setActiveBackground(0);
      await load();
      flash('ok', '已恢复默认背景');
    } catch (e: any) {
      flash('err', e?.message || '操作失败');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm('删除这张背景图？')) return;
    setBusy(id);
    try {
      await api.shop.deleteBackground(id);
      await load();
      flash('ok', '已删除');
    } catch (e: any) {
      flash('err', e?.message || '删除失败');
    } finally {
      setBusy(null);
    }
  };

  /* ── 未登录 ── */
  if (!user) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
        <ImageIcon className="w-10 h-10 text-gray-300 mx-auto" />
        <p className="mt-3 text-sm text-gray-500">登录后可以自定义首页背景</p>
        <button
          onClick={openLoginModal}
          className="mt-5 inline-flex items-center gap-2 h-10 px-6 rounded-xl bg-blue-500 text-white text-sm font-medium active:scale-95 transition-transform"
        >
          <UserIcon className="w-4 h-4" /> 去登录
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="py-16 flex flex-col items-center text-gray-400">
        <Loader2 className="w-7 h-7 animate-spin" />
        <p className="mt-3 text-sm">加载中…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {msg && (
        <div
          className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${
            msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
          }`}
        >
          {msg.kind === 'ok' ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* 未解锁 */}
      {!owned ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <div className="flex items-start gap-4">
            <div className="shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center">
              <ImageIcon className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-semibold text-gray-900">更换首页背景图片</h3>
              <p className="mt-1 text-sm text-gray-500 leading-relaxed">
                还在用默认背景？解锁后可以换成你自己的图片，只对你自己可见。
              </p>
              <div className="mt-3 flex items-center gap-2 text-amber-600 font-semibold">
                <Coins className="w-4 h-4 text-amber-500" />
                <span className="tabular-nums">{price ?? 211}</span>
                <span className="text-xs font-normal text-gray-400">铜板</span>
              </div>
              <Link
                to="/shop"
                className="mt-4 inline-flex items-center gap-1.5 h-10 px-5 rounded-xl bg-blue-500 text-white text-sm font-medium active:scale-95 transition-transform"
              >
                <Lock className="w-4 h-4" /> 去商城解锁
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* 上传 + 配额 */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">我的背景图</h3>
                <p className="mt-0.5 text-xs text-gray-400">
                  已用 {items.length}/{max} 张 · 单张不超过 5MB
                </p>
              </div>
              <button
                disabled={busy === 'upload' || items.length >= max}
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-blue-500 text-white text-sm font-medium active:scale-95 transition-transform disabled:opacity-50"
              >
                {busy === 'upload' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                上传图片
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
            </div>
            {items.length >= max && (
              <p className="mt-3 text-xs text-amber-600">已达上限，删掉一张才能继续上传</p>
            )}
          </div>

          {/* 遮罩浓度：控制首页背景上那层白色蒙层。
              深色图需要更厚的遮罩才能看清深色文字，浅色图则希望遮罩薄一点更通透 —— 
              写死 30% 永远只能照顾一类图，所以交给用户自己平衡。 */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-gray-900">背景遮罩</h3>
                <p className="mt-0.5 text-xs text-gray-400 leading-relaxed">
                  遮罩越淡，背景越清楚；太淡会让首页文字看不清
                </p>
              </div>
              <span className="shrink-0 text-lg font-bold text-slate-900 tabular-nums leading-none mt-0.5">
                {mask}%
              </span>
            </div>

            {/* 实时预览：和首页同一张图、同一层白遮罩，拖动即刻反映 */}
            <div className="mt-3 relative h-24 rounded-xl overflow-hidden border border-gray-100 bg-[#bcd3ec]">
              <img
                src={items.find((i) => i.active)?.url || '/home-bg.webp'}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0" style={{ background: `rgba(255,255,255,${mask / 100})` }} />
              <span className="absolute left-2 bottom-2 text-[11px] font-medium text-slate-700/85 bg-white/65 backdrop-blur-sm px-2 py-0.5 rounded-full">
                {items.some((i) => i.active) ? '当前背景' : '默认背景'}
              </span>
            </div>

            <input
              type="range"
              min={0}
              max={80}
              step={5}
              value={mask}
              onChange={(e) => applyMask(Number(e.target.value))}
              className="mt-4 w-full accent-blue-500"
              aria-label="背景遮罩不透明度"
            />
            <div className="flex justify-between text-[11px] text-gray-400 mt-1">
              <span>清晰</span>
              <span>柔和</span>
            </div>
          </div>

          {/* 列表 */}
          {items.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-10 text-center">
              <ImageIcon className="w-9 h-9 text-gray-300 mx-auto" />
              <p className="mt-3 text-sm text-gray-500">还没有图片，上传一张试试</p>
              <p className="mt-1 text-xs text-gray-400">建议用横图（比如 1600×900），效果最好</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {items.map((bg) => (
                <div key={bg.id} className="relative rounded-2xl overflow-hidden border border-gray-100 bg-white">
                  <img src={bg.url} alt="" className="w-full h-28 object-cover" />
                  {bg.active && (
                    <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[11px] font-medium">
                      <Check className="w-3 h-3" /> 使用中
                    </span>
                  )}
                  <div className="flex items-center gap-2 p-2">
                    <button
                      disabled={bg.active || busy === bg.id}
                      onClick={() => use(bg.id)}
                      className="flex-1 h-8 rounded-lg bg-blue-50 text-blue-600 text-xs font-medium active:scale-95 transition-transform disabled:opacity-40"
                    >
                      {busy === bg.id ? '…' : bg.active ? '已使用' : '使用这张'}
                    </button>
                    <button
                      disabled={busy === bg.id}
                      onClick={() => remove(bg.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-rose-50 text-rose-500 active:scale-95 transition-transform disabled:opacity-40"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeId !== null && (
            <button
              disabled={busy === 0}
              onClick={reset}
              className="w-full h-11 rounded-xl bg-gray-50 text-gray-500 text-sm active:scale-[0.99] transition-transform disabled:opacity-50"
            >
              {busy === 0 ? '处理中…' : '恢复默认背景'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
