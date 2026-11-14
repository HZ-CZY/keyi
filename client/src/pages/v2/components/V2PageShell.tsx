import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import BottomNav from './BottomNav';

/**
 * V2 page shell — shared chrome for every v2 sub-page:
 *   - Same light blue-white gradient backdrop as the v2 dashboard
 *   - Top bar: back arrow + title + dark-mode toggle
 *   - Optional sticky bottom nav (App-style)
 */
export default function V2PageShell({
  title,
  children,
  backTo = '/',
  showBottomNav = true,
}: {
  title: string;
  children: React.ReactNode;
  backTo?: string;
  showBottomNav?: boolean;
}) {


  // Heartbeat — keep logged-in users marked as online (was in legacy TopHeaderLayout)
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    const beat = () => api.auth.heartbeat().catch(() => {});
    beat();
    const interval = setInterval(beat, 60 * 1000);
    return () => clearInterval(interval);
  }, [user]);

  return (
    <div className="v2-page-shell min-h-screen relative overflow-hidden">
      {/* Extremely subtle light blue-white gradient backdrop — matches v2 dashboard */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#edf4ff_0%,#f8fbff_45%,#eef3fb_100%)]" />
      </div>

      {/* Top bar */}
      <header className="v2-topbar px-4 md:px-8 pt-4 pb-3 flex items-center gap-3 sticky top-0 z-30">
        <Link
          to={backTo}
          className="shrink-0 w-10 h-10 rounded-2xl bg-white/80 border border-white/80 backdrop-blur-xl flex items-center justify-center hover:-translate-x-0.5 transition-all shadow-[0_8px_24px_rgba(51,84,132,0.10)]"
          aria-label="返回"
        >
          <ArrowLeft className="w-4 h-4 text-slate-600" />
        </Link>
        <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">KEYI SPACE</p><h1 className="text-xl font-black tracking-tight text-slate-900 truncate">{title}</h1></div>
              </header>

      {/* Content */}
      <main className="v2-page-content w-full max-w-6xl mx-auto px-4 md:px-8 pb-6">{children}</main>

      {/* Footer — copyright + ICP */}
      <footer className="text-center px-4 pb-28 pt-4 text-[11px] text-slate-400">
        @2026刻忆间隔学习平台 by HZ-CZY&nbsp;&nbsp;|&nbsp;&nbsp;
        <a href="https://beian.miit.gov.cn" target="_blank" rel="noopener noreferrer" className="hover:text-slate-600 transition-colors">
          粤ICP备2026085151号-1
        </a>
      </footer>

      {/* Bottom nav */}
      {showBottomNav && <BottomNav />}
    </div>
  );
}
