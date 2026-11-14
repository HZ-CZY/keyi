import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ChevronLeft, Loader2, RotateCcw, Palette } from 'lucide-react';
import { api } from '../../lib/api';
import WordnetPaletteControls from '../../components/WordnetPaletteControls';
import { applyPaletteFromSetting } from '../../lib/wordnetPalette';

/* ============================================================
 * 常量：数值约束 / 默认值 / 封面渐变
 * ============================================================ */

/** 每日组数取值范围 */
const MIN_GROUPS = 1;
const MAX_GROUPS = 10;

/** 每组词数取值范围 */
const MIN_PER_SESSION = 1;
const MAX_PER_SESSION = 30;

/** 「重置」按钮恢复的本页默认计划 */
const DEFAULT_GROUPS = 4;
const DEFAULT_PER_SESSION = 20;

/** 滚轮单行高度（px），与参考图对齐 */
const ROW_HEIGHT = 44;

/** 卡组封面预设渐变（按卡组 id 取模轮换，保证同一卡组颜色稳定） */
const COVER_GRADIENTS: string[] = [
  'from-orange-400 to-orange-600',
  'from-blue-400 to-blue-600',
  'from-emerald-400 to-emerald-600',
  'from-purple-400 to-purple-600',
  'from-rose-400 to-rose-600',
];

/** 上下渐隐遮罩：让滚轮上下边缘淡出，突出中间选中行 */
const FADE_MASK =
  'linear-gradient(to bottom, transparent 0%, black 30%, black 70%, transparent 100%)';

const fadeMaskStyle: CSSProperties = {
  maskImage: FADE_MASK,
  WebkitMaskImage: FADE_MASK,
};

/** 把数值限制在 [min, max] 区间内 */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/* ============================================================
 * PlanWheel —— 双列联动滚轮
 *   左列：真实滚动（snap + 滚动停止后自动对齐 + 鼠标滚轮逐格 + 点击跳转）
 *   右列：伪滚动，由左列选中下标驱动 translateY，不可滚动、不响应滚轮
 * ============================================================ */

interface PlanWheelProps {
  /** 左列每一行显示的文案，数组长度即选项个数 */
  values: string[];
  /** 右列每一行显示的文案，与 values 等长，随左列选中行联动 */
  linked: string[];
  /** 当前选中行下标（受控） */
  index: number;
  /** 选中行变化回调 */
  onChange: (index: number) => void;
  /** 单行高度，默认 44px */
  rowHeight?: number;
  /** 可见行数，默认 5 行 */
  visibleRows?: number;
}

function PlanWheel({
  values,
  linked,
  index,
  onChange,
  rowHeight = ROW_HEIGHT,
  visibleRows = 5,
}: PlanWheelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /** rAF 节流标记：一帧内只处理一次 scroll */
  const tickingRef = useRef<boolean>(false);
  /** 停止滚动后的对齐定时器（120ms 防抖） */
  const alignTimerRef = useRef<number | null>(null);
  /** 最近一次由本组件内部滚动产生的下标 —— 用于避免外部 index 回灌时重复滚动 */
  const lastEmittedRef = useRef<number>(-1);

  const count = values.length;
  /** 容器可视高度 */
  const boxHeight = rowHeight * visibleRows;
  /** 上下占位高度：使第 0 行正好落在正中高亮条上 */
  const pad = ((visibleRows - 1) * rowHeight) / 2;
  /** 正中高亮条的顶部偏移 */
  const centerTop = pad;

  /** 滚到指定行（平滑） */
  const goTo = useCallback(
    (i: number, behavior: ScrollBehavior = 'smooth') => {
      const el = scrollRef.current;
      if (!el) return;
      const target = clamp(i, 0, count - 1);
      lastEmittedRef.current = target;
      el.scrollTo({ top: target * rowHeight, behavior });
    },
    [count, rowHeight],
  );

  /** 左列滚动：rAF 节流计算选中行；停止 120ms 后平滑对齐到整行 */
  const handleScroll = useCallback(() => {
    if (tickingRef.current) return;
    tickingRef.current = true;
    requestAnimationFrame(() => {
      tickingRef.current = false;
      const el = scrollRef.current;
      if (!el) return;
      const idx = clamp(Math.round(el.scrollTop / rowHeight), 0, count - 1);
      lastEmittedRef.current = idx;
      if (idx !== index) onChange(idx);
    });
    if (alignTimerRef.current !== null) window.clearTimeout(alignTimerRef.current);
    alignTimerRef.current = window.setTimeout(() => {
      alignTimerRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      const idx = clamp(Math.round(el.scrollTop / rowHeight), 0, count - 1);
      lastEmittedRef.current = idx;
      el.scrollTo({ top: idx * rowHeight, behavior: 'smooth' });
    }, 120);
  }, [count, index, onChange, rowHeight]);

  /** 鼠标滚轮：拦截页面滚动，向上/下滚一格 */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const next = clamp(index + (e.deltaY > 0 ? 1 : -1), 0, count - 1);
      goTo(next);
      if (next !== index) onChange(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [count, goTo, index, onChange]);

  /** 外部（如「重置」）改变 index 时，把左列滚到对应位置 */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (lastEmittedRef.current === index) return;
    lastEmittedRef.current = index;
    el.scrollTo({ top: index * rowHeight, behavior: 'auto' });
  }, [index, rowHeight]);

  /** 卸载时清理定时器 */
  useEffect(
    () => () => {
      if (alignTimerRef.current !== null) window.clearTimeout(alignTimerRef.current);
    },
    [],
  );

  return (
    <div className="relative" style={{ height: boxHeight }}>
      {/* 正中高亮条（在内容之下，作为选中行底色） */}
      <div
        className="pointer-events-none absolute inset-x-0 z-0"
        style={{ top: centerTop, height: rowHeight }}
      >
        <div className="relative h-full w-full rounded-lg bg-[#D6E6FB]/70">
          <div className="absolute left-2 right-2 top-0 h-px bg-slate-300/60" />
          <div className="absolute left-2 right-2 bottom-0 h-px bg-slate-300/60" />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center">
            <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
          </div>
        </div>
      </div>

      {/* 两列内容（在高亮条之上，保证文字清晰） */}
      <div className="relative z-10 grid grid-cols-2 h-full">
        {/* 左列：真实滚动 */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-scroll overscroll-contain snap-y snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={fadeMaskStyle}
        >
          <div style={{ height: pad }} />
          {values.map((v, i) => (
            <div
              key={i}
              onClick={() => {
                goTo(i);
                if (i !== index) onChange(i);
              }}
              style={{ height: rowHeight }}
              className={`snap-center flex items-center justify-center text-[19px] tabular-nums cursor-pointer select-none transition-colors ${
                i === index ? 'font-semibold text-slate-900' : 'font-normal text-slate-400'
              }`}
            >
              {v}
            </div>
          ))}
          <div style={{ height: pad }} />
        </div>

        {/* 右列：联动伪滚轮，不可滚动 */}
        <div className="h-full overflow-hidden" style={fadeMaskStyle}>
          <div
            className="transition-transform duration-150 ease-out"
            style={{ transform: `translateY(${-index * rowHeight}px)` }}
          >
            <div style={{ height: pad }} />
            {linked.map((v, i) => (
              <div
                key={i}
                style={{ height: rowHeight }}
                className={`flex items-center justify-center pr-8 text-[19px] tabular-nums select-none transition-colors ${
                  i === index ? 'font-semibold text-blue-600' : 'font-normal text-slate-400'
                }`}
              >
                {v}
              </div>
            ))}
            <div style={{ height: pad }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * 卡组封面：渐变色块 + 卡组名前两字 + 同心圆装饰 + 书脊线
 * ============================================================ */

interface DeckCoverProps {
  name: string;
  deckId: number;
}

function DeckCover({ name, deckId }: DeckCoverProps) {
  const gradient = COVER_GRADIENTS[Math.abs(deckId) % COVER_GRADIENTS.length];
  return (
    <div
      className={`relative w-14 h-[72px] rounded-md bg-gradient-to-br ${gradient} shrink-0 overflow-hidden`}
    >
      {/* 封面文字：卡组名前两字 */}
      <span className="absolute left-1.5 top-1.5 text-[11px] font-semibold text-white/95 leading-tight max-w-[46px] truncate">
        {name.slice(0, 2)}
      </span>
      {/* 同心圆装饰 */}
      <svg
        viewBox="0 0 40 40"
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8"
        fill="none"
      >
        <circle cx="20" cy="20" r="5" stroke="white" strokeOpacity="0.95" strokeWidth="2.5" />
        <circle cx="20" cy="20" r="11" stroke="white" strokeOpacity="0.65" strokeWidth="2" />
        <circle cx="20" cy="20" r="16" stroke="white" strokeOpacity="0.35" strokeWidth="1.5" />
      </svg>
      {/* 书脊线 */}
      <div className="absolute left-2 right-2 bottom-2 h-[3px] rounded-full bg-white/70" />
    </div>
  );
}

/* ============================================================
 * 学习设置页（百词斩「调整计划」风格）
 *   逻辑层完全沿用：state / 加载 / 保存 / 数值约束 / 剩余词数口径
 * ============================================================ */

export default function StudySettingsPageV2() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const deckId = parseInt(params.get('deck') || '') || null;

  const [decks, setDecks] = useState<any[] | null>(null);
  const [groups, setGroups] = useState(DEFAULT_GROUPS);
  const [perSession, setPerSession] = useState(DEFAULT_PER_SESSION);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await api.decks.list().catch(() => [] as any[]);
        setDecks(d);
        const s = await api.auth.getSettings().catch(() => ({} as Record<string, string>));
        const ps = parseInt((s as any).study_per_session) || DEFAULT_PER_SESSION;
        const active = d.find((x: any) => x.id === deckId) || d[0] || null;
        const g =
          parseInt((s as any).daily_groups) ||
          (active ? Math.max(1, Math.round((active.new_per_day || ps) / ps)) : DEFAULT_GROUPS);
        setPerSession(clamp(ps, MIN_PER_SESSION, MAX_PER_SESSION));
        setGroups(clamp(g, MIN_GROUPS, MAX_GROUPS));
        // 词球配色也存 user_settings：这里顺手套用账号里的配色（避免多一次请求）
        applyPaletteFromSetting((s as any).wordnet_palette);
      } catch {
        /* 出错时保留默认值 */
      }
      setLoading(false);
    })();
  }, [deckId]);

  const activeDeck = decks?.find((x: any) => x.id === deckId) || decks?.[0] || null;

  // 剩余词数口径（与旧版一致）：
  // new_count=未学新卡, learning_count=学习中, review_count=复习中，三者相加恒等于 card_count
  // 所以「已学」= learning + review，「剩余」= 总数 - 已学（即 new_count）
  const total = activeDeck?.card_count || 0;
  const learned = (activeDeck?.learning_count || 0) + (activeDeck?.review_count || 0);
  const remaining = Math.max(total - learned, 0);
  const perDay = groups * perSession;
  const days = perDay > 0 ? Math.ceil(remaining / perDay) : 0;

  // 预计完成时间（完整年月日）
  const endDate = useMemo(() => new Date(Date.now() + days * 86400000), [days]);
  const endText =
    remaining === 0
      ? '已完成'
      : `${endDate.getFullYear()}年${endDate.getMonth() + 1}月${endDate.getDate()}日`;

  // 预计每日用时：每词约 25 秒
  const minutes = Math.max(1, Math.round((perDay * 25) / 60));

  // 进度百分比
  const percent = total > 0 ? clamp(Math.round((learned / total) * 100), 0, 100) : 0;

  /* ---------- 滚轮数据 ---------- */

  const groupValues = useMemo(
    () => Array.from({ length: MAX_GROUPS }, (_, i) => `${i + 1}组`),
    [],
  );
  const groupLinked = useMemo(
    () =>
      Array.from({ length: MAX_GROUPS }, (_, i) => {
        const g = i + 1;
        if (remaining === 0) return '已学完';
        return `${Math.ceil(remaining / (g * perSession))} 天`;
      }),
    [remaining, perSession],
  );

  const sessionValues = useMemo(
    () => Array.from({ length: MAX_PER_SESSION }, (_, i) => `${i + 1}词`),
    [],
  );
  const sessionLinked = useMemo(
    () => Array.from({ length: MAX_PER_SESSION }, (_, i) => `${groups * (i + 1)} 词`),
    [groups],
  );

  const handleGroupsChange = useCallback((i: number) => {
    setGroups(clamp(i + 1, MIN_GROUPS, MAX_GROUPS));
  }, []);
  const handlePerSessionChange = useCallback((i: number) => {
    setPerSession(clamp(i + 1, MIN_PER_SESSION, MAX_PER_SESSION));
  }, []);

  /** 重置：仅恢复本页默认计划，不调用任何重置进度的接口 */
  const handleReset = useCallback(() => {
    setGroups(DEFAULT_GROUPS);
    setPerSession(DEFAULT_PER_SESSION);
    setMsg(null);
  }, []);

  /** 保存：与旧版完全一致的三处提交 */
  async function save() {
    if (!activeDeck || saving) return;
    setSaving(true);
    setMsg(null);
    try {
      await api.auth.updateSettings({
        study_per_session: String(perSession),
        daily_groups: String(groups),
      } as any);
      await api.decks.updateConfig(activeDeck.id, { new_per_day: groups * perSession });
      setMsg('已保存');
      setTimeout(() => navigate('/'), 600);
    } catch (e: any) {
      setMsg(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* A. 顶栏 */}
      <div className="sticky top-0 z-30 bg-white">
        <div className="relative max-w-md mx-auto h-14 flex items-center px-2">
          <button
            onClick={() => navigate('/')}
            className="w-9 h-9 flex items-center justify-center rounded-full active:bg-slate-100 transition-colors"
            aria-label="返回"
          >
            <ChevronLeft className="w-6 h-6 text-slate-700" strokeWidth={2} />
          </button>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-[17px] font-semibold text-slate-900">调整计划</span>
          </div>
        </div>
      </div>

      {loading ? (
        /* F. 加载中 */
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : !activeDeck ? (
        /* F. 无牌组空状态 */
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
          <h2 className="text-lg font-bold text-slate-600">还没有牌组</h2>
          <p className="text-sm text-slate-400 mt-2">先去创建牌组，再设置学习计划</p>
          <button
            onClick={() => navigate('/decks')}
            className="mt-6 px-6 py-2.5 rounded-full bg-[#2E6BE6] text-white text-sm font-medium shadow-sm active:bg-blue-700 transition-colors"
          >
            去创建牌组
          </button>
        </div>
      ) : (
        <div className="max-w-md mx-auto pb-40">
          {/* B. 卡组信息通栏 */}
          <div className="px-4 pt-1 pb-4">
            <div className="flex items-start gap-3">
              <DeckCover name={activeDeck.name || ''} deckId={activeDeck.id || 0} />

              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-lg font-bold text-slate-900 truncate">
                      {activeDeck.name}
                    </div>
                    <div className="text-sm text-slate-500 mt-0.5">
                      {remaining === 0
                        ? '已学完'
                        : `每日 ${perDay} 词，剩余 ${days} 天`}
                    </div>
                  </div>
                  {/* 重置：恢复本页默认计划 */}
                  <button
                    onClick={handleReset}
                    className="shrink-0 flex items-center gap-1 pt-1 text-xs text-slate-400 active:text-slate-600 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    重置
                  </button>
                </div>

                {/* 进度条（左端小圆点） */}
                <div className="relative mt-3 h-1 rounded-full bg-slate-100">
                  <div
                    className="absolute left-0 top-0 h-1 rounded-full bg-blue-500"
                    style={{ width: `${percent}%` }}
                  />
                  <div className="absolute -left-[1px] top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-white" />
                </div>

                <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    已学 {learned}
                  </span>
                  <span>{total} 词</span>
                </div>
              </div>
            </div>
          </div>

          {/* C. 蓝色预计信息条 */}
          <div className="bg-slate-50 px-4 py-3 space-y-1.5 text-sm">
            <div>
              <span className="text-slate-500">预计完成时间：</span>
              <span className="text-blue-600 font-semibold">{endText}</span>
            </div>
            <div>
              <span className="text-slate-500">预计每日用时：</span>
              <span className="text-blue-600 font-semibold">{minutes} 分钟</span>
            </div>
          </div>

          {/* D. 核心滚轮卡 1：每日组数 / 完成天数 */}
          <div className="mx-4 mt-4 rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <div className="grid grid-cols-2 px-4 pt-3 pb-2 text-[15px] font-semibold text-slate-800">
              <div>每日组数 (每组 {perSession} 词)</div>
              <div className="text-center">完成天数</div>
            </div>
            <div className="mx-4 h-px bg-slate-100" />
            <PlanWheel
              values={groupValues}
              linked={groupLinked}
              index={groups - 1}
              onChange={handleGroupsChange}
              rowHeight={ROW_HEIGHT}
              visibleRows={5}
            />
          </div>

          {/* D. 核心滚轮卡 2：每组词数 / 每日共学 */}
          <div className="mx-4 mt-4 rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <div className="grid grid-cols-2 px-4 pt-3 pb-2 text-[15px] font-semibold text-slate-800">
              <div>每组词数</div>
              <div className="text-center">每日共学</div>
            </div>
            <div className="mx-4 h-px bg-slate-100" />
            <PlanWheel
              values={sessionValues}
              linked={sessionLinked}
              index={perSession - 1}
              onChange={handlePerSessionChange}
              rowHeight={ROW_HEIGHT}
              visibleRows={4}
            />
          </div>

          {/* D. 复习每组词数：固定 10，不可修改 */}
          <div className="mx-4 mt-4 rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[15px] font-semibold text-slate-800">复习每组词数</span>
              <input
                type="number"
                value={10}
                readOnly
                disabled
                aria-label="复习每组词数（固定 10）"
                className="w-20 text-center text-[15px] font-semibold text-slate-400 bg-slate-50 border border-slate-200 rounded-lg py-1.5 cursor-not-allowed"
              />
            </div>
            <div className="mx-4 h-px bg-slate-100" />
            <p className="px-4 py-2.5 text-xs text-slate-400">复习固定 10 个一组（10 张 × 2 阶段 = 20 题）</p>
          </div>

          {/* 词球配色（自定义调色板）—— 与首页词球右下角的小面板是同一套设置 */}
          <div className="mx-4 mt-4 rounded-2xl border border-slate-100 bg-white shadow-sm p-4">
            <div className="flex items-center gap-2 mb-3">
              <Palette className="w-4 h-4 text-indigo-500" />
              <span className="text-[15px] font-semibold text-slate-800">词球配色</span>
              <span className="text-[11px] text-slate-400">首页词汇球，改完立即生效</span>
            </div>
            <WordnetPaletteControls variant="inline" />
          </div>

          <p className="text-center text-xs text-slate-400 mt-4">上下滑动或滚轮调节数值</p>
        </div>
      )}

      {/* E. 底部固定保存按钮 */}
      {!loading && activeDeck && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-gradient-to-t from-white via-white/95 to-transparent pt-6">
          <div className="max-w-md mx-auto px-4 pb-[max(env(safe-area-inset-bottom),16px)]">
            {msg && (
              <div
                className={`mb-2 text-center text-sm flex items-center justify-center gap-1 ${
                  msg === '已保存' ? 'text-green-600' : 'text-red-500'
                }`}
              >
                {msg === '已保存' && <Check className="w-4 h-4" />}
                {msg}
              </div>
            )}
            <button
              onClick={save}
              disabled={saving}
              className="w-full py-3.5 rounded-xl bg-[#2E6BE6] hover:bg-blue-700 active:bg-blue-700 text-white text-[17px] font-semibold disabled:opacity-60 transition-colors"
            >
              {saving ? '保存中…' : '保存计划'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
