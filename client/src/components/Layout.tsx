import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Home, Layers, BarChart3, LogOut, Menu, X,
  Shield, FileText, Settings, Search, Star,
  LayoutDashboard, Upload, Sun, Moon, MessageCircle, Wifi, Megaphone, Terminal
} from 'lucide-react';
import { useState, useEffect } from 'react';
import AiChatWidget from './AiChatWidget';
import LoginModal from './LoginModal';
import AnnouncementPopup from './AnnouncementPopup';
import { api } from '../lib/api';

// Three main nav items (user-facing)
const mainLinks = [
  { to: '/', icon: Home, label: '首页' },
  { to: '/decks', icon: Layers, label: '牌组' },
  { to: '/stats', icon: BarChart3, label: '统计' },
];

const userLinks = [
  { to: '/settings', icon: Settings, label: '个人中心' },
];

const adminLinks = [
  { to: '/admin', icon: LayoutDashboard, label: '总览', exact: true },
  { to: '/admin/users', icon: Shield, label: '用户管理', exact: true },
  { to: '/admin/decks', icon: Layers, label: '牌组', exact: true },
  { to: '/admin/cards', icon: FileText, label: '制卡中心' },
  { to: '/admin/site-content', icon: FileText, label: '站点内容' },
  { to: '/admin/feedback', icon: MessageCircle, label: '用户反馈' },
  { to: '/admin/security', icon: Wifi, label: '安全', exact: true },
  { to: '/admin/announcements', icon: Megaphone, label: '公告' },
  { to: '/admin/terminal', icon: Terminal, label: '终端' },
  { to: '/import', icon: Upload, label: '导入' },
  { to: '/lookup', icon: Search, label: '查词' },
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

// ── Top pill nav layout (regular users) ────────────

function TopHeaderLayout({ menuOpen, setMenuOpen, isAdmin }: {
  menuOpen: boolean; setMenuOpen: (v: boolean) => void; isAdmin: boolean;
}) {
  const { user, logout, openLoginModal } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const hideHeader = location.pathname.startsWith('/study/') || location.pathname.startsWith('/quiz/') || location.pathname.startsWith('/review/');

  const handleLogout = () => { logout(); navigate('/'); };

  const isPillActive = (to: string) => {
    if (to === '/') return location.pathname === '/';
    return location.pathname.startsWith(to);
  };

  // ── Dark mode ──
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('darkMode') === 'true';
    }
    return false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  // Heartbeat — regular users also stay marked online
  useEffect(() => {
    if (!user) return;
    const beat = () => api.auth.heartbeat().catch(() => {});
    beat();
    const interval = setInterval(beat, 60 * 1000);
    return () => clearInterval(interval);
  }, [user]);

  const toggleDark = () => setDarkMode(prev => !prev);

  return (
    <div className="min-h-screen flex flex-col">
      {!hideHeader && (
        <>
          {/* Desktop floating pill nav — three separate capsules */}
          <div className="hidden md:flex justify-center items-start pt-4 sticky top-0 z-50">
            {/* Left pill: brain icon + 刻忆 */}
            <nav className="pill-nav flex items-center gap-3 px-4 h-14 rounded-full absolute left-4">
              <NavLink to="/" className="w-11 h-11 flex items-center justify-center flex-shrink-0">
                <img src="/brain.svg" alt="刻忆" className="w-7 h-7" />
              </NavLink>
              <span className="text-base font-bold text-gray-900 mt-0.5">刻忆</span>
            </nav>

            {/* Center pill: all navigation */}
            <nav className="pill-nav flex items-center gap-1.5 px-4 h-14 rounded-full">
              <NavLink
                to="/"
                end
                className={`pill-link ${isPillActive('/') ? 'pill-link-active' : ''}`}
              >
                首页
              </NavLink>
              <NavLink
                to="/decks"
                className={`pill-link ${isPillActive('/decks') ? 'pill-link-active' : ''}`}
              >
                牌组
              </NavLink>
              <NavLink
                to="/stats"
                className={`pill-link ${isPillActive('/stats') ? 'pill-link-active' : ''}`}
              >
                统计
              </NavLink>
              <NavLink
                to="/lookup"
                className={`pill-link ${isPillActive('/lookup') ? 'pill-link-active' : ''}`}
              >
                查词
              </NavLink>
              <NavLink
                to="/poetry/"
                target="_blank"
                rel="noopener noreferrer"
                className={`pill-link ${isPillActive('/poetry') ? 'pill-link-active' : ''}`}
              >
                诗云
              </NavLink>
              <NavLink
                to="/settings"
                className={`pill-link ${isPillActive('/settings') ? 'pill-link-active' : ''}`}
              >
                设置
              </NavLink>
            </nav>

            {/* Right pill: dark mode + user/login */}
            <nav className="pill-nav flex items-center gap-2 px-4 h-14 rounded-full absolute right-4">
                {/* Dark mode toggle */}
                <button
                  onClick={toggleDark}
                  className="p-2.5 rounded-full text-gray-400 hover:text-amber-500 hover:bg-white/30 transition-all duration-250 ease-premium"
                  title={darkMode ? '切换亮色模式' : '切换深色模式'}
                >
                  {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>

                {user ? (
                  <>
                    <div className="capsule-user flex items-center gap-2.5 pl-3 pr-3 py-1.5 rounded-full">
                      {user?.avatar_url ? (
                        <img src={user.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {user?.username?.charAt(0).toUpperCase() || 'U'}
                        </div>
                      )}
                      <span className="text-sm font-medium text-gray-700 max-w-[100px] truncate">
                        {user?.username}
                      </span>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="p-2.5 rounded-full text-gray-400 hover:text-red-500 hover:bg-white/30 transition-all duration-250 ease-premium"
                      title="退出登录"
                    >
                      <LogOut className="w-5 h-5" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={openLoginModal}
                    className="px-4 py-2 rounded-full bg-gradient-to-r from-primary-600 to-indigo-600 text-white text-sm font-medium hover:shadow-lg hover:translate-y-[-1px] transition-all duration-250 ease-premium"
                  >
                    登录
                  </button>
                )}
              </nav>
          </div>

          {/* Mobile header */}
          <header className="md:hidden sticky top-0 z-50 pill-nav rounded-none border-x-0 border-t-0 px-4 h-14 flex items-center justify-between">
            <NavLink to="/" className="flex items-center gap-2.5">
              <div className="capsule-icon w-8 h-8 rounded-lg">
                <img src="/brain.svg" alt="刻忆" className="w-5 h-5" />
              </div>
              <span className="font-bold text-gray-900 text-sm">刻忆</span>
            </NavLink>

            <div className="flex items-center gap-2">
              {/* Mobile capsule buttons */}
              <div className="flex items-center gap-1.5">
                {mainLinks.map(link => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end={link.to === '/'}
                    className={`pill-link text-xs px-2.5 py-1.5 ${
                      isPillActive(link.to) ? 'pill-link-active' : ''
                    }`}
                  >
                    {link.label}
                  </NavLink>
                ))}
              </div>

              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="p-2 text-gray-500 hover:text-gray-700 rounded-full hover:bg-white/30 transition-all"
              >
                {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </header>

          {/* Mobile dropdown nav */}
          {menuOpen && (
            <div className="md:hidden fixed top-14 left-0 right-0 z-40 pill-nav border-t-0 rounded-none border-x-0 px-4 py-3 flex flex-col gap-1 shadow-soft-lg">
              {user ? (
                <>
                  <div className="capsule-user flex items-center gap-2.5 px-3 py-2 rounded-full mb-2">
                    {user?.avatar_url ? (
                      <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                        {user?.username?.charAt(0).toUpperCase() || 'U'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{user?.username}</div>
                      <div className="text-xs text-gray-400">
                        {(user as any)?.role === 'admin' ? '管理员' : '用户'}
                      </div>
                    </div>
                  </div>
                  <NavLink to="/lookup" onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-white/30 transition-all">
                    <Search className="w-4 h-4" /> 查词
                  </NavLink>
                  <NavLink to="/poetry/" target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-white/30 transition-all">
                    <Star className="w-4 h-4" /> 诗云
                  </NavLink>
                  <NavLink to="/settings" onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-white/30 transition-all">
                    <Settings className="w-4 h-4" /> 设置
                  </NavLink>
                  <button onClick={handleLogout}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-500 hover:bg-white/30 transition-all">
                    <LogOut className="w-4 h-4" /> 退出登录
                  </button>
                </>
              ) : (
                <button onClick={() => { setMenuOpen(false); openLoginModal(); }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 transition-all">
                  <LogOut className="w-4 h-4 rotate-90" /> 登录
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Content */}
      <main className={`flex-1 w-full ${hideHeader ? 'px-0 py-0' : 'max-w-7xl mx-auto px-4 py-6 pt-6 md:pt-8'}`}>
        <Outlet />
      </main>

      {/* Footer */}
      {!hideHeader && (
      <footer className="text-center py-4 text-xs text-gray-400 border-t border-white/50">
        @2026刻忆间隔学习平台 by HZ-CZY &nbsp;|&nbsp; <a href="https://beian.miit.gov.cn" target="_blank" rel="noopener noreferrer" class="text-gray-400 hover:text-gray-600">粤ICP备2026085151号-1</a>
      </footer>
      )}

      {!hideHeader && <AiChatWidget />}
    </div>
  );
}

// ── Sidebar layout (admin users) — three stacked pill capsules ──────

function SidebarLayout({ menuOpen, setMenuOpen }: {
  menuOpen: boolean; setMenuOpen: (v: boolean) => void;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => { logout(); navigate('/'); };

  // ── Dark mode ──
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('darkMode') === 'true';
    }
    return false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  const toggleDark = () => setDarkMode(prev => !prev);

  // Heartbeat — keep admin marked as online
  useEffect(() => {
    const beat = () => api.admin.heartbeat().catch(() => {});
    beat();
    const interval = setInterval(beat, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const allAdminLinks = [...adminLinks, ...userLinks];

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

      {/* Desktop: three stacked pill capsules (left side) */}
      <div className="hidden md:flex flex-col items-center fixed left-0 top-0 h-screen z-50 w-[220px]">
        <div className="flex flex-col items-center flex-1 w-full pt-6 pb-6 gap-6">
          {/* Top capsule: brand */}
          <nav className="pill-nav flex items-center justify-center gap-3 px-5 h-14 rounded-full w-[180px]">
            <img src="/brain.svg" alt="刻忆" className="w-9 h-9" />
            <span className="text-lg font-bold text-gray-900">刻忆</span>
          </nav>

          {/* Middle capsule: admin nav links — stretches tall with bottom space */}
          <nav className="pill-nav flex flex-col items-stretch px-3 pt-4 rounded-[28px] gap-1 w-[180px] flex-1">
            {allAdminLinks.map(link => (
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
          <button
            onClick={toggleDark}
            className="p-2 rounded-full text-gray-400 hover:text-amber-500 hover:bg-white/30 transition-all duration-250 ease-premium"
            title={darkMode ? '切换亮色模式' : '切换深色模式'}
          >
            {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>

          <div className="capsule-user flex items-center gap-2 pl-2 pr-2 py-1 rounded-full">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {user?.username?.charAt(0).toUpperCase() || 'U'}
              </div>
            )}
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

      {/* Mobile top bar + slide-in sidebar */}
      <div className="flex-1 flex flex-col min-w-0 md:ml-[220px]">
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
            {allAdminLinks.map(link => (
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
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {user?.username?.charAt(0).toUpperCase() || 'U'}
                </div>
              )}
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
          @2026刻忆间隔学习平台 by HZ-CZY &nbsp;|&nbsp; <a href="https://beian.miit.gov.cn" target="_blank" rel="noopener noreferrer" class="text-gray-400 hover:text-gray-600">粤ICP备2026085151号-1</a>
        </footer>
      </div>

      <AiChatWidget />
    </div>
  );
}

// ── Main Layout ──────────────────────────────────

export default function Layout() {
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = (user as any)?.role === 'admin';

  if (isAdmin) {
    return <><SidebarLayout menuOpen={menuOpen} setMenuOpen={setMenuOpen} /><LoginModal /><AnnouncementPopup /></>;
  }

  return <><TopHeaderLayout menuOpen={menuOpen} setMenuOpen={setMenuOpen} isAdmin={false} /><LoginModal /><AnnouncementPopup /></>;
}
