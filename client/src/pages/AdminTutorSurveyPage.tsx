import { useEffect, useState, useMemo } from 'react';
import { Loader2, RefreshCw, MessageSquareQuote, TrendingUp, Users2 } from 'lucide-react';
import { api } from '../lib/api';

/**
 * 后台 · 新功能问卷（AI 讲题付费意愿）
 * ─────────────────────────────────────────────────────────
 * 仅陈子洋 / admin 可见（Layout 菜单过滤 + 后端 403 双保险）。
 * 数据来自 GET /api/tutor-survey/admin/list，同一账号只保留最新一条。
 */

const WILL_PAY_LABEL: Record<string, { t: string; cls: string }> = {
  yes: { t: '愿意', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  depends: { t: '看价格', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  no: { t: '不愿意', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

const PRICE_LABEL: Record<string, string> = {
  free: '只能免费',
  p1: '1 元/题',
  p3: '3 元/题',
  p5: '5 元/题',
  vip: '开会员',
};

const WANT_LABEL: Record<string, string> = {
  homework: '作业题',
  exam: '错题',
  preview: '提前学',
  steps: '看步骤',
  check: '检查对错',
  other: '其他',
};

interface Row {
  id: number;
  username: string;
  willPay: string;
  price: string | null;
  grade: string | null;
  wants: string[];
  comment: string | null;
  at: number;
}

function fmt(ts: number) {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function AdminTutorSurveyPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<'all' | 'yes' | 'depends' | 'no'>('all');

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.tutorSurvey.adminList();
      setData(r);
    } catch (e: any) {
      setErr(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const list: Row[] = data?.list || [];
  const shown = useMemo(
    () => (filter === 'all' ? list : list.filter((r) => r.willPay === filter)),
    [list, filter]
  );

  const total = data?.total || 0;
  const yes = data?.byWillPay?.yes || 0;
  const depends = data?.byWillPay?.depends || 0;
  const no = data?.byWillPay?.no || 0;
  const willPayRate = total ? Math.round(((yes + depends) / total) * 100) : 0;
  const yesRate = total ? Math.round((yes / total) * 100) : 0;

  // 会员偏好占比
  const vipCount = data?.byPrice?.vip || 0;
  const priceRows = (['free', 'p1', 'p3', 'p5', 'vip'] as const).map((k) => ({
    k,
    n: data?.byPrice?.[k] || 0,
  }));
  const maxPrice = Math.max(1, ...priceRows.map((x) => x.n));

  return (
    <div className="p-5 md:p-7 max-w-[1180px]">
      {/* 顶部 */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[20px] font-bold text-slate-900 flex items-center gap-2">
            <MessageSquareQuote className="w-5 h-5 text-indigo-500" />
            新功能问卷
          </h1>
          <p className="text-[12.5px] text-slate-500 mt-1">
            AI 讲题（拍照讲解）付费意愿 · 同一账号只保留最新一条
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="shrink-0 h-9 px-3.5 rounded-xl bg-white ring-1 ring-slate-200 text-[13px] text-slate-700 flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {err && (
        <div className="mb-4 rounded-xl bg-rose-50 text-rose-600 text-[13px] px-3.5 py-2.5">{err}</div>
      )}

      {loading && !data ? (
        <div className="py-20 flex items-center justify-center text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <>
          {/* 核心指标 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat label="已填写" value={total} unit="人" sub="去重后（每人一条）" tone="slate" />
            <Stat label="愿意付费" value={`${yesRate}%`} sub={`${yes} 人明确愿意`} tone="emerald" />
            <Stat label="愿意或看价格" value={`${willPayRate}%`} sub={`${yes + depends} 人有付费可能`} tone="indigo" />
            <Stat label="倾向会员制" value={vipCount} unit="人" sub={total ? `占 ${Math.round((vipCount / total) * 100)}%` : '—'} tone="amber" />
          </div>

          {/* 价格接受度 */}
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-4 mb-5">
            <div className="text-[13.5px] font-semibold text-slate-800 mb-3 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-slate-400" />
              价格接受度
            </div>
            <div className="space-y-2">
              {priceRows.map(({ k, n }) => (
                <div key={k} className="flex items-center gap-3">
                  <div className="w-[92px] shrink-0 text-[12.5px] text-slate-600">{PRICE_LABEL[k]}</div>
                  <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${k === 'vip' ? 'bg-amber-400' : 'bg-indigo-400'}`}
                      style={{ width: `${(n / maxPrice) * 100}%` }}
                    />
                  </div>
                  <div className="w-10 shrink-0 text-right text-[12.5px] tabular-nums text-slate-700">{n}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 筛选 */}
          <div className="flex items-center gap-2 mb-3">
            {(
              [
                ['all', `全部 ${total}`],
                ['yes', `愿意 ${yes}`],
                ['depends', `看价格 ${depends}`],
                ['no', `不愿意 ${no}`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`px-3 py-1.5 rounded-full text-[12.5px] font-medium transition-colors ${
                  filter === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 明细 */}
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 overflow-hidden">
            {shown.length === 0 ? (
              <div className="py-14 text-center text-[13px] text-slate-400">
                <Users2 className="w-7 h-7 mx-auto mb-2 text-slate-300" />
                还没有人填写
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {shown.map((r) => {
                  const wl = WILL_PAY_LABEL[r.willPay] || { t: r.willPay, cls: 'bg-slate-100 text-slate-600 ring-slate-200' };
                  return (
                    <div key={r.id} className="px-4 py-3 hover:bg-slate-50/60">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13.5px] font-semibold text-slate-900">{r.username}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ${wl.cls}`}>
                          {wl.t}
                        </span>
                        {r.price && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-600">
                            {PRICE_LABEL[r.price] || r.price}
                          </span>
                        )}
                        {r.grade && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-600">
                            {r.grade}
                          </span>
                        )}
                        <span className="ml-auto text-[11.5px] text-slate-400 tabular-nums">{fmt(r.at)}</span>
                      </div>
                      {r.wants?.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {r.wants.map((w) => (
                            <span key={w} className="text-[11px] text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                              {WANT_LABEL[w] || w}
                            </span>
                          ))}
                        </div>
                      )}
                      {r.comment && (
                        <div className="mt-1.5 text-[12.5px] text-slate-600 leading-relaxed bg-slate-50 rounded-lg px-2.5 py-2">
                          {r.comment}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 年级分布（可选） */}
          {data?.byGrade && Object.keys(data.byGrade).length > 0 && (
            <div className="mt-4 rounded-2xl bg-white ring-1 ring-slate-200 p-4">
              <div className="text-[13px] font-semibold text-slate-800 mb-2.5">年级分布</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.byGrade as Record<string, number>)
                  .sort((a, b) => b[1] - a[1])
                  .map(([g, n]) => (
                    <span key={g} className="text-[12px] text-slate-600 bg-slate-50 ring-1 ring-slate-200 rounded-lg px-2.5 py-1">
                      {g} <b className="text-slate-900 tabular-nums">{n}</b>
                    </span>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  sub,
  tone,
}: {
  label: string;
  value: number | string;
  unit?: string;
  sub?: string;
  tone: 'slate' | 'emerald' | 'indigo' | 'amber';
}) {
  const ring = {
    slate: 'ring-slate-200',
    emerald: 'ring-emerald-200',
    indigo: 'ring-indigo-200',
    amber: 'ring-amber-200',
  }[tone];
  const color = {
    slate: 'text-slate-900',
    emerald: 'text-emerald-600',
    indigo: 'text-indigo-600',
    amber: 'text-amber-600',
  }[tone];
  return (
    <div className={`rounded-2xl bg-white ring-1 ${ring} px-4 py-3.5`}>
      <div className="text-[12px] text-slate-500">{label}</div>
      <div className={`mt-1 text-[24px] font-bold tabular-nums leading-none ${color}`}>
        {value}
        {unit && <span className="text-[13px] font-medium text-slate-400 ml-1">{unit}</span>}
      </div>
      {sub && <div className="text-[11px] text-slate-400 mt-1.5">{sub}</div>}
    </div>
  );
}
