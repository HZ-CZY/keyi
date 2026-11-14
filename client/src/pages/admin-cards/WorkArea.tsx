// 右栏 —— 工作区
//
// 结构：标题栏（DeckHeader）→ 工具栏（搜索 / 视图切换 / 新建 / AI）→ 卡片列表
//
// 改造中删掉的东西（原 AdminCardsPage.tsx）：
//   · 渐变 Hero 大标题 + 笔记/卡片/牌组三个数字 —— 占了近 1/4 屏，信息量极低
//   · 4 个渐变大卡按钮组成的「快速操作区」—— 低频操作占了最显眼的位置
//   · 队列分布条（新/学习/复习/重学）—— 那是学生学习进度，不是制卡质量
//   · 笔记类型筛选 + 行内类型徽章 —— 线上 1738 张卡 100% 是「古文翻译」，
//     这个筛选器永远只有一个选项

import { Layers, LayoutGrid, List, Plus, Search, Sparkles, X } from 'lucide-react';
import DeckHeader from './DeckHeader';
import CardList, { SkeletonRows } from './CardList';
import type { KeywordGroup, NoteItem } from './types';
import type { CardSortField, CardSortOrder, CardViewMode } from './hooks/useAdminNotes';

export default function WorkArea({
  hasDeck,
  deckName,
  cardCount,
  keywordCount,
  risk,
  isBigDeck,
  isPublished,
  sourceDeckCount,

  handleDeckId,
  bigDeckName,

  loading,
  groups,
  filtered,
  notesCount,
  viewMode,
  onViewModeChange,
  search,
  onSearchChange,
  onClearSearch,
  sortField,
  onSortFieldChange,
  sortOrder,
  onSortOrderToggle,

  onEditDeck,
  onMerge,
  onDissolve,
  onEditNote,
  onDeleteNote,
  onAi,
  onNew,
}: {
  hasDeck: boolean;
  deckName: string;
  cardCount: number;
  keywordCount: number;
  risk: { multi: number; missing: number };
  isBigDeck: boolean;
  isPublished: boolean;
  sourceDeckCount: number;

  /** 当前牌组 id，切换时用来清空 CardList 的展开态 */
  handleDeckId: number | null;
  bigDeckName?: string;

  loading: boolean;
  groups: KeywordGroup[];
  filtered: NoteItem[];
  notesCount: number;
  viewMode: CardViewMode;
  onViewModeChange: (v: CardViewMode) => void;
  search: string;
  onSearchChange: (v: string) => void;
  onClearSearch: () => void;
  sortField: CardSortField;
  onSortFieldChange: (v: CardSortField) => void;
  sortOrder: CardSortOrder;
  onSortOrderToggle: () => void;

  onEditDeck: () => void;
  onMerge: () => void;
  onDissolve: () => void;
  onEditNote: (n: NoteItem) => void;
  onDeleteNote: (n: NoteItem) => void;
  onAi: () => void;
  onNew: () => void;
}) {
  if (!hasDeck) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[420px] bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary-50 flex items-center justify-center mx-auto mb-3">
            <LayoutGrid className="w-8 h-8 text-primary-300" />
          </div>
          <p className="text-sm font-medium text-gray-600">从左侧选择一个牌组</p>
          <p className="text-xs text-gray-400 mt-1">
            大卡组在顶部，已并入的字牌组按拼音首字母分组
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 space-y-2">
      <DeckHeader
        deckName={deckName}
        cardCount={cardCount}
        keywordCount={keywordCount}
        risk={risk}
        isBigDeck={isBigDeck}
        isPublished={isPublished}
        sourceDeckCount={sourceDeckCount}
        onEdit={onEditDeck}
        onMerge={onMerge}
        onDissolve={onDissolve}
      />

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* ── 工具栏 ── */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-gray-100">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              id="card-search"
              type="text"
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              placeholder="在当前牌组里找卡片（原句 / 释义 / 白话 / 标签）"
              className="w-full pl-8 pr-7 py-1 text-[12px] border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300"
            />
            {search && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* 排序（仅平铺视图有意义，分组视图固定按组排） */}
          {viewMode === 'flat' && (
            <div className="hidden sm:flex items-center border border-gray-200 rounded-lg overflow-hidden flex-shrink-0">
              <select
                value={sortField}
                onChange={e => onSortFieldChange(e.target.value as CardSortField)}
                className="text-[11px] border-0 px-1.5 py-1 bg-white focus:outline-none text-gray-600"
              >
                <option value="keyword">按重点字</option>
                <option value="front">按原句</option>
                <option value="cards">按卡片数</option>
              </select>
              <button
                onClick={onSortOrderToggle}
                className="px-1.5 py-1 text-[11px] text-gray-500 hover:text-primary-600 hover:bg-primary-50 border-l border-gray-200 transition-colors"
                title={sortOrder === 'asc' ? '升序' : '降序'}
              >
                {sortOrder === 'asc' ? '↑' : '↓'}
              </button>
            </div>
          )}

          {/* 视图切换 */}
          <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden flex-shrink-0">
            <button
              onClick={() => onViewModeChange('keyword')}
              className={`px-2 py-1 transition-colors ${
                viewMode === 'keyword'
                  ? 'bg-primary-50 text-primary-600'
                  : 'text-gray-400 hover:bg-gray-50'
              }`}
              title="按重点字分组"
            >
              <Layers className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onViewModeChange('flat')}
              className={`px-2 py-1 transition-colors ${
                viewMode === 'flat'
                  ? 'bg-primary-50 text-primary-600'
                  : 'text-gray-400 hover:bg-gray-50'
              }`}
              title="平铺列表"
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={onNew}
            className="flex items-center gap-1 text-[12px] font-medium text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 px-2.5 py-1 rounded-lg transition-colors flex-shrink-0"
            title="手动新建卡片 (Ctrl+N)"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">新建</span>
          </button>

          <button
            onClick={onAi}
            className="flex items-center gap-1 text-[12px] font-medium text-white bg-primary-600 hover:bg-primary-700 px-2.5 py-1 rounded-lg transition-colors flex-shrink-0"
            title="上传文档，AI 自动制卡"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">AI 制卡</span>
          </button>
        </div>

        {/* ── 列表 ──
            头部压成一行后，列表可用高度从 calc(100vh-22rem) 提到 -14rem，
            1870 视口下约 850px，按 32px 行高可容 26 行。 */}
        {loading ? (
          <SkeletonRows />
        ) : (
          <div key={handleDeckId ?? 'none'} className="max-h-[calc(100vh-14rem)] overflow-y-auto">
            <CardList
              viewMode={viewMode}
              groups={groups}
              filtered={filtered}
              notesCount={notesCount}
              search={search}
              onClearSearch={onClearSearch}
              onEdit={onEditNote}
              onDelete={onDeleteNote}
              onAi={onAi}
              onNew={onNew}
              bigDeckName={bigDeckName}
            />
          </div>
        )}
      </div>
    </div>
  );
}
