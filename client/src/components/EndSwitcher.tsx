import { useNavigate, useLocation } from 'react-router-dom';
import { Shield, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/**
 * 管理端 ⇄ 用户端 分段切换器。
 *
 * - 仅管理员可见（普通用户看不到，避免误入 /admin 守卫页）。
 * - 在「管理后台（/admin/*）」与「用户端（V2 全屏路由）」都常驻右下角，
 *   所以管理员能在两端之间快速来回，不会跳走后回不来。
 * - 用户端有 BottomNav 全宽底栏，故抬高到 bottom-20 避免遮挡。
 */
export default function EndSwitcher() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // [2026-10-26] 仅陈子洋、陈浩铎可使用「用户端 ⇄ 管理端」切换
  if (!user || !['陈子洋', '陈浩铎'].includes(user.username)) return null;

  const isAdmin = location.pathname.startsWith('/admin');
  const posCls = isAdmin ? 'bottom-6 right-6' : 'bottom-20 right-6';

  const goAdmin = () => navigate('/admin');
  const goUser = () => navigate('/');

  const segBase =
    'flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors';
  const active = 'bg-primary-600 text-white shadow-sm';
  const inactive = 'text-gray-500 hover:text-gray-800';

  return (
    <div
      className={`fixed ${posCls} z-50 flex items-center gap-0.5 p-1 rounded-full bg-white/90 backdrop-blur border border-gray-200 shadow-lg`}
    >
      <button
        type="button"
        onClick={goAdmin}
        className={`${segBase} ${isAdmin ? active : inactive}`}
        title="切换到管理后台"
      >
        <Shield className="w-3.5 h-3.5" />
        管理端
      </button>
      <button
        type="button"
        onClick={goUser}
        className={`${segBase} ${!isAdmin ? active : inactive}`}
        title="切换到用户端"
      >
        <User className="w-3.5 h-3.5" />
        用户端
      </button>
    </div>
  );
}
