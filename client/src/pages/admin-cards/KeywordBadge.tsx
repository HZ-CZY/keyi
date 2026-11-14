// 重点字徽章 —— 卡片列表里最重要的一个信号
//
// 三种状态一眼可辨：
//   · 字·当      紫  = 恰好 1 处标记，健康，能正常出题
//   · N 处标记   玫红 = 标了多处，出题会歧义，需人工修
//   · 未标字     琥珀 = 完全没标，这张卡在学习端会退化成普通问答
//
// 颜色沿用改造前 AdminCardsPage 里已上线的那套，老师已经认熟了，不换。

import { KEYWORD_BADGE } from './keyword';
import type { KeywordInfo } from './types';

export default function KeywordBadge({
  info,
  size = 'sm',
}: {
  info: KeywordInfo;
  /** sm = 卡片行内；md = 组标题 */
  size?: 'sm' | 'md';
}) {
  const badge = KEYWORD_BADGE[info.state];
  const label = badge.label(info.keyword || '', info.count);

  const padding = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5';

  const title =
    info.state === 'ok'
      ? `重点字：${info.keyword}`
      : info.state === 'multi'
        ? `标记了 ${info.count} 处重点字（应为 1 处）`
        : '原句没有 **重点字** 标记，出题时无法组同字干扰项池';

  return (
    <span
      title={title}
      className={`flex-shrink-0 rounded font-medium border ${padding} ${badge.className}`}
    >
      {label}
    </span>
  );
}
