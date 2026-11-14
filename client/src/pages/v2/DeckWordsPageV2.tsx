import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Search, ArrowUpDown, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { renderMarkup } from '../../lib/markup';

/**
 * 牌组单词列表页（2026-10-10 新增）
 * ---------------------------------------------------------------
 * 入口：首页学习卡片上的牌组名（StudyShortcut）点击进入。
 * 数据：GET /api/cards/deck/:deckId —— 返回该牌组全部卡片，
 *       含 cards.*（queue/due/interval/reps/lapses）+ notes.fields/tags。
 *
 * 卡片状态（沿用 Anki 队列语义，与 /decks 列表页的统计口径一致）：
 *   queue=0            → 未学习（新卡）
 *   queue=1 或 3       → 学习中（relearning / learning）
 *   queue=2            → 复习中：due 已过 = 已逾期，否则 = 下次复习
 *
 * 顶部筛选标签：全部 / 今日 / 未学习 / 学习中 / 已逾期
 *   「已熟」「已新」在图二里也有，但本站没有对应数据口径 ——
 *   Anki 的熟度体现在 interval 上，不是独立队列。为不造假数据，
 *   这里只做「已逾期」，并把 interval 直接展示在行内（下次复习 x 天后）。
 */

interface CardRow {
  id: number;
  queue: number;
  due: number;
  interval: number;
  reps: number;
  lapses: number;
  fields: string; // JSON 字符串
  tags: string;
}

interface DeckInfo {
  id: number;
  name: string;
  card_count?: number;
  new_count?: number;
  learning_count?: number;
  review_count?: number;
}

type FilterKey = 'all' | 'today' | 'new' | 'learning' | 'overdue';
type SortKey = 'default' | 'due' | 'status';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'today', label: '今日' },
  { key: 'new', label: '未学习' },
  { key: 'learning', label: '学习中' },
  { key: 'overdue', label: '已逾期' },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'default', label: '按课序默认排序' },
  { key: 'due', label: '按到期时间' },
  { key: 'status', label: '按学习状态' },
];

/** 卡片状态机：把 queue/due 归一成前端要展示的三种态 */
function statusOf(card: CardRow, now: number): 'new' | 'learning' | 'review' | 'overdue' {
  if (card.queue === 0) return 'new';
  if (card.queue === 1 || card.queue === 3) return 'learning';
  if (card.queue === 2) return card.due <= now ? 'overdue' : 'review';
  return 'review';
}

/** 相对时间文案（只用于「已逾期」与「下次复习」两处） */
function dueText(card: CardRow, now: number): string {
  const diff = card.due - now; // 秒，正数=未来
  const days = Math.round(Math.abs(diff) / 86400);
  if (diff <= 0) {
    if (Math.abs(diff) < 3600) return '已逾期';
    return days >= 1 ? `已逾期 ${days} 天` : '已逾期';
  }
  if (days < 1) return '今日复习';
  return `下次复习：${days} 天后`;
}

/** fields 容错解析：优先 JSON，退回 \x1f 分隔（历史数据两种都可能有） */
function parseFields(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.map((x) => String(x ?? ''));
  } catch {
    /* 落到下面的分隔符分支 */
  }
  return String(raw ?? '').split('\x1f');
}

/** 把可能含 HTML 的字段剥成纯文本（搜索用，避免把标签也搜进去） */
function toPlain(html: string): string {
  return String(html ?? '').replace(/<[^>]*>/g, ' ');
}

function Row({
  index,
  front,
  back,
  status,
  dueLabel,
  onOpen,
}: {
  index: number;
  front: string;
  back: string;
  status: 'new' | 'learning' | 'review' | 'overdue';
  dueLabel: string;
  onOpen: () => void;
}) {
  const dotCls =
    status === 'new' ? 'bg-slate-300'
    : status === 'learning' ? 'bg-amber-400'
    : status === 'overdue' ? 'bg-rose-500'
    : 'bg-[#3B6BE8]';

  const rightCls =
    status === 'overdue' ? 'text-rose-500'
    : status === 'new' ? 'text-slate-400'
    : status === 'learning' ? 'text-amber-600'
    : 'text-slate-400';

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay: Math.min(index, 12) * 0.015 }}
      className="w-full text-left bg-white hover:bg-slate-50/80 active:bg-slate-100/70 transition-colors border-b border-slate-100 last:border-b-0"
    >
      <div className="flex items-start gap-2.5 px-4 py-3">
        <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${dotCls}`} />
        <div className="min-w-0 flex-1">
          <div
            className="text-[15px] font-semibold text-slate-800 leading-6 break-words"
            dangerouslySetInnerHTML={{ __html: front }}
          />
          <div
            className="mt-0.5 text-[12.5px] text-slate-500 leading-5 break-words"
            dangerouslySetInnerHTML={{ __html: back }}
          />
        </div>
        <div className="shrink-0 flex items-center gap-0.5 pt-0.5">
          <span className={`text-[11.5px] tabular-nums ${rightCls}`}>{dueLabel}</span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
        </div>
      </div>
    </motion.button>
  );
}

export default function DeckWordsPageV2() {
  const { deckId } = useParams<{ deckId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [deck, setDeck] = useState<DeckInfo | null>(null);
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sort, setSort] = useState<SortKey>('default');
  const [showSort, setShowSort] = useState(false);
  const [q, setQ] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const id = Number(deckId);

  useEffect(() => {
    if (!user || !id) return;
    let alive = true;
    // 牌组元信息（名称、统计）与卡片列表并行拉取
    Promise.all([
      api.decks.list().then((list: DeckInfo[]) => list.find((d) => d.id === id) || null).catch(() => null),
      api.cards.deckCards(id).catch((e: Error) => { throw e; }),
    ])
      .then(([info, rows]) => {
        if (!alive) return;
        setDeck(info);
        setCards(Array.isArray(rows) ? (rows as CardRow[]) : []);
        setError(null);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message || '加载失败');
      });
    return () => { alive = false; };
  }, [user, id]);

  // now 每次渲染取一次即可（列表页不需要秒级刷新）
  const now = Math.floor(Date.now() / 1000);

  /** 预计算每张卡的展示数据，避免在 render 里反复解析 fields */
  const rows = useMemo(() => {
    if (!cards) return [];
    return cards.map((c) => {
      const f = parseFields(c.fields);
      const status = statusOf(c, now);
      return {
        card: c,
        status,
        // 正面：原文（含 **重点** 标记）；背面：释义（fields[1]）
        frontHtml: renderMarkup(f[0] || ''),
        backHtml: renderMarkup(f[1] || ''),
        plain: (toPlain(f[0]) + ' ' + toPlain(f[1])).toLowerCase(),
        dueLabel: status === 'new' ? '新' : status === 'learning' ? '学习中' : dueText(c, now),
      };
    });
  }, [cards, now]);

  // 各筛选标签的计数（用于标签上的小数字）
  const counts = useMemo(() => {
    const base = { all: rows.length, today: 0, new: 0, learning: 0, overdue: 0 };
    for (const r of rows) {
      if (r.status === 'new') base.new += 1;
      else if (r.status === 'learning') base.learning += 1;
      else if (r.status === 'overdue') { base.overdue += 1; base.today += 1; }
      else if (r.card.queue === 2 && r.card.due <= now + 86400) base.today += 1;
    }
    return base;
  }, [rows, now]);

  const visible = useMemo(() => {
    let list = rows;
    if (filter === 'new') list = list.filter((r) => r.status === 'new');
    else if (filter === 'learning') list = list.filter((r) => r.status === 'learning');
    else if (filter === 'overdue') list = list.filter((r) => r.status === 'overdue');
    else if (filter === 'today') {
      list = list.filter((r) => r.status === 'overdue' || (r.card.queue === 2 && r.card.due <= now + 86400));
    }
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((r) => r.plain.includes(needle));
    }
    if (sort === 'due') {
      list = [...list].sort((a, b) => a.card.due - b.card.due);
    } else if (sort === 'status') {
      const rank: Record<string, number> = { overdue: 0, new: 1, learning: 2, review: 3 };
      list = [...list].sort((a, b) => rank[a.status] - rank[b.status]);
    }
    return list;
  }, [rows, filter, q, sort, now]);

  const deckName = deck?.name || '单词列表';

  return (
    <div className="min-h-screen bg-[#f2f6fc] pb-28">
      {/* 顶栏 */}
      <header className="sticky top-0 z-30 bg-white/92 backdrop-blur-md border-b border-slate-200/70">
        <div className="max-w-2xl mx-auto flex items-center gap-2 px-3 h-14">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-slate-600 hover:bg-slate-100 active:scale-95 transition"
            aria-label="返回"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="flex-1 text-center text-[16px] font-bold text-slate-800 truncate">{deckName}</h1>
          <button
            onClick={() => { setShowSearch((v) => !v); if (showSearch) setQ(''); }}
            className="w-9 h-9 rounded-full flex items-center justify-center text-slate-600 hover:bg-slate-100 active:scale-95 transition"
            aria-label="搜索"
          >
            <Search className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* 搜索框（点放大镜展开） */}
        {showSearch && (
          <div className="max-w-2xl mx-auto px-3 pb-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索原文或释义…"
                className="w-full h-10 rounded-xl bg-slate-100 pl-9 pr-9 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#3B6BE8]/30"
              />
              {q && (
                <button
                  onClick={() => setQ('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label="清空"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* 筛选标签 */}
        <div className="max-w-2xl mx-auto px-3 pb-2 overflow-x-auto">
          <div className="flex items-center gap-2 w-max">
            {FILTERS.map((f) => {
              const on = filter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`px-3.5 h-8 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors ${
                    on ? 'bg-[#3B6BE8] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200/70'
                  }`}
                >
                  {f.label}
                  <span className={`ml-1 tabular-nums ${on ? 'text-white/80' : 'text-slate-400'}`}>
                    {counts[f.key]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* 统计条 + 排序 */}
      <div className="max-w-2xl mx-auto px-4 pt-3 pb-2 flex items-center justify-between">
        <p className="text-[12.5px] text-slate-500">
          共 <b className="text-slate-700 tabular-nums">{visible.length}</b> 词
          {q.trim() ? <span className="text-slate-400">（筛选自 {rows.length} 词）</span> : null}
        </p>
        <div className="relative">
          <button
            onClick={() => setShowSort((v) => !v)}
            className="flex items-center gap-1 text-[12.5px] text-slate-500 hover:text-slate-700 transition-colors"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            {SORTS.find((s) => s.key === sort)?.label}
          </button>
          {showSort && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowSort(false)} />
              <div className="absolute right-0 top-7 z-40 w-40 rounded-xl bg-white shadow-[0_10px_30px_rgba(30,60,110,0.18)] ring-1 ring-slate-200/70 py-1 overflow-hidden">
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => { setSort(s.key); setShowSort(false); }}
                    className={`w-full text-left px-3 py-2 text-[12.5px] transition-colors ${
                      sort === s.key ? 'text-[#3B6BE8] font-semibold bg-blue-50/60' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 列表 */}
      <main className="max-w-2xl mx-auto px-3 pb-6">
        {error ? (
          <div className="rounded-2xl bg-white py-16 text-center text-sm text-slate-400">{error}</div>
        ) : cards === null ? (
          <div className="rounded-2xl bg-white py-16 text-center text-sm text-slate-400">加载中…</div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl bg-white py-16 text-center">
            <p className="text-sm text-slate-400">
              {q.trim() ? '没有匹配的词' : '这个筛选下还没有词'}
            </p>
          </div>
        ) : (
          <div className="rounded-2xl bg-white overflow-hidden shadow-[0_2px_12px_rgba(30,60,110,0.06)]">
            {visible.map((r, i) => (
              <Row
                key={r.card.id}
                index={i}
                front={r.frontHtml}
                back={r.backHtml}
                status={r.status}
                dueLabel={r.dueLabel}
                onOpen={() => navigate(`/study/${id}`)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
