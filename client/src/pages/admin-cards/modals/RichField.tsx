// 富文本字段编辑器（所见即所得）
//
// 【2026-10-12 新增】替换原 MarkField（textarea + 记号按钮）。
// 原实现里老师看到的是 `敢竭**鄙**怀` 这种记号，必须记住 Ctrl+Q 才是加粗，
// 很容易标错、也不直观。现在改成真·富文本：加粗就是加粗、高亮就是高亮，
// 保存时再转回项目统一的记号文本。
//
// 为什么不用 Quill / TipTap：
//   全站正文只支持「加粗 + 高亮 + 换行」三种格式（唯一解析口径见 lib/markup.ts
//   的 renderMarkup）。引入富文本库（几百 KB）后仍要再写一层 HTML↔记号 的转换，
//   体积大、收益小。这里用 contentEditable + 一个转换器：零依赖、零体积，
//   并且**编辑器直接用 renderMarkup 渲染** —— 保证「编辑器里看到的 = 学生看到的」。
//
// 数据模型（不改动，与线上 42 万个字段完全兼容）：
//   加粗 → `**字**` ；高亮 → `==字==` ；换行 → `\n`
//   历史数据里有 586 条笔记用了 <b> 标签（形如 `<b>**爱**</b>` 的双层写法），
//   转换器会把 <b>/<strong> 归一成 `**`，并避免叠成 `****`。

import { useEffect, useRef, useState } from 'react';
import { Bold, Eraser, Highlighter } from 'lucide-react';
import { renderMarkup } from '../../../lib/markup';

/* ─────────────── 记号文本 → 编辑器 HTML ─────────────── */

/** renderMarkup 已做 `**`→<strong>、`==`→<mark class="highlight"> 并净化，只需补换行 */
function markupToHtml(text: string): string {
  return renderMarkup(text).replace(/\n/g, '<br>');
}

/* ─────────────── 编辑器 HTML → 记号文本 ─────────────── */

function isBoldEl(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'b' || tag === 'strong') return true;
  const fw = (el as HTMLElement).style?.fontWeight || '';
  if (!fw) return false;
  if (fw === 'bold' || fw === 'bolder') return true;
  const n = parseInt(fw, 10);
  return !isNaN(n) && n >= 600;
}

function isHlEl(el: Element): boolean {
  if (el.tagName.toLowerCase() === 'mark') return true;
  if (el.classList.contains('highlight') || el.classList.contains('mark-highlight')) return true;
  const bg = (el as HTMLElement).style?.backgroundColor || '';
  if (!bg) return false;
  return !/^transparent$/i.test(bg) && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg);
}

function nodeToMarkup(node: Node): string {
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType !== 1) return '';
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === 'br' || tag === 'hr') return '\n';

  let inner = '';
  el.childNodes.forEach((c) => { inner += nodeToMarkup(c); });

  // 浏览器回车（Enter）生成的 <div>/<p> 容器，视作换行
  if (tag === 'div' || tag === 'p') return '\n' + inner;

  const isFmt = isBoldEl(el) || isHlEl(el);
  // 空的格式壳直接丢掉 —— extractContents() 在选区落在格式边界时会留下
  // `<b></b>` 这种空元素，照原样序列化就会写出 `****` 这种坏记号，
  // 而坏记号 renderMarkup 认不出来，会原样显示给学生。
  if (isFmt && !inner.replace(/\s/g, '')) return '';

  // 已经有记号就不重复包裹（历史数据里的 <b>**爱**</b> 就是这种双层写法）
  if (isBoldEl(el) && !/^\*\*[\s\S]*\*\*$/.test(inner)) inner = '**' + inner + '**';
  if (isHlEl(el) && !/^==[\s\S]*==$/.test(inner)) inner = '==' + inner + '==';
  return inner;
}

function htmlToMarkup(root: HTMLElement): string {
  let s = '';
  root.childNodes.forEach((n) => { s += nodeToMarkup(n); });
  return s
    .replace(/\u00a0/g, ' ')     // &nbsp; → 普通空格
    .replace(/\n{3,}/g, '\n\n')  // 最多留一个空行
    .replace(/^\n+/, '')
    .replace(/\s+$/, '');
}

/* ─────────────── 组件 ─────────────── */

export default function RichField({
  label,
  hint,
  badge,
  value,
  onChange,
  placeholder,
  autoFocus,
  minHeight = 64,
}: {
  label: string;
  /** 字段用途提示，如「正面 · 出题的句子」 */
  hint?: string;
  /** 标签右侧的状态徽章（如重点字状态），由调用方决定内容 */
  badge?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** 自己刚发出去的值 —— 用它区分「我的输入」和「外部换值」，避免回写把光标顶走 */
  const lastEmitted = useRef<string | null>(null);
  const [fmt, setFmt] = useState({ bold: false, hl: false });

  // 只在值来自外部（切换卡片、父组件重置）时重写 innerHTML。
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (lastEmitted.current !== null && value === lastEmitted.current) return;
    el.innerHTML = markupToHtml(value);
    el.setAttribute('data-empty', (el.textContent || '').trim() === '' ? 'true' : 'false');
    lastEmitted.current = value;
  }, [value]);

  useEffect(() => {
    if (autoFocus && ref.current) ref.current.focus();
  }, [autoFocus]);

  const refreshFmt = () => {
    const el = ref.current;
    if (!el) return;
    let hl = false;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      let n: Node | null = sel.getRangeAt(0).startContainer;
      while (n && n !== el) {
        if (n.nodeType === 1 && isHlEl(n as Element)) { hl = true; break; }
        n = n.parentNode;
      }
    }
    let bold = false;
    try { bold = document.queryCommandState('bold'); } catch { /* 忽略 */ }
    setFmt({ bold, hl });
  };

  // 光标/选区变化时更新工具栏高亮态
  useEffect(() => {
    const onSel = () => {
      if (document.activeElement === ref.current) refreshFmt();
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  const sync = () => {
    const el = ref.current;
    if (!el) return;
    const md = htmlToMarkup(el);
    el.setAttribute('data-empty', (el.textContent || '').trim() === '' ? 'true' : 'false');
    lastEmitted.current = md;
    onChange(md);
    refreshFmt();
  };

  const after = () => requestAnimationFrame(() => sync());

  /** 把节点「脱壳」：只留子内容，去掉这层格式 */
  const unwrapEl = (node: Node) => {
    const p = node.parentNode;
    if (!p) return;
    while (node.firstChild) p.insertBefore(node.firstChild, node);
    p.removeChild(node);
    p.normalize();
  };

  const findHlAncestor = (from: Node): Node | null => {
    const el = ref.current;
    let n: Node | null = from;
    while (n && n !== el) {
      if (n.nodeType === 1 && isHlEl(n as Element)) return n;
      n = n.parentNode;
    }
    return null;
  };

  const doBold = () => {
    ref.current?.focus();
    document.execCommand('bold');
    after();
  };

  /** 高亮：手动包一层 <mark class="highlight">，与学习端渲染完全一致（不是 execCommand 的底色 span） */
  const doHighlight = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return; // 没选文字就不处理，避免产生空高亮
    const existing = findHlAncestor(range.commonAncestorContainer);
    if (existing) {
      unwrapEl(existing);
    } else {
      const mark = document.createElement('mark');
      mark.className = 'highlight';
      try {
        mark.appendChild(range.extractContents());
        range.insertNode(mark);
      } catch { return; }
    }
    after();
  };

  /** 清除选中范围内的加粗/高亮 */
  const doClear = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;
    const targets = Array.from(el.querySelectorAll('b,strong,mark,span,font')).filter(
      (n) => (isBoldEl(n) || isHlEl(n)) && range.intersectsNode(n),
    );
    targets.forEach(unwrapEl);
    after();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'q' || k === 'b') { e.preventDefault(); doBold(); }
    else if (k === 'e') { e.preventDefault(); doHighlight(); }
    else if (k === 'x' && e.shiftKey) { e.preventDefault(); doClear(); }
  };

  // 只接受纯文本粘贴 —— 避免把外部网页的样式/结构粘进来（模型只支持加粗+高亮）
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    after();
  };

  const ToolBtn = ({
    active, title, onClick, children,
  }: {
    active?: boolean; title: string; onClick: () => void; children: React.ReactNode;
  }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()} // 关键：别让点击抢走编辑器里的选区
      onClick={onClick}
      className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
        active
          ? 'bg-primary-100 text-primary-700'
          : 'text-gray-500 hover:bg-gray-200/70 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden transition-colors focus-within:border-primary-300">
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-gray-50/70 border-b border-gray-100">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="text-[12px] font-semibold text-gray-700 shrink-0">{label}</span>
          {hint ? <span className="text-[10.5px] text-gray-400 truncate">{hint}</span> : null}
          {badge}
        </span>
        <div className="flex items-center gap-0.5 shrink-0">
          <ToolBtn active={fmt.bold} title="加粗 · 标记重点字词 (Ctrl+Q)" onClick={doBold}>
            <Bold className="w-3.5 h-3.5" />
          </ToolBtn>
          <ToolBtn active={fmt.hl} title="高亮 (Ctrl+E)" onClick={doHighlight}>
            <Highlighter className="w-3.5 h-3.5" />
          </ToolBtn>
          <ToolBtn title="清除格式 (Ctrl+Shift+X)" onClick={doClear}>
            <Eraser className="w-3.5 h-3.5" />
          </ToolBtn>
        </div>
      </div>

      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        data-placeholder={placeholder || `输入${label}内容…`}
        data-empty="true"
        onInput={sync}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        className="rich-editor px-3 py-2.5 text-[14px] leading-[1.75] text-gray-900 outline-none"
        style={{ minHeight }}
      />
    </div>
  );
}
