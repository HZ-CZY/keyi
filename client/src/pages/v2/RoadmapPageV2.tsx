import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type RoadmapItem } from '../../lib/api';
import { Bug, Check, ChevronLeft, Loader2, Scale, Sparkles, Wrench } from 'lucide-react';

/**
 * 站点升级进度（路线图）
 * ─────────────────────────────────────────────
 * 入口在「设置 → 站点升级进度」。学生端只读，数据由后台维护。
 *
 * 【2026-11-06 改版】四个阶段由纵向分组改成**四栏看板**，一屏同时看到
 * 「计划中 / 待开始 / 进行中 / 已完成」各自堆了多少活：
 *   · 桌面：四列等宽，各列独立纵向滚动（页面整体不再被 22 条已完成拉长）
 *   · 手机：四列横向滑动，一屏一列，snap 对齐
 */

const INK = '#1E293B';
const INK2 = '#64748B';

type StatusKey = 'planned' | 'todo' | 'doing' | 'done';
type CatKey = 'feature' | 'improve' | 'bug' | 'balance';

const STATUS_META: Record<
  StatusKey,
  { label: string; color: string; soft: string; line: string; dot: string }
> = {
  planned: {
    label: '计划中',
    color: '#64748B',
    soft: 'rgba(100,116,139,0.06)',
    line: 'rgba(100,116,139,0.18)',
    dot: '#94A3B8',
  },
  todo: {
    label: '待开始',
    color: '#0369A1',
    soft: 'rgba(3,105,161,0.06)',
    line: 'rgba(3,105,161,0.18)',
    dot: '#0EA5E9',
  },
  doing: {
    label: '进行中',
    color: '#B45309',
    soft: 'rgba(180,83,9,0.06)',
    line: 'rgba(180,83,9,0.20)',
    dot: '#F59E0B',
  },
  done: {
    label: '已完成',
    color: '#047857',
    soft: 'rgba(4,120,87,0.06)',
    line: 'rgba(4,120,87,0.18)',
    dot: '#10B981',
  },
};

const CAT_META: Record<CatKey, { label: string; color: string; icon: typeof Bug }> = {
  feature: { label: '新功能', color: '#7C3AED', icon: Sparkles },
  improve: { label: '体验优化', color: '#2563EB', icon: Wrench },
  bug: { label: '问题修复', color: '#E11D48', icon: Bug },
  balance: { label: '数值调整', color: '#B45309', icon: Scale },
};

const STATUS_ORDER: StatusKey[] = ['planned', 'todo', 'doing', 'done'];

function fmtDate(sec: number): string {
  if (!sec) return '';
  const d = new Date(sec * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function RoadmapPageV2() {
  const navigate = useNavigate();
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [updatedAt, setUpdatedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState<'all' | CatKey>('all');

  useEffect(() => {
    let alive = true;
    api.roadmap
      .get()
      .then((r) => {
        if (!alive) return;
        setItems(r.items || []);
        setCounts(r.counts || {});
        setUpdatedAt(r.updatedAt || 0);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(
    () => (cat === 'all' ? items : items.filter((i) => i.category === cat)),
    [items, cat]
  );

  const grouped = useMemo(() => {
    const g: Record<StatusKey, RoadmapItem[]> = {
      planned: [],
      todo: [],
      doing: [],
      done: [],
    };
    for (const it of filtered) {
      if (g[it.status as StatusKey]) g[it.status as StatusKey].push(it);
    }
    return g;
  }, [filtered]);

  const total = items.length;
  const doneCount = counts.done || 0;
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div
      className="min-h-screen pb-12"
      style={{ background: 'linear-gradient(180deg,#FAFBFF 0%,#EEF1FB 100%)' }}
    >
      <header className="sticky top-0 z-20 border-b border-black/5 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center gap-2 px-4 py-3">
          <button
            onClick={() => navigate(-1)}
            className="-ml-1 flex h-9 w-9 items-center justify-center transition-transform active:scale-90"
            aria-label="返回"
          >
            <ChevronLeft className="h-6 w-6" style={{ color: INK }} strokeWidth={2.6} />
          </button>
          <h1 className="text-[17px] font-black" style={{ color: INK }}>
            站点升级进度
          </h1>
          <span className="ml-auto text-[11.5px] font-semibold" style={{ color: INK2 }}>
            {updatedAt ? `更新于 ${fmtDate(updatedAt)}` : ''}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-4 pt-4">
        {/* 概览：一行进度 */}
        <div className="rounded-[20px] bg-white px-4 py-3 shadow-[0_8px_28px_rgba(30,41,59,0.06)] ring-1 ring-slate-900/5">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-extrabold" style={{ color: INK }}>
              整体进度
            </p>
            <p className="text-[12px] font-bold tabular-nums" style={{ color: INK2 }}>
              {doneCount} / {total} 已完成 · {percent}%
            </p>
          </div>
          <div className="mt-2 h-[7px] w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.max(2, percent)}%`,
                background: 'linear-gradient(90deg,#34D399,#059669)',
              }}
            />
          </div>
        </div>

        {/* 分类筛选 */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {(
            [
              ['all', '全部'],
              ['feature', '新功能'],
              ['improve', '体验优化'],
              ['bug', '问题修复'],
              ['balance', '数值调整'],
            ] as [('all' | CatKey), string][]
          ).map(([key, label]) => {
            const active = cat === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setCat(key)}
                className="shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition-all active:scale-95"
                style={{
                  background: active ? '#1E293B' : 'rgba(255,255,255,0.9)',
                  color: active ? '#fff' : INK2,
                  boxShadow: active
                    ? '0 6px 16px rgba(30,41,59,0.22)'
                    : '0 2px 8px rgba(30,41,59,0.06)',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* ── 四栏看板 ─────────────────────────────────────
            手机：每列 82vw，横向滑动；桌面(md+)：四列等宽并排，各自内部滚动 */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="mt-3 flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-2 md:snap-none md:overflow-visible">
            {STATUS_ORDER.map((sk) => {
              const list = grouped[sk];
              const m = STATUS_META[sk];
              return (
                <section
                  key={sk}
                  className="w-[62vw] shrink-0 snap-start rounded-[18px] p-2 md:w-0 md:min-w-0 md:flex-1 md:shrink"
                  style={{ background: m.soft, boxShadow: `inset 0 0 0 1px ${m.line}` }}
                >
                  {/* 列头 */}
                  <div className="mb-2 flex items-center justify-between px-1.5 pt-0.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`h-[7px] w-[7px] rounded-full ${sk === 'doing' ? 'animate-pulse' : ''}`}
                        style={{ background: m.dot }}
                      />
                      <h2 className="text-[13px] font-extrabold" style={{ color: m.color }}>
                        {m.label}
                      </h2>
                    </div>
                    <span
                      className="rounded-full px-1.5 py-[1px] text-[10.5px] font-black tabular-nums"
                      style={{ background: '#fff', color: m.color }}
                    >
                      {list.length}
                    </span>
                  </div>

                  {/* 列内卡片（桌面独立滚动，避免整页被 22 条已完成拉长） */}
                  <div className="space-y-2 pb-1 md:max-h-[calc(100vh-282px)] md:overflow-y-auto md:pr-1">
                    {list.map((it) => {
                      const cm = CAT_META[it.category] || CAT_META.feature;
                      const Icon = cm.icon;
                      return (
                        <div
                          key={it.id}
                          className="rounded-xl bg-white p-2.5 shadow-[0_2px_10px_rgba(30,41,59,0.05)] ring-1 ring-white/70 transition-transform active:scale-[0.99]"
                        >
                          <div className="flex items-start gap-1.5">
                            <span
                              className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px]"
                              style={{ background: `${cm.color}16` }}
                            >
                              {sk === 'done' ? (
                                <Check
                                  className="h-2.5 w-2.5"
                                  style={{ color: cm.color }}
                                  strokeWidth={3.4}
                                />
                              ) : (
                                <Icon className="h-2.5 w-2.5" style={{ color: cm.color }} />
                              )}
                            </span>
                            <p
                              className="min-w-0 flex-1 text-[12.5px] font-bold leading-snug"
                              style={{ color: sk === 'done' ? '#334155' : INK }}
                            >
                              {it.title}
                            </p>
                          </div>

                          {it.detail ? (
                            <p
                              className="mt-1 text-[11px] leading-[1.5]"
                              style={{
                                color: INK2,
                                display: '-webkit-box',
                                WebkitLineClamp: 3,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {it.detail}
                            </p>
                          ) : null}

                          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                            <span
                              className="rounded px-1 py-[1px] text-[10px] font-bold"
                              style={{ background: `${cm.color}16`, color: cm.color }}
                            >
                              {cm.label}
                            </span>
                            {it.version ? (
                              <span className="text-[10px] font-semibold" style={{ color: '#94A3B8' }}>
                                {it.version}
                              </span>
                            ) : null}
                            {sk === 'done' && it.updated_at ? (
                              <span className="text-[10px] font-semibold" style={{ color: '#94A3B8' }}>
                                {fmtDate(it.updated_at)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}

                    {!list.length ? (
                      <p className="py-8 text-center text-[11px]" style={{ color: '#94A3B8' }}>
                        {cat === 'all' ? '暂无' : '该分类下暂无'}
                      </p>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        <p className="mt-4 text-center text-[11px] leading-relaxed" style={{ color: '#94A3B8' }}>
          清单来自后台规划与同学们的建议，按周更新。「已完成」= 已经上线。
        </p>
      </div>
    </div>
  );
}
