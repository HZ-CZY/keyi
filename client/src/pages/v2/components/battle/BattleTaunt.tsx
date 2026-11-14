import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Megaphone, X } from 'lucide-react';

/**
 * 决斗场「嘲讽」（2026-10-19，商城商品 battle_taunt 解锁）
 * ────────────────────────────────────────────────────────────
 *  · 右下角悬浮按钮 → 弹出 6 条预设语录（文案由服务端下发，不硬编码）
 *  · 对方发的嘲讽以气泡形式在屏幕上方浮出 3.5 秒
 *  · 每局 3 次、间隔 8 秒；前端只做展示与倒计时，次数与频率一律以服务端为准
 *
 * 为什么不自定义输入：自由文本必然出现辱骂，且要额外做审核。
 * 预设文案既好维护，也符合「竞技调侃、不伤人」的定位。
 */

export type TauntItem = { idx: number; text: string };

/** 对方嘲讽气泡（受控） */
export function TauntBubble({
  show,
  name,
  text,
}: {
  show: boolean;
  name: string;
  text: string;
}) {
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key={`${name}-${text}`}
          initial={{ opacity: 0, y: -14, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.96 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="pointer-events-none fixed left-1/2 top-[18%] z-[70] w-[min(88vw,340px)] -translate-x-1/2"
        >
          <div className="rounded-2xl bg-white/95 px-4 py-3 shadow-[0_16px_40px_rgba(76,45,140,0.28)] ring-1 ring-white/70 backdrop-blur">
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-rose-500">
              <Megaphone className="h-3.5 w-3.5" />
              {name} 嘲讽了你
            </p>
            <p className="mt-1 text-[15px] font-extrabold leading-snug text-slate-800">{text}</p>
          </div>
          {/* 小尾巴 */}
          <div className="mx-auto -mt-[1px] h-2 w-2 rotate-45 bg-white/95 ring-1 ring-white/70" />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default function BattleTaunt({
  owned,
  items,
  remaining,
  cooldownUntil,
  sending,
  error,
  onSend,
}: {
  owned: boolean;
  items: TauntItem[];
  /** 本局剩余次数（服务端 state.tauntUsed 推算） */
  remaining: number;
  /** 冷却结束时刻（ms），0 = 可发 */
  cooldownUntil: number;
  sending: boolean;
  error: string;
  /** 返回 true 表示发送成功（面板自动收起） */
  onSend: (idx: number) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!cooldownUntil || cooldownUntil <= Date.now()) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  const cdLeft = cooldownUntil ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000)) : 0;
  const disabled = sending || cdLeft > 0 || remaining <= 0;

  if (!owned) return null;

  return (
    <>
      {/* 悬浮按钮：对局页没有底部导航，右下角不会和别的东西打架 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="嘲讽"
        className={`fixed bottom-24 right-4 z-[65] flex h-[52px] w-[52px] items-center justify-center rounded-full text-white shadow-[0_10px_24px_rgba(168,60,140,0.38)] ring-2 ring-white/60 transition-transform active:scale-90 ${
          disabled ? 'bg-slate-400/85' : 'bg-gradient-to-br from-fuchsia-500 to-rose-500'
        }`}
      >
        {sending ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : cdLeft > 0 ? (
          <span className="text-[15px] font-extrabold tabular-nums">{cdLeft}</span>
        ) : (
          <Megaphone className="h-5 w-5" />
        )}
        {remaining > 0 && cdLeft === 0 && !sending ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-extrabold text-rose-500 shadow">
            {remaining}
          </span>
        ) : null}
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-[66] bg-black/35"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="fixed bottom-[92px] right-3 z-[67] w-[min(88vw,320px)] rounded-3xl bg-white p-3 shadow-[0_20px_50px_rgba(24,20,60,0.28)]"
            >
              <div className="flex items-center gap-2 px-1">
                <Megaphone className="h-4 w-4 text-rose-500" />
                <p className="text-[14px] font-extrabold text-slate-800">嘲讽一下</p>
                <span className="ml-auto text-[11px] font-semibold text-slate-400">
                  本局剩 {remaining} 次
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-slate-500 active:scale-90"
                  aria-label="关闭"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-2 grid gap-1.5">
                {items.map((it) => (
                  <button
                    key={it.idx}
                    type="button"
                    disabled={disabled}
                    onClick={async () => {
                      const ok = await onSend(it.idx);
                      if (ok) setOpen(false);
                    }}
                    className="rounded-xl bg-slate-50 px-3 py-2.5 text-left text-[13.5px] font-semibold text-slate-700 ring-1 ring-slate-100 transition-transform active:scale-[0.98] disabled:opacity-45"
                  >
                    {it.text}
                  </button>
                ))}
              </div>

              {error ? (
                <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11.5px] font-semibold text-rose-500">
                  {error}
                </p>
              ) : null}
              <p className="mt-2 px-1 text-[10.5px] text-slate-400">
                每局最多 3 次 · 间隔 8 秒 · 友善调侃，别当真
              </p>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}
