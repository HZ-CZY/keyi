// 制卡中心 —— 共享类型（2026-09-28 UI 重做）
//
// 【为什么单独抽这个文件】
// 原 AdminCardsPage.tsx 是 1947 行单文件，类型定义散在顶部与各处闭包里。
// 重做后拆成 16 个组件，类型必须有个唯一归属地，否则组件间互相 import
// 会形成环。这个文件不依赖任何组件，只依赖 api.ts 的返回形状。

/** GET /admin/decks 的元素 */
export interface Deck {
  id: number;
  name: string;
  description?: string;
  card_count: number;
  /** 非空 = 这个牌组已并入某个大牌组 */
  merged_into_id?: number | null;
  /** 1 = 已上架到书架（学生已在使用，改名需重新推送） */
  published?: number;
  /** 非空 = 这个牌组是从某个源牌组推送出去的副本 */
  source_deck_id?: number | null;
  /** 非空 = 这个牌组是「大牌组」（由若干子牌组合并而成） */
  source_decks?: SourceDeck[];
}

export interface SourceDeck {
  id: number;
  name: string;
  card_count: number;
}

export interface Notetype {
  id: number;
  name: string;
  /** JSON 数组字符串，如 '["Front","Back","白话文"]' */
  field_names: string;
}

export interface CardSummary {
  id: number;
  templateIdx: number;
  queue: number;
  reps: number;
  interval: number;
}

export interface NoteItem {
  id: number;
  notetypeId: number;
  notetypeName: string;
  fieldNames: string[];
  fields: string[];
  tags: string;
  cards: CardSummary[];
}

// ────────────────────────────────────────────────────────────
// 牌组的三重身份
//
// 实测线上数据（管理员 151 个牌组）：
//   · 大卡组   1 个（id=546「文言文150实词2.1」，有 150 个子牌组）
//   · 未并入   0 个
//   · 已并入 150 个（全部 merged_into_id=546）
//
// 所以不能用原来的「大/小」二分 —— 「独立小牌组」实际是空集合，
// 必须按「角色」分，否则 UI 会永远显示一个 149 项的大平铺。
// ────────────────────────────────────────────────────────────
export type DeckRole = 'big' | 'independent' | 'nested';

export function deckRole(d: Deck): DeckRole {
  if (d.source_decks && d.source_decks.length > 0) return 'big';
  if (d.merged_into_id) return 'nested';
  return 'independent';
}

/** 左栏三段式分组的结果 */
export interface DeckGroups {
  big: Deck[];
  independent: Deck[];
  nested: Deck[];
}

// ────────────────────────────────────────────────────────────
// 按重点字分组的卡片视图
// ────────────────────────────────────────────────────────────

/** 一张卡上重点字标记的健康状况 —— 直接决定学习端能否组出干扰项池 */
export type KeywordState = 'ok' | 'multi' | 'missing';

export interface KeywordInfo {
  /** 抽出的重点字；未标记时为 null */
  keyword: string | null;
  /** ** ** 出现的次数 */
  count: number;
  state: KeywordState;
}

export interface KeywordGroup {
  /** 分组键：重点字，或未标记时的 '(未标)' */
  key: string;
  keyword: string | null;
  notes: NoteItem[];
  /** 组内风险卡数，用于组头警示 */
  issues: { multi: number; missing: number };
}

// ────────────────────────────────────────────────────────────
// AI 制卡（与 server/src/routes/lib/aiCardSchema.ts 的返回对齐）
// ────────────────────────────────────────────────────────────

export type CardStatus = 'ok' | 'needs-review' | 'rejected' | 'duplicate';

export interface ValidationIssue {
  level: 'fatal' | 'warn';
  code: string;
  message: string;
}

export interface PreviewCard {
  front: string;
  back: string;
  plain: string;
  source?: string;
  /** 后端抽出的重点字 */
  keyword: string;
  status: CardStatus;
  issues: ValidationIssue[];
}

export interface PreviewStats {
  total: number;
  ok: number;
  needsReview: number;
  rejected: number;
  duplicateInBatch: number;
  duplicateInLibrary: number;
  importable: number;
}

export interface PreviewResult {
  success: boolean;
  /** true = AI 没守 JSON 协议，走了旧 ' ||| ' 兜底解析 */
  legacyFormat: boolean;
  documentLength: number;
  stats: PreviewStats;
  issues: (ValidationIssue & { index: number })[];
  cards: PreviewCard[];
}

export interface CommitResult {
  success: boolean;
  message: string;
  stats: {
    created: number;
    skippedDuplicate: number;
    needsReview: number;
    duplicateInBatch: number;
    rejected: number;
    notetypeName: string;
    notetypeCreated: boolean;
  };
  rejected: { front: string; reasons: string[] }[];
}

/** 预览表格里老师正在编辑的一行 —— 在 PreviewCard 上叠加上本地编辑态 */
export interface EditableCard extends PreviewCard {
  /** 老师手动标记「这张不要」 */
  __skip?: boolean;
}

// ────────────────────────────────────────────────────────────
// 消息条
// ────────────────────────────────────────────────────────────

export interface Message {
  type: 'error' | 'success';
  text: string;
}

/** 产品名统一 —— 上一轮已把面向用户的「单词」改为「卡片」 */
export const APP_TERM = '卡片' as const;
