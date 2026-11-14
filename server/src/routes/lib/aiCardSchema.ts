// AI 制卡 —— 输出协议与校验（2026-09-28 重写）
//
// 【背景】原实现是通用文档摘要器：输出「正面 ||| 背面」两字段纯文本，
// 与刻忆线上 12.6 万张「古文翻译」卡片的结构完全不兼容：
//   · 缺 **重点字** 标记 → 出题时 keywordPools 组不出来，阶段1/2/3 全部退化
//   · 只有 2 个字段 → 学习页「释义/原文/翻译」三栏少一栏
//   · 用 ' ||| ' 做分隔符 → 释义里出现 ' ||| ' 就错位，无任何校验
//   · AI导入 笔记类型建了但线上 0 张卡 → 名副其实的"死功能"
//
// 本文件定义新的 JSON 协议 + 一套硬校验，作为「制卡中心 → AI 智能制卡」的唯一事实来源。
// 前端的预览/编辑、后端的入库都必须走 validateCard，保证「所见即所入」。

export interface AiCard {
  /** 原句，必须且只能有 1 处 **重点字** 标记 */
  front: string;
  /** 释义，只写本句中该字的义项，不得夹带注释/出处 */
  back: string;
  /** 整句白话翻译 */
  plain: string;
  /** 出处，如「《劝学》」，可为空 */
  source?: string;
}

export type IssueLevel = 'fatal' | 'warn';

export interface ValidationIssue {
  level: IssueLevel;
  code: string;
  message: string;
}

export interface ValidatedCard extends AiCard {
  /** 提取出的重点字（用于同字义项分组/去重） */
  keyword: string;
  issues: ValidationIssue[];
  /** 有 fatal 则不入库；有 warn 则入库但打 needs-review 标签 */
  status: 'ok' | 'needs-review' | 'rejected';
}

/** 与线上 notetypes 一致的字段顺序：Front / Back / 白话文 */
export const FIELD_NAMES = ['Front', 'Back', '白话文'];

export const DEFAULT_NOTETYPE_NAME = '古文翻译';

const KW_RE = /\*\*([^*\n]{1,6})\*\*/g;

/** 提取重点字（唯一一处 ** **），多处或缺失返回 null */
export function extractKeyword(front: string): string | null {
  if (!front) return null;
  const all = [...front.matchAll(KW_RE)];
  if (all.length !== 1) return null;
  const kw = all[0][1].replace(/<[^>]+>/g, '').trim();
  return kw || null;
}

/** 纯文本（去标记与 HTML），用于长度判断与去重 */
export function toPlain(s: string): string {
  return (s || '')
    .replace(/\*\*/g, '')
    .replace(/={2}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 注释/出处混进释义的典型特征（线上真实脏数据：
//   "==<div>葫芦提：糊涂<br></div>承担=="  → 释义里混了字头解释
//   "==当：应当，应该=="                    → 释义里重复了重点字
const ANNOTATION_HINTS = [/<br\s*\/?>/i, /<div/i, /^[\u4e00-\u9fa5]\s*[：:]/];

function looksLikeAnnotationPolluted(back: string, keyword: string): boolean {
  const plain = toPlain(back);
  if (ANNOTATION_HINTS.some(re => re.test(back) || re.test(plain))) return true;
  // 释义以重点字开头且紧跟「：」 → 多半是把字头解释当成了义项
  if (keyword && new RegExp(`^${keyword}\\s*[：:]`).test(plain)) return true;
  return false;
}

/**
 * 单卡校验 —— 前端预览与后端入库共用，保证口径完全一致。
 * @param raw AI 返回的原始对象（字段可能缺失/类型不对）
 */
export function validateCard(raw: any): ValidatedCard {
  const issues: ValidationIssue[] = [];

  const front = toRawString(raw?.front);
  const back = toRawString(raw?.back);
  const plain = toRawString(raw?.plain);
  const source = toRawString(raw?.source);

  const keyword = extractKeyword(front) || '';

  // ── 致命项：不入库 ─────────────────────────────
  if (!front) {
    issues.push({ level: 'fatal', code: 'FRONT_EMPTY', message: '原句为空' });
  } else {
    const marks = [...front.matchAll(KW_RE)].length;
    if (marks === 0) {
      issues.push({ level: 'fatal', code: 'NO_KEYWORD_MARK', message: '原句缺少 **重点字** 标记' });
    } else if (marks > 1) {
      issues.push({
        level: 'fatal',
        code: 'MULTI_KEYWORD_MARK',
        message: `原句有 ${marks} 处重点字标记，每张卡只允许 1 处`,
      });
    }
  }

  if (!back) {
    issues.push({ level: 'fatal', code: 'BACK_EMPTY', message: '释义为空' });
  }

  if (back && toPlain(back).length > 40) {
    issues.push({
      level: 'fatal',
      code: 'BACK_TOO_LONG',
      message: `释义 ${toPlain(back).length} 字，超过 40 字上限（应只写本句中该字的义项）`,
    });
  }

  // ── 警告项：入库但标记待复核 ────────────────────
  if (front && toPlain(front).length < 5) {
    issues.push({ level: 'warn', code: 'FRONT_TOO_SHORT', message: '原句过短，可能不是完整例句' });
  }
  if (!plain) {
    issues.push({ level: 'warn', code: 'PLAIN_EMPTY', message: '缺少白话文翻译' });
  }
  if (back && looksLikeAnnotationPolluted(back, keyword)) {
    issues.push({
      level: 'warn',
      code: 'BACK_POLLUTED',
      message: '释义疑似混入注释/字头解释，请人工确认',
    });
  }
  if (back && keyword && toPlain(back) === keyword) {
    issues.push({ level: 'warn', code: 'BACK_EQ_KEYWORD', message: '释义与重点字相同，可能是无效卡' });
  }

  const status: ValidatedCard['status'] = issues.some(i => i.level === 'fatal')
    ? 'rejected'
    : issues.length > 0
      ? 'needs-review'
      : 'ok';

  return { front, back, plain, source, keyword, issues, status };
}

function toRawString(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

export interface DedupeResult {
  cards: ValidatedCard[];
  /** 卡内/批内重复被剔除的数量 */
  duplicateInBatch: number;
}

/**
 * 批内去重。两种重复都算：
 *   1. 同一重点字 + 同一释义（同字同义重复出题，会污染干扰项池）
 *   2. 完全相同的原句**且**释义也相同（真正的整体重复）
 *
 * 注意顺序很关键：必须先判「字+义」。若先判「原句相同」，
 * 那么「君子**生**非异也 / 天性」「君子**生**非异也 / 生长」这类
 * 同句多义卡会被误杀 —— 而一词多义恰恰是本项目最想保留的。
 * 线上 **当** 一字就有 8 个义项，属于正确行为。
 */
export function dedupeCards(cards: ValidatedCard[]): DedupeResult {
  const seenKwBack = new Set<string>();
  const out: ValidatedCard[] = [];
  let duplicateInBatch = 0;

  for (const c of cards) {
    if (c.status === 'rejected') {
      out.push(c);
      continue;
    }
    const kwBackKey = `${c.keyword}\u0001${toPlain(c.back)}`;
    if (seenKwBack.has(kwBackKey)) {
      duplicateInBatch++;
      continue;
    }
    seenKwBack.add(kwBackKey);
    out.push(c);
  }

  return { cards: out, duplicateInBatch };
}

/**
 * 解析 AI 返回文本 → 卡片数组。
 * 兼容三种情况：纯 JSON 数组、```json 代码块、以及旧版「正面 ||| 背面」文本。
 */
export function parseAiOutput(content: string): { cards: ValidatedCard[]; legacyFormat: boolean; rawCount: number } {
  const text = (content || '').trim();
  if (!text) return { cards: [], legacyFormat: false, rawCount: 0 };

  // 1. 去掉 markdown 代码围栏
  let body = text;
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) body = fence[1].trim();

  // 2. 尝试整体 JSON
  const parsed = tryParseJsonArray(body);
  if (parsed) {
    const cards = parsed.map(validateCard);
    return { cards, legacyFormat: false, rawCount: parsed.length };
  }

  // 3. 兜底：旧版 ' ||| ' 文本（AI 偶尔不遵守 JSON 指令）
  const legacy: ValidatedCard[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const sep = t.indexOf(' ||| ');
    if (sep <= 0) continue;
    const front = t.slice(0, sep).trim();
    const back = t.slice(sep + 5).trim();
    if (!front || !back) continue;
    legacy.push(validateCard({ front, back, plain: '' }));
  }
  if (legacy.length > 0) {
    return { cards: legacy, legacyFormat: true, rawCount: legacy.length };
  }

  return { cards: [], legacyFormat: false, rawCount: 0 };
}

function tryParseJsonArray(body: string): any[] | null {
  const candidates: string[] = [body];
  // 容错：AI 可能在 JSON 前后加了解释性文字
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start >= 0 && end > start) candidates.push(body.slice(start, end + 1));

  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (Array.isArray(v)) return v;
      if (v && Array.isArray(v.cards)) return v.cards;
    } catch { /* try next */ }
  }
  return null;
}
