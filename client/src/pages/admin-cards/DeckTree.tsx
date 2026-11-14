// 左栏 —— 牌组树
//
// 【设计依据（线上实测）】
// 管理员 151 个牌组：1 个大卡组（546「文言文150实词2.1」，869 张卡，已上架）
//                   + 150 个已并入它的单字牌组（当/发/间/见…，各 5~15 张）
//                   + 0 个未并入的独立小牌组
//
// 所以「大卡组 / 小卡组」的二分是错的 —— 小卡组区会永远塞着 149 个平铺项，
// 和改造前一屏 pill 的毛病一模一样。改成按「角色」分三段，
// 已并入区再按拼音首字母切段，才有通讯录的可扫性。
//
// 【2026-10-12 补充】切段后字母桶默认是收起的，老师反馈「小牌组不见了」
// （要点两层才看得到牌组名）。现改为字母桶默认全部展开，字母头仍可点击收起。

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, FolderPlus, GitMerge, Layers, PanelLeftClose, Search, X } from 'lucide-react';
import DeckTreeItem, { SourceDeckRow, TreeSection } from './DeckTreeItem';
import type { Deck } from './types';
import type { UseAdminDecksResult } from './hooks/useAdminDecks';
import type { DeckNodeActions } from './DeckTreeItem';

export default function DeckTree({
  data,
  selectedDeckId,
  search,
  onSearchChange,
  onSelect,
  actions,
  onNewDeck,
  onDeleteSourceDeck,
  onCollapse,
}: {
  data: UseAdminDecksResult;
  selectedDeckId: number | null;
  search: string;
  onSearchChange: (v: string) => void;
  onSelect: (d: Deck) => void;
  actions: DeckNodeActions;
  onNewDeck: () => void;
  onDeleteSourceDeck: (e: React.MouseEvent, deckId: number) => void;
  /** 收起左栏（抽屉化） */
  onCollapse: () => void;
}) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    // 三段全展开：大卡组（1 个）、未并入（0 个，显示空态文案）、
    // 已并入（150 个，内部按拼音首字母再分桶，每桶默认折叠，总高度可控）。
    // 上一版把「已并入」默认收起，导致左栏展开前只有 3 行、下面 400px 死白。
    new Set(['big', 'independent', 'nested']),
  );
  const [expandedBigId, setExpandedBigId] = useState<number | null>(null);
  const [expandedLetters, setExpandedLetters] = useState<Set<string>>(new Set());

  const toggleSection = (key: string) =>
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const toggleLetter = (letter: string) =>
    setExpandedLetters(prev => {
      const next = new Set(prev);
      if (next.has(letter)) next.delete(letter); else next.add(letter);
      return next;
    });

  const { groups, searchResults, searching, nestedByInitial, hostNameOf } = data;

  // 【2026-10-12】字母桶改为「默认全部展开」。
  // 起因：老师反馈「制卡中心的小牌组不见了」—— 150 个已并入的牌组原本折叠在
  // A / B / C… 字母后面，要点两层才看得到牌组名，看上去就像消失了。
  // 现在数据一到就全部展开，字母头仍可单独点击收起；
  // 用 ref 只在首次加载时初始化一次，之后不覆盖用户的手动状态。
  const letterInitRef = useRef(false);
  useEffect(() => {
    if (letterInitRef.current || nestedByInitial.length === 0) return;
    letterInitRef.current = true;
    setExpandedLetters(new Set(nestedByInitial.map(x => x.letter)));
  }, [nestedByInitial]);

  return (
    <aside className="w-[260px] flex-shrink-0 flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden h-[calc(100vh-7rem)] sticky top-5">
      {/* ── 头部：搜索 + 全局操作 ── */}
      <div className="px-2.5 py-2 border-b border-gray-100 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-700">
            <Layers className="w-3.5 h-3.5 text-primary-500" />
            牌组
            <span className="text-[10px] font-normal text-gray-400 tabular-nums">
              {data.decks.length}
            </span>
          </span>
          <div className="flex items-center gap-0.5">
            <button
              onClick={onNewDeck}
              className="p-1.5 rounded-md text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
              title="新建牌组"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => actions.onMerge()}
              className="p-1.5 rounded-md text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
              title="合并牌组"
            >
              <GitMerge className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onCollapse}
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="收起牌组栏 (Ctrl+B)"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="找牌组（支持拼音）"
            className="w-full pl-7 pr-6 py-1 text-[12px] border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300"
          />
          {search && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* ── 主体 ── */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1 space-y-0.5">
        {data.loading ? (
          <div className="space-y-1.5 p-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-5 shimmer rounded-md" />
            ))}
          </div>
        ) : searching ? (
          // ── 搜索结果：平铺，带角色标注 ──
          searchResults.length === 0 ? (
            <p className="text-center text-xs text-gray-400 py-8">未找到匹配的牌组</p>
          ) : (
            <>
              <p className="px-2 py-1 text-[10px] text-gray-400">
                找到 {searchResults.length} 个
              </p>
              {searchResults.map(d => (
                <DeckTreeItem
                  key={d.id}
                  deck={d}
                  selected={selectedDeckId === d.id}
                  hostName={d.merged_into_id ? hostNameOf(d) : undefined}
                  actions={actions}
                  onSelect={onSelect}
                />
              ))}
            </>
          )
        ) : (
          <>
            {/* ═══ 大卡组 ═══ */}
            {groups.big.length > 0 && (
              <TreeSection
                title="大卡组"
                count={groups.big.length}
                accent="blue"
                expanded={expandedSections.has('big')}
                onToggle={() => toggleSection('big')}
              >
                {groups.big.map(d => (
                  <div key={d.id}>
                    <div className="relative">
                      <DeckTreeItem
                        deck={d}
                        selected={selectedDeckId === d.id}
                        actions={actions}
                        onSelect={onSelect}
                      />
                      {/* 展开子牌组的按钮，压在节点右侧卡片数之前 */}
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setExpandedBigId(prev => (prev === d.id ? null : d.id));
                        }}
                        className="absolute left-[13px] top-[26px] z-10 flex items-center gap-0.5 text-[10px] text-amber-500 hover:text-amber-600"
                      >
                        <motion.span
                          animate={{ rotate: expandedBigId === d.id ? 90 : 0 }}
                          transition={{ duration: 0.15 }}
                          className="inline-block"
                        >
                          ▸
                        </motion.span>
                        {d.source_decks?.length ?? 0} 个子牌组
                      </button>
                    </div>
                    {expandedBigId === d.id && (
                      <div className="mt-4 space-y-0.5 max-h-72 overflow-y-auto">
                        {d.source_decks?.map(sd => (
                          <SourceDeckRow
                            key={sd.id}
                            deck={sd}
                            selected={selectedDeckId === sd.id}
                            onSelect={() => onSelect({ ...d, id: sd.id, name: sd.name, card_count: sd.card_count, source_decks: [] })}
                            onDelete={e => onDeleteSourceDeck(e, sd.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </TreeSection>
            )}

            {/* ═══ 未并入的字牌组 ═══ */}
            <TreeSection
              title="未并入"
              count={groups.independent.length}
              accent="emerald"
              expanded={expandedSections.has('independent')}
              onToggle={() => toggleSection('independent')}
            >
              {groups.independent.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-gray-400 leading-relaxed">
                  所有字牌组都已并入大卡组
                </p>
              ) : (
                groups.independent.map(d => (
                  <DeckTreeItem
                    key={d.id}
                    deck={d}
                    selected={selectedDeckId === d.id}
                    actions={actions}
                    onSelect={onSelect}
                  />
                ))
              )}
            </TreeSection>

            {/* ═══ 已并入 —— 按拼音首字母分段，默认收起 ═══ */}
            {groups.nested.length > 0 && (
              <TreeSection
                title={`已并入 · ${hostNameOf(groups.nested[0])}`}
                count={groups.nested.length}
                accent="gray"
                expanded={expandedSections.has('nested')}
                onToggle={() => toggleSection('nested')}
              >
                {nestedByInitial.map(({ letter, decks }) => (
                  <div key={letter}>
                    <button
                      onClick={() => toggleLetter(letter)}
                      className="w-full flex items-center gap-1 px-2.5 py-[3px] rounded-md hover:bg-gray-50 transition-colors"
                    >
                      <motion.span
                        animate={{ rotate: expandedLetters.has(letter) ? 90 : 0 }}
                        transition={{ duration: 0.15 }}
                        className="flex-shrink-0 text-gray-300"
                      >
                        <ChevronRight className="w-2.5 h-2.5" />
                      </motion.span>
                      <span className="w-3 text-[10px] font-mono font-semibold text-gray-400">
                        {letter}
                      </span>
                      <span className="text-[10px] text-gray-400 tabular-nums">
                        {decks.length}
                      </span>
                    </button>
                    {expandedLetters.has(letter) && (
                      <div className="space-y-0.5">
                        {decks.map(d => (
                          <DeckTreeItem
                            key={d.id}
                            deck={d}
                            selected={selectedDeckId === d.id}
                            actions={actions}
                            onSelect={onSelect}
                            indented
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </TreeSection>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
