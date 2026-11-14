import { formatCoins } from '../lib/coins';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Coins, Loader2, Lock, Mountain, RefreshCw, TrendingUp } from 'lucide-react';
import { isFeatureEnabled, useFeatureFlags } from '../lib/featureFlags';
import { getTabId } from '../lib/tabId';
import { useAuth } from '../context/AuthContext';

/**
 * 刻忆觉醒（部落）—— 用 iframe 嵌入 client/public/village3d 那套独立小游戏。
 *
 * 为什么用 iframe 而不是直接引入：
 *   游戏是纯 ES module + three.js 写的一坨（自带渲染循环、存档、PVP），
 *   塞进 React 树里会和 React 的渲染/生命周期打架。iframe 让它完全自治，
 *   两边只通过 postMessage 交换三件事：登录态、钱包快照、离线结算。
 *
 * 通信协议（宿主 ⇄ 游戏，均为同源 postMessage，绝不用 '*'）：
 *   宿主 → 游戏：village:auth（token/余额/user）、village:wallet-push、village:offline-result、village:flush
 *   游戏 → 宿主：village:ready（加载完成，宿主收到就补发 auth）、village:wallet-changed、village:need-offline
 *
 * ⚠️ 游戏侧源码在 client/public/village3d/（Vite 会原样拷进 dist/village3d），
 *    其中 bridge.js 负责这套 postMessage 协议；改协议两边必须一起改。
 */
const GAME_URL = '/village3d/index.html';
/** 加载超时：8 秒内游戏没报到就判定失败（网络差/资源缺失） */
const READY_TIMEOUT_MS = 8000;

interface Wallet {
  balance: number;
  todayStudyEarned: number;
  todayGameGranted: number;
  studyBonus?: number;
  limits?: unknown;
}

export default function VillageGamePage() {
  /* 订阅全局开关：开关一变（管理员在后台关掉部落）这里要立刻跟着切 */
  useFeatureFlags();
  /* 【2026-10-01】登录门禁：没有登录态一律不进游戏。
     这是一道**页面内的第二道门**（第一道是 App.tsx 的 ProtectedRoute）：
     iframe 一旦挂载就会开始加载 village3d 并握手，未登录时游戏侧拿不到 token，
     会陷入"能走动、但每次存钱/建东西都 401"的状态 —— 比直接挡住更让人困惑。
     两个守卫都在前端，权威拦截仍在服务端（/api/village/* 全部 authMiddleware）。 */
  const { user, loading: authLoading, openLoginModal } = useAuth();

  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [showHud, setShowHud] = useState(true);
  /* 钱包放进 ref：postAuth 在 useCallback([]) 里，读 state 会拿到初始值 */
  const walletRef = useRef<Wallet | null>(null);
  walletRef.current = wallet;

  /** 把登录态 + 钱包推给游戏（握手后、以及游戏每次 ready 都要补发） */
  const postAuth = useCallback(() => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    const token = localStorage.getItem('token');
    /* 【2026-10-01】没有 token 就不要再发 village:auth ——
       游戏侧 bridge.js 收到 auth 会把 ready 置 true 并开始读写云存档，
       而每个请求都会 401。宁可让它停在"等待登录"，也不要给它一个假登录态。
       （正常情况下走不到这里：上面的 !user 分支已经把页面挡住了，
         这是防止 token 在游戏运行期间被其它标签页清空。） */
    if (!token) return;
    const w = walletRef.current;
    let user: unknown = null;
    try {
      const raw = localStorage.getItem('user');
      user = raw ? JSON.parse(raw) : null;
    } catch { user = null; }
    win.postMessage({
      type: 'village:auth',
      payload: {
        token,
        balance: w ? w.balance : 0,
        todayStudyEarned: w ? w.todayStudyEarned : 0,
        todayGameGranted: w ? w.todayGameGranted : 0,
        limits: w?.limits || null,
        user,
        /* 【2026-10-14】把本标签页的标识交给游戏侧：它在 iframe 里，
           sessionStorage 与顶层是两份，自己生成会得到另一个值。 */
        tabId: getTabId(),
      },
    }, location.origin);
  }, []);

  /** 拉一次钱包快照 → 更新顶部余额条 → 顺便推给游戏（游戏里的铜板是钱包镜像） */
  const refreshWallet = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const res = await fetch('/api/village/wallet', {
        headers: { Authorization: `Bearer ${token}`, 'X-KEYI-TAB': getTabId() },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.ok) return;
      const w: Wallet = {
        balance: data.balance || 0,
        todayStudyEarned: data.todayStudyEarned || 0,
        todayGameGranted: data.todayGameGranted || 0,
        studyBonus: data.studyBonus || 0,
        limits: data.limits || undefined,
      };
      setWallet(w);
      frameRef.current?.contentWindow?.postMessage({
        type: 'village:wallet-push',
        payload: { balance: w.balance, todayStudyEarned: w.todayStudyEarned, todayGameGranted: w.todayGameGranted },
      }, location.origin);
    } catch { /* 网络抖动：顶部条保持旧值，游戏侧自己有重试 */ }
  }, []);

  /* 游戏 → 宿主的消息 */
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== location.origin) return;
      const msg = ev.data;
      if (!msg || typeof msg.type !== 'string') return;
      switch (msg.type) {
        case 'village:ready':
          /* 通知 index.html 的开屏页收起（那边在等这个事件） */
          window.dispatchEvent(new Event('village:__ready'));
          setReady(true);
          setFailed(false);
          postAuth();
          break;
        case 'village:wallet-changed':
          refreshWallet();
          break;
        case 'village:exit':
          /* 游戏侧的战报弹窗要求「先退出部落」—— 回首页去赚铜板 */
          window.history.back();
          break;
        case 'village:need-offline':
          /* 离线收益由宿主代打（游戏侧拿不到登录态，只有 token 在宿主这里） */
          fetch('/api/village/offline-claim', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
              'X-KEYI-TAB': getTabId(),
            },
          })
            .then((r) => r.json())
            .then((r) => {
              frameRef.current?.contentWindow?.postMessage({ type: 'village:offline-result', payload: r }, location.origin);
            })
            .catch(() => {});
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [postAuth, refreshWallet]);

  /* 启动：拉钱包 + 起超时计时（游戏 ready 会取消掉） */
  useEffect(() => {
    refreshWallet();
    let ok = false;
    const markReady = () => { ok = true; };
    window.addEventListener('village:__ready', markReady);
    const timer = setTimeout(() => { if (!ok) setFailed(true); }, READY_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('village:__ready', markReady);
    };
  }, [refreshWallet]);

  /* 离页 / 切后台：催游戏立刻落库，别把刚盖好的房子留在内存里 */
  useEffect(() => {
    const flush = () => {
      frameRef.current?.contentWindow?.postMessage({ type: 'village:flush' }, location.origin);
    };
    window.addEventListener('pagehide', flush);
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  if (!isFeatureEnabled('village')) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-50">
        <div className="text-center px-8">
          <Loader2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">刻忆觉醒暂时关闭</p>
        </div>
      </div>
    );
  }

  /* 未登录 / 会话校验中：不挂载 iframe，直接给出明确出口。
     authLoading 期间先显示加载态 —— 直接判"未登录"会让已登录用户在
     刷新页面时看到一瞬间的"请先登录"，体验很糟。 */
  if (authLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-b from-[#7ec8f0] to-[#a8dcf5]">
        <Loader2 className="w-10 h-10 text-white/90 animate-pulse" />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#7ec8f0] px-6">
        <div className="text-center max-w-xs">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/85 backdrop-blur-md shadow-sm flex items-center justify-center">
            <Lock className="w-8 h-8 text-indigo-500" />
          </div>
          <h2 className="text-lg font-bold text-white mb-1.5">请先登录</h2>
          <p className="text-white/85 text-sm mb-6">登录后才能进入部落，你的村庄会跟着账号一起保存。</p>
          <div className="flex items-center justify-center gap-2.5">
            <button
              onClick={openLoginModal}
              className="h-10 px-7 rounded-full bg-slate-900 text-white text-sm font-medium active:scale-95 transition-transform"
            >
              登录
            </button>
            <button
              onClick={() => window.history.back()}
              className="h-10 px-5 rounded-full bg-white/85 text-slate-700 text-sm font-medium active:scale-95 transition-transform"
            >
              返回
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#7ec8f0] overflow-hidden">
      <iframe ref={frameRef} src={GAME_URL} title="刻忆觉醒" className="w-full h-full border-0" allow="fullscreen; autoplay" />

      {/* 顶部余额条：只在游戏就绪后出现，避免盖住开屏动画 */}
      {ready && (
        <div className="absolute top-0 inset-x-0 z-10 pointer-events-none">
          <div className="flex items-start justify-end gap-2 p-3 pt-[max(env(safe-area-inset-top),12px)]">
            {showHud && (
              <div className="pointer-events-auto flex items-center gap-2">
                <div className="flex items-center gap-3 h-9 px-3.5 rounded-full bg-white/80 backdrop-blur-md shadow-sm border border-white/60">
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-700 tabular-nums">
                    <Coins className="w-4 h-4 text-amber-500" />
                    {formatCoins(wallet?.balance)}
                  </span>
                  <span className="w-px h-4 bg-black/10" />
                  <span
                    className="flex items-center gap-1.5 text-[12px] text-slate-600 tabular-nums"
                    title={wallet?.studyBonus ? `今日学习所得铜板（学识矿脉加成 +${Math.round(wallet.studyBonus * 100)}%）` : '今日学习所得铜板'}
                  >
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                    {wallet ? `+${wallet.todayStudyEarned}` : '—'}
                  </span>
                  {/* 【2026-10-21】原来只显示「×1.02」，含义埋在 title 里；
                      iPad 没有 hover，学生根本看不到这是「学识矿脉」的加成（反馈 #254）。 */}
                  {!!wallet?.studyBonus && (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-violet-600 bg-violet-50 rounded-full px-2 py-0.5 tabular-nums">
                      <Mountain className="w-3 h-3" />
                      矿脉 +{Math.round(wallet.studyBonus * 100)}%
                    </span>
                  )}
                </div>
                <button
                  onClick={refreshWallet}
                  className="flex items-center justify-center w-9 h-9 rounded-full bg-white/80 backdrop-blur-md shadow-sm border border-white/60 text-slate-500 active:scale-95 transition-transform"
                  title="刷新余额"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 返回：游戏是全屏的，得给一个自己的退出出口 */}
      <button
        onClick={() => window.history.back()}
        className="absolute left-3 bottom-[max(env(safe-area-inset-bottom),12px)] z-30 flex items-center gap-1.5 h-9 pl-2 pr-3.5 rounded-full bg-black/40 text-white text-xs font-medium backdrop-blur-md active:scale-95 transition-transform"
        title="返回学习页"
      >
        <ChevronLeft className="w-4 h-4" /> 返回
      </button>

      {!ready && !failed && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-gradient-to-b from-[#7ec8f0] to-[#a8dcf5]">
          <div className="text-center">
            <Loader2 className="w-10 h-10 text-white/90 mx-auto mb-4 animate-pulse" />
            <p className="text-white/90 text-sm font-medium">正在进入部落…</p>
          </div>
        </div>
      )}

      {failed && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/95 backdrop-blur">
          <div className="text-center px-8 max-w-xs">
            <Loader2 className="w-11 h-11 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-700 text-sm font-medium mb-1">加载失败了</p>
            <p className="text-slate-400 text-xs mb-5">请检查网络后重试</p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 h-9 px-5 rounded-full bg-slate-800 text-white text-xs font-medium active:scale-95 transition-transform"
            >
              <RefreshCw className="w-3.5 h-3.5" /> 重新加载
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
