import { ShieldAlert } from 'lucide-react';

/**
 * 匹配失败（failed）——延续大厅紫色玻璃风格：60 秒无人加入，入场费已由后端退还。
 */
export default function BattleFailed({
  error,
  onBack,
}: {
  error: string;
  onBack: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-5 pt-16 pb-28">
      <div className="rounded-[28px] bg-white/85 p-7 text-center shadow-[0_18px_44px_rgba(76,45,140,0.22)] ring-1 ring-white/60 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-rose-50">
          <ShieldAlert className="h-8 w-8 text-rose-400" strokeWidth={1.9} />
        </div>
        <h2 className="mt-4 text-[26px] font-extrabold text-slate-800">匹配失败</h2>
        <p className="mt-1.5 text-[13px] text-slate-500">60 秒内没有找到对手</p>
        <p className="mt-1 text-[13px] font-bold text-emerald-600">已退还 50 铜板入场费</p>

        {error ? <p className="mt-3 text-[12px] text-rose-500">{error}</p> : null}

        <button
          type="button"
          onClick={onBack}
          className="mt-6 w-full rounded-full bg-gradient-to-b from-[#8b7cf8] to-[#6a58f2] py-3 text-[15px] font-extrabold text-white shadow-[0_10px_24px_rgba(106,88,242,0.4)] transition-transform active:scale-95"
        >
          返回大厅
        </button>
      </div>
    </div>
  );
}
