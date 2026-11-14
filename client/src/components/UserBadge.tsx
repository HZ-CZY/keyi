import type { CSSProperties } from 'react';

/**
 * 账号头像金标 (2026-09-22)
 *
 * 需求：某些账号（users.badge_label 非空）的头像在所有出现头像的地方
 *       —— 首页顶栏 / 个人中心 / 排行榜 / 对战与匹配 / 一起背 / 后台侧边栏 ——
 *       都显示一圈金色头像框 + 一枚文字标签（「老师」「管理员」…可自由设置）。
 *
 * 用法：
 *   <Avatar ... badgeLabel={item.badge_label} />                    // 头像组件（battle/Avatar.tsx）内置支持
 *   <span className={badgeRingCls(!!u.badge_label, 'ring-2 ring-white/60')} style={badgeGlow(!!u.badge_label)}>…</span>
 *   <UserBadge size={44} label={u.badge_label} />                   // 贴在有 relative 的容器里（右下角）
 *   <UserTag label={u.badge_label} />                               // 名字旁边的金标小药丸
 *
 * 只影响展示：不授予任何后台权限（后台权限看 users.role = 'admin'）。
 */

/** 金环：Tailwind class（配合圆形容器使用） */
export const BADGE_RING_CLS = 'ring-2 ring-amber-400';

/** 金环的暖光（内联 style，和 ring 叠加） */
export const BADGE_GLOW_STYLE: CSSProperties = {
  boxShadow: '0 0 12px rgba(251,191,36,0.65)',
};

/** 金色渐变（标签底色） */
export const BADGE_GRADIENT = 'linear-gradient(135deg,#FFD75E,#E8A02A)';

/** 有金标时用金环，否则用传入的原样式 */
export function badgeRingCls(hasBadge?: boolean | number | string, fallback = ''): string {
  return hasBadge ? BADGE_RING_CLS : fallback;
}

/** 有金标时的暖光 style（没有则返回 undefined，不污染样式） */
export function badgeGlow(hasBadge?: boolean | number | string): CSSProperties | undefined {
  return hasBadge ? BADGE_GLOW_STYLE : undefined;
}

/** 贴在头像右下角的金标小标签（父容器需要 position: relative） */
export function UserBadge({ size = 44, label = '老师', className = '' }: { size?: number; label?: string; className?: string }) {
  const fontSize = size >= 60 ? 12 : size >= 40 ? 10 : 9;
  return (
    <span
      className={`absolute z-20 select-none whitespace-nowrap rounded-full font-bold text-white ${className}`}
      style={{
        right: -2,
        bottom: -2,
        padding: `${fontSize <= 9 ? 1 : 1.5}px ${fontSize <= 9 ? 4 : 6}px`,
        fontSize,
        lineHeight: `${fontSize + 3}px`,
        background: BADGE_GRADIENT,
        border: '1.5px solid rgba(255,255,255,0.95)',
        boxShadow: '0 2px 6px rgba(0,0,0,0.22)',
      }}
    >
      {label}
    </span>
  );
}

/** 名字旁边的金标小药丸 */
export function UserTag({ label = '老师', className = '' }: { label?: string; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full font-bold text-white ${className}`}
      style={{
        padding: '1px 7px',
        fontSize: 11,
        lineHeight: '15px',
        background: BADGE_GRADIENT,
        boxShadow: '0 1px 4px rgba(232,160,42,0.45)',
      }}
    >
      {label}
    </span>
  );
}
