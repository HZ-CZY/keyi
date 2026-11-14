import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginModal from './components/LoginModal';
import AnnouncementPopup from './components/AnnouncementPopup';
import AddToHomeGuide from './components/AddToHomeGuide';
import EndSwitcher from './components/EndSwitcher';
import Layout from './components/Layout';
import DashboardV2 from './pages/v2/DashboardV2';
import TutorLabPage from './pages/TutorLabPage';
import DecksPageV2 from './pages/v2/DecksPageV2';
import StudyPageV2 from './pages/v2/StudyPageV2';
import ReviewPageV2 from './pages/v2/ReviewPageV2';
import WordLookupPageV2 from './pages/v2/WordLookupPageV2';
import WordbookPageV2 from './pages/v2/WordbookPageV2';
import CoinLedgerPageV2 from './pages/v2/CoinLedgerPageV2';
import RoadmapPageV2 from './pages/v2/RoadmapPageV2';
import AdminAnalyticsPage from './pages/AdminAnalyticsPage';
import V2PageShell from './pages/v2/components/V2PageShell';
import { isFeatureEnabled, useFeatureFlags, fetchFlags } from './lib/featureFlags';
import { ListTodo, ShoppingBag, Crown, Library, BookOpen } from 'lucide-react';

/**
 * 【2026-09-22 代码分割】管理后台 / 次要页面改按需加载。
 *
 * 改动前：以下页面全部静态 import，被打进主包 assets/index-*.js（≈1.1 MB），
 * 任何访客打开首页都要下载整个管理后台，是「后台很卡」的根因。
 * 改动后：改为 React.lazy 动态 import，Rollup 自动为每个页面产出独立 chunk，
 * 只有真正访问该路由时才下载。
 *
 * 首屏必需组件保持静态 import（不进 lazy）：DashboardV2（首页）、StudyPageV2、
 * DecksPageV2、ReviewPageV2、WordLookupPageV2、LoginModal、AnnouncementPopup、
 * AuthProvider、Layout、V2PageShell。
 * 仅改变加载方式 —— UI 结构、className、文案、接口调用一律未动。
 */
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const AdminDeckPage = lazy(() => import('./pages/AdminDeckPage'));
const AdminAvatarReviewPage = lazy(() => import('./pages/AdminAvatarReviewPage'));
const AdminCardsPage = lazy(() => import('./pages/AdminCardsPage'));
const AdminSiteContentPage = lazy(() => import('./pages/AdminSiteContentPage'));
const AdminFeedbackPage = lazy(() => import('./pages/AdminFeedbackPage'));
const AdminTutorQueuePage = lazy(() => import('./pages/AdminTutorQueuePage'));
const AdminClassReportPage = lazy(() => import('./pages/AdminClassReportPage'));
const AdminSecurityPage = lazy(() => import('./pages/AdminSecurityPage'));
const AdminAnnouncementsPage = lazy(() => import('./pages/AdminAnnouncementsPage'));
const AdminTasksPage = lazy(() => import('./pages/AdminTasksPage'));
const AdminShopPage = lazy(() => import('./pages/AdminShopPage'));
const AdminFeatureFlagsPage = lazy(() => import('./pages/v2/AdminFeatureFlagsPage'));
// 非首屏的次要页面
const ProfilePageV2 = lazy(() => import('./pages/v2/ProfilePageV2'));
const StudySettingsPageV2 = lazy(() => import('./pages/v2/StudySettingsPageV2'));
const StatsPage = lazy(() => import('./pages/StatsPage'));
const TasksPageV2 = lazy(() => import('./pages/v2/TasksPageV2'));
const DiscoverPageV2 = lazy(() => import('./pages/v2/DiscoverPageV2'));
const V2PlaceholderPage = lazy(() => import('./pages/v2/V2PlaceholderPage'));
const ReadingPageV2 = lazy(() => import('./pages/v2/ReadingPageV2'));
const TogetherPageV2 = lazy(() => import('./pages/v2/TogetherPageV2'));
const TrainingPageV2 = lazy(() => import('./pages/v2/TrainingPageV2'));
const ArenaPracticePage = lazy(() => import('./pages/v2/ArenaPracticePage'));
const BattlePageV2 = lazy(() => import('./pages/v2/BattlePageV2'));
/* ArenaHubPage（单人练习/真人 PK 双卡片页）已于 2026-10-10 废弃，不再挂路由，
   故也不再 import —— 保留其源文件仅作历史参考。 */
const ContestPageV2 = lazy(() => import('./pages/v2/ContestPageV2'));
/* 牌组单词列表（2026-10-10）：首页学习卡片点牌组名进入 */
const DeckWordsPageV2 = lazy(() => import('./pages/v2/DeckWordsPageV2'));
/* 考前突击（2026-10-11）：统编版选必一 古诗词及文言文 10 篇，速览 + 默写自测 */
const CrashCoursePageV2 = lazy(() => import('./pages/v2/CrashCoursePageV2'));
/* 刻忆觉醒（部落）：外壳是 iframe，游戏本体在 client/public/village3d/ */
const VillageGamePage = lazy(() => import('./pages/VillageGamePage'));
/* 商城（2026-09-30 上架首个商品：更换首页背景图片） */
const ShopPageV2 = lazy(() => import('./pages/v2/ShopPageV2'));

/** 懒加载占位 —— 轻量「加载中」，与 v2 视觉体系一致（非整页骨架） */
function RouteFallback() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="flex items-center gap-3 text-gray-400">
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" />
        <span className="text-sm">加载中…</span>
      </div>
    </div>
  );
}

/** 懒加载路由的 Suspense 边界（统一 fallback） */
function LazyRoute({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

// 统计/设置用 v2 外壳包装（内容逻辑不变，去掉旧版导航）
const StatsPageV2 = () => (
  <V2PageShell title="统计"><StatsPage /></V2PageShell>
);

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, openLoginModal } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="min-h-[calc(100vh-200px)] flex flex-col items-center justify-center text-center px-4">
        <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
          <img src="/brain.svg" alt="刻忆" className="w-12 h-12 opacity-40" />
        </div>
        <h2 className="text-2xl font-bold text-gray-500 mb-2">请先登录</h2>
        <p className="text-gray-400 mb-6">登录后即可查看此页面内容</p>
        <button
          onClick={openLoginModal}
          className="px-8 py-3 rounded-full bg-gradient-to-r from-primary-600 to-indigo-600 text-white font-medium shadow-soft-lg hover:shadow-xl hover:translate-y-[-2px] transition-all duration-250 ease-premium"
        >
          登录
        </button>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * 管理员路由守卫 —— 登录 + 角色双重校验。
 *
 * 【2026-09-12 安全修复】原先 /admin/* 下全部路由只用了 ProtectedRoute，
 * 而它仅校验「是否登录」，不校验角色，导致任意已登录的普通用户都能进入
 * 管理后台界面。真正的数据拦截在后端 adminMiddleware（这部分是正确的），
 * 所以不构成数据泄漏；但会暴露后台结构与功能清单，且一旦某个管理接口漏加
 * adminMiddleware，就会立刻变成实际越权。
 *
 * 注意：前端守卫只是 UI 层防护，后端鉴权才是唯一权威。
 */
/* [2026-11-12] AI 讲题实验室已对内测全量开放，路由守卫改为普通登录校验。 */

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, openLoginModal } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="min-h-[calc(100vh-200px)] flex flex-col items-center justify-center text-center px-4">
        <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
          <img src="/brain.svg" alt="刻忆" className="w-12 h-12 opacity-40" />
        </div>
        <h2 className="text-2xl font-bold text-gray-500 mb-2">请先登录</h2>
        <p className="text-gray-400 mb-6">登录后即可查看此页面内容</p>
        <button
          onClick={openLoginModal}
          className="px-8 py-3 rounded-full bg-gradient-to-r from-primary-600 to-indigo-600 text-white font-medium shadow-soft-lg hover:shadow-xl hover:translate-y-[-2px] transition-all duration-250 ease-premium"
        >
          登录
        </button>
      </div>
    );
  }
  if (user.role !== 'admin') {
    return (
      <div className="min-h-[calc(100vh-200px)] flex flex-col items-center justify-center text-center px-4">
        <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-rose-100 to-orange-100 flex items-center justify-center">
          <img src="/brain.svg" alt="刻忆" className="w-12 h-12 opacity-40" />
        </div>
        <h2 className="text-2xl font-bold text-gray-500 mb-2">无权访问</h2>
        <p className="text-gray-400 mb-6">该页面仅管理员可见</p>
        <button
          onClick={() => { window.location.href = '/'; }}
          className="px-8 py-3 rounded-full bg-gradient-to-r from-primary-600 to-indigo-600 text-white font-medium shadow-soft-lg hover:shadow-xl hover:translate-y-[-2px] transition-all duration-250 ease-premium"
        >
          返回首页
        </button>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * 全局功能开关路由守卫：
 * - 模块被禁用（flag=false）时，渲染白玻璃「功能维护中」占位页，直接访问被拦截。
 * - 通过 useFeatureFlags 订阅开关变化，开关切换后立即重渲染并拦截/放行。
 * - 未加载到开关（进站首帧）时默认视为开，避免误拦截。
 */
function FeatureGuard({
  flagKey,
  children,
  title = '功能维护中',
  desc = '该模块暂时不可用，敬请期待重新开放~',
}: {
  flagKey: string;
  children: React.ReactNode;
  title?: string;
  desc?: string;
}) {
  useFeatureFlags();
  if (!isFeatureEnabled(flagKey)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#cfe0f4] via-[#bcd3ec] to-[#a9c6e6] px-4">
        <div className="glass rounded-3xl shadow-soft-lg px-10 py-12 text-center max-w-sm">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-white/70 flex items-center justify-center">
            <img src="/brain.svg" alt="刻忆" className="w-9 h-9 opacity-50" />
          </div>
          <h2 className="text-xl font-bold text-gray-700 mb-2">{title}</h2>
          <p className="text-gray-500 text-sm mb-6">{desc}</p>
          <button
            onClick={() => { window.location.href = '/'; }}
            className="px-6 py-2.5 rounded-full bg-gradient-to-r from-primary-600 to-indigo-600 text-white font-medium shadow-soft-lg hover:translate-y-[-1px] transition-all"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { loading } = useAuth();

  // 通知静态开屏页：应用已挂载并完成鉴权，可以淡出了
  useEffect(() => {
    if (!loading) (window as any).__KEYI_READY__ = true;
  }, [loading]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary-600 flex items-center justify-center">
            <span className="text-white text-2xl font-bold">A</span>
          </div>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* 根路径 — 直接渲染 V2 仪表盘（无 /v2 后缀） */}
      <Route path="/" element={<DashboardV2 />} />
      {/* 未知路径（含旧 /v2 书签）→ 回首页 */}
      <Route path="*" element={<Navigate to="/" replace />} />

      {/* Admin 管理后台（保留旧版侧边栏布局）
          【2026-09-12 安全修复】整棵 /admin 子树改由 AdminRoute 守卫（登录 + 角色）。
          守卫挂在父路由的 element 上：非管理员时 AdminRoute 直接渲染「无权访问」，
          Layout 的 <Outlet/> 不会渲染，所有子页面都不会挂载。
          【2026-09-22 代码分割】12 个管理页全部 lazy，进入具体页面时才下载对应 chunk。
          注意：守卫在 Suspense 外层 —— 非管理员根本不会触发子页面 chunk 下载。 */}
      <Route path="/admin" element={<AdminRoute><Layout /></AdminRoute>}>
        <Route index element={<Suspense fallback={<RouteFallback />}><AdminDashboardPage /></Suspense>} />
        <Route path="decks" element={<Suspense fallback={<RouteFallback />}><AdminDeckPage /></Suspense>} />
        <Route path="users" element={<Suspense fallback={<RouteFallback />}><AdminPage /></Suspense>} />
        <Route path="avatar-reviews" element={<Suspense fallback={<RouteFallback />}><AdminAvatarReviewPage /></Suspense>} />
        <Route path="cards" element={<Suspense fallback={<RouteFallback />}><AdminCardsPage /></Suspense>} />
        <Route path="site-content" element={<Suspense fallback={<RouteFallback />}><AdminSiteContentPage /></Suspense>} />
        <Route path="feedback" element={<Suspense fallback={<RouteFallback />}><AdminFeedbackPage /></Suspense>} />
        <Route path="tutor-queue" element={<Suspense fallback={<RouteFallback />}><AdminTutorQueuePage /></Suspense>} />
        <Route path="security" element={<Suspense fallback={<RouteFallback />}><AdminSecurityPage /></Suspense>} />
        <Route path="announcements" element={<Suspense fallback={<RouteFallback />}><AdminAnnouncementsPage /></Suspense>} />
        <Route path="tasks" element={<Suspense fallback={<RouteFallback />}><AdminTasksPage /></Suspense>} />
        <Route path="shop" element={<Suspense fallback={<RouteFallback />}><AdminShopPage /></Suspense>} />
        {/* 全局功能开关 */}
        <Route path="feature-flags" element={<Suspense fallback={<RouteFallback />}><AdminFeatureFlagsPage /></Suspense>} />
        <Route path="analytics" element={<Suspense fallback={<RouteFallback />}><AdminAnalyticsPage /></Suspense>} />
        <Route path="class-report" element={<Suspense fallback={<RouteFallback />}><AdminClassReportPage /></Suspense>} />
      </Route>

      {/* V2 全屏独立路由 — 不经过旧版 Layout，保持 v2 视觉体系 */}
      <Route path="/decks" element={<FeatureGuard flagKey="decks"><DecksPageV2 /></FeatureGuard>} />
      <Route path="/study/:deckId?" element={<FeatureGuard flagKey="study"><StudyPageV2 /></FeatureGuard>} />
      {/* 牌组单词列表（2026-10-10）：首页学习卡片点牌组名进入，展示该牌组全部卡片
          与其学习状态（未学习/学习中/已逾期/下次复习），支持筛选、排序、搜索。 */}
      <Route path="/deck/:deckId/words" element={<FeatureGuard flagKey="study"><ProtectedRoute><LazyRoute><DeckWordsPageV2 /></LazyRoute></ProtectedRoute></FeatureGuard>} />
      {/* 考前突击（2026-10-11）：入口在首页右侧栏「训练场」下方。内容为选必一古诗词及文言文
          速览 + 默写自测，数据在 client/src/data/crashCourse.ts，纯前端、无后端改动。 */}
      <Route path="/crash" element={<FeatureGuard flagKey="crash"><ProtectedRoute><LazyRoute><CrashCoursePageV2 /></LazyRoute></ProtectedRoute></FeatureGuard>} />
      <Route path="/review/:deckId" element={<FeatureGuard flagKey="review"><ReviewPageV2 /></FeatureGuard>} />
      <Route path="/lookup" element={<FeatureGuard flagKey="lookup"><WordLookupPageV2 /></FeatureGuard>} />
      <Route path="/wordbook" element={<FeatureGuard flagKey="lookup"><ProtectedRoute><WordbookPageV2 /></ProtectedRoute></FeatureGuard>} />
      <Route path="/coins" element={<ProtectedRoute><CoinLedgerPageV2 /></ProtectedRoute>} />
      {/* [2026-11-09] AI 讲题实验室：仅站长可见，不对学生开放 */}
      <Route path="/tutor-lab" element={<ProtectedRoute><TutorLabPage /></ProtectedRoute>} />
      {/* 站点升级进度（2026-11-06）：设置页入口，学生只读 */}
      <Route path="/roadmap" element={<ProtectedRoute><LazyRoute><RoadmapPageV2 /></LazyRoute></ProtectedRoute>} />
      <Route path="/study-settings" element={<LazyRoute><StudySettingsPageV2 /></LazyRoute>} />
      <Route path="/tasks" element={<FeatureGuard flagKey="tasks"><LazyRoute><TasksPageV2 /></LazyRoute></FeatureGuard>} />
      <Route path="/stats" element={<FeatureGuard flagKey="stats"><LazyRoute><StatsPageV2 /></LazyRoute></FeatureGuard>} />
      <Route path="/settings" element={<LazyRoute><ProfilePageV2 /></LazyRoute>} />
      {/* 发现（2026-10-19）：底部导航第二项，取代原来的「每日一句」/daily。
          页面内容 = 每日一句（朗读 / 打卡 / 往期回顾）+ 任务 / 查词 / 统计 / 词库 四个探索入口。
          /daily 保留为客户端重定向，老书签不会 404。详见 DiscoverPageV2 顶部说明。 */}
      <Route path="/discover" element={<FeatureGuard flagKey="daily"><LazyRoute><DiscoverPageV2 /></LazyRoute></FeatureGuard>} />
      <Route path="/daily" element={<Navigate to="/discover" replace />} />
      {/* 竞技场（2026-10-10 调整）：/arena 现在**直接进入决斗场大厅**
          （BattleLobby，紫色大厅页），不再经过原来的「单人练习 / 真人 PK 双卡片」
          ArenaHubPage —— 那个页面已废弃（文件保留，仅作历史参考，不再挂在任何路由上）。
          单人练习入口改从首页右侧栏「训练场」进入（→ /arena/practice）。 */}
      <Route path="/arena" element={<FeatureGuard flagKey="battle"><ProtectedRoute><LazyRoute><BattlePageV2 /></LazyRoute></ProtectedRoute></FeatureGuard>} />
      {/* 老路由 302 —— 保留旧书签（直接敲 URL 由后端 302；此处兜底客户端路由） */}
      <Route path="/training" element={<Navigate to="/arena/practice" replace />} />
      <Route path="/battle" element={<Navigate to="/arena" replace />} />
      {/* 单人练习（训练场）：首页右侧栏「训练场」入口直达 */}
      <Route path="/arena/practice" element={<FeatureGuard flagKey="practice"><ProtectedRoute><LazyRoute><ArenaPracticePage /></LazyRoute></ProtectedRoute></FeatureGuard>} />
      {/* /arena/pk 是决斗场大厅的内层别名，直接复用同一页面（原来的 BattlePageV2 守卫已上移到 /arena） */}
      <Route path="/arena/pk" element={<Navigate to="/arena" replace />} />
      {/* 实词大赛（一站到底）：答错为止的选择题挑战 + 单独排行榜 */}
      <Route path="/contest" element={<FeatureGuard flagKey="contest"><ProtectedRoute><LazyRoute><ContestPageV2 /></LazyRoute></ProtectedRoute></FeatureGuard>} />
      <Route path="/together" element={<FeatureGuard flagKey="together"><LazyRoute><TogetherPageV2 /></LazyRoute></FeatureGuard>} />
      {/* 刻忆觉醒（部落）—— 对全部登录用户开放（不再只给管理员）
          【2026-10-01 修复】原先这里**只有 FeatureGuard，没有 ProtectedRoute**，
          导致未登录访客直接敲 /village 就能进入游戏（其他页面如 /arena 都套了
          ProtectedRoute，唯独漏了这里）。现在补上，未登录一律显示「请先登录」。
          服务端 /api/village/* 本来就有 authMiddleware 兜底（未登录 401），
          这个守卫解决的是"界面能进去、但处处报错"的糟糕体验。 */}
      <Route path="/village" element={<FeatureGuard flagKey="village"><ProtectedRoute><LazyRoute><VillageGamePage /></LazyRoute></ProtectedRoute></FeatureGuard>} />
      <Route path="/shop" element={<FeatureGuard flagKey="shop"><LazyRoute><ShopPageV2 /></LazyRoute></FeatureGuard>} />
      <Route path="/member" element={<FeatureGuard flagKey="member"><LazyRoute><V2PlaceholderPage title="会员" icon={<Crown className="w-9 h-9 text-amber-500" />} /></LazyRoute></FeatureGuard>} />
      <Route path="/reading" element={<FeatureGuard flagKey="reading"><LazyRoute><ReadingPageV2 /></LazyRoute></FeatureGuard>} />
    </Routes>
  );
}

export default function App() {
  // 进站拉取一次全局功能开关，覆盖本地缓存并通知各订阅组件。
  // 【2026-10-11】另加「每 5 分钟 + 页面重新可见」的静默同步：
  // 「限时开启」的板块（如考前突击）到点后能自动隐藏，用户无需手动刷新。
  useEffect(() => {
    fetchFlags();
    const timer = setInterval(() => { fetchFlags(); }, 5 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchFlags();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // [2026-10-26] 全局点击埋点：自动提取锚点（data-track > aria-label/title > 文案），批量上报
  useEffect(() => {
    let queue: { path: string; target: string; label: string }[] = [];
    let timer: number | null = null;
    const flush = () => {
      if (queue.length === 0) return;
      const token = localStorage.getItem('token');
      if (!token) return;
      const events = queue.slice(0, 50);
      queue = queue.slice(50);
      fetch('/api/analytics/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ events }),
        keepalive: true,
      }).catch(() => {});
    };
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement)?.closest?.('button,a,[role="button"],input,select,textarea,label,[data-track]') as HTMLElement | null;
      if (!el) return;
      const explicit = el.getAttribute('data-track');
      const text = (explicit || el.getAttribute('aria-label') || el.getAttribute('title') || (el as any).innerText || (el as any).placeholder || el.getAttribute('name') || '')
        .trim().replace(/\s+/g, ' ').slice(0, 80);
      const tag = el.tagName.toLowerCase();
      const target = (explicit || `${tag}:${text || el.id || (el.className || '').toString().slice(0, 40)}`).slice(0, 200);
      queue.push({ path: window.location.pathname + window.location.search, target, label: text });
      if (queue.length >= 20) flush();
    };
    document.addEventListener('click', onClick, true);
    timer = window.setInterval(flush, 4000);
    return () => {
      document.removeEventListener('click', onClick, true);
      if (timer) clearInterval(timer);
      flush();
    };
  }, []);
  return (
    <AuthProvider>
      <AppRoutes />
      {/* 全局登录弹窗 — 所有路由(含 V2 全屏页)都可弹出登录 */}
      <LoginModal />
      {/* 全局公告弹窗 — 所有页面都能显示公告 */}
      <AnnouncementPopup />
      {/* 添加到主屏幕 · 全屏强引导（每个用户只弹一次，服务端记录） */}
      <AddToHomeGuide />
      {/* 管理端 ⇄ 用户端 切换器 — 仅管理员可见，覆盖所有路由 */}
      <EndSwitcher />
    </AuthProvider>
  );
}
