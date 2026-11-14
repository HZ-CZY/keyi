import { NavLink } from 'react-router-dom';
import { Home, BookOpen, Swords, Tent, ShoppingBag } from 'lucide-react';
import { isFeatureEnabled, useFeatureFlags } from '../../../lib/featureFlags';

const ITEMS = [
  { to: '/', label: '首页', icon: Home, flag: null as string | null },
  { to: '/learning', label: '学习', icon: BookOpen, flag: 'learning' },
  { to: '/arena', label: '竞技场', icon: Swords, flag: 'arena' },
  /* 部落（刻忆觉醒）—— 2026-09-30 起对全部用户开放，替换掉原来的「一起背」入口。
     一起背本身没删：/together 路由还在，只是不占底部导航位。 */
  { to: '/village', label: '部落', icon: Tent, flag: 'village' },
  { to: '/shop', label: '商城', icon: ShoppingBag, flag: 'shop' },
];

/**
 * Sticky bottom navigation — 百词斩 style, P1 合并为 5 项:
 *   首页 / 学习 / 竞技场 / 部落 / 商城
 *   - 全宽白底圆角玻璃态，触屏友好（iPad 场景图标放大至 24px）
 *   - 选中项：蓝色系 #3b82f6 实心图标 + 加粗标签
 *   - 被功能开关禁用的模块项自动隐藏，列表自适应
 */
export default function BottomNav() {
  // 订阅开关变化，禁用项隐藏后自动重渲染
  useFeatureFlags();
  const visible = ITEMS.filter((i) => !i.flag || isFeatureEnabled(i.flag));

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-black/5 pb-[max(env(safe-area-inset-bottom),8px)] pt-2">
      <ul className="flex max-w-2xl mx-auto">
        {visible.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 py-1.5 text-[11px] transition-colors ${
                  isActive
                    ? 'text-primary-600 font-semibold'
                    : 'text-slate-400  hover:text-slate-600 '
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className="w-6 h-6"
                    strokeWidth={isActive ? 2.5 : 2}
                    fill={isActive ? 'currentColor' : 'none'}
                  />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
