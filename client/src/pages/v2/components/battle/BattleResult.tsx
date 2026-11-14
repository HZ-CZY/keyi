import Avatar from './Avatar';
import type { BattleState } from './types';

/**
 * 结算（result）——紫色渐变顶部 + 白色玻璃比分对比卡。
 * 胜负判定与铜板文案沿用原有规则（分高者赢 / 平局退费 / 败者无奖励）。
 */
export default function BattleResult({
  battle,
  total,
  myName,
  avatarUrl,
  badgeLabel = '',
  onPlayAgain,
  onBack,
}: {
  battle: BattleState;
  total: number;
  myName: string;
  avatarUrl?: string | null;
  /** 账号金标文字（非空 → 金环 + 标签） */
  badgeLabel?: string;
  onPlayAgain: () => void;
  onBack: () => void;
}) {
  const my = battle.me.score;
  const op = battle.opponent.score;
  const win = my > op;
  const draw = my === op;
  const title = win ? '🎉 胜利' : draw ? '🤝 平局' : '💪 惜败';
  /* 好友房（私房）免费、无奖励、不计段位：胜平负都不提铜板，
     否则「胜者 +100」会把人骗去开房刷币（2026-11-12）。 */
  const coinText = battle.isPrivate
    ? '好友对战：不消耗铜板，也不发放铜板奖励 / 不计段位分'
    : win
    ? '胜者 +100 铜板'
    : draw
    ? '平局：退还双方 50 铜板入场费'
    : '败者无铜板奖励';

  return (
    <div className="pb-28">
      {/* 紫色渐变顶部 */}
      <div className="rounded-b-[32px] bg-gradient-to-b from-[#6a58f2] to-[#8f7cf8] px-5 pb-12 pt-9 text-center shadow-[0_10px_30px_rgba(90,60,200,0.35)]">
        <h2 className="text-[36px] font-black text-white drop-shadow-[0_3px_6px_rgba(60,30,140,0.35)]">
          {title}
        </h2>
        <p className="mt-1.5 text-[13px] font-semibold text-white/90">{coinText}</p>
      </div>

      {/* 白色玻璃比分对比卡 */}
      <div className="mx-auto -mt-7 max-w-2xl px-4">
        <div className="rounded-[26px] bg-white/85 p-5 shadow-[0_18px_44px_rgba(76,45,140,0.22)] ring-1 ring-white/60 backdrop-blur-xl">
          <div className="flex items-stretch gap-3">
            {/* 我 */}
            <div className="flex flex-1 flex-col items-center rounded-2xl bg-white/80 py-5 shadow-sm">
              <Avatar url={avatarUrl} name={myName} size={40} badgeLabel={badgeLabel} />
              <p className="mt-1.5 max-w-[92px] truncate text-[12px] text-slate-400">
                {myName}
              </p>
              <p className="mt-1 text-[38px] font-black leading-none text-slate-800">{my}</p>
              <p className="mt-1.5 text-[11.5px] text-slate-400">
                答对 {battle.me.correct} / {total}
              </p>
            </div>

            <div className="flex items-center px-1 text-[15px] font-black italic text-slate-300">
              VS
            </div>

            {/* 对手 */}
            <div className="flex flex-1 flex-col items-center rounded-2xl bg-white/80 py-5 shadow-sm">
              <Avatar url={null} name={battle.opponentName} size={40} />
              <p className="mt-1.5 max-w-[92px] truncate text-[12px] text-slate-400">
                {battle.opponentName}
              </p>
              <p className="mt-1 text-[38px] font-black leading-none text-slate-800">{op}</p>
              <p className="mt-1.5 text-[11.5px] text-slate-400">
                答对 {battle.opponent.correct} / {total}
              </p>
            </div>
          </div>

          {/* 逐题得分明细（新赛制：先对 +20 / 后对 +10 / 错 0） */}
          {battle.rounds && battle.rounds.length > 0 ? (
            <div className="mt-4 rounded-2xl bg-white/70 p-3 shadow-sm">
              <p className="mb-2 text-center text-[12px] font-bold text-slate-500">逐题得分（满分 100）</p>
              <div className="grid grid-cols-5 gap-1.5">
                {battle.rounds.map((r, i) => (
                  <div key={i} className="flex flex-col items-center rounded-lg bg-white/80 py-1.5 shadow-sm">
                    <span className="text-[10px] text-slate-400">第{i + 1}题</span>
                    <span
                      className={`text-[13px] font-black ${
                        r.myPoints > r.opPoints
                          ? 'text-emerald-600'
                          : r.myPoints < r.opPoints
                          ? 'text-rose-500'
                          : 'text-slate-700'
                      }`}
                    >
                      {r.myPoints}
                    </span>
                    <span className="text-[10px] text-slate-300">vs {r.opPoints}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={onPlayAgain}
            className="mt-5 w-full rounded-full bg-gradient-to-b from-[#FFD24D] to-[#FFB800] py-3.5 text-[17px] font-extrabold text-[#5B3A00] shadow-[0_10px_22px_rgba(255,168,0,0.45)] ring-2 ring-white/70 transition-transform active:scale-95"
          >
            再来一局
          </button>
          <button
            type="button"
            onClick={onBack}
            className="mt-2.5 w-full rounded-full bg-white/90 py-3 text-[14px] font-bold text-slate-600 shadow-sm ring-1 ring-slate-100 transition-transform active:scale-95"
          >
            返回大厅
          </button>
        </div>
      </div>
    </div>
  );
}
