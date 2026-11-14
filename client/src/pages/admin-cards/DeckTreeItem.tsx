// 左栏牌组树 —— 单个节点
//
// 三种节点形态合一：
//   · big         大卡组：可展开看子牌组，kebab 有「改名 / 合并 / 解散」
//   · independent 未并入的小牌组：kebab 有「改名 / 合并 / 删除」
//   · nested      已并入的小牌组：名字下挂「↳ 主机名」，kebab 同上
//
// 操作入口全部收进 hover 出现的 kebab —— 151 个节点如果每个都挂 3 个按钮，
// 视觉会彻底糊掉。

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookOpen, CheckCircle2, ChevronRight, Layers, MoreHorizontal, Pencil, Trash2,
} from 'lucide-react';
import type { Deck } from './types';
import { deckRole } from './types';

export interface DeckNodeActions {
  onEdit: (d: Deck) => void;
  onMerge: () => void;
  onDissolve: (d: Deck) => void;
  onDelete: (d: Deck) => void;
}

function KebabMenu({
  deck,
  actions,
  onClose,
}: {
  deck: Deck;
  actions: DeckNodeActions;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // 延迟绑定：避免触发菜单的那次 click 立刻把它关掉
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler); };
  }, [onClose]);

  const role = deckRole(deck);
  const items = [
    { icon: Pencil, label: '改名 / 改描述', onClick: () => actions.onEdit(deck) },
    { icon: Layers, label: '合并牌组…', onClick: () => actions.onMerge() },
  ];
  if (role === 'big') {
    items.push({ icon: Trash2, label: '解散合并', onClick: () => actions.onDissolve(deck) });
  } else {
    items.push({ icon: Trash2, label: '删除牌组', onClick: () => actions.onDelete(deck) });
  }

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.94, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: -4 }}
      transition={{ duration: 0.12 }}
      className="absolute right-1 top-8 z-30 w-40 bg-white rounded-xl shadow-lg border border-gray-200 py-1 origin-top-right"
      onClick={e => e.stopPropagation()}
    >
      {items.map(it => (
        <button
          key={it.label}
          onClick={() => { onClose(); it.onClick(); }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-left transition-colors ${
            it.label.includes('删除') || it.label.includes('解散')
              ? 'text-red-600 hover:bg-red-50'
              : 'text-gray-700 hover:bg-gray-50'
          }`}
        >
          <it.icon className="w-3.5 h-3.5" />
          {it.label}
        </button>
      ))}
    </motion.div>
  );
}

export default function DeckTreeItem({
  deck,
  selected,
  hostName,
  actions,
  onSelect,
  indented = false,
}: {
  deck: Deck;
  selected: boolean;
  /** 已并入时，主机牌组名 */
  hostName?: string;
  actions: DeckNodeActions;
  onSelect: (d: Deck) => void;
  /** 是否作为大卡组下的子项渲染 */
  indented?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const role = deckRole(deck);
  const isBig = role === 'big';

  return (
    <div className={`relative group ${indented ? 'ml-4' : ''}`}>
      <div
        className={`flex items-center gap-1.5 rounded-lg cursor-pointer transition-colors ${
          selected ? 'bg-primary-50' : 'hover:bg-gray-50'
        }`}
        onClick={() => onSelect(deck)}
      >
        {/* 选中竖条：用 transform 缩放而不是改宽度，避免重排 */}
        <span
          className={`w-[3px] self-stretch rounded-full transition-transform duration-150 origin-center ${
            selected ? 'bg-primary-500 scale-y-100' : 'bg-transparent scale-y-0'
          }`}
        />

        <span className="flex-1 min-w-0 flex items-center gap-1.5 py-1">
          {isBig
            ? <Layers className={`w-3.5 h-3.5 flex-shrink-0 ${selected ? 'text-primary-500' : 'text-blue-400'}`} />
            : <BookOpen className={`w-3 h-3 flex-shrink-0 ${selected ? 'text-primary-500' : 'text-gray-300'}`} />}

          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              <span
                className={`truncate text-[12px] ${
                  selected ? 'text-primary-700 font-semibold' : 'text-gray-700'
                }`}
              >
                {deck.name}
              </span>
              {deck.published === 1 && (
                <CheckCircle2
                  className="w-3 h-3 flex-shrink-0 text-emerald-500"
                  aria-label="已上架"
                />
              )}
            </span>
            {hostName && (
              <span className="block truncate text-[10px] text-gray-400 leading-tight">
                ↳ {hostName}
              </span>
            )}
          </span>

          <span className={`flex-shrink-0 text-[10px] tabular-nums ${selected ? 'text-primary-400' : 'text-gray-400'}`}>
            {deck.card_count}
          </span>
        </span>

        <button
          onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
          className={`p-1 mr-0.5 rounded-md text-gray-300 hover:text-gray-600 hover:bg-gray-200/60 transition-opacity ${
            menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
          }`}
          aria-label="更多操作"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <KebabMenu deck={deck} actions={actions} onClose={() => setMenuOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

/** 大卡组下的子牌组行（内联渲染，比复用 DeckTreeItem 更紧凑） */
export function SourceDeckRow({
  deck,
  selected,
  onSelect,
  onDelete,
}: {
  deck: { id: number; name: string; card_count: number };
  selected: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={`group/src flex items-center gap-1.5 ml-4 pl-2 py-1 rounded-lg cursor-pointer transition-colors ${
        selected ? 'bg-primary-50' : 'hover:bg-gray-50'
      }`}
      onClick={onSelect}
    >
      <BookOpen className={`w-3 h-3 flex-shrink-0 ${selected ? 'text-primary-500' : 'text-amber-400'}`} />
      <span className={`flex-1 truncate text-[12px] ${selected ? 'text-primary-700 font-medium' : 'text-gray-600'}`}>
        {deck.name}
      </span>
      <span className="text-[10px] text-gray-400 tabular-nums">{deck.card_count}</span>
      <button
        onClick={e => { e.stopPropagation(); onDelete(e); }}
        className="p-0.5 mr-0.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover/src:opacity-100 transition-opacity"
        aria-label="删除子牌组"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

/** 可折叠的分区标题 */
export function TreeSection({
  title,
  count,
  expanded,
  onToggle,
  accent = 'gray',
  children,
}: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  accent?: 'blue' | 'emerald' | 'gray';
  children: React.ReactNode;
}) {
  const tone = {
    blue: 'text-blue-600',
    emerald: 'text-emerald-600',
    gray: 'text-gray-500',
  }[accent];

  return (
    <div>
      <button
        onClick={onToggle}
      className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-gray-50 transition-colors ${tone}`}
    >
      <motion.span
        animate={{ rotate: expanded ? 90 : 0 }}
        transition={{ duration: 0.15 }}
        className="flex-shrink-0"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </motion.span>
      <span className="text-[11px] font-semibold tracking-wide">{title}</span>
      <span className="text-[10px] px-1.5 rounded-full bg-gray-100 text-gray-500 tabular-nums">
        {count}
      </span>
    </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 pb-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
