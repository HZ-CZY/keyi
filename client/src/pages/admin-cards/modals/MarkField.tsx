// 带标记工具栏的字段输入框
//
// 原样从 AdminCardsPage.tsx 顶部搬过来，逻辑一字未改 —— 这段已上线稳定：
//   Ctrl+Q 加粗（**字**，即重点字标记）
//   Ctrl+E 高亮（==高亮==）
// 重点字标记是本项目出题的命门，输入时必须让老师顺手能标。

import { useRef } from 'react';

export default function MarkField({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const wrap = (before: string, after: string) => {
    const ta = ref.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    let selected = value.substring(start, end);
    if (!selected) selected = '重点词语';
    const newVal = value.substring(0, start) + before + selected + after + value.substring(end);
    onChange(newVal);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'q') {
      e.preventDefault();
      wrap('**', '**');
    } else if (mod && e.key === 'e') {
      e.preventDefault();
      wrap('==', '==');
    }
  };

  return (
    <div>
      <label className="block text-[13px] text-gray-600 mb-1 font-medium">{label}</label>
      <div className="flex gap-1 mb-1.5">
        <button
          type="button"
          onClick={() => wrap('**', '**')}
          className="w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-100 hover:border-gray-300 transition-colors"
          title="加粗 · 重点字标记 (Ctrl+Q)"
        >B</button>
        <button
          type="button"
          onClick={() => wrap('==', '==')}
          className="w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-amber-50 hover:border-amber-300 transition-colors"
          title="高亮 (Ctrl+E)"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10.5 2.5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v7l4.5 4.5V16h-12v-2.5L10.5 9.5v-7z" />
          </svg>
        </button>
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="input-field w-full resize-none"
        rows={3}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      <p className="text-[10px] text-gray-400 mt-0.5">Ctrl+Q 加粗 · Ctrl+E 高亮</p>
    </div>
  );
}
