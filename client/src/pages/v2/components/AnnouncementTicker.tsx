import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Megaphone, Sparkles, X } from 'lucide-react';
import { api } from '../../../lib/api';
import AnnouncementRichText, { announcementPlainText } from '../../../components/AnnouncementRichText';

/**
 * 首页顶部公告滚动播报（横向跑马灯 · 无缝循环）
 *
 * - 数据源：GET /api/announcements/ticker（公开接口，只返回 published=1 的公告，最新在前）
 * - 播报内容：标题 + 正文全文（富文本用 announcementPlainText 剥成纯文本，与后台所见一致）
 * - 无缝原理：轨道里放两份完全相同的文本，CSS 动画 0 → -50%（见 index.css 的 .ann-marquee-track）
 * - 速度恒定：按实测宽度算一轮时长（PX_PER_SEC 像素/秒），长文案不会飞速掠过
 * - 点击整条 → 弹出公告详情（玻璃态卡片，多条时可左右切换）
 */

/** 播报条数：最新 N 条已发布公告（发新公告自动排在最前） */
const TICKER_LIMIT = 3;
/** 滚动速度（像素/秒）—— 调大滚得更快（80 → 100 于 2026-09-14 按用户要求加快一点点） */
const PX_PER_SEC = 100;
/** 最短一轮时长（秒）：文案很短时也不至于一闪而过 */
const MIN_DURATION = 24;
/** 列表自动刷新间隔：发新公告后最多 5 分钟进入播报 */
const REFRESH_MS = 5 * 60 * 1000;

function formatDate(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function AnnouncementTicker() {
  const [items, setItems] = useState<any[]>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [duration, setDuration] = useState(45);
  const trackRef = useRef<HTMLSpanElement | null>(null);

  // ── 拉取已发布公告（未登录也能看到，与弹窗的「已读过滤」逻辑独立） ──
  useEffect(() => {
    let alive = true;
    const load = () => {
      api.announcements
        .ticker(TICKER_LIMIT)
        .then((d) => {
          if (alive && Array.isArray(d)) setItems(d);
        })
        .catch(() => {
          /* 静默失败：拿不到公告就不显示播报条，不打扰用户 */
        });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  // 标题 + 正文全文（纯文本）
  const entries = useMemo(
    () =>
      items.map((a) => ({
        ...a,
        plain: announcementPlainText(a.content),
      })),
    [items]
  );

  // ── 按实测宽度算一轮时长（含字体加载完成后的重测） ──
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => {
      const oneCopyWidth = el.scrollWidth / 2; // 轨道内含两份相同内容
      if (!oneCopyWidth) return;
      setDuration(Math.max(MIN_DURATION, oneCopyWidth / PX_PER_SEC));
    };
    measure();
    window.addEventListener('resize', measure);
    // 中文字体异步加载完成后宽度会变，需要重测
    document.fonts?.ready.then(measure).catch(() => {});
    return () => window.removeEventListener('resize', measure);
  }, [entries]);

  if (entries.length === 0) return null;

  const open = openIndex !== null ? entries[openIndex] : null;

  /** 渲染一份播报内容（两份完全一致才能无缝衔接） */
  const renderCopy = (key: string, hidden: boolean) => (
    <span
      key={key}
      className="ann-marquee-text inline-flex items-center text-[13px] sm:text-sm text-slate-900"
      aria-hidden={hidden || undefined}
    >
      {entries.map((a, i) => (
        <span key={a.id} className="inline-flex items-center">
          {i > 0 && (
            <span className="select-none px-4 text-[11px] text-blue-500/80">✦</span>
          )}
          <span className={`ann-marquee-title font-semibold ${
            /紧急|停服|故障/.test(a.title) ? 'text-red-600' : 'text-blue-700'
          }`}>{a.title}</span>
          {a.plain && <span className="pl-2">{a.plain}</span>}
        </span>
      ))}
      {/* 尾部留白：保证两份内容之间的间隔一致，循环处不粘连 */}
      <span className="inline-block w-12 shrink-0" aria-hidden="true" />
    </span>
  );

  return (
    <>
      {/* 播报条：顶栏下方、主体内容上方，整行通栏胶囊 */}
      <div className="px-4 md:px-8 pb-3">
        <button
          type="button"
          onClick={() => setOpenIndex(0)}
          title="点击查看公告全文"
          aria-label="公告滚动播报，点击查看全文"
          className="ann-marquee relative flex h-9 w-full items-center gap-2.5 overflow-hidden rounded-full keyi-glass px-3.5 text-left active:scale-[0.995] transition-transform"
        >
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-bold text-blue-600">
            <Megaphone className="h-3.5 w-3.5" />
            公告
          </span>
          <span className="ann-marquee-divider h-3.5 w-px shrink-0 bg-slate-300/70" />
          <span className="ann-marquee-viewport relative min-w-0 flex-1 overflow-hidden">
            <span
              ref={trackRef}
              className="ann-marquee-track"
              style={{ animationDuration: `${duration}s` }}
            >
              {renderCopy('a', false)}
              {renderCopy('b', true)}
            </span>
          </span>
        </button>
      </div>

      {/* 公告详情弹窗（复用全站公告弹窗的玻璃态视觉） */}
      {open && (
        <div
          className="fixed inset-0 z-[98] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpenIndex(null);
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-[1.75rem] bg-white shadow-[0_28px_80px_rgba(30,41,82,0.30)] ring-1 ring-white/60 dark:bg-slate-800">
            {/* 顶部渐变横幅 */}
            <div className="relative overflow-hidden bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700 px-6 pb-6 pt-5 text-white">
              <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/15 blur-2xl" />
              <button
                onClick={() => setOpenIndex(null)}
                aria-label="关闭公告"
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white/90 transition-all hover:bg-white/30 hover:text-white"
              >
                <X style={{ width: 18, height: 18 }} />
              </button>
              <div className="relative">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-[11px] font-semibold tracking-wider text-white shadow-sm backdrop-blur">
                  <Megaphone style={{ width: 13, height: 13 }} />
                  系统公告
                </span>
                <h3 className="mt-3 pr-10 text-[21px] font-bold leading-snug drop-shadow-sm">
                  {open.title}
                </h3>
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-white/75">
                  <Sparkles style={{ width: 12, height: 12 }} />
                  {formatDate(open.created_at)}
                </p>
              </div>
            </div>

            {/* 正文：与后台编辑器所见一致 */}
            <div className="max-h-[58vh] overflow-y-auto px-6 py-5">
              <AnnouncementRichText
                html={open.content}
                className="text-[14px] leading-relaxed text-slate-700 dark:text-slate-200"
              />
            </div>

            {/* 多条公告时可切换 */}
            {entries.length > 1 && (
              <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-700">
                <button
                  onClick={() =>
                    setOpenIndex((i) => ((i ?? 0) - 1 + entries.length) % entries.length)
                  }
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                  上一条
                </button>
                <span className="text-[12px] tabular-nums text-slate-400">
                  {(openIndex ?? 0) + 1} / {entries.length}
                </span>
                <button
                  onClick={() => setOpenIndex((i) => ((i ?? 0) + 1) % entries.length)}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  下一条
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
