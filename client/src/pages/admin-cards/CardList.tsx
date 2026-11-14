// 卡片列表 —— 表格密集视图（2026-09-29 第二轮：加表头 + 列对齐）
//
// 【为什么默认分组】
// 线上大卡组 546 有 869 张卡，但只有 154 个不同的重点字（119 个字卡数 >3）。
// 平铺 869 行要滚很久，而且同一个字的不同义项散落在四处 ——
// 而「同字多义项」恰恰是本项目最需要人工核对的维度（重复 / 歧义 / 漏义）。
// 分组后一屏能看完 154 个组头，同字的卡自然相邻。
//
// 【第二轮改动】
// CardRow 已改成四列网格行，这里同步：
//   · 新增吸顶表头，列名「字 / 原句 / 释义 / 操作」
//   · GroupHeader 改用同一套列宽，让组名与「字」列同轨，不再各排各的
//   · 组头不再显示「N 处标记」徽章（与行内徽章重复），风险改在右端出 chip

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, BookOpen, ChevronRight, Sparkles } from 'lucide-react';
import CardRow, { GRID_COLS } from './CardRow';
import { GROUP_WARN_STYLE, UNMARKED_KEY } from './keyword';
import type { KeywordGroup, NoteItem } from './types';

function SkeletonRows({ rows = 16 }: { rows?: number }) {
  return (
    <div className="p-3 space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid grid-cols-[72px_minmax(0,1fr)_200px_84px] gap-2 items-center">
          <div className="h-3.5 shimmer rounded" style={{ width: `${70 + (i % 3) * 10}%` }} />
          <div className="h-3 shimmer rounded" style={{ width: `${55 + (i % 4) * 10}%` }} />
          <div className="h-3 shimmer rounded" style={{ width: `${40 + (i % 3) * 12}%` }} />
          <div className="h-3 shimmer rounded w-8" />
        </div>
      ))}
    </div>
  );
}

/** 吸顶表头 —— 列名与 CardRow 的 GRID_COLS 一一对应 */
function TableHead({ showKeyword = true }: { showKeyword?: boolean }) {
  return (
    <div
      className={`sticky top-0 z-10 grid ${GRID_COLS} gap-2 px-2 py-1.5 bg-gray-50/95 backdrop-blur-sm border-b border-gray-200 text-[10px] font-medium text-gray-400`}
    >
      <span>{showKeyword ? '字' : ''}</span>
      <span>原句</span>
      <span>释义</span>
      <span className="text-right">操作</span>
    </div>
  );
}

function EmptyDeck({ onAi, onNew }: { onAi: () => void; onNew: () => void }) {
  return (
    <div className="text-center py-14">
      <div className="w-14 h-14 rounded-2xl bg-primary-50 flex items-center justify-center mx-auto mb-3">
        <BookOpen className="w-7 h-7 text-primary-300" />
      </div>
      <p className="text-sm font-medium text-gray-600">该牌组暂无卡片</p>
      <p className="text-xs text-gray-400 mt-1 mb-4">上传一份文言文文档，或手动逐张创建</p>
      <div className="flex items-center justify-center gap-2">
        <button
          onClick={onAi}
          className="flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5" /> AI 制卡
        </button>
        <button
          onClick={onNew}
          className="text-[13px] px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          手动新建
        </button>
      </div>
    </div>
  );
}

function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <div className="text-center py-14">
      <p className="text-sm font-medium text-gray-500">未找到匹配的卡片</p>
      <button
        onClick={onClear}
        className="text-xs text-primary-600 hover:text-primary-700 mt-1.5 underline underline-offset-2"
      >
        清除搜索
      </button>
    </div>
  );
}

/** 组头 —— 用与行相同的列宽，让「当」正好落在「字」列下方 */
function GroupHeader({
  group,
  expanded,
  onToggle,
}: {
  group: KeywordGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isUnmarked = group.key === UNMARKED_KEY;
  const warnCount = group.issues.multi + group.issues.missing;
  const warnMsg = [
    group.issues.multi > 0 ? `${group.issues.multi} 张标了多处` : '',
    group.issues.missing > 0 ? `${group.issues.missing} 张未标字` : '',
  ].filter(Boolean).join(' · ');

  return (
    <button
      onClick={onToggle}
      className={`w-full grid ${GRID_COLS} gap-2 items-center px-2 py-[5px] border-b border-gray-100 text-left transition-colors ${
        expanded ? 'bg-gray-50' : 'bg-white hover:bg-gray-50/70'
      }`}
    >
      {/* 列 1：组名（= 重点字），与行内徽章同轨 */}
      <span className="flex items-center gap-1 min-w-0">
        <motion.span
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          className="flex-shrink-0 text-gray-400"
        >
          <ChevronRight className="w-3 h-3" />
        </motion.span>
        <span
          className={`truncate text-[12px] font-semibold ${
            isUnmarked ? 'text-amber-700' : 'text-gray-800'
          }`}
        >
          {isUnmarked ? '未标' : group.key}
        </span>
      </span>

      {/* 列 2/3：卡片数占位，保持网格对齐；空白但不塌陷 */}
      <span className="text-[10px] text-gray-400 tabular-nums">{group.notes.length} 张</span>
      <span />

      {/* 列 4：风险 chip */}
      <span className="flex items-center justify-end gap-1">
        {warnCount > 0 && (
          <span
            className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border font-medium ${GROUP_WARN_STYLE}`}
            title={warnMsg}
          >
            <AlertTriangle className="w-2.5 h-2.5" />
            {warnCount}
          </span>
        )}
      </span>
    </button>
  );
}

export default function CardList({
  viewMode,
  groups,
  filtered,
  notesCount,
  search,
  onClearSearch,
  onEdit,
  onDelete,
  onAi,
  onNew,
  /** 当前牌组是大卡组时，其名字；用于卡片行提示「与 XXX 同一张」 */
  bigDeckName,
}: {
  viewMode: 'keyword' | 'flat';
  groups: KeywordGroup[];
  filtered: NoteItem[];
  notesCount: number;
  search: string;
  onClearSearch: () => void;
  onEdit: (n: NoteItem) => void;
  onDelete: (n: NoteItem) => void;
  onAi: () => void;
  onNew: () => void;
  bigDeckName?: string;
}) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // 【2026-10-12 调整】切换牌组 / 搜索变化时，只展开**第一组**，其余收起。
  // （上一版曾改成全部展开，157 个组一次性铺开太长，这里回退。）
  // 组头可单独点击展开/收起，右上角也有「全部展开 / 全部折叠」。
  useEffect(() => {
    setExpandedKeys(groups.length > 0 ? new Set([groups[0].key]) : new Set());
  }, [groups]);

  const toggleKey = (key: string) =>
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const allExpanded = groups.length > 0 && expandedKeys.size === groups.length;
  const toggleAll = () =>
    setExpandedKeys(allExpanded ? new Set() : new Set(groups.map(g => g.key)));

  if (notesCount === 0) return <EmptyDeck onAi={onAi} onNew={onNew} />;
  if (filtered.length === 0 && search) return <NoMatch onClear={onClearSearch} />;

  // ── 平铺视图 ──
  if (viewMode === 'flat') {
    return (
      <div>
        <TableHead />
        {filtered.map(n => (
          <CardRow key={n.id} note={n} onEdit={onEdit} onDelete={onDelete} syncedTo={bigDeckName} />
        ))}
      </div>
    );
  }

  // ── 分组视图（默认）──
  return (
    <div>
      <TableHead />
      {groups.map(g => {
        const expanded = expandedKeys.has(g.key);
        return (
          <div key={g.key}>
            <GroupHeader group={g} expanded={expanded} onToggle={() => toggleKey(g.key)} />
            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden bg-white"
                >
                  {g.notes.map(n => (
                    <CardRow key={n.id} note={n} onEdit={onEdit} onDelete={onDelete} syncedTo={bigDeckName} />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
      {/* 全部展开/收起 —— 154 个组手动点太累 */}
      {groups.length > 1 && (
        <div className="flex justify-center py-3">
          <button
            onClick={toggleAll}
            className="text-[11px] text-gray-400 hover:text-primary-600 px-3 py-1 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {allExpanded ? '收起全部' : `展开全部 ${groups.length} 组`}
          </button>
        </div>
      )}
    </div>
  );
}

export { SkeletonRows };
