import { useEffect, useState } from 'react';

/**
 * 对局展示用倒计时。
 *
 * 后端 battles 表有 expired_at（= started_at + 300s）作为强制结算时间，
 * 但 GET /battles/:id 的 buildState() 目前没有把它返回给前端，
 * 因此这里统一接收一个「绝对截止时间戳」，由调用方决定来源：
 *   - 若后端补上 startedAt / expiredAt → 用服务端时间换算；
 *   - 否则退化为「进入 playing 时本地 +300 秒」，仅作展示，
 *     真正的判负 / 结算一律以后端强制结算为准。
 */

/** 后端强结时长（MATCH_FORCE_FINISH_SECONDS = 300 秒） */
export const BATTLE_DURATION_MS = 300_000;

/** 把剩余毫秒格式化为 mm:ss（不足两位补 0） */
export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * 每秒两次轮询剩余时间，返回「剩余毫秒」（不会小于 0）。
 * @param deadline 绝对截止时间戳（ms）；为 null 时返回 0
 */
export function useCountdown(deadline: number | null): number {
  const [remain, setRemain] = useState<number>(() =>
    deadline ? Math.max(0, deadline - Date.now()) : 0
  );

  useEffect(() => {
    if (!deadline) {
      setRemain(0);
      return;
    }
    const tick = (): void => setRemain(Math.max(0, deadline - Date.now()));
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [deadline]);

  return remain;
}
