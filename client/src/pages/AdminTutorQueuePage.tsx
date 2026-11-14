import { useEffect, useRef, useState } from 'react';
import {
  Activity, RefreshCw, Loader2, Clock, CheckCircle2, Users, ListOrdered, AlertTriangle,
  X, Hand, Maximize2, FileWarning } from 'lucide-react';
import { api } from '../lib/api';

/**
 * 后台 · 讲题队列实时面板
 * ─────────────────────────────────────────────────────────
 * 数据来自 GET /api/lesson-video/admin/queue（仅 role=admin）。
 * 每 5 秒自动拉一次，用来回答学生问的「我前面还有几个人 / 还要等多久」。
 * 排队时长口径：1 位 ≈ 15 分钟（与前端一致）。
 */

interface Job {
  id: string;
  user_id: number;
  username: string;
  status: 'queued' | 'running';
  stage: string;
  stage_key: string;
  progress: number;
  detail: string;
  queue_position: number;
  queue_ahead: number;
  est_wait_minutes: number;
  est_remain_minutes: number;
  elapsed_minutes: number;
  created_at: number;
  started_at: number;
  image_url: string | null;
}

interface QueueData {
  dry_run: boolean;
  server_time: number;
  minutes_per_job: number;
  worker_active: boolean;
  current_id: string | null;
  queued: number;
  total_in_system: number;
  total_wait_minutes: number;
  today: { submitted: number; done: number; failed: number; avg_minutes: number | null };
  jobs: Job[];
}

const p2 = (n: number) => String(n).padStart(2, '0');

function fmtClock(ts: number) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

function fmtDur(min: number) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} 小时 ${r} 分` : `${h} 小时`;
}

function Stat({
  label, value, unit, sub, tone,
}: { label: string; value: React.ReactNode; unit?: string; sub?: string; tone: string }) {
  const tones: Record<string, string> = {
    indigo: 'text-indigo-600',
    amber: 'text-amber-600',
    emerald: 'text-emerald-600',
    slate: 'text-slate-700',
    rose: 'text-rose-600',
  };
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 px-4 py-3.5">
      <div className="text-[12px] text-slate-500">{label}</div>
      <div className={`mt-1 text-[24px] leading-none font-bold tabular-nums ${tones[tone] || tones.slate}`}>
        {value}
        {unit && <span className="ml-1 text-[12px] font-medium text-slate-400">{unit}</span>}
      </div>
      {sub && <div className="mt-1.5 text-[11.5px] text-slate-400">{sub}</div>}
    </div>
  );
}

export default function AdminTutorQueuePage() {
  const [data, setData] = useState<QueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [auto, setAuto] = useState(true);
  const [tick, setTick] = useState(0);
  const [preview, setPreview] = useState<Job | null>(null);
  const [canceling, setCanceling] = useState('');
  const timer = useRef<number | null>(null);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await api.lessonVideoAdminQueue();
      setData(r);
      setErr('');
    } catch (e: any) {
      setErr(e?.message || '加载失败');
    } finally {
      setLoading(false);
      setTick((n) => n + 1);
    }
  };

  /* 【2026-11-12】中断原因二选一：
     simple = 题目较简单（把资源让给更需要的人）
     single = 请上传单题（整页练习册/试卷，一道题都没法讲）
     两套话术都在学生端本地展示，学生看不到「被管理员踢了」。 */
  const cancelJob = async (j: Job, reason: 'simple' | 'single' = 'simple') => {
    const where = j.status === 'running' ? '正在讲' : `排在第 ${j.queue_position} 位`;
    const tip = reason === 'single'
      ? '学生端会显示「请上传单题 / 一次只讲一道题，整张练习册我讲不过来」。'
      : '学生端会显示「监测到题目较简单，请把资源让给更需要的同学」。';
    const ok = window.confirm(
      `确定中断 ${j.username} 的这道题吗？\n当前${where}，中断后会立刻把位置让给下一位。\n${tip}`
    );
    if (!ok) return;
    setCanceling(j.id);
    try {
      await api.lessonVideoAdminCancelJob(j.id, reason);
      await load(true);
    } catch (e: any) {
      setErr(e?.message || '中断失败');
    } finally {
      setCanceling('');
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (timer.current) window.clearInterval(timer.current);
    if (!auto) return;
    timer.current = window.setInterval(() => load(true), 5000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [auto]);

  const jobs = data?.jobs || [];
  const running = jobs.filter((j) => j.status === 'running');
  const queued = jobs.filter((j) => j.status === 'queued');

  return (
    <div className="p-5 md:p-7 max-w-[1100px]">
      {/* 顶部 */}
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-[20px] font-bold text-slate-900 flex items-center gap-2">
            <ListOrdered className="w-5 h-5 text-indigo-500" />
            讲题队列
          </h1>
          <p className="text-[12.5px] text-slate-500 mt-1">
            「刻忆讲题」内测实时排队情况 · 每 {data?.minutes_per_job ?? 15} 分钟一位 · 自动刷新 5 秒
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAuto((v) => !v)}
            className={`h-9 px-3 rounded-xl text-[12.5px] font-medium ring-1 transition-colors ${
              auto
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                : 'bg-white text-slate-500 ring-slate-200'
            }`}
          >
            {auto ? '● 自动刷新中' : '○ 已暂停'}
          </button>
          <button
            onClick={() => load()}
            disabled={loading}
            className="h-9 px-3.5 rounded-xl bg-white ring-1 ring-slate-200 text-[13px] text-slate-700 flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-4 rounded-xl bg-rose-50 text-rose-600 text-[13px] px-3.5 py-2.5 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {err}
        </div>
      )}

      {loading && !data ? (
        <div className="py-20 flex items-center justify-center text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <>
          {/* 指标 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat
              label="正在讲"
              value={running.length}
              unit="人"
              sub={running[0] ? `${running[0].username} · 已讲 ${running[0].elapsed_minutes} 分钟` : '空闲中'}
              tone={running.length ? 'indigo' : 'slate'}
            />
            <Stat
              label="排队中"
              value={queued.length}
              unit="人"
              sub={queued.length ? `最后一位约等 ${fmtDur(data?.total_wait_minutes || 0)}` : '当前无需排队'}
              tone="amber"
            />
            <Stat
              label="预计清空"
              value={fmtDur(data?.total_wait_minutes || 0)}
              sub="按每位 15 分钟估算"
              tone="slate"
            />
            <Stat
              label="今日已讲完"
              value={data?.today.done ?? 0}
              unit="题"
              sub={
                data?.today.avg_minutes
                  ? `平均 ${data.today.avg_minutes} 分钟/题`
                  : `提交 ${data?.today.submitted ?? 0} 题`
              }
              tone="emerald"
            />
          </div>

          {/* 队列 */}
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="text-[13.5px] font-semibold text-slate-800 flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-slate-400" />
                当前队列
                <span className="text-[12px] font-normal text-slate-400">（按提交先后排序）</span>
              </div>
              <div className="text-[11.5px] text-slate-400 tabular-nums">
                {data?.worker_active ? 'worker 运行中' : 'worker 空闲'}
                {data?.dry_run && <span className="ml-2 text-amber-500">dry-run 模式</span>}
              </div>
            </div>

            {jobs.length === 0 ? (
              <div className="py-16 text-center text-[13px] text-slate-400">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-300" />
                队列已清空，没有人在等
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {[...running, ...queued].map((j, idx) => {
                  const isRun = j.status === 'running';
                  return (
                    <div
                      key={j.id}
                      className={`px-4 py-3 flex items-center gap-3 ${isRun ? 'bg-indigo-50/40' : 'hover:bg-slate-50/60'}`}
                    >
                      {/* 位次 */}
                      <div
                        className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[12px] font-bold tabular-nums ${
                          isRun ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {isRun ? '讲' : idx - running.length + 1}
                      </div>

                      {/* 题图：点开看大图，判断题目难易后再决定要不要让出资源 */}
                      <button
                        type="button"
                        onClick={() => j.image_url && setPreview(j)}
                        title="点击查看题目大图"
                        className="group relative w-10 h-10 shrink-0 rounded-lg overflow-hidden bg-slate-100 ring-1 ring-slate-200 hover:ring-indigo-300"
                      >
                        {j.image_url ? (
                          <>
                            <img src={j.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                            <span className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/40 text-white">
                              <Maximize2 className="w-3.5 h-3.5" />
                            </span>
                          </>
                        ) : (
                          <span className="w-full h-full flex items-center justify-center text-slate-300">
                            <Users className="w-4 h-4" />
                          </span>
                        )}
                      </button>

                      {/* 主体 */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13.5px] font-semibold text-slate-900 truncate">{j.username}</span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ${
                              isRun
                                ? 'bg-indigo-50 text-indigo-700 ring-indigo-200'
                                : 'bg-amber-50 text-amber-700 ring-amber-200'
                            }`}
                          >
                            {isRun ? 'Agent 正在讲' : '排队中'}
                          </span>
                          {isRun && (
                            <span className="text-[11.5px] text-slate-500 tabular-nums">{j.progress}%</span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-[11.5px] text-slate-500 flex-wrap">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            提交 {fmtClock(j.created_at)}
                          </span>
                          {isRun ? (
                            <span>已讲 {j.elapsed_minutes} 分钟 · 预计还需约 {j.est_remain_minutes} 分钟</span>
                          ) : (
                            <span>
                              已等 {j.elapsed_minutes} 分钟 · 前方 {j.queue_ahead} 位 · 预计还需约{' '}
                              {j.est_wait_minutes} 分钟
                            </span>
                          )}
                          {isRun && j.stage && <span className="text-slate-400">{j.stage}</span>}
                        </div>
                        {isRun && (
                          <div className="mt-1.5 h-1.5 rounded-full bg-slate-200/70 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-indigo-500 transition-all"
                              style={{ width: `${Math.max(0, Math.min(100, j.progress))}%` }}
                            />
                          </div>
                        )}
                      </div>

                      {/* 中断：排队中直接出队，正在讲的杀进程，位置立刻让给下一位 */}
                      <div className="shrink-0 flex flex-col gap-1.5">
                        <button
                          type="button"
                          onClick={() => cancelJob(j, 'single')}
                          disabled={canceling === j.id}
                          title="整页练习册/试卷：提示学生裁成单题再拍"
                          className="h-8 px-2.5 rounded-lg text-[12px] font-medium text-amber-700 bg-amber-50 ring-1 ring-amber-200 hover:bg-amber-100 active:scale-95 disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
                        >
                          <FileWarning className="w-3.5 h-3.5" />
                          请上传单题
                        </button>
                        <button
                          type="button"
                          onClick={() => cancelJob(j, 'simple')}
                          disabled={canceling === j.id}
                          title="中断这个任务，把位置让给后面的人"
                          className="h-8 px-2.5 rounded-lg text-[12px] font-medium text-rose-600 bg-rose-50 ring-1 ring-rose-200 hover:bg-rose-100 active:scale-95 disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
                        >
                          {canceling === j.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Hand className="w-3.5 h-3.5" />}
                          中断
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <p className="mt-3 text-[11.5px] text-slate-400">
            数据更新于 {data ? fmtClock(data.server_time) : '—'} · 队列位次取自讲题 worker 的内存队列，
            与学生对端显示的「前方还有 N 位」一致。
          </p>

          {/* 题目大图：管理员据此判断是「错题拆解」还是整页基础题 */}
          {preview && (
            <div
              className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
              onClick={() => setPreview(null)}
            >
              <div
                className="bg-white rounded-2xl overflow-hidden max-w-[900px] w-full shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold text-slate-900 truncate">
                      {preview.username} 的题目
                    </div>
                    <div className="text-[11.5px] text-slate-500 mt-0.5">
                      {preview.status === 'running' ? '正在讲' : `排在第 ${preview.queue_position} 位`}
                      {' · '}提交 {fmtClock(preview.created_at)} · 已等 {preview.elapsed_minutes} 分钟
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => { const p = preview; setPreview(null); cancelJob(p, 'single'); }}
                      className="h-8 px-2.5 rounded-lg text-[12px] font-medium text-amber-700 bg-amber-50 ring-1 ring-amber-200 hover:bg-amber-100 flex items-center gap-1 whitespace-nowrap"
                    >
                      <FileWarning className="w-3.5 h-3.5" /> 提示上传单题
                    </button>
                    <button
                      type="button"
                      onClick={() => { const p = preview; setPreview(null); cancelJob(p, 'simple'); }}
                      className="h-8 px-2.5 rounded-lg text-[12px] font-medium text-rose-600 bg-rose-50 ring-1 ring-rose-200 hover:bg-rose-100 flex items-center gap-1 whitespace-nowrap"
                    >
                      <Hand className="w-3.5 h-3.5" /> 中断并让出
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreview(null)}
                      className="w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="bg-slate-50 max-h-[70vh] overflow-auto flex items-center justify-center">
                  {preview.image_url && (
                    <img src={preview.image_url} alt="题目" className="max-w-full" />
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
