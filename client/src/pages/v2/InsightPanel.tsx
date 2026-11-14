import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ChevronRight, Loader2, Lightbulb, X, Sparkles } from 'lucide-react';

const INK = '#3A2318';
const INK2 = '#8B6A57';

/** 去掉 HTML / **高亮** / ==释义== 标记 */
function plain(s: string): string {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/==(.+?)==/g, '$1')
    .trim();
}

interface InsightItem {
  char: string;
  wrongN: number;
  wrongDefs: string[];
  totalDefs: number;
  coverage: number;
  missedN: number;
  lineTotal: number;
  sample: { def: string; sent: string }[];
  confused: string;
  tip: string;
}

interface Line {
  def: string;
  sent: string;
  trans?: string;
  missed?: boolean;
}

/**
 * 举一反三
 * ─────────────────────────────────────────────────────────
 * 错题本只告诉学生「这个字你错了 67 次」，但错 67 次的原因通常不是这一个字难，
 * 而是他只认识其中一个义项，考到另外几条就栽。这一栏把「这个字一共几条路、
 * 你已经走通几条、还差哪几条」摊开给他看。
 *
 * 数据来自 /api/wordbook/insight，由 scripts/wrong_insight.js 每日反算。
 */
export default function InsightPanel() {
  const [list, setList] = useState<InsightItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    api.wordbook
      .insight()
      .then((d) => setList(d as InsightItem[]))
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  }, []);

  const openChar = async (ch: string) => {
    setOpen(ch);
    setDetailLoading(true);
    setDetail(null);
    try {
      const d = await api.wordbook.insightOf(ch);
      setDetail(d);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-7 h-7 animate-spin" style={{ color: '#E8342A' }} />
      </div>
    );
  }

  if (!list.length) {
    return (
      <div className="text-center py-24">
        <Lightbulb className="w-10 h-10 mx-auto mb-3" style={{ color: '#D9B8A5' }} />
        <div className="text-[14px] font-semibold" style={{ color: INK2 }}>
          还没有可归纳的错题
        </div>
        <div className="text-[12px] mt-1" style={{ color: '#B08A76' }}>
          同一个字错到 2 次以上，这里就会帮你把它所有的义项理出来
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div
        className="rounded-2xl p-3.5 mb-1"
        style={{ background: 'linear-gradient(135deg,#FFF1E4,#FFE6D2)' }}
      >
        <div className="flex items-center gap-1.5 text-[13px] font-black" style={{ color: '#C04A2A' }}>
          <Sparkles className="w-4 h-4" />
          你错得最多的 {list.length} 个字
        </div>
        <div className="text-[12px] mt-1 leading-5" style={{ color: '#A2603F' }}>
          一个字的错，多半不是这个字难，是你只认得其中一条意思。点开看还差哪几条。
        </div>
      </div>

      {list.map((it) => {
        /* 进度 = 已拿下的例句义项 / 有例句的义项总数。
           另有一句「共 N 条义项」放在旁边，说明还有没配例句的义项没算进来。 */
        const total = it.lineTotal || 0;
        const doneN = Math.max(0, total - it.missedN);
        const pct = total ? Math.round((doneN / total) * 100) : 0;
        return (
          <div key={it.char} className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5 overflow-hidden">
            <button
              onClick={() => openChar(it.char)}
              className="w-full text-left p-4 flex items-center gap-3 active:bg-black/[.02] transition"
            >
              <div
                className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-[22px] font-black"
                style={{ background: 'rgba(232,52,42,.07)', color: '#C04A2A' }}
              >
                {it.char}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold" style={{ color: INK }}>
                  错过 {it.wrongN} 次
                  <span className="ml-2 font-normal text-[12px]" style={{ color: INK2 }}>
                    已拿下 {doneN}/{total} 条
                    {it.totalDefs > total && ` · 全字共 ${it.totalDefs} 条义项`}
                  </span>
                </div>
                {/* 进度条：走通的义项 / 全部义项 */}
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,.06)' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct >= 80 ? '#3BA55D' : pct >= 40 ? '#F0A03C' : '#E8342A',
                      }}
                    />
                  </div>
                  <span className="text-[11px] font-bold shrink-0" style={{ color: INK2 }}>
                    {pct}%
                  </span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 shrink-0" style={{ color: '#C9A896' }} />
            </button>

            {it.sample.length > 0 && (
              <div className="px-4 pb-3 -mt-1 space-y-1">
                {it.sample.map((s, i) => (
                  <div key={i} className="text-[12px] leading-5" style={{ color: INK2 }}>
                    <span className="font-bold" style={{ color: '#C04A2A' }}>{plain(s.def)}</span>
                    <span className="mx-1">·</span>
                    {plain(s.sent)}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* ── 详情弹层 ── */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ background: 'rgba(30,16,10,.45)' }}
          onClick={() => setOpen(null)}
        >
          <div
            className="w-full sm:max-w-lg max-h-[86vh] rounded-t-3xl sm:rounded-3xl bg-white overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white/95 backdrop-blur px-4 py-3 border-b border-black/5 flex items-center gap-3">
              <div className="text-[24px] font-black" style={{ color: INK }}>{open}</div>
              <div className="flex-1 text-[12px]" style={{ color: INK2 }}>
                {detail ? `${detail.wrongN} 次答错 · ${detail.totalDefs} 条义项` : ''}
              </div>
              <button onClick={() => setOpen(null)} className="w-8 h-8 flex items-center justify-center" aria-label="关闭">
                <X className="w-5 h-5" style={{ color: INK2 }} />
              </button>
            </div>

            {detailLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#E8342A' }} />
              </div>
            ) : !detail ? (
              <div className="py-16 text-center text-[13px]" style={{ color: INK2 }}>没有数据</div>
            ) : (
              <div className="px-4 py-4 space-y-4">
                {detail.tip && (
                  <div className="rounded-xl p-3" style={{ background: 'rgba(59,165,93,.07)' }}>
                    <div className="text-[11px] font-bold mb-1" style={{ color: '#2F8F4E' }}>一条线记住它</div>
                    <div className="text-[13px] leading-6" style={{ color: INK }}>{plain(detail.tip)}</div>
                  </div>
                )}
                {detail.confused && (
                  <div className="rounded-xl p-3" style={{ background: 'rgba(232,52,42,.05)' }}>
                    <div className="text-[11px] font-bold mb-1" style={{ color: '#C04A2A' }}>最容易混的两条</div>
                    <div className="text-[13px] leading-6" style={{ color: INK }}>{plain(detail.confused)}</div>
                  </div>
                )}

                <div>
                  <div className="text-[12px] font-bold mb-2" style={{ color: INK2 }}>
                    这个字的 {(detail.lines as Line[]).length} 条路
                  </div>
                  <div className="space-y-2">
                    {(detail.lines as Line[]).map((l, i) => (
                      <div
                        key={i}
                        className="rounded-xl p-3 border"
                        style={{
                          borderColor: l.missed ? 'rgba(232,52,42,.25)' : 'rgba(59,165,93,.25)',
                          background: l.missed ? 'rgba(232,52,42,.03)' : 'rgba(59,165,93,.04)',
                        }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                            style={
                              l.missed
                                ? { background: 'rgba(232,52,42,.1)', color: '#C04A2A' }
                                : { background: 'rgba(59,165,93,.12)', color: '#2F8F4E' }
                            }
                          >
                            {l.missed ? '还没拿下' : '已拿下'}
                          </span>
                          <span className="text-[13px] font-bold" style={{ color: INK }}>{plain(l.def)}</span>
                        </div>
                        <div className="text-[12.5px] leading-6" style={{ color: INK2 }}>{plain(l.sent)}</div>
                        {l.trans && (
                          <div className="text-[12px] leading-5 mt-0.5" style={{ color: '#B08A76' }}>
                            {plain(l.trans)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
