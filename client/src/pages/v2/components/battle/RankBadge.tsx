import { useId } from 'react';

/**
 * 决斗场段位徽章（纯前端展示，不影响任何计分逻辑）。
 *
 * 段位只由「胜场数」映射，铜板 / 得分 / 后端数据一概不参与：
 *   0-2 青铜、3-5 白银、6-9 黄金、10+ 钻石
 */

export type RankTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'star' | 'king';

/** 段位元数据：名称 + 奖牌配色 */
export interface RankMeta {
  tier: RankTier;
  /** 段位名，如「黄金」 */
  name: string;
  /** 奖牌渐变起点 */
  from: string;
  /** 奖牌渐变终点 */
  to: string;
  /** 描边 / 文字深色 */
  edge: string;
  /** 中央星星填充色 */
  star: string;
  /** 段位下方的描述小字 */
  label: string;
}

const BRONZE: RankMeta = {
  tier: 'bronze',
  name: '青铜',
  from: '#F3BE86',
  to: '#B06A33',
  edge: '#8A4E21',
  star: '#FFF6E2',
  label: '初入决斗场',
};

const SILVER: RankMeta = {
  tier: 'silver',
  name: '白银',
  from: '#EEF3F9',
  to: '#94A4B9',
  edge: '#64748B',
  star: '#FFFFFF',
  label: '渐入佳境',
};

const GOLD: RankMeta = {
  tier: 'gold',
  name: '黄金',
  from: '#FFE485',
  to: '#E39A12',
  edge: '#A96C05',
  star: '#FFF8DC',
  label: '实力不俗',
};

const DIAMOND: RankMeta = {
  tier: 'diamond',
  name: '钻石',
  from: '#A5F3FC',
  to: '#3B82F6',
  edge: '#1D4ED8',
  star: '#FFFFFF',
  label: '决斗场之巅',
};

/* 【2026-11-06 段位系统】后端改成 ELO 积分制后，段位多了三档。
   配色沿用各自段位在服务端 duel-rating.ts 里的 color，前后端看起来是同一个东西。 */
const PLATINUM: RankMeta = {
  tier: 'platinum',
  name: '铂金',
  from: '#B8F2E4',
  to: '#2FBFA0',
  edge: '#157A65',
  star: '#F2FFFB',
  label: '稳扎稳打',
};

const STAR: RankMeta = {
  tier: 'star',
  name: '星耀',
  from: '#E9D5FF',
  to: '#A855F7',
  edge: '#6D28D9',
  star: '#FBF5FF',
  label: '锋芒毕露',
};

const KING: RankMeta = {
  tier: 'king',
  name: '王者',
  from: '#FFD1DC',
  to: '#F04E6B',
  edge: '#9F1239',
  star: '#FFF5F7',
  label: '无人能挡',
};

/**
 * 按胜场数换算段位（纯前端映射，不写库、不调接口）。
 * @param wins 战绩里的胜场数
 */
export function rankOf(wins: number): RankMeta {
  const w = Number.isFinite(wins) ? Math.max(0, Math.floor(wins)) : 0;
  if (w >= 10) return DIAMOND;
  if (w >= 6) return GOLD;
  if (w >= 3) return SILVER;
  return BRONZE;
}

/** 按后端下发的 tier.key 取元数据（新段位系统的主路径） */
export function rankByKey(key?: string | null): RankMeta | null {
  switch (String(key || '')) {
    case 'bronze': return BRONZE;
    case 'silver': return SILVER;
    case 'gold': return GOLD;
    case 'platinum': return PLATINUM;
    case 'diamond': return DIAMOND;
    case 'star': return STAR;
    case 'king': return KING;
    default: return null;
  }
}

/** 段位档位表（与服务端 duel-rating.ts 对齐），仅用于旧接口兜底 */
const RATING_BANDS: { key: RankTier; min: number; max: number }[] = [
  { key: 'bronze', min: 0, max: 899 },
  { key: 'silver', min: 900, max: 1049 },
  { key: 'gold', min: 1050, max: 1199 },
  { key: 'platinum', min: 1200, max: 1349 },
  { key: 'diamond', min: 1350, max: 1499 },
  { key: 'star', min: 1500, max: 1649 },
  { key: 'king', min: 1650, max: 9999 },
];

/** 按积分换算段位（客户端兜底，正常以服务端为准） */
export function rankOfRating(rating: number): RankMeta {
  const r = Number.isFinite(rating) ? Math.max(0, Math.round(rating)) : 1000;
  for (const b of RATING_BANDS) {
    if (r <= b.max) return rankByKey(b.key) || BRONZE;
  }
  return KING;
}

/** 左侧翅膀轮廓（以奖牌圆心为原点绘制，右侧镜像复用） */
const WING_PATH =
  'M-30 -6 C-44 -18 -56 -26 -70 -26 C-62 -18 -56 -14 -50 -10 C-60 -10 -66 -6 -70 -2 ' +
  'C-60 -3 -52 -2 -46 2 C-54 8 -58 14 -60 22 C-48 16 -38 12 -30 10 Z';

/** 中央五角星（以奖牌圆心为原点绘制） */
const STAR_PATH =
  'M0 -15 L4.4 -5 L15 -4.4 L6.6 2.4 L9.6 12.6 L0 6.8 L-9.6 12.6 L-6.6 2.4 ' +
  'L-15 -4.4 L-4.4 -5 Z';

/** 右上角装饰小星 */
const SPARK_A = 'M104 22 l2.3 5.6 6 .5 -4.6 3.9 1.4 5.9 -5.1-3.1 -5.1 3.1 1.4-5.9 -4.6-3.9 6-.5 Z';
/** 左上角装饰小星 */
const SPARK_B = 'M22 28 l1.7 4.1 4.4.4 -3.3 2.8 1 4.3 -3.8-2.3 -3.8 2.3 1-4.3 -3.3-2.8 4.4-.4 Z';

/**
 * 段位徽章：金色圆形奖牌 + 翅膀 + 星星（自绘 SVG，不依赖图片资源）。
 * @param wins  胜场数（决定段位）
 * @param size  徽章宽度 px（高度按比例 0.82 计算）
 * @param showName 是否在徽章下方渲染段位名
 */
export default function RankBadge({
  wins,
  tierKey,
  size = 104,
  showName = false,
  className = '',
}: {
  wins: number;
  /** 指定段位 key 时优先（新段位系统），不再按胜场推算 */
  tierKey?: string | null;
  size?: number;
  showName?: boolean;
  className?: string;
}) {
  const meta = rankByKey(tierKey) || rankOf(wins);
  // useId 生成的 id 含冒号，不能用于 url(#...)，去掉非字母数字字符
  const uid = `rk${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const height = Math.round(size * 0.82);

  return (
    <span className={`inline-flex flex-col items-center leading-none ${className}`}>
      <svg
        width={size}
        height={height}
        viewBox="0 0 132 108"
        aria-label={`段位 ${meta.name}`}
        style={{ filter: 'drop-shadow(0 6px 10px rgba(76,45,140,0.22))' }}
      >
        <defs>
          <linearGradient id={`${uid}-medal`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={meta.from} />
            <stop offset="100%" stopColor={meta.to} />
          </linearGradient>
          <linearGradient id={`${uid}-wing`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
            <stop offset="100%" stopColor={meta.from} stopOpacity="0.9" />
          </linearGradient>
        </defs>

        {/* 翅膀（左右各一片） */}
        <g transform="translate(66 52)">
          <path
            d={WING_PATH}
            fill={`url(#${uid}-wing)`}
            stroke="#ffffff"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path
            d={WING_PATH}
            fill={`url(#${uid}-wing)`}
            stroke="#ffffff"
            strokeWidth="2.5"
            strokeLinejoin="round"
            transform="scale(-1 1)"
          />
        </g>

        {/* 奖牌主体 */}
        <circle cx="66" cy="52" r="33" fill={`url(#${uid}-medal)`} stroke="#ffffff" strokeWidth="5" />
        <circle
          cx="66"
          cy="52"
          r="33"
          fill="none"
          stroke={meta.edge}
          strokeOpacity="0.35"
          strokeWidth="1.5"
        />
        <circle cx="66" cy="52" r="25" fill="#ffffff" fillOpacity="0.22" />
        <path
          d="M46 32 A25 25 0 0 1 84 28"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.6"
          strokeWidth="4"
          strokeLinecap="round"
        />

        {/* 中央星星 */}
        <g transform="translate(66 52)">
          <path
            d={STAR_PATH}
            fill={meta.star}
            stroke={meta.edge}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </g>

        {/* 装饰小星 */}
        <path d={SPARK_A} fill="#FFE066" opacity="0.9" />
        <path d={SPARK_B} fill="#FFE066" opacity="0.75" />
      </svg>
      {showName ? (
        <span
          className="mt-1 text-[13px] font-extrabold tracking-wide"
          style={{ color: meta.edge }}
        >
          {meta.name}
        </span>
      ) : null}
    </span>
  );
}
