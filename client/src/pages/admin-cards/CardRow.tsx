// 卡片行 —— 表格密集行（2026-09-29 第二轮：布局改表格）
//
// 【为什么从「流式两段文字」改成表格】
// 第一版一行放「原句 + 释义」两段，行高 ~90px：视口 1870px 时工作区有 ~1500px 宽，
// 而一句古文 30-50 字只占 400px 左右，右边全是空白；同时 869 张卡一屏只看得到 7 行。
// 典型的「宽容器装窄内容」。
//
// 改法：四列网格，列宽固定后文字有轨道、扫视有节奏，行高压到 py-1.5（约 32px），
// 一屏可见行数从 7 提升到 16+。原句和释义单行截断，需要看全就点展开。
//
// 【列定义】与 CardList 的 GRID_COLS 必须一致，否则表头与内容错位：
//   [72px] 字徽章  | [1fr] 原句 | [200px] 释义 | [84px] 操作
//
// 【安全】所有字段走 renderMarkup —— 它内部做白名单净化，
// 历史上有过存储型 XSS（笔记字段可被自建），不能绕过。见 lib/markup.ts 顶部注释。

import { Fragment, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Edit2, GitBranch, Trash2 } from 'lucide-react';
import { renderMarkup } from '../../lib/markup';
import KeywordBadge from './KeywordBadge';
import { parseKeyword } from './keyword';
import type { NoteItem } from './types';

const QUEUE_TEXT: Record<number, { label: string; className: string }> = {
  0: { label: '新', className: 'bg-blue-50 text-blue-600' },
  1: { label: '学习中', className: 'bg-amber-50 text-amber-600' },
  2: { label: '复习', className: 'bg-green-50 text-green-600' },
  3: { label: '重学', className: 'bg-red-50 text-red-600' },
};

/** 与 CardList 的表头共用同一套列宽 —— 唯一来源 */
export const GRID_COLS = 'grid-cols-[72px_minmax(0,1fr)_200px_84px]';

export default function CardRow({
  note,
  onEdit,
  onDelete,
  /** 已并入大卡组时，提示这张卡在两个牌组里是同一张 */
  syncedTo,
}: {
  note: NoteItem;
  onEdit: (n: NoteItem) => void;
  onDelete: (n: NoteItem) => void;
  syncedTo?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const front = note.fields[0] || '';
  const back = note.fields[1] || '';
  const plain = note.fields[2] || '';
  const kwInfo = parseKeyword(front);
  const firstCard = note.cards[0];
  const queue = firstCard ? QUEUE_TEXT[firstCard.queue] : null;
  const tags = (note.tags || '').split(/\s+/).filter(Boolean);
  const hasDetail = !!(plain || tags.length || queue || syncedTo);

  return (
    <Fragment>
      <div
        role="row"
        className={`grid ${GRID_COLS} items-center gap-2 px-2 border-b border-gray-50 last:border-0 cursor-pointer transition-colors ${
          expanded ? 'bg-primary-50/40' : 'hover:bg-gray-50/70'
        }`}
        onClick={() => setExpanded(v => !v)}
      >
        {/* 列 1：重点字徽章 */}
        <div role="cell" className="min-w-0 py-1.5">
          <KeywordBadge info={kwInfo} />
        </div>

        {/* 列 2：原句 —— 单行截断，不换行，保证行高恒定 */}
        <div
          role="cell"
          className="min-w-0 py-1.5 text-[13px] text-gray-800 leading-[1.5] truncate"
          title={front.replace(/\*\*/g, '').replace(/==/g, '')}
          dangerouslySetInnerHTML={{ __html: renderMarkup(front) }}
        />

        {/* 列 3：释义 —— 常显（老师改卡时这是核心信息） */}
        <div
          role="cell"
          className="min-w-0 py-1.5 text-[12px] text-gray-500 leading-[1.5] truncate"
          title={back.replace(/\*\*/g, '').replace(/==/g, '')}
          dangerouslySetInnerHTML={{ __html: renderMarkup(back) }}
        />

        {/* 列 4：操作 —— hover 才显形，平时留白不抢视线 */}
        <div role="cell" className="flex items-center justify-end gap-0.5 group/act">
          <button
            onClick={e => { e.stopPropagation(); onEdit(note); }}
            className="p-1 rounded-md text-gray-300 opacity-0 group-hover/act:opacity-100 focus:opacity-100 hover:text-primary-600 hover:bg-primary-50 transition-[opacity,color,background-color]"
            title="编辑"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete(note); }}
            className="p-1 rounded-md text-gray-300 opacity-0 group-hover/act:opacity-100 focus:opacity-100 hover:text-red-500 hover:bg-red-50 transition-[opacity,color,background-color]"
            title="删除"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <motion.span
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={{ duration: 0.15 }}
            className={`p-0.5 ${expanded ? 'text-primary-500' : 'text-gray-300'}`}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </motion.span>
        </div>
      </div>

      {/* ── 展开行：整行铺开，左缩进与「原句」列对齐 ── */}
      <AnimatePresence initial={false}>
        {expanded && hasDetail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden bg-gray-50/60 border-b border-gray-100 last:border-0"
          >
            <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 px-2 py-2">
              <span className="text-[10px] text-gray-300 text-right">详情</span>
              <div className="space-y-1 min-w-0">
                {plain && (
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] text-gray-400 flex-shrink-0 w-6 mt-[3px]">白话</span>
                    <span className="flex-1 text-[12px] text-gray-600 leading-relaxed">{plain}</span>
                  </div>
                )}

                {back && (
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] text-gray-400 flex-shrink-0 w-6 mt-[3px]">释义</span>
                    <span
                      className="flex-1 text-[12px] text-gray-700 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMarkup(back) }}
                    />
                  </div>
                )}

                <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-gray-400 pt-0.5">
                  {tags.map((t, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-gray-100">#{t}</span>
                  ))}
                  {queue && (
                    <span className={`px-1.5 py-0.5 rounded ${queue.className}`}>{queue.label}</span>
                  )}
                  {note.cards.length > 1 && <span>{note.cards.length} 张卡</span>}
                  {syncedTo && (
                    <span className="flex items-center gap-1 text-primary-500">
                      <GitBranch className="w-3 h-3" />
                      与「{syncedTo}」同一张
                    </span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Fragment>
  );
}
