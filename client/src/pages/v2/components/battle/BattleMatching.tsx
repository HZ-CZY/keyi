import { useId } from 'react';
import { motion } from 'framer-motion';
import { Star } from 'lucide-react';
import Avatar from './Avatar';
import RankBadge, { rankOf } from './RankBadge';

/**
 * 匹配中（matching）——参考图：蓝红斜切对峙 + 中央黄色 VS 徽章。
 *
 * 纯展示层：取消按钮直接复用页面的 backToLobby（逻辑未改动）。
 */

/** 中央黄色 VS 徽章（自绘 SVG，V 与 S 上下错位 + 白描边） */
function VsBadge({ className = '' }: { className?: string }) {
  const uid = `vs${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const common = {
    fontFamily: 'Impact, "Arial Black", "PingFang SC", sans-serif',
    fontSize: 58,
    fontStyle: 'italic' as const,
    fontWeight: 900,
    textAnchor: 'middle' as const,
  };

  return (
    <motion.div
      animate={{ y: [0, -6, 0], scale: [1, 1.05, 1] }}
      transition={{ repeat: Infinity, duration: 1.9, ease: 'easeInOut' }}
      style={{ filter: 'drop-shadow(0 8px 14px rgba(0,0,0,0.35))' }}
    >
      <svg
        width={116}
        height={116}
        viewBox="0 0 120 120"
        aria-label="VS"
        className={className}
      >
        <defs>
          <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFE066" />
            <stop offset="100%" stopColor="#FF8A00" />
          </linearGradient>
        </defs>
        {/* 白描边层 */}
        <text {...common} x="42" y="58" fill="#ffffff" stroke="#ffffff" strokeWidth="9">
          V
        </text>
        <text {...common} x="80" y="96" fill="#ffffff" stroke="#ffffff" strokeWidth="9">
          S
        </text>
        {/* 渐变填充层 */}
        <text {...common} x="42" y="58" fill={`url(#${uid})`}>
          V
        </text>
        <text {...common} x="80" y="96" fill={`url(#${uid})`}>
          S
        </text>
      </svg>
    </motion.div>
  );
}

export default function BattleMatching({
  username,
  avatarUrl,
  badgeLabel = '',
  wins,
  tierLabel = '',
  onCancel,
}: {
  username: string;
  avatarUrl?: string | null;
  /** 账号金标文字（非空 → 金环 + 标签） */
  badgeLabel?: string;
  wins: number;
  /** 我的段位名（如「黄金 II」）：用来说明匹配范围，2026-11-06 段位系统上线后加的 */
  tierLabel?: string;
  onCancel: () => void;
}) {
  const meta = rankOf(wins);

  return (
    <>
      {/* 背景：左蓝右红，中间约 8° 斜切 */}
      <div className="fixed inset-0 z-0 overflow-hidden">
        <div className="absolute inset-0 bg-[#3D7BFF]" />
        <div
          className="absolute inset-0 bg-[#FA5252]"
          style={{
            clipPath: 'polygon(calc(50% + 7vh) 0%, 100% 0%, 100% 100%, calc(50% - 7vh) 100%)',
          }}
        />
        <span className="pointer-events-none absolute left-[-3%] top-[7%] -rotate-6 select-none whitespace-nowrap text-[16vw] font-black italic leading-none text-white/15">
          FIGHTING
        </span>
      </div>

      <div className="relative z-10 flex min-h-screen w-full flex-col">
        {/* 顶部白色描边标题 */}
        <div className="pt-5 text-center">
          <h1
            className="inline-block text-[26px] font-black italic tracking-wide sm:text-[30px]"
            style={{
              color: '#ffffff',
              WebkitTextStroke: '2px #23307a',
              textShadow: '0 4px 0 rgba(0,0,0,0.18)',
            }}
          >
            习题大乱斗
          </h1>
        </div>

        {/* 对峙区 */}
        <div className="relative min-h-[54vh] w-full flex-1">
          {/* 左半：我方大头像（手机端上移，给中央 VS 让位） */}
          <div className="absolute left-0 top-0 flex h-full w-1/2 items-center justify-start pb-16 pt-4 sm:justify-center sm:pt-0">
            <div className="rounded-full bg-white/25 p-1.5 ring-[6px] ring-white/70">
              <Avatar url={avatarUrl} name={username} size={104} ring={false} badgeLabel={badgeLabel} />
            </div>
          </div>

          {/* 右半：旋转虚线圆环 + 问号（手机端整体下移，文案不再被 VS 压住） */}
          <div className="absolute right-0 top-0 flex h-full w-1/2 flex-col items-center justify-end gap-4 pb-16 sm:justify-center">
            <div className="relative h-28 w-28 sm:h-36 sm:w-36">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 9, ease: 'linear' }}
                className="absolute inset-0 rounded-full border-[6px] border-dashed border-white/80"
              />
              <div className="absolute inset-3 rounded-full bg-white/15" />
              <span className="absolute inset-0 flex items-center justify-center text-[54px] font-black text-white sm:text-[64px]">
                ?
              </span>
            </div>
            <div className="px-3 text-center">
              <p className="text-[15px] font-extrabold text-white">正在匹配对手…</p>
              <p className="mt-1 text-[11.5px] text-white/80">
                {tierLabel ? `优先匹配 ${tierLabel} 附近的对手` : '正在全服寻找对手'}
              </p>
              <p className="mt-0.5 text-[10.5px] text-white/60">
                取消匹配立即退款 · 60 秒无对手自动退还
              </p>
            </div>
          </div>

          {/* 中央 VS 徽章：手机端缩小，避免压住头像 / 文案 */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2">
            <VsBadge className="h-[76px] w-[76px] sm:h-[104px] sm:w-[104px]" />
          </div>

          {/* 左下角斜切信息卡 */}
          <div className="absolute bottom-3 left-3 z-20 sm:bottom-5 sm:left-6">
            <div
              className="flex items-center gap-2 bg-white py-1.5 pl-2 pr-8 shadow-[0_10px_24px_rgba(0,0,0,0.25)]"
              style={{ clipPath: 'polygon(0 0, 100% 0, calc(100% - 20px) 100%, 0 100%)' }}
            >
              <Avatar url={avatarUrl} name={username} size={32} ring={false} badgeLabel={badgeLabel} />
              <div className="min-w-0">
                <p className="max-w-[110px] truncate text-[13px] font-extrabold text-slate-800">
                  {username}
                </p>
                <div className="mt-0.5 flex items-center gap-1">
                  <RankBadge wins={wins} size={22} />
                  <span
                    className="text-[11px] font-extrabold"
                    style={{ color: meta.edge }}
                  >
                    {meta.name}
                  </span>
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 取消匹配 */}
        <div className="pb-24 text-center">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full bg-white/25 px-9 py-2.5 text-[15px] font-extrabold text-white ring-1 ring-white/60 backdrop-blur transition-transform active:scale-95"
          >
            取消匹配
          </button>
        </div>
      </div>
    </>
  );
}
