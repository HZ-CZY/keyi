// 北京时间 (UTC+8) 日期工具
// 打卡、连续天数等"按天"统计统一使用中国时区,避免 UTC 导致凌晨 8 点前的
// 打卡/复习被记到前一天(北京 00:00 = UTC 前一天 16:00)。

export const CN_TZ_OFFSET_MS = 8 * 3600 * 1000;

/** 北京时间日期字符串 YYYY-MM-DD */
export function cnDateStr(d: Date = new Date()): string {
  return new Date(d.getTime() + CN_TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** 北京时间的"今天"及其对应的 UTC 起止时间戳(秒) */
export function cnTodayWindow() {
  const today = cnDateStr();
  const [y, m, day] = today.split('-').map(Number);
  const startOfDay = Math.floor((Date.UTC(y, m - 1, day) - CN_TZ_OFFSET_MS) / 1000);
  return { today, startOfDay, endOfDay: startOfDay + 86400 };
}

/** SQLite date() 修饰符后缀:把 unixepoch 时间戳转成北京时间日期 */
export const CN_SQL_MODIFIER = '+8 hours';

/**
 * 日期字符串按天偏移（YYYY-MM-DD → YYYY-MM-DD）。
 * 【2026-11-07】为什么不用 new Date(...).setDate()：
 * 那两个 API 都按「运行环境本地时区」算，而生产机是 UTC。
 * 带 +08:00 的字符串会被解析成 UTC 的前一天 16:00，setDate 再在 UTC 上切日，
 * 回溯出来的日期整体错一天 —— 直接导致连签在跨天时刻归零又恢复。
 * 这里只用 UTC 日历做纯日期加减，不参与任何时区换算，跟服务器时区无关。
 */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + delta);
  return t.toISOString().slice(0, 10);
}
