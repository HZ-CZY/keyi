import { NavLink } from 'react-router-dom';
import { Compass, Home, Swords, Tent, ShoppingBag } from 'lucide-react';
import { isFeatureEnabled, useFeatureFlags } from '../../../lib/featureFlags';

const ITEMS = [
  { to: '/', label: '首页', icon: Home, flag: null as string | null },
  /* 【2026-10-19】第二项从「每日一句」升级为「发现」（/discover）：
     页面里保留每日一句（朗读/打卡/往期回顾），并增加任务、查词、统计、词库
     四个探索入口。底部只有 5 格，第二格用来承载「学习主线之外的一切」。
     开关 key 沿用 daily（后台显示名已改为「发现」）。 */
  { to: '/discover', label: '发现', icon: Compass, flag: 'daily' },
  { to: '/arena', label: '竞技场', icon: Swords, flag: 'arena' },
  /* 部落（刻忆觉醒）—— 2026-09-30 起对全部用户开放，替换掉原来的「一起背」入口。
     一起背本身没删：/together 路由还在，只是不占底部导航位。 */
  { to: '/village', label: '部落', icon: Tent, flag: 'village' },
  { to: '/shop', label: '商城', icon: ShoppingBag, flag: 'shop' },
];

/**
 * Sticky bottom navigation — 百词斩 style, P1 合并为 5 项:
 *   首页 / 每日一句 / 竞技场 / 部落 / 商城
 *   - 全宽白底圆角玻璃态，触屏友好（iPad 场景图标放大至 24px）
 *   - 选中项：蓝色系 #3b82f6 实心图标 + 加粗标签
 *   - 被功能开关禁用的模块项自动隐藏，列表自适应
 *
 * 【2026-10-10】竞技场各页（决斗场大厅/练习/对战）背景是饱和度很高的紫色渐变，
 * 而这里原本用的是 bg-white/82 + backdrop-blur —— 82% 白叠在浓紫上会被染成
 * 一片淡紫，未选中项又是 text-slate-400，对比度极低，看起来「全紫看不清」。
 * 这里加一个 solid 变体：在紫色底页面上改为**不透明白底**，配色固定，不再透出背景。
 */
export default function BottomNav({ solid = false }: { solid?: boolean }) {
  // 订阅开关变化，禁用项隐藏后自动重渲染
  useFeatureFlags();
  const visible = ITEMS.filter((i) => !i.flag || isFeatureEnabled(i.flag));

  /* 【2026-10-21】非 solid 态用 Apple 风液态玻璃（样式见 index.css 的 .v2-bottom-nav--glass）：
     玻璃层只有 12% 白，通透感来自 blur(24px) + saturate(180%) + brightness(1.06)，
     配合顶部 1px 高光，不再是一条白带。solid 态（竞技场紫底页）保持纯白。 */
  const shellCls = solid
    ? 'bg-white border-t border-slate-200/90 shadow-[0_-12px_32px_rgba(38,67,108,0.16)]'
    : 'v2-bottom-nav--glass';

  return (
    <nav className={`v2-bottom-nav fixed bottom-0 inset-x-0 z-40 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 ${shellCls}${solid ? ' v2-bottom-nav--solid' : ''}`}>
      <ul className="flex max-w-3xl mx-auto px-2 md:px-4 gap-1">
        {visible.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 py-1.5 text-[11px] transition-colors ${
                  isActive
                    ? 'text-primary-600 font-semibold'
                    : 'text-slate-500 hover:text-slate-700'
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
