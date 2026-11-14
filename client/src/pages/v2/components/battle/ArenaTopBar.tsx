import Avatar from './Avatar';
import { formatClock, useCountdown } from './useCountdown';

/**
 * 对局顶部紫色横幅：题号 / 我方头像 + 状态 + 得分 / 倒计时 / 对手 + 得分 / 比分对比条。
 *
 * 只做展示：不提供退出对局入口（原逻辑没有此能力，不放假按钮）。
 */

/** 双方得分对比条：我方蓝从左、对手红从右，中间 ⚡ 分隔；双方 0 分各占一半 */
function ScoreBar({ me, op }: { me: number; op: number }) {
  const sum = me + op;
  const raw = sum === 0 ? 50 : (me / sum) * 100;
  const pct = Math.min(94, Math.max(6, raw));

  return (
    <div className="relative mt-2.5 h-3.5 w-full overflow-hidden rounded-full bg-white/25">
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-[#3D7BFF] transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
      <div
        className="absolute inset-y-0 right-0 rounded-full bg-[#FA5252] transition-all duration-500"
        style={{ width: `${100 - pct}%` }}
      />
      <span className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-[13px] leading-none">
        ⚡
      </span>
    </div>
  );
}

export default function ArenaTopBar({
  qIndex,
  total,
  deadline,
  meScore,
  meFinished,
  myName,
  avatarUrl,
  badgeLabel = '',
  opponentName,
  opponentScore,
}: {
  qIndex: number;
  total: number;
  /** 绝对截止时间戳（ms）；null 时不显示倒计时 */
  deadline: number | null;
  meScore: number;
  meFinished: boolean;
  myName: string;
  avatarUrl?: string | null;
  /** 账号金标文字（非空 → 金环 + 标签） */
  badgeLabel?: string;
  opponentName: string;
  opponentScore: number;
}) {
  const remain = useCountdown(deadline);
  const urgent = remain <= 30_000;

  return (
    <div className="rounded-b-[28px] bg-gradient-to-b from-[#6a58f2] to-[#8f7cf8] px-4 pb-4 pt-4 shadow-[0_10px_30px_rgba(90,60,200,0.35)]">
      <div className="mx-auto max-w-3xl">
        {/* 题号 */}
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-extrabold text-white">
            第 {qIndex + 1}/{total} 题
          </p>
          <p className="text-[11px] text-white/70">先答对 +20 · 后答对 +10 · 总分 100</p>
        </div>

        {/* 深紫胶囊：我 / 倒计时 / 对手 */}
        <div className="mt-2 rounded-2xl bg-[#5b45e0]/65 px-3 py-2.5 ring-1 ring-white/15">
          <div className="flex items-center gap-2">
            {/* 我 */}
            <Avatar url={avatarUrl} name={myName} size={34} badgeLabel={badgeLabel} />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-white/85">
                {meFinished ? '已答完' : '答题中…'}
              </p>
              <span className="mt-0.5 inline-block rounded-md bg-white px-1.5 py-[1px] text-[11px] font-extrabold text-[#5b45e0]">
                总得分 {meScore}
              </span>
            </div>

            {/* 倒计时 */}
            <div className="mx-auto flex flex-col items-center">
              <div
                className={`rounded-xl px-3 py-1 text-[18px] font-extrabold tabular-nums leading-tight ${
                  urgent
                    ? 'animate-pulse bg-rose-50 text-rose-600'
                    : 'bg-white text-[#5b45e0]'
                }`}
              >
                {formatClock(remain)}
              </div>
              <span className="mt-0.5 text-[10px] text-white/70">剩余时间</span>
            </div>

            {/* 对手 */}
            <div className="min-w-0 text-right">
              <p className="hidden max-w-[92px] truncate text-[11px] font-semibold text-white/85 sm:block">
                {opponentName}
              </p>
              <span className="mt-0.5 inline-block rounded-md bg-white px-1.5 py-[1px] text-[11px] font-extrabold text-[#e11d48]">
                总得分 {opponentScore}
              </span>
            </div>
            <Avatar url={null} name={opponentName} size={34} />
          </div>

          <ScoreBar me={meScore} op={opponentScore} />
        </div>
      </div>
    </div>
  );
}
