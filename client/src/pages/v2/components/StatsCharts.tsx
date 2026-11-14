import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';

/**
 * 统计页图表组件集（百词斩风格）。
 *
 * 设计取舍：不引入 echarts / recharts 等图表库 —— 这里只有三种固定形态的
 * 图表，手写 SVG 既能把体积控制在几 KB，也能和站点玻璃态视觉完全贴合。
 * 所有动画只驱动 transform / opacity。
 */

// ── 记忆阶段配色（五档梯度：越深 = 掌握越牢） ─────────────────
export const STAGE_META = [
  { key: 'fresh', label: '初记', solid: '#dbeafe', text: '#60a5fa' },
  { key: 'hard', label: '强化', solid: '#bfdbfe', text: '#3b82f6' },
  { key: 'solid', label: '巩固', solid: '#93c5fd', text: '#2563eb' },
  { key: 'familiar', label: '熟识', solid: '#60a5fa', text: '#1d4ed8' },
  { key: 'slain', label: '已斩', solid: '#2563eb', text: '#1e3a8a' },
] as const;

/* ────────────────────────────────────────────────────────────
 * 1. 未来 10 天复习计划柱状图
 *
 * 【2026-09-28 修复】原实现有两个问题：
 *   ① 图例写着「逾期：玫红」「已复习标记：虚线」，但柱体只有
 *      `isToday ? 玫红 : 蓝` 一种配色，overdue 参数拿到后从未被使用 ——
 *      图例是纯装饰，与画面不符。
 *   ② 后端因 SQL 缺陷长期返回全 0，这里 max 退化成 10，画出 10 根空柱。
 * 现改为：今天那根柱子按「逾期占比」做双色堆叠（下半逾期=玫红 / 上半今日到期=蓝），
 * 图例同步为「逾期 / 今日到期 / 未来待复习」三项，与画面严格一致。
 * ──────────────────────────────────────────────────────────── */
export function ReviewPlanChart({
  days,
  overdue,
}: {
  days: { label: string; offset: number; count: number; isToday: boolean }[];
  overdue: number;
}) {
  const todayCount = days.find((d) => d.isToday)?.count || 0;
  // 今天柱子里属于「逾期」的部分（后端已把逾期并入今天，这里拆开展示）
  const overdueInToday = Math.min(overdue, todayCount);
  const freshInToday = Math.max(todayCount - overdueInToday, 0);

  const max = Math.max(...days.map((d) => d.count), 10);
  // 取整到 10 的倍数作为 Y 轴上限，刻度更整齐
  const yMax = Math.ceil(max / 10) * 10;
  const ticks = [yMax, Math.round(yMax * 0.66), Math.round(yMax * 0.33), 0];

  const H = 220; // 绘图区高度
  const BAR_W = 18;
  const pxPerUnit = yMax > 0 ? H / yMax : 0;

  return (
    <div className="w-full">
      <div className="flex">
        {/* Y 轴刻度 */}
        <div
          className="flex flex-col justify-between text-[10px] text-slate-400 pr-2 shrink-0"
          style={{ height: H }}
        >
          {ticks.map((t) => (
            <span key={t} className="leading-none tabular-nums">
              {t}
            </span>
          ))}
        </div>

        {/* 绘图区 */}
        <div className="flex-1 relative" style={{ height: H }}>
          {/* 网格线 */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {ticks.map((t, i) => (
              <div
                key={t}
                className={
                  i === ticks.length - 1
                    ? 'border-b border-slate-200'
                    : 'border-b border-dashed border-slate-200/70'
                }
              />
            ))}
          </div>

          {/* 柱体 */}
          <div className="absolute inset-0 flex items-end justify-between px-1">
            {days.map((d, i) => {
              const h = Math.max(d.count * pxPerUnit, d.count > 0 ? 3 : 0);
              const showVal = d.count > 0;
              const hOverdue = d.isToday ? overdueInToday * pxPerUnit : 0;
              const hFresh = d.isToday
                ? freshInToday * pxPerUnit
                : Math.max(h, d.count > 0 ? 3 : 0);
              return (
                <div key={d.offset} className="flex-1 flex flex-col items-center justify-end h-full">
                  {showVal && (
                    <span
                      className="text-[10px] font-semibold mb-1 tabular-nums"
                      style={{ color: d.isToday ? '#e11d48' : '#3b82f6' }}
                    >
                      {d.count}
                    </span>
                  )}
                  {/* 今天：逾期（下）+ 今日到期（上）双色堆叠；其余：纯蓝 */}
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: h }}
                    transition={{ duration: 0.5, delay: i * 0.045, ease: [0.4, 0, 0.2, 1] }}
                    className="overflow-hidden flex flex-col justify-end"
                    style={{ width: BAR_W, borderRadius: 4 }}
                  >
                    <div style={{ height: hFresh, background: '#93c5fd' }} />
                    <div style={{ height: hOverdue, background: '#fb7185' }} />
                  </motion.div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* X 轴标签 */}
      <div className="flex mt-2">
        <div className="pr-2 shrink-0" style={{ width: 26 }} />
        <div className="flex-1 flex justify-between px-1">
          {days.map((d) => (
            <span
              key={d.offset}
              className={`flex-1 text-center text-[10px] leading-tight ${
                d.isToday ? 'text-slate-800 font-semibold' : 'text-slate-400'
              }`}
            >
              {d.label.length > 2 ? (
                <>
                  {d.label.slice(0, -1)}
                  <br />后
                </>
              ) : (
                d.label
              )}
            </span>
          ))}
        </div>
      </div>

      {/* 图例（与上面柱体渲染严格对应） */}
      <div className="flex items-center justify-center gap-5 mt-4 text-[11px] text-slate-500">
        <Legend color="#fb7185" label="逾期" />
        <Legend color="#93c5fd" label="待复习" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

/* ────────────────────────────────────────────────────────────
 * 2. 我的掌握现状 —— 五档柱状图
 * ──────────────────────────────────────────────────────────── */
export function MasteryChart({ now }: { now: Record<string, number> }) {
  const values = STAGE_META.map((s) => now[s.key] || 0);
  const max = Math.max(...values, 1);
  const H = 200;

  return (
    <div className="w-full">
      <div className="relative" style={{ height: H }}>
        {/* 网格 */}
        <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border-b border-dashed border-slate-200/70" />
          ))}
        </div>

        <div className="absolute inset-0 flex items-end justify-around px-2">
          {STAGE_META.map((s, i) => {
            const v = values[i];
            const h = Math.max((v / max) * (H - 30), v > 0 ? 4 : 0);
            return (
              <div key={s.key} className="flex flex-col items-center justify-end" style={{ width: 52 }}>
                <span className="text-[11px] font-semibold text-slate-700 mb-1 tabular-nums">{v}张</span>
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: h }}
                  transition={{ duration: 0.55, delay: i * 0.07, ease: [0.4, 0, 0.2, 1] }}
                  className="rounded-t-md"
                  style={{ width: 34, background: s.solid }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* X 轴标签 */}
      <div className="flex justify-around px-2 mt-2">
        {STAGE_META.map((s) => (
          <span
            key={s.key}
            className="text-[11px] text-slate-500"
            style={{ width: 52, textAlign: 'center' }}
          >
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
 * 3. 我的掌握进展 —— 堆叠面积图
 *    11 个时点，自下而上按阶段堆积；悬停/点击可查看当日明细。
 * ──────────────────────────────────────────────────────────── */
export function ProgressStackChart({
  trend,
}: {
  trend: { date: string; label: string; stages: Record<string, number> }[];
}) {
  const [active, setActive] = useState<number | null>(null);

  const { paths, yMax, totals } = useMemo(() => {
    const H = 200;
    const W = 640;
    const n = trend.length;
    const stepX = n > 1 ? W / (n - 1) : W;

    const totalsArr = trend.map((t) =>
      STAGE_META.reduce((s, m) => s + (t.stages[m.key] || 0), 0)
    );
    const rawMax = Math.max(...totalsArr, 1);
    // 【2026-09-28 修复】原先一律向上取整到 100 的倍数：小数据量时
    // （例如 30 词）Y 轴会被拉到 100，整条趋势被压成贴底的一条细线。
    // 现改为按量级自适应步长：<50 取 5、<200 取 10、<1000 取 50，其余取 100。
    const step = rawMax < 50 ? 5 : rawMax < 200 ? 10 : rawMax < 1000 ? 50 : 100;
    const yMaxVal = Math.max(Math.ceil(rawMax / step) * step, step);
    const yOf = (v: number) => H - (v / yMaxVal) * H;

    // 自下而上累积，生成每档一条面积带
    const acc = new Array(n).fill(0);
    const result: { d: string; color: string; key: string }[] = [];

    for (const m of STAGE_META) {
      const top: number[] = [];
      const bottom: number[] = [];
      for (let i = 0; i < n; i++) {
        bottom.push(acc[i]);
        acc[i] += trend[i].stages[m.key] || 0;
        top.push(acc[i]);
      }
      // 面积路径：上沿从左到右，下沿从右到左闭合
      let d = `M 0 ${yOf(top[0])}`;
      for (let i = 1; i < n; i++) d += ` L ${i * stepX} ${yOf(top[i])}`;
      for (let i = n - 1; i >= 0; i--) d += ` L ${i * stepX} ${yOf(bottom[i])}`;
      d += ' Z';
      result.push({ d, color: m.solid, key: m.key });
    }

    return { paths: result, yMax: yMaxVal, totals: totalsArr };
  }, [trend]);

  const H = 200;
  const yTicks = [yMax, Math.round(yMax * 0.75), Math.round(yMax * 0.5), Math.round(yMax * 0.25), 0];

  return (
    <div className="w-full">
      <div className="flex">
        {/* Y 轴 */}
        <div
          className="flex flex-col justify-between text-[10px] text-slate-400 pr-2 shrink-0"
          style={{ height: H }}
        >
          {yTicks.map((t) => (
            <span key={t} className="leading-none tabular-nums">
              {t.toLocaleString()}
            </span>
          ))}
        </div>

        <div className="flex-1 relative" style={{ height: H }}>
          {/* 网格 */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="border-b border-dashed border-slate-200/60" />
            ))}
          </div>

          {/* 面积图 */}
          <svg
            viewBox={`0 0 640 ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
          >
            {paths.map((p, i) => (
              <motion.path
                key={p.key}
                d={p.d}
                fill={p.color}
                initial={{ opacity: 0 }}
                animate={{
                  opacity: active === null || STAGE_META[i].key === 'slain' ? 1 : 0.55,
                }}
                transition={{ duration: 0.6, delay: 0.1 + i * 0.08 }}
              />
            ))}
            {/* 高亮列指示线 */}
            {active !== null && (
              <line
                x1={(active / Math.max(trend.length - 1, 1)) * 640}
                y1={0}
                x2={(active / Math.max(trend.length - 1, 1)) * 640}
                y2={H}
                stroke="#1e3a8a"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                opacity="0.5"
              />
            )}
          </svg>

          {/* 交互热区 */}
          <div className="absolute inset-0 flex">
            {trend.map((t, i) => (
              <button
                key={t.date}
                type="button"
                className="flex-1 h-full focus:outline-none"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onClick={() => setActive(active === i ? null : i)}
                aria-label={`${t.label} 掌握进展`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* X 轴标签 */}
      <div className="flex mt-2">
        <div className="pr-2 shrink-0" style={{ width: 34 }} />
        <div className="flex-1 flex">
          {trend.map((t) => (
            <span key={t.date} className="flex-1 text-center text-[9px] leading-tight text-slate-400">
              {t.label.length > 2 ? (
                <>
                  {t.label.slice(0, -1)}
                  <br />前
                </>
              ) : (
                t.label
              )}
            </span>
          ))}
        </div>
      </div>

      {/* 悬浮明细 */}
      {active !== null && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 glass rounded-xl px-3 py-2 text-[11px] text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1"
        >
          <span className="font-semibold text-slate-800">{trend[active].label}</span>
          <span className="text-slate-400">共 {totals[active].toLocaleString()} 张</span>
          {STAGE_META.map((m) => (
            <span key={m.key} className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: m.solid }} />
              {m.label} {trend[active].stages[m.key] || 0}
            </span>
          ))}
        </motion.div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
 * 4. 阶段分布列表（图下方的文字明细，含占比）
 * ──────────────────────────────────────────────────────────── */
export function StageBreakdown({
  now,
  percent,
  total,
}: {
  now: Record<string, number>;
  percent: Record<string, number>;
  total: number;
}) {
  return (
    <div className="mt-6">
      <p className="text-sm text-slate-500 mb-3">当前已学卡片记忆持久度分布：</p>
      <div className="space-y-2.5">
        {STAGE_META.map((m, i) => (
          <motion.div
            key={m.key}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, delay: i * 0.06 }}
            className="flex items-center gap-3"
          >
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: m.solid }} />
            <span className="text-sm text-slate-600 w-20 shrink-0">{m.label}阶段：</span>
            <span className="text-sm font-bold text-slate-900 tabular-nums">{now[m.key] || 0}张</span>
            <span className="text-sm text-slate-300">|</span>
            <span className="text-sm font-bold tabular-nums" style={{ color: m.text }}>
              {percent[m.key] || 0}%
            </span>
          </motion.div>
        ))}
      </div>
      <p className="text-xs text-slate-400 mt-3">共计 {total.toLocaleString()} 张</p>
    </div>
  );
}
