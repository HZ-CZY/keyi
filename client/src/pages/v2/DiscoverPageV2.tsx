import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Check, ChevronLeft, ChevronRight, Copy,
  Quote, RotateCcw, Volume2, VolumeX,
} from 'lucide-react';
import gsap from 'gsap';
import V2PageShell from './components/V2PageShell';
import { api } from '../../lib/api';
import {
  DAILY_QUOTES, cnToday, formatCnDate, quoteOfDay, recentDays, relativeLabel, shiftDay,
} from '../../data/dailyQuotes';
import { DAILY_FIGURES, figureOfDay } from '../../data/dailyFigures';

/**
 * 发现（/discover）— 2026-10-19 全面重设计
 * ────────────────────────────────────────────────────────────
 * 视觉：Apple 风 —— 大圆角、克制的渐变、留白优先、动效只做「物理感」。
 * 动效：GSAP（只进本路由的 chunk，不影响首屏）。
 *   · 进页：卡片按 y+opacity stagger 浮入；
 *   · 切换往期：句子卡轻微下沉再回弹（0.42s）；
 *   · 尊重 prefers-reduced-motion：命中就直接跳过所有动画。
 *
 * 内容：
 *   · 每日一句 + 每日人物（双栏：左引语卡、右人物卡）
 *   · 每日时政（中青网为主 + 新闻联播国家大事，纯文本、不可跳转）
 *   · 往期回顾（近 30 天日期胶囊）
 *
 * 数据：句库在 data/dailyQuotes.ts、人物库在 data/dailyFigures.ts，
 * 均按日期取模轮换；时政由 /api/daily/news 抓取，后端只存标题与摘要、不存链接。
 */

/** 是否开启动效（系统开启「减弱动态效果」时全部跳过） */
function motionOK(): boolean {
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

export default function DiscoverPageV2() {
  const [viewDate, setViewDate] = useState<string>(() => cnToday());
  const [toast, setToast] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [news, setNews] = useState<{ title: string; summary?: string }[]>([]);
  const [newsSource, setNewsSource] = useState('新闻联播');

  const rootRef = useRef<HTMLDivElement>(null);
  const quoteRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  const { quote, index } = useMemo(() => quoteOfDay(viewDate), [viewDate]);
  const { figure, index: figIndex } = useMemo(() => figureOfDay(viewDate), [viewDate]);
  const isToday = viewDate === cnToday();
  const days = useMemo(() => recentDays(30), []);

  /* ── 每日时政：拉一次，失败就整块隐藏 ── */
  useEffect(() => {
    api.dailyNews()
      .then((r) => {
        setNews(r?.items || []);
        if (r?.source) setNewsSource(r.source);
      })
      .catch(() => {});
  }, []);

  /* ── 进页动效：卡片依次浮入 ── */
  useEffect(() => {
    if (!motionOK() || !rootRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from('.dv-reveal', {
        y: 26,
        opacity: 0,
        duration: 0.72,
        ease: 'power3.out',
        stagger: 0.085,
        clearProps: 'transform,opacity',
      });
    }, rootRef);
    return () => ctx.revert();
  }, []);

  /* ── 切换往期时，句子卡重新入场的微动效 ── */
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!motionOK() || !quoteRef.current) return;
    gsap.fromTo(
      quoteRef.current,
      { opacity: 0.35, y: 10 },
      { opacity: 1, y: 0, duration: 0.42, ease: 'power2.out', clearProps: 'transform,opacity' }
    );
  }, [viewDate]);

  /* ── toast 自动消失 ── */
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 2000);
    return () => window.clearTimeout(t);
  }, [toast]);

  /* ── 切日期时停止朗读 ── */
  useEffect(() => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (synth) synth.cancel();
    setSpeaking(false);
  }, [viewDate]);

  function getSynth(): SpeechSynthesis | null {
    return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  }

  function speak() {
    const synth = getSynth();
    if (!synth) {
      setToast('当前浏览器不支持语音朗读');
      return;
    }
    if (synth.speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(quote.en);
    u.lang = 'en-US';
    u.rate = 0.9;
    const voice = synth.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
    if (voice) u.voice = voice;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(u);
  }

  async function copyText() {
    const text = `${quote.en}\n${quote.zh}\n—— ${quote.by}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setToast('复制失败，请手动选择文本');
    }
  }

  return (
    <V2PageShell title="发现">
      <div ref={rootRef} className="max-w-2xl md:max-w-3xl lg:max-w-4xl mx-auto pb-6">
        {/* ══════════ 每日一句 + 每日人物（双栏） ══════════ */}
        <div className="dv-reveal grid grid-cols-1 sm:grid-cols-[1.32fr_1fr] gap-3 items-stretch">
        {/* 左：每日一句 —— 白玻璃 + 左侧细竖线，去掉紫色渐变与柔光 */}
        <div className="relative overflow-hidden rounded-[22px] bg-white border border-slate-200/60 px-5 pt-5 pb-5">
          <span className="absolute left-0 top-7 bottom-7 w-[3px] rounded-r-full bg-[#3B6BE8]/75" />

          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
              <Quote className="w-3 h-3 text-slate-300" strokeWidth={2.4} />
              Daily Quote
            </span>
            <span className="text-[11.5px] font-medium text-slate-400 tabular-nums">{formatCnDate(viewDate)}</span>
          </div>

          <div ref={quoteRef} className="mt-3.5">
            <p className="text-[20px] lg:text-[22px] leading-[1.5] font-semibold tracking-[-0.01em] text-slate-900">
              {quote.en}
            </p>
            <p className="mt-3 text-[13.5px] leading-[1.75] text-slate-500">{quote.zh}</p>
            <p className="mt-2.5 text-[12px] text-slate-400">—— {quote.by}</p>
          </div>

          {quote.key && quote.key.length > 0 && (
            <p className="mt-3.5 text-[11.5px] leading-6 text-slate-400">
              {quote.key.map((k, i) => (
                <span key={k.w}>
                  {i > 0 && <span className="mx-1.5 text-slate-300">·</span>}
                  <b className="font-semibold text-slate-600">{k.w}</b>
                  <span className="ml-1">{k.zh}</span>
                </span>
              ))}
            </p>
          )}

          <div className="mt-4 flex items-center justify-between">
            <span className="text-[10.5px] font-medium text-slate-400 tabular-nums">
              第 {index + 1} 句 / 共 {DAILY_QUOTES.length} 句
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={speak}
                className="h-8 px-3 rounded-full border border-slate-200 text-[11.5px] font-medium text-slate-600 inline-flex items-center gap-1.5 active:scale-95 transition-transform"
              >
                {speaking ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                {speaking ? '停止' : '朗读'}
              </button>
              <button
                type="button"
                onClick={copyText}
                aria-label="复制整句"
                className="w-8 h-8 rounded-full border border-slate-200 grid place-items-center text-slate-500 active:scale-95 transition-transform"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {/* 右：每日人物 */}
        <div className="relative overflow-hidden rounded-[22px] bg-white border border-slate-200/60 px-5 pt-5 pb-5 flex flex-col">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Daily Figure</span>
            <span className="text-[10.5px] font-medium text-slate-400">{figure.tag}</span>
          </div>
          <div className="relative mt-4">
            <p className="text-[22px] lg:text-[24px] font-bold leading-tight text-slate-900">{figure.name}</p>
            <p className="mt-1 text-[11.5px] font-medium text-slate-400">{figure.title}</p>
          </div>
          <p className="mt-3 flex-1 text-[12.5px] leading-[1.72] text-slate-500">“{figure.quote}”</p>
          <p className="mt-3 text-[10px] font-medium text-slate-300 tabular-nums">
            第 {figIndex + 1} 位 / 共 {DAILY_FIGURES.length} 位
          </p>
        </div>
        </div>

        {/* ══════════ 每日时政 ══════════ */}
        {news.length > 0 && (
          <section className="dv-reveal mt-7">
            <div className="flex items-baseline justify-between px-1 mb-2.5">
              <h2 className="text-[17px] font-black tracking-tight text-slate-900">每日时政</h2>
              <span className="text-[11px] font-semibold text-slate-400">来源：{newsSource}</span>
            </div>
            <div className="rounded-[22px] bg-white border border-slate-200/60 overflow-hidden">
              {news.map((n, i) => (
                <div
                  key={`${i}-${n.title.slice(0, 8)}`}
                  className="flex gap-3 px-4 py-3.5 border-t border-slate-100/80 first:border-t-0"
                >
                  <span className="shrink-0 w-4 mt-[3px] text-[11px] font-semibold text-slate-300 tabular-nums">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13.5px] leading-[1.55] text-slate-700">{n.title}</p>
                    {n.summary && (
                      <p
                        className="mt-1 text-[11.5px] leading-[1.6] text-slate-400 overflow-hidden"
                        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } as CSSProperties}
                      >
                        {n.summary}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 px-1 text-[10.5px] text-slate-400">仅展示标题与摘要节选 · 不提供跳转</p>
          </section>
        )}

        {/* ══════════ 往期回顾 ══════════ */}
        <section className="dv-reveal mt-7">
          <div className="flex items-baseline justify-between px-1 mb-2.5">
            <h2 className="text-[17px] font-black tracking-tight text-slate-900">往期回顾</h2>
            {!isToday && (
              <button
                type="button"
                onClick={() => setViewDate(cnToday())}
                className="inline-flex items-center gap-1 text-[12px] font-bold text-[#3B6BE8] active:scale-95 transition-transform"
              >
                <RotateCcw className="w-3.5 h-3.5" /> 回到今天
              </button>
            )}
          </div>

          <div className="rounded-[26px] bg-white border border-white/70 shadow-[0_12px_34px_-18px_rgba(38,60,110,0.22)] px-4 py-4">
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {days.map((d) => {
                const active = d === viewDate;
                const [, m, dd] = d.split('-');
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setViewDate(d)}
                    className={`shrink-0 w-[58px] py-2 rounded-2xl text-center transition-all active:scale-95 ${
                      active
                        ? 'text-white shadow-[0_10px_22px_-10px_rgba(59,107,232,0.9)]'
                        : 'bg-slate-50 text-slate-600'
                    }`}
                    style={active ? { background: 'linear-gradient(135deg,#5B8BF5,#3B6BE8)' } : undefined}
                  >
                    <span className="block text-[13px] font-black leading-none tabular-nums">
                      {parseInt(m, 10)}/{parseInt(dd, 10)}
                    </span>
                    <span className={`block text-[10px] mt-1 ${active ? 'text-white/75' : 'text-slate-400'}`}>
                      {relativeLabel(d)}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setViewDate(shiftDay(viewDate, -1))}
                className="flex-1 h-10 rounded-2xl bg-slate-50 text-slate-600 text-[12.5px] font-bold inline-flex items-center justify-center gap-1 active:scale-[0.98] transition-transform"
              >
                <ChevronLeft className="w-4 h-4" /> 上一句
              </button>
              <button
                type="button"
                onClick={() => setViewDate(shiftDay(viewDate, 1))}
                disabled={isToday}
                className="flex-1 h-10 rounded-2xl bg-slate-50 text-slate-600 text-[12.5px] font-bold inline-flex items-center justify-center gap-1 active:scale-[0.98] transition-transform disabled:opacity-40"
              >
                下一句 <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>

        <p className="mt-6 text-center text-[10.5px] text-slate-400">句子按日期轮换 · 同一天全站同一句</p>
      </div>

      {/* toast */}
      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-50 px-4 py-2.5 rounded-2xl bg-slate-900/90 text-white text-[12.5px] font-semibold shadow-lg max-w-[80vw] text-center backdrop-blur">
          {toast}
        </div>
      )}
    </V2PageShell>
  );
}
