import { useEffect, useState, useCallback } from 'react';
import { Search, X, ChevronLeft, BookOpen, Loader2 } from 'lucide-react';
import V2PageShell from './components/V2PageShell';
import { api } from '../../lib/api';

/**
 * 阅读板块 —— 文言文内容库。
 *
 * 【2026-09-28 新增】方案 A：列表 + 沉浸式阅读。
 *   - 列表：关键词搜索、朝代筛选、排序、分页加载
 *   - 详情：整篇阅读（正文/译文/注释/赏析/创作背景，可折叠）
 *   - 复用 v2 视觉体系（V2PageShell + 玻璃态）
 */

interface ReadingItem {
  id: number;
  title: string;
  author: string;
  dynasty: string;
  word_count: number;
  excerpt: string;
}

interface ReadingDetail extends ReadingItem {
  content: string;
  translation: string;
  annotation: string;
  appreciation: string;
  background: string;
}

type TabKey = 'content' | 'translation' | 'annotation' | 'appreciation' | 'background';

export default function ReadingPageV2() {
  const [items, setItems] = useState<ReadingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [dynasty, setDynasty] = useState('');
  const [sort, setSort] = useState<'default' | 'words' | 'title'>('default');
  const [dynasties, setDynasties] = useState<{ dynasty: string; count: number }[]>([]);

  const [detail, setDetail] = useState<ReadingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState<TabKey>('content');
  const [fontSize, setFontSize] = useState(17);

  const PAGE_SIZE = 20;

  // 元信息（朝代聚合）
  useEffect(() => {
    api.content.readingMeta().then(m => setDynasties(m.dynasties)).catch(() => {});
  }, []);

  // 列表加载（page 变化或筛选变化时重置）
  const load = useCallback(async (nextPage: number, append: boolean) => {
    setLoading(true);
    try {
      const r = await api.content.readings({ q, dynasty, page: nextPage, limit: PAGE_SIZE, sort });
      setTotal(r.total);
      setItems(prev => (append ? [...prev, ...r.items] : r.items));
    } catch {
      if (!append) setItems([]);
    } finally {
      setLoading(false);
    }
  }, [q, dynasty, sort]);

  useEffect(() => {
    setPage(1);
    load(1, false);
  }, [load]);

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    setTab('content');
    try {
      const d = await api.content.readingDetail(id);
      setDetail(d);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      /* ignore */
    } finally {
      setDetailLoading(false);
    }
  };

  // ─────────── 详情视图 ───────────
  if (detail || detailLoading) {
    const tabs: { key: TabKey; label: string }[] = ([
      { key: 'translation', label: '译文' },
      { key: 'annotation', label: '注释' },
      { key: 'appreciation', label: '赏析' },
      { key: 'background', label: '创作背景' },
    ] as { key: TabKey; label: string }[]).filter(t => detail && (detail as any)[t.key]);

    return (
      <V2PageShell title="阅读">
        <button
          onClick={() => { setDetail(null); }}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> 返回列表
        </button>

        {detailLoading && !detail ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中…
          </div>
        ) : detail && (
          <article className="glass rounded-3xl shadow-sm p-6 md:p-10 max-w-3xl mx-auto mb-8">
            {/* 标题 */}
            <header className="text-center mb-8">
              <h1 className="text-2xl md:text-3xl font-bold text-slate-800 mb-2">{detail.title}</h1>
              <p className="text-sm text-slate-400">
                {detail.author}
                {detail.dynasty ? `〔${detail.dynasty}〕` : ''}
                <span className="mx-2">·</span>
                约 {detail.word_count} 字
              </p>
            </header>

            {/* 正文 */}
            <div
              className="leading-loose text-slate-700 whitespace-pre-wrap tracking-wide"
              style={{ fontSize: `${fontSize}px`, lineHeight: 2.1 }}
            >
              {detail.content}
            </div>

            {/* 字号调节 */}
            <div className="flex items-center justify-center gap-3 my-6 text-slate-400">
              <button
                onClick={() => setFontSize(s => Math.max(14, s - 1))}
                className="w-8 h-8 rounded-full glass flex items-center justify-center hover:scale-105 transition-transform text-sm font-bold"
              >A-</button>
              <span className="text-xs">{fontSize}px</span>
              <button
                onClick={() => setFontSize(s => Math.min(26, s + 1))}
                className="w-8 h-8 rounded-full glass flex items-center justify-center hover:scale-105 transition-transform text-sm font-bold"
              >A+</button>
            </div>

            {/* 译文/注释/赏析/背景 */}
            {tabs.length > 0 && (
              <div className="mt-8 pt-6 border-t border-slate-200/60">
                <div className="flex flex-wrap gap-2 mb-4">
                  {tabs.map(t => (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      className={`px-4 py-1.5 rounded-full text-sm transition-all ${
                        tab === t.key
                          ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-sm'
                          : 'glass text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="text-slate-600 leading-relaxed whitespace-pre-wrap text-[15px]" style={{ lineHeight: 1.9 }}>
                  {(detail as any)[tab] || '暂无'}
                </div>
              </div>
            )}

            <p className="mt-10 text-xs text-slate-300 text-center">内容来源：古诗文网</p>
          </article>
        )}
      </V2PageShell>
    );
  }

  // ─────────── 列表视图 ───────────
  return (
    <V2PageShell title="阅读">
      {/* 搜索框 */}
      <div className="mb-4 max-w-3xl mx-auto">
        <div className="glass rounded-2xl flex items-center gap-2 px-4 py-2.5 shadow-sm">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            value={qInput}
            onChange={e => setQInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') setQ(qInput.trim()); }}
            placeholder="搜索篇名、作者或正文…"
            className="flex-1 bg-transparent outline-none text-sm text-slate-700 placeholder:text-slate-400"
          />
          {qInput && (
            <button onClick={() => { setQInput(''); setQ(''); }} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setQ(qInput.trim())}
            className="px-3 py-1 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-xs font-medium"
          >搜索</button>
        </div>

        {/* 朝代筛选 */}
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            onClick={() => setDynasty('')}
            className={`px-3 py-1 rounded-full text-xs transition-all ${
              dynasty === '' ? 'bg-slate-700 text-white' : 'glass text-slate-500 hover:text-slate-700'
            }`}
          >全部 {total}</button>
          {dynasties.map(d => (
            <button
              key={d.dynasty}
              onClick={() => setDynasty(d.dynasty)}
              className={`px-3 py-1 rounded-full text-xs transition-all ${
                dynasty === d.dynasty ? 'bg-slate-700 text-white' : 'glass text-slate-500 hover:text-slate-700'
              }`}
            >{d.dynasty} {d.count}</button>
          ))}
        </div>

        {/* 排序 */}
        <div className="flex items-center gap-2 mt-3 text-xs text-slate-400">
          <span>排序：</span>
          {([['default', '默认'], ['words', '字数'], ['title', '篇名']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`px-2.5 py-1 rounded-full transition-all ${
                sort === k ? 'bg-slate-700 text-white' : 'hover:text-slate-600'
              }`}
            >{label}</button>
          ))}
        </div>
      </div>

      {/* 列表 */}
      <div className="max-w-3xl mx-auto space-y-3">
        {items.map(it => (
          <button
            key={it.id}
            onClick={() => openDetail(it.id)}
            className="w-full text-left glass rounded-2xl p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-800 truncate">{it.title}</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {it.author}{it.dynasty ? `〔${it.dynasty}〕` : ''} · 约 {it.word_count} 字
                </p>
                <p className="text-sm text-slate-500 mt-1.5 line-clamp-2 leading-relaxed">{it.excerpt}…</p>
              </div>
              <BookOpen className="w-4 h-4 text-slate-300 shrink-0 mt-1" />
            </div>
          </button>
        ))}

        {!loading && items.length === 0 && (
          <div className="text-center py-20 text-slate-400 text-sm">没有找到相关篇目</div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-8 text-slate-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> 加载中…
          </div>
        )}

        {!loading && items.length > 0 && items.length < total && (
          <button
            onClick={() => { const np = page + 1; setPage(np); load(np, true); }}
            className="w-full py-3 rounded-2xl glass text-sm text-slate-500 hover:text-slate-700 transition-all"
          >加载更多（{items.length} / {total}）</button>
        )}
      </div>
    </V2PageShell>
  );
}
