import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import {
  Loader2, RefreshCw, ChevronLeft, Users, AlertTriangle,
  TrendingUp, Timer, Award, UserX, ChevronRight,
} from 'lucide-react';

const INK = '#3A2318';
const INK2 = '#8B6A57';

/** 分组 → 配色。顺序即严重度，老师从上往下看就是优先级 */
const FLAG_STYLE: Record<string, { bg: string; fg: string }> = {
  稳定: { bg: 'rgba(59,165,93,.10)', fg: '#2F8F4E' },
  正常: { bg: 'rgba(59,165,93,.07)', fg: '#3F8F5C' },
  偏少: { bg: 'rgba(240,160,60,.12)', fg: '#A9741B' },
  掉队: { bg: 'rgba(240,120,60,.14)', fg: '#B85A1E' },
  已流失: { bg: 'rgba(232,52,42,.10)', fg: '#C04A2A' },
  疑似刷时长: { bg: 'rgba(120,90,200,.12)', fg: '#6B4BB0' },
  未开始: { bg: 'rgba(0,0,0,.06)', fg: '#8B6A57' },
};

interface Student {
  userId: number; username: string; studied: number; studiedPct: number;
  rev30: number; active30: number; acc30: number; fast30: number;
  daysIdle: number; wrongOpen: number; flag: string;
}
interface Trend {
  day: string; reviews: number; effectiveStudents: number;
  activeStudents: number; accuracy: number;
}

/**
 * 后台 · 班级学情
 * ─────────────────────────────────────────────────────────
 * 数据来自 scripts/class_report.js 预计算的三张表，接口只读不算 —— 老师看到的
 * 每个数字都能回脚本里复算。
 *
 * 三条重要口径（页面上也要写出来，免得被误读）：
 *   1. 全站是同一套 869 张预制卡，「学了 300 张」= 这套卡里他过了 300 张。
 *   2. 有效学习 = 当天 ≥10 条记录且秒过率 < 80%，刷时长的会被单独抓出来。
 *   3. 正确率只统计复习卡（review_type=2），新卡不算。
 */
export default function AdminClassReportPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [trend, setTrend] = useState<Trend[]>([]);
  const [attn, setAttn] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('全部');
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([api.admin.classReport(), api.admin.classTrend(30), api.admin.classAttention()])
      .then(([d, t, a]) => {
        setData(d);
        setTrend(t as Trend[]);
        setAttn(a);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openStudent = async (id: number) => {
    setDetailLoading(true);
    setDetail({ userId: id });
    try {
      const d = await api.admin.classStudent(id);
      setDetail(d);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#E8342A' }} />
      </div>
    );
  }

  const students: Student[] = data?.students || [];
  const flags: { flag: string; n: number }[] = data?.flags || [];
  const list = filter === '全部' ? students : students.filter((s) => s.flag === filter);

  return (
    <div className="min-h-screen pb-16" style={{ background: '#FBF7F3' }}>
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-black/5">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 flex items-center justify-center active:scale-90 transition"
            aria-label="返回"
          >
            <ChevronLeft className="w-6 h-6" style={{ color: INK }} strokeWidth={2.6} />
          </button>
          <h1 className="text-[17px] font-black" style={{ color: INK }}>班级学情</h1>
          <span className="text-[11px]" style={{ color: INK2 }}>
            {data?.total || 0} 人 · 更新于{' '}
            {data?.computedAt ? new Date(data.computedAt * 1000).toLocaleString('zh-CN') : '—'}
          </span>
          <button onClick={load} className="ml-auto flex items-center gap-1 text-[12px] font-bold" style={{ color: INK2 }}>
            <RefreshCw className="w-3.5 h-3.5" /> 刷新
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pt-4 space-y-4">
        {/* ── 分组卡片 ── */}
        <section className="grid grid-cols-4 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <button
            onClick={() => setFilter('全部')}
            className="rounded-xl p-2.5 text-left border transition"
            style={{
              background: filter === '全部' ? '#fff' : 'rgba(255,255,255,.6)',
              borderColor: filter === '全部' ? '#E8342A' : 'rgba(0,0,0,.06)',
            }}
          >
            <div className="text-[19px] font-black" style={{ color: INK }}>{students.length}</div>
            <div className="text-[11px] font-bold" style={{ color: INK2 }}>全部</div>
          </button>
          {flags.map((f) => {
            const st = FLAG_STYLE[f.flag] || FLAG_STYLE['未开始'];
            const on = filter === f.flag;
            return (
              <button
                key={f.flag}
                onClick={() => setFilter(on ? '全部' : f.flag)}
                className="rounded-xl p-2.5 text-left border transition"
                style={{
                  background: st.bg,
                  borderColor: on ? st.fg : 'transparent',
                }}
              >
                <div className="text-[19px] font-black" style={{ color: st.fg }}>{f.n}</div>
                <div className="text-[11px] font-bold" style={{ color: st.fg }}>{f.flag}</div>
              </button>
            );
          })}
        </section>

        {/* ── 今日该找谁 ── */}
        {attn && filter === '全部' && (
          <section className="grid md:grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
              <div className="flex items-center gap-1.5 text-[13px] font-black mb-2" style={{ color: '#B85A1E' }}>
                <AlertTriangle className="w-4 h-4" /> 该谈话（学过又停了）
              </div>
              {(attn.talk || []).length === 0 ? (
                <div className="text-[12px]" style={{ color: INK2 }}>没有掉队的学生</div>
              ) : (
                <div className="space-y-1.5">
                  {attn.talk.map((t: any) => (
                    <button
                      key={t.user_id}
                      onClick={() => openStudent(t.user_id)}
                      className="w-full flex items-center gap-2 text-[12.5px] py-1 hover:bg-black/[.02] rounded px-1"
                    >
                      <span className="font-bold" style={{ color: INK }}>{t.username}</span>
                      <span style={{ color: '#C04A2A' }}>闲置 {t.days_idle} 天</span>
                      <span className="ml-auto" style={{ color: INK2 }}>学过 {t.studied} 张</span>
                    </button>
                  ))}
                </div>
              )}
              {(attn.never || []).length > 0 && (
                <div className="mt-2 pt-2 border-t border-black/5">
                  <div className="flex items-center gap-1.5 text-[12px] font-bold mb-1" style={{ color: INK2 }}>
                    <UserX className="w-3.5 h-3.5" /> 从未学过（催开通，不是谈话对象）
                  </div>
                  <div className="text-[12px]" style={{ color: INK2 }}>
                    {attn.never.map((u: any) => u.username).join('、')}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
              <div className="flex items-center gap-1.5 text-[13px] font-black mb-2" style={{ color: '#6B4BB0' }}>
                <Timer className="w-4 h-4" /> 疑似刷时长（秒过率过高）
              </div>
              {(attn.fake || []).length === 0 ? (
                <div className="text-[12px]" style={{ color: INK2 }}>没有异常</div>
              ) : (
                <div className="space-y-1.5">
                  {attn.fake.map((t: any) => (
                    <div key={t.user_id} className="flex items-center gap-2 text-[12.5px] py-1">
                      <span className="font-bold" style={{ color: INK }}>{t.username}</span>
                      <span style={{ color: '#6B4BB0' }}>秒过 {Math.round(t.fast_30d * 100)}%</span>
                      <span className="ml-auto" style={{ color: INK2 }}>30天 {t.rev_30d} 次</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 pt-2 border-t border-black/5">
                <div className="flex items-center gap-1.5 text-[12px] font-bold mb-1" style={{ color: '#2F8F4E' }}>
                  <Award className="w-3.5 h-3.5" /> 值得表扬
                </div>
                <div className="text-[12px]" style={{ color: INK2 }}>
                  {(attn.praise || []).map((u: any) => `${u.username}（${u.active_30d}天/${Math.round(u.acc_30d * 100)}%）`).join('、')}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── 30 天趋势 ── */}
        {filter === '全部' && trend.length > 0 && (
          <section className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
            <div className="flex items-center gap-1.5 text-[13px] font-black mb-3" style={{ color: INK }}>
              <TrendingUp className="w-4 h-4" /> 近 30 天：有效学习人数
            </div>
            <div className="flex items-end gap-1 h-24">
              {trend.map((t) => {
                const max = Math.max(...trend.map((x) => x.activeStudents), 1);
                const h = Math.max(2, (t.activeStudents / max) * 92);
                const he = Math.max(0, (t.effectiveStudents / max) * 92);
                return (
                  <div key={t.day} className="flex-1 flex flex-col justify-end items-center relative group">
                    <div className="w-full rounded-t-sm relative" style={{ height: h, background: 'rgba(232,52,42,.15)' }}>
                      <div className="absolute bottom-0 left-0 right-0 rounded-t-sm" style={{ height: he, background: '#E8342A' }} />
                    </div>
                    <div className="absolute -top-6 hidden group-hover:block text-[10px] whitespace-nowrap bg-black/80 text-white px-1.5 py-0.5 rounded z-10">
                      {t.day.slice(5)} 活跃{t.activeStudents} 有效{t.effectiveStudents}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-2 text-[11px]" style={{ color: INK2 }}>
              <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#E8342A' }} />有效学习</span>
              <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: 'rgba(232,52,42,.15)' }} />当天有记录</span>
            </div>
          </section>
        )}

        {/* ── 学生表 ── */}
        <section className="rounded-2xl bg-white ring-1 ring-black/5 overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-1.5 border-b border-black/5">
            <Users className="w-4 h-4" style={{ color: INK2 }} />
            <span className="text-[13px] font-black" style={{ color: INK }}>
              {filter === '全部' ? '全部学生' : filter} · {list.length} 人
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left" style={{ color: INK2, background: '#FAF5F1' }}>
                  <th className="px-4 py-2 font-bold">学生</th>
                  <th className="px-2 py-2 font-bold">分组</th>
                  <th className="px-2 py-2 font-bold text-right">学过</th>
                  <th className="px-2 py-2 font-bold text-right">30天活跃</th>
                  <th className="px-2 py-2 font-bold text-right">正确率</th>
                  <th className="px-2 py-2 font-bold text-right">秒过率</th>
                  <th className="px-2 py-2 font-bold text-right">闲置</th>
                  <th className="px-2 py-2 font-bold text-right">错题</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => {
                  const st = FLAG_STYLE[s.flag] || FLAG_STYLE['未开始'];
                  return (
                    <tr
                      key={s.userId}
                      onClick={() => openStudent(s.userId)}
                      className="border-t border-black/[.04] cursor-pointer hover:bg-black/[.015]"
                    >
                      <td className="px-4 py-2 font-bold" style={{ color: INK }}>{s.username}</td>
                      <td className="px-2 py-2">
                        <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded" style={{ background: st.bg, color: st.fg }}>
                          {s.flag}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right" style={{ color: INK }}>{s.studied}</td>
                      <td className="px-2 py-2 text-right" style={{ color: INK }}>{s.active30}</td>
                      <td className="px-2 py-2 text-right" style={{ color: s.acc30 >= 0.85 ? '#2F8F4E' : s.acc30 < 0.6 ? '#C04A2A' : INK }}>
                        {s.rev30 ? `${Math.round(s.acc30 * 100)}%` : '—'}
                      </td>
                      <td className="px-2 py-2 text-right" style={{ color: s.fast30 > 0.3 ? '#6B4BB0' : INK2 }}>
                        {s.rev30 ? `${Math.round(s.fast30 * 100)}%` : '—'}
                      </td>
                      <td className="px-2 py-2 text-right" style={{ color: s.daysIdle < 0 ? INK2 : s.daysIdle >= 30 ? '#C04A2A' : INK }}>
                        {s.daysIdle < 0 ? '未开始' : `${s.daysIdle}天`}
                      </td>
                      <td className="px-2 py-2 text-right" style={{ color: INK2 }}>{s.wrongOpen}</td>
                      <td className="px-2 py-2"><ChevronRight className="w-3.5 h-3.5" style={{ color: '#C9A896' }} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 text-[11px] leading-5 border-t border-black/5" style={{ color: '#B08A76' }}>
            口径：全站共用一套 869 张预制卡，「学过」= 这套卡里已过的张数。有效学习 = 当天 ≥10 条记录且秒过率 &lt; 80%。
            正确率只统计复习卡。闲置 = 距最后一次复习的天数，「未开始」表示一条复习记录都没有。
          </div>
        </section>
      </main>

      {/* ── 学生详情 ── */}
      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ background: 'rgba(30,16,10,.45)' }}
          onClick={() => setDetail(null)}
        >
          <div
            className="w-full sm:max-w-lg max-h-[86vh] rounded-t-3xl sm:rounded-3xl bg-white overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white/95 backdrop-blur px-4 py-3 border-b border-black/5 flex items-center gap-2">
              <div className="text-[15px] font-black" style={{ color: INK }}>{detail.username || '加载中'}</div>
              {detail.flag && (
                <span
                  className="text-[10.5px] font-bold px-1.5 py-0.5 rounded"
                  style={{
                    background: (FLAG_STYLE[detail.flag] || FLAG_STYLE['未开始']).bg,
                    color: (FLAG_STYLE[detail.flag] || FLAG_STYLE['未开始']).fg,
                  }}
                >
                  {detail.flag}
                </span>
              )}
              <button onClick={() => setDetail(null)} className="ml-auto text-[12px] font-bold" style={{ color: INK2 }}>
                关闭
              </button>
            </div>
            {detailLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#E8342A' }} />
              </div>
            ) : (
              <div className="px-4 py-4 space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ['学过', `${detail.studied} 张`],
                    ['30天活跃', `${detail.active30} 天`],
                    ['正确率', detail.rev30 ? `${Math.round(detail.acc30 * 100)}%` : '—'],
                    ['秒过率', detail.rev30 ? `${Math.round(detail.fast30 * 100)}%` : '—'],
                    ['闲置', detail.daysIdle < 0 ? '未开始' : `${detail.daysIdle} 天`],
                    ['未解决错题', `${detail.wrongOpen}`],
                  ].map(([k, v]) => (
                    <div key={k as string} className="rounded-xl p-2.5" style={{ background: '#FAF5F1' }}>
                      <div className="text-[10.5px]" style={{ color: INK2 }}>{k}</div>
                      <div className="text-[14px] font-black" style={{ color: INK }}>{v}</div>
                    </div>
                  ))}
                </div>

                {detail.weekly?.length > 0 && (
                  <div>
                    <div className="text-[12px] font-bold mb-1.5" style={{ color: INK2 }}>近 8 周</div>
                    <div className="space-y-1">
                      {detail.weekly.map((w: any) => (
                        <div key={w.weekStart} className="flex items-center gap-2 text-[12px]">
                          <span style={{ color: INK2, width: 82 }}>{w.weekStart}</span>
                          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,.05)' }}>
                            <div
                              className="h-full"
                              style={{
                                width: `${Math.min(100, (w.reviews / Math.max(...detail.weekly.map((x: any) => x.reviews), 1)) * 100)}%`,
                                background: w.activeDays >= 5 ? '#3BA55D' : w.activeDays >= 3 ? '#F0A03C' : '#E8342A',
                              }}
                            />
                          </div>
                          <span className="w-14 text-right" style={{ color: INK }}>{w.reviews} 次</span>
                          <span className="w-12 text-right" style={{ color: INK2 }}>{w.activeDays} 天</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {detail.daily?.length > 0 && (
                  <div>
                    <div className="text-[12px] font-bold mb-1.5" style={{ color: INK2 }}>最近 14 天明细</div>
                    <div className="space-y-0.5">
                      {detail.daily.slice(0, 14).map((d: any) => (
                        <div key={d.day} className="flex items-center gap-2 text-[12px] py-0.5">
                          <span style={{ color: INK2, width: 82 }}>{d.day.slice(5)}</span>
                          <span className="flex-1" style={{ color: INK }}>{d.reviews} 次</span>
                          <span style={{ color: INK2 }}>{d.accuracy ? `正确 ${Math.round(d.accuracy * 100)}%` : ''}</span>
                          {d.effective === 1 && (
                            <span className="text-[10px] font-bold px-1 rounded" style={{ background: 'rgba(59,165,93,.12)', color: '#2F8F4E' }}>有效</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
