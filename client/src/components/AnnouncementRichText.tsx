import { useMemo } from 'react';
import { sanitizeAnnouncementHtml } from '../lib/sanitizeHtml';

/**
 * 公告富文本 —— 用户端弹窗 / 管理端编辑预览共用，保证两端显示一致。
 *
 * 安全模型：白名单净化。只允许：段落 div/p、换行 br、加粗 b/strong、斜体 i/em、
 * 下划线 u、以及「仅带合法 color 内联样式」的 span；script/style/事件属性一律剥离，
 * 未知标签剥壳只保留文本。文本中的原始换行符依赖外层 white-space:pre-line 呈现。
 *
 * 【2026-09-12】净化器实现已抽出到 lib/sanitizeHtml.ts 作为共享模块，本文件改为
 * 复用（行为完全等价）。抽出原因：卡片正文 lib/markup.ts 也需要同一套净化逻辑
 * 来修存储型 XSS，不该存在两份实现。此处保留 re-export，原有导入路径不受影响。
 */
export { sanitizeAnnouncementHtml };

/** 提取纯文本（列表摘要用） */
export function announcementPlainText(html: string | null | undefined): string {
  if (!html) return '';
  const clean = sanitizeAnnouncementHtml(html);
  // 文本节点中已转义 & < > "；此处还原 &#.. 实体即可得到近似纯文本
  return clean
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

interface AnnouncementRichTextProps {
  html: string | null | undefined;
  /** 追加样式类；正文默认会保留原始换行（white-space: pre-line） */
  className?: string;
}

/** 公告正文统一渲染组件：白名单净化 + 保留换行排版 */
export default function AnnouncementRichText({ html, className = '' }: AnnouncementRichTextProps) {
  const safe = useMemo(() => sanitizeAnnouncementHtml(html), [html]);
  return (
    <div
      className={`announcement-body whitespace-pre-line break-words ${className}`}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
