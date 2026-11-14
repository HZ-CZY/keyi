import { useEffect, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import {
  PALETTE_PRESETS,
  applyCustomColor,
  applyPreset,
  getPalette,
  presetById,
  resetPalette,
  subscribePalette,
  type WordnetPalette,
} from '../lib/wordnetPalette';

/**
 * 词球配色控件（2026-09-22）—— 首页词球右下角的小面板 + 个人中心「学习设置」里共用。
 * variant='panel' 给首页弹层用（带关闭按钮），'inline' 给设置页嵌在页面里用。
 */
export default function WordnetPaletteControls({
  variant = 'inline',
  onClose,
}: {
  variant?: 'panel' | 'inline';
  onClose?: () => void;
}) {
  const [pal, setPal] = useState<WordnetPalette>(getPalette());
  useEffect(() => subscribePalette(setPal), []);

  const active = presetById(pal.preset);

  return (
    <div className="w-full">
      {/* 标题（内嵌到设置页时由外层卡片提供标题，这里不重复） */}
      {variant === 'panel' && (
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-slate-800">词球配色</span>
            <span className="text-[11px] text-slate-400">跟着账号保存</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 active:scale-95 transition"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 预设主题 */}
      <div className={`grid gap-2 ${variant === 'panel' ? 'grid-cols-4' : 'grid-cols-4 sm:grid-cols-8'}`}>
        {PALETTE_PRESETS.map((p) => {
          const on = pal.preset === p.id;
          return (
            <button
              key={p.id}
              onClick={() => applyPreset(p.id)}
              title={p.note ? `${p.name} · ${p.note}` : p.name}
              className={`relative flex flex-col items-center gap-1 rounded-xl p-1.5 transition active:scale-95 ${
                on ? 'ring-2 ring-blue-500 bg-blue-50' : 'ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {/* 预览：深色底上展示词色 + 连线色 */}
              <span
                className="w-9 h-9 rounded-lg flex flex-col items-center justify-center overflow-hidden"
                style={{
                  background: p.multi
                    ? 'conic-gradient(#ff9aa2,#ffd08a,#a9f0cf,#8fd8ff,#dcc4ff,#ff9aa2)'
                    : 'linear-gradient(160deg,#3b4a63,#22303f)',
                }}
              >
                {p.multi ? (
                  <span className="text-white font-bold" style={{ fontSize: 13 }}>多</span>
                ) : (
                  <>
                    <span style={{ color: p.word, fontWeight: 700, fontSize: 13, lineHeight: '15px' }}>月</span>
                    <span className="block rounded-full" style={{ width: 16, height: 2, background: p.line, opacity: 0.9 }} />
                  </>
                )}
              </span>
              <span className={`text-[10.5px] font-medium leading-none ${on ? 'text-blue-600' : 'text-slate-500'}`}>
                {p.name}
              </span>
              {on && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                  <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 自定义微调 */}
      <div className="mt-3 rounded-xl bg-slate-50/80 border border-slate-100 p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-slate-600">自定义颜色</span>
          <button
            onClick={resetPalette}
            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 active:scale-95 transition"
          >
            <RotateCcw className="w-3 h-3" />
            恢复默认
          </button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {([
            ['word', '词的颜色'],
            ['line', '连线的颜色'],
          ] as const).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2 rounded-lg bg-white ring-1 ring-slate-200 px-2 py-1.5 cursor-pointer active:scale-[0.98] transition"
            >
              <span
                className="w-6 h-6 rounded-full ring-1 ring-slate-300 shrink-0"
                style={{ background: key === 'word' && pal.preset === 'rainbow' ? 'conic-gradient(#ff9aa2,#ffd08a,#a9f0cf,#8fd8ff,#dcc4ff,#ff9aa2)' : pal[key] }}
              />
              <span className="flex flex-col min-w-0">
                <span className="text-[11px] text-slate-500 leading-none">{label}</span>
                <span className="text-[11px] font-semibold text-slate-700 leading-tight truncate">
                  {key === 'word' && pal.preset === 'rainbow' ? '多彩' : pal[key].toUpperCase()}
                </span>
              </span>
              <input
                type="color"
                value={pal[key]}
                onChange={(e) => applyCustomColor(key, e.target.value)}
                className="sr-only"
                aria-label={label}
              />
            </label>
          ))}
        </div>
        {active?.multi && (
          <p className="mt-1.5 text-[11px] text-slate-400">当前是「多彩」：每个词按自己的颜色显示，连线用下方颜色。</p>
        )}
      </div>

      <p className="mt-2 text-[11px] text-slate-400 leading-snug">
        调完立即生效。登录后配色会存到账号里，换设备打开也是同一套。
      </p>
    </div>
  );
}
