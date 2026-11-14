// 重点字解析 —— 卡片列表与 AI 预览共用
//
// 【为什么这块逻辑值得单独一个文件】
// 「**重点字**」是整套卡片体系的命门：它同时决定
//   · 学习端阶段1「据句选意」能不能组出同字义项池
//   · 阶段2「据义选句」有没有可用的干扰句
//   · 阶段3「义意速判」拿什么做判断题
// 一旦某张卡漏标或多标，出题就会静默退化（不报错，但题目变水）。
// 所以列表里必须把「这张卡的字标得对不对」直接可视化成徽章。
//
// 线上实测：546 大牌组 869 张卡共 154 个不同重点字，119 个字的卡数 >3。
// 也就是说「同字多义项」是常态 —— 分组展示比平铺列表更有意义。

import type { KeywordInfo, KeywordState } from './types';

/** 与后端 aiCardSchema.ts 的 KW_RE 保持一致（1~6 个非星号非换行字符） */
const KW_RE = /\*\*([^*\n]{1,6})\*\*/g;

/**
 * 解析原句里的重点字标记。
 *
 * 注意：这里刻意不复用 renderMarkup —— 那个函数返回的是 HTML 字符串，
 * 我们要的是「抽出来做分组键 + 数标记个数」，语义不同。
 */
export function parseKeyword(front: string | undefined | null): KeywordInfo {
  const raw = front || '';
  const all = [...raw.matchAll(KW_RE)];
  const count = all.length;

  if (count === 0) return { keyword: null, count: 0, state: 'missing' };

  // 多标时仍然把第一个抽出来当分组键，避免这些卡全挤进「(未标)」组 ——
  // 它们其实是有字的，只是标多了，归到对应字下面老师才好顺手修。
  const keyword = (all[0][1] || '').replace(/<[^>]+>/g, '').trim() || null;
  const state: KeywordState = count === 1 ? 'ok' : 'multi';
  return { keyword, count, state };
}

/** 未标记卡的归组键 */
export const UNMARKED_KEY = '(未标)';

/** 分组键：有字用字，没字用 '(未标)' */
export function groupKeyOf(front: string | undefined | null): string {
  return parseKeyword(front).keyword || UNMARKED_KEY;
}

/**
 * 徽章文案与配色 —— 三种状态，全局唯一来源。
 * label 统一签名 (kw: string, count: number) => string，调用处不必按状态分支。
 */
export const KEYWORD_BADGE: Record<
  KeywordState,
  { className: string; label: (kw: string, count: number) => string }
> = {
  ok: {
    className: 'bg-violet-50 text-violet-600 border-violet-200',
    label: kw => `字·${kw}`,
  },
  multi: {
    className: 'bg-rose-50 text-rose-600 border-rose-200',
    label: (_kw, count) => `${count} 处标记`,
  },
  missing: {
    className: 'bg-amber-50 text-amber-600 border-amber-200',
    label: () => '未标字',
  },
};

/** 组头警示色 */
export const GROUP_WARN_STYLE = 'bg-amber-50 text-amber-700 border-amber-200';
