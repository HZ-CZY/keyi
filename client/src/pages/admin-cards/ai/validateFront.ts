// 重点字校验 —— 前端复刻版
//
// ⚠️【必须与后端保持同步】
// 事实来源：server/src/routes/lib/aiCardSchema.ts
//   fatal: FRONT_EMPTY / NO_KEYWORD_MARK / MULTI_KEYWORD_MARK / BACK_EMPTY / BACK_TOO_LONG
//   warn : FRONT_TOO_SHORT / PLAIN_EMPTY / BACK_POLLUTED / BACK_EQ_KEYWORD
// 改任何一条规则，两处都要改。
//
// 【为什么可以放心复刻】
// 后端 commit 会**二次校验**（admin-ai-import.ts 里明确注释「前端编辑后可能被
// 改坏，后端必须再过一遍」）。所以这里只负责「老师编辑时立刻看到反馈」，
// 不承担数据正确性责任 —— 就算这里算错了，脏数据也进不了库。

import { parseKeyword } from '../keyword';
import type { ValidationIssue } from '../types';

export const FIELD_NAMES = ['Front', 'Back', '白话文'];

/** 与后端 toPlain 一致：去标记、去 HTML、压空白 */
export function toPlain(s: string): string {
  return (s || '')
    .replace(/\*\*/g, '')
    .replace(/={2}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const ANNOTATION_HINTS = [/<br\s*\/?>/i, /<div/i, /^[\u4e00-\u9fa5]\s*[：:]/];

function looksLikeAnnotationPolluted(back: string, keyword: string): boolean {
  const plain = toPlain(back);
  if (ANNOTATION_HINTS.some(re => re.test(back) || re.test(plain))) return true;
  if (keyword && new RegExp(`^${keyword}\\s*[：:]`).test(plain)) return true;
  return false;
}

export interface LocalValidation {
  keyword: string;
  issues: ValidationIssue[];
  status: 'ok' | 'needs-review' | 'rejected';
}

export function validateLocal(front: string, back: string, plain: string): LocalValidation {
  const issues: ValidationIssue[] = [];

  const f = (front || '').trim();
  const b = (back || '').trim();
  const p = (plain || '').trim();

  const info = parseKeyword(f);
  const keyword = info.keyword || '';

  // ── fatal ──
  if (!f) {
    issues.push({ level: 'fatal', code: 'FRONT_EMPTY', message: '原句为空' });
  } else if (info.count === 0) {
    issues.push({ level: 'fatal', code: 'NO_KEYWORD_MARK', message: '原句缺少 **重点字** 标记' });
  } else if (info.count > 1) {
    issues.push({
      level: 'fatal',
      code: 'MULTI_KEYWORD_MARK',
      message: `原句有 ${info.count} 处重点字标记，每张卡只允许 1 处`,
    });
  }

  if (!b) {
    issues.push({ level: 'fatal', code: 'BACK_EMPTY', message: '释义为空' });
  }

  if (b && toPlain(b).length > 40) {
    issues.push({
      level: 'fatal',
      code: 'BACK_TOO_LONG',
      message: `释义 ${toPlain(b).length} 字，超过 40 字上限（应只写本句中该字的义项）`,
    });
  }

  // ── warn ──
  if (f && toPlain(f).length < 5) {
    issues.push({ level: 'warn', code: 'FRONT_TOO_SHORT', message: '原句过短，可能不是完整例句' });
  }
  if (!p) {
    issues.push({ level: 'warn', code: 'PLAIN_EMPTY', message: '缺少白话文翻译' });
  }
  if (b && looksLikeAnnotationPolluted(b, keyword)) {
    issues.push({ level: 'warn', code: 'BACK_POLLUTED', message: '释义疑似混入注释/字头解释，请人工确认' });
  }
  if (b && keyword && toPlain(b) === keyword) {
    issues.push({ level: 'warn', code: 'BACK_EQ_KEYWORD', message: '释义与重点字相同，可能是无效卡' });
  }

  const status: LocalValidation['status'] = issues.some(i => i.level === 'fatal')
    ? 'rejected'
    : issues.length > 0
      ? 'needs-review'
      : 'ok';

  return { keyword, issues, status };
}

/** 批量去重（与后端 dedupeCards 同口径）：同「字 + 释义」只留第一张 */
export function dedupeLocal<T extends { keyword: string; back: string; status: string }>(
  cards: T[],
): { kept: T[]; duplicateCount: number } {
  const seen = new Set<string>();
  const kept: T[] = [];
  let duplicateCount = 0;

  for (const c of cards) {
    if (c.status === 'rejected') { kept.push(c); continue; }
    const key = `${c.keyword}\u0001${toPlain(c.back)}`;
    if (seen.has(key)) { duplicateCount++; continue; }
    seen.add(key);
    kept.push(c);
  }
  return { kept, duplicateCount };
}

/** 状态 → 展示配置 */
export const STATUS_META = {
  ok: { label: '可入库', dot: 'bg-emerald-500', text: 'text-emerald-700', chip: 'bg-emerald-50 border-emerald-200' },
  'needs-review': { label: '待复核', dot: 'bg-amber-500', text: 'text-amber-700', chip: 'bg-amber-50 border-amber-200' },
  rejected: { label: '不通过', dot: 'bg-rose-500', text: 'text-rose-700', chip: 'bg-rose-50 border-rose-200' },
  duplicate: { label: '重复', dot: 'bg-gray-400', text: 'text-gray-500', chip: 'bg-gray-50 border-gray-200' },
} as const;
