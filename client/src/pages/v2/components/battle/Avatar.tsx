/**
 * 决斗场头像：优先用户真实头像，取不到时显示默认人像占位（不造假数据）。
 *
 * badgeLabel 非空（users.badge_label，如「老师」「管理员」）时换成金色头像框 + 右下角该文字标签
 * （2026-09-22），所有用到本组件的地方（匹配页 / 对战顶栏 / 结算页 / 排行榜）自动生效。
 */
import type { CSSProperties } from 'react';
import { UserBadge, BADGE_RING_CLS, BADGE_GLOW_STYLE } from '../../../../components/UserBadge';

export default function Avatar({
  url,
  name,
  size = 40,
  ring = true,
  badgeLabel = '',
  className = '',
}: {
  /** 头像地址（AuthContext 的 user.avatar_url） */
  url?: string | null;
  /** 用户名，用于占位图的首字母 / alt */
  name?: string;
  /** 边长 px */
  size?: number;
  /** 是否显示白色描边（历史调用里有传颜色字符串的，一律按「要描边」处理） */
  ring?: boolean | string;
  /** 头像金标文字（非空 → 金环 + 标签） */
  badgeLabel?: string;
  className?: string;
}) {
  const box = { width: size, height: size } as const;
  const hasBadge = !!badgeLabel;
  const ringCls = hasBadge ? BADGE_RING_CLS : ring ? 'ring-[3px] ring-white/90' : '';
  const glow: CSSProperties | undefined = hasBadge ? BADGE_GLOW_STYLE : undefined;

  const inner = url ? (
    <img
      src={url}
      alt={name || '头像'}
      style={{ ...box, ...glow }}
      className={`shrink-0 rounded-full object-cover bg-slate-200 ${ringCls} ${className}`}
    />
  ) : (
    <span
      style={{ ...box, ...glow, fontSize: Math.max(10, Math.round(size * 0.42)) }}
      className={`shrink-0 inline-flex items-center justify-center rounded-full bg-gradient-to-b from-slate-200 to-slate-300 font-bold text-slate-500 ${ringCls} ${className}`}
    >
      {(name || '?').trim().slice(0, 1).toUpperCase()}
    </span>
  );

  if (!hasBadge) return inner;

  return (
    <span className="relative inline-flex shrink-0" style={box}>
      {inner}
      <UserBadge size={size} label={badgeLabel} />
    </span>
  );
}
