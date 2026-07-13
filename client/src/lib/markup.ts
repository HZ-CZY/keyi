/**
 * 渲染笔记中的标记语法：
 * - **text** → <strong>text</strong>
 * - ==text== → <mark class="highlight">text</mark>
 */
export function renderMarkup(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/==(.+?)==/g, '<mark class="highlight">$1</mark>');
}
