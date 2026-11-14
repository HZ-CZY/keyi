import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Layers, LogOut, Menu, X, ChevronRight,
  Shield, FileText,
  LayoutDashboard, MessageCircle, Wifi, Megaphone,
  Image as ImageIcon, ClipboardList, ShoppingBag, BarChart3, TrendingUp, ListOrdered } from 'lucide-react';
import { useState, useEffect } from 'react';
import { UserBadge, badgeRingCls, badgeGlow } from './UserBadge';
import { api } from '../lib/api';

const adminLinks = [
  { to: '/admin', icon: LayoutDashboard, label: '总览', exact: true },
  { to: '/admin/users', icon: Shield, label: '用户管理', exact: true },
  { to: '/admin/avatar-reviews', icon: ImageIcon, label: '头像审核', exact: true },
  { to: '/admin/decks', icon: Layers, label: '牌组', exact: true },
  { to: '/admin/cards', icon: FileText, label: '制卡中心' },
  { to: '/admin/site-content', icon: FileText, label: '站点内容' },
  { to: '/admin/feedback', icon: MessageCircle, label: '用户反馈' },
  { to: '/admin/tutor-queue', icon: ListOrdered, label: '讲题队列' },
  { to: '/admin/class-report', icon: TrendingUp, label: '班级学情' },
  { to: '/admin/analytics', icon: BarChart3, label: '点击统计' },
  { to: '/admin/security', icon: Wifi, label: '安全', exact: true },
  { to: '/admin/announcements', icon: Megaphone, label: '公告' },
  { to: '/admin/tasks', icon: ClipboardList, label: '任务管理' },
  { to: '/admin/shop', icon: ShoppingBag, label: '商城', exact: true },
];

// ── Shared nav link renderer ─────────────────────

function NavItem({ to, icon: Icon, label, exact, onClick }: {
  to: string; icon: any; label: string; exact?: boolean; onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/' || exact}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all
         ${isActive
           ? 'bg-primary-50 text-primary-700 shadow-sm'
           : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
         }`
      }
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

// ── Sidebar layout (admin users) — three stacked pill capsules ──────

function SidebarLayout({ menuOpen, setMenuOpen }: {
  menuOpen: boolean; setMenuOpen: (v: boolean) => void;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // 【2026-10-12】点击侧栏即自动隐藏（让出 220px 给内容区，制卡中心这类宽页面尤其需要）。
  // 隐藏后左侧留一条窄唤醒条，点它或点菜单时恢复。
  const [sidebarHidden, setSidebarHidden] = useState(false);

  // 【2026-10-12 调整】点击收起**只在「制卡中心」生效** —— 那个页面左右两栏都宽，最需要横向空间；
  // 其他后台页面保持常显，避免误触后找不到导航。
  const canCollapse = location.pathname.startsWith('/admin/cards');
  // 离开制卡中心时自动把侧栏放出来，避免带着「已收起」的状态跳到别的页面
  useEffect(() => {
    if (!canCollapse) setSidebarHidden(false);
  }, [canCollapse]);

  const handleLogout = () => { logout(); navigate('/'); };








  // Heartbeat — keep admin marked as online
  useEffect(() => {
    const beat = () => api.admin.heartbeat().catch(() => {});
    beat();
    const interval = setInterval(beat, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  /* 仅站长可见的页面：点击统计 */
  const OWNER_ONLY = ['/admin/analytics'];
  const allAdminLinks = adminLinks.filter(
    (l) =>
      !OWNER_ONLY.includes(l.to) || user?.username === '陈子洋'
  );

  const isPillActive = (to: string) => {
    if (to === '/admin') return location.pathname === '/admin';
    return location.pathname.startsWith(to);
  };

  return (
    <div className="min-h-screen flex">
      {/* Mobile overlay */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Desktop: three stacked pill capsules (left side)
          —— 仅「制卡中心」支持点击整块收起（靠左边缘的唤醒条恢复），其他页面常显 */}
      <div
        onClick={canCollapse ? () => setSidebarHidden(true) : undefined}
        title={canCollapse ? '点击收起侧栏' : undefined}
        className={`hidden md:flex flex-col items-center fixed left-0 top-0 h-screen z-50 transition-[width] duration-200 ease-premium ${
          sidebarHidden
            ? 'w-0 overflow-hidden pointer-events-none'
            : `w-[220px]${canCollapse ? ' cursor-pointer' : ''}`
        }`}
      >
        <div className="flex flex-col items-center flex-1 w-full pt-6 pb-6 gap-6">
          {/* Top capsule: brand */}
          <nav className="pill-nav flex items-center justify-center gap-3 px-5 h-14 rounded-full w-[180px]">
            <img src="/brain.svg" alt="刻忆" className="w-9 h-9" />
            <span className="text-lg font-bold text-gray-900">刻忆</span>
          </nav>

          {/* Middle capsule: admin nav links — stretches tall with bottom space */}
          <nav className="pill-nav flex flex-col items-stretch px-3 pt-4 rounded-[28px] gap-1 w-[180px] flex-1">
            {allAdminLinks.map(link => (link as any).external ? (
              <a
                key={link.to}
                href={(link as any).external}
                target={(link as any).external === link.to ? undefined : '_blank'}
                rel={(link as any).external === link.to ? undefined : 'noopener noreferrer'}
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-250 ease-premium text-gray-500 hover:text-gray-800 hover:bg-white/25"
              >
                <link.icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{link.label}</span>
                {(link as any).external !== link.to && <span className="ml-auto text-[10px] opacity-50">↗</span>}
              </a>
            ) : (
              <NavLink
                key={link.to}
                to={link.to}
                end={(link as any).exact}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-250 ease-premium
                   ${isActive || isPillActive(link.to)
                     ? 'pill-link-active'
                     : 'text-gray-500 hover:text-gray-800 hover:bg-white/25'
                   }`
                }
              >
                <link.icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{link.label}</span>
              </NavLink>
            ))}
            {/* Spacer pushes links to top, leaving empty space at bottom */}
            <div className="flex-1" />
          </nav>

          {/* Bottom capsule: dark mode + user + logout */}
          <nav className="pill-nav flex items-center justify-center gap-1 px-3 h-14 rounded-full w-[180px]">
          
          <div className="capsule-user flex items-center gap-2 pl-2 pr-2 py-1 rounded-full">
            <span className="relative shrink-0">
              {user?.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt=""
                  className={`w-7 h-7 rounded-full object-cover flex-shrink-0 ${badgeRingCls(!!(user as any)?.badge_label)}`}
                  style={badgeGlow(!!(user as any)?.badge_label)}
                />
              ) : (
                <div
                  className={`w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${badgeRingCls(!!(user as any)?.badge_label)}`}
                  style={badgeGlow(!!(user as any)?.badge_label)}
                >
                  {user?.username?.charAt(0).toUpperCase() || 'U'}
                </div>
              )}
              {(user as any)?.badge_label ? <UserBadge size={28} label={(user as any).badge_label} /> : null}
            </span>
            <span className="text-sm font-medium text-gray-700 max-w-[70px] truncate">
              {user?.username}
            </span>
          </div>

          <button
            onClick={handleLogout}
            className="p-2 rounded-full text-gray-400 hover:text-red-500 hover:bg-white/30 transition-all duration-250 ease-premium"
            title="退出登录"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </nav>
      </div>
      </div>

      {/* 侧栏收起后的唤醒条（细长贴左边缘，点它展开） */}
      {sidebarHidden && canCollapse && (
        <button
          onClick={() => setSidebarHidden(false)}
          title="展开侧栏"
          className="hidden md:flex fixed left-0 top-1/2 -translate-y-1/2 z-50 items-center justify-center w-[14px] h-24 rounded-r-lg bg-white/90 backdrop-blur border border-l-0 border-gray-200 shadow-sm text-gray-400 hover:text-primary-600 hover:bg-primary-50/70 transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Mobile top bar + slide-in sidebar */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-[margin] duration-200 ease-premium ${
          sidebarHidden ? 'md:ml-[14px]' : 'md:ml-[220px]'
        }`}
      >
        <div className="md:hidden sticky top-0 z-30 glass border-b border-white/30 h-14 flex items-center px-4 gap-3 shadow-soft">
          <button
            onClick={() => setMenuOpen(true)}
            className="p-2 text-gray-600 hover:bg-white/60 rounded-lg"
          >
            <Menu className="w-5 h-5" />
          </button>
          <img src="/brain.svg" alt="刻忆" className="w-8 h-8" />
          <span className="font-bold text-gray-900">刻忆</span>
        </div>

        {/* Mobile slide-in sidebar (pill-style) */}
        <aside className={`
          md:hidden fixed top-0 left-0 z-50 h-screen
          w-64 flex-shrink-0
          glass border-r border-white/30 shadow-soft-lg
          flex flex-col
          transition-transform duration-300 ease-premium
          ${menuOpen ? 'translate-x-0' : '-translate-x-full'}
        `}>
          {/* Brand */}
          <div className="h-16 flex items-center gap-3 px-5 border-b border-white/20">
            <img src="/brain.svg" alt="刻忆" className="w-9 h-9" />
            <span className="text-lg font-bold text-gray-900">刻忆</span>
            <button
              onClick={() => setMenuOpen(false)}
              className="md:hidden ml-auto p-1.5 text-gray-400 hover:text-gray-600 hover:bg-white/50 rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Nav links */}
          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
            {allAdminLinks.map(link => (link as any).external ? (
              <a
                key={link.to}
                href={(link as any).external}
                target={(link as any).external === link.to ? undefined : '_blank'}
                rel={(link as any).external === link.to ? undefined : 'noopener noreferrer'}
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-250 ease-premium text-gray-600 hover:bg-white/60 hover:text-gray-900"
              >
                <link.icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{link.label}</span>
                {(link as any).external !== link.to && <span className="ml-auto text-[10px] opacity-50">↗</span>}
              </a>
            ) : (
              <NavLink
                key={link.to}
                to={link.to}
                end={(link as any).exact}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-250 ease-premium
                   ${isActive || isPillActive(link.to)
                     ? 'bg-gradient-to-r from-primary-50 to-indigo-50 text-primary-700 shadow-sm'
                     : 'text-gray-600 hover:bg-white/60 hover:text-gray-900'
                   }`
                }
              >
                <link.icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{link.label}</span>
              </NavLink>
            ))}
          </nav>

          {/* Mobile user section */}
          <div className="border-t border-white/20 p-3">
            <div className="flex items-center gap-3 px-2 py-2">
              <span className="relative shrink-0">
                {user?.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt=""
                    className={`w-8 h-8 rounded-full object-cover flex-shrink-0 ${badgeRingCls(!!(user as any)?.badge_label)}`}
                    style={badgeGlow(!!(user as any)?.badge_label)}
                  />
                ) : (
                  <div
                    className={`w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${badgeRingCls(!!(user as any)?.badge_label)}`}
                    style={badgeGlow(!!(user as any)?.badge_label)}
                  >
                    {user?.username?.charAt(0).toUpperCase() || 'U'}
                  </div>
                )}
                {(user as any)?.badge_label ? <UserBadge size={32} label={(user as any).badge_label} /> : null}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{user?.username}</p>
                <p className="text-xs text-gray-400 truncate">
                  {(user as any)?.role === 'admin' ? '管理员' : '用户'}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50/70 rounded-lg transition-colors"
                title="退出登录"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* Content area */}
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>

        {/* Footer */}
        <footer className="text-center py-4 text-xs text-gray-400 border-t border-white/50">
          @2026刻忆间隔学习平台 by HZ-CZY &nbsp;|&nbsp; <a href="https://beian.miit.gov.cn" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600">粤ICP备2026085151号-1</a>
        </footer>
      </div>
    </div>
  );
}

// ── Main Layout ──────────────────────────────────

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);

  return <><SidebarLayout menuOpen={menuOpen} setMenuOpen={setMenuOpen} /></>;
}
