// 右栏 —— 牌组标题栏
//
// 替代原来那个占了近 1/4 屏的渐变 Hero（笔记/卡片/牌组三个大数字）。
//
// 【2026-09-29 第二轮：压成一行】
// 上一版还是两行（标题+徽章一行，统计一行），在 869 张卡的页面里，
// 头部每多占 30px，列表就少一屏半。现在全部塞进一行：
//   左：名称 + 已上架 + 大卡组徽章
//   中：869 张 · 154 字 · ⚠46 待修
//   右：改名 / 合并 / 解散
//
// 统计口径是老师真正关心的：卡片数 / 重点字数 / 风险卡数。
// 「笔记」「卡片」在本项目里永远 1:1，「牌组总数」跟当前牌组无关，都是噪音，已删。

import { AlertTriangle, CheckCircle2, GitMerge, Layers, Pencil, Trash2 } from 'lucide-react';

export default function DeckHeader({
  deckName,
  cardCount,
  keywordCount,
  risk,
  isBigDeck,
  isPublished,
  sourceDeckCount,
  onEdit,
  onMerge,
  onDissolve,
}: {
  deckName: string;
  cardCount: number;
  keywordCount: number;
  risk: { multi: number; missing: number };
  isBigDeck: boolean;
  isPublished: boolean;
  sourceDeckCount: number;
  onEdit: () => void;
  onMerge: () => void;
  onDissolve: () => void;
}) {
  const riskTotal = risk.multi + risk.missing;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-3 py-2">
      <div className="flex items-center gap-2.5">
        {/* ── 左：名称 + 徽章 ── */}
        <div className="flex items-center gap-1.5 min-w-0">
          <h1 className="text-[15px] font-bold text-gray-900 truncate">{deckName || '—'}</h1>

          {isPublished && (
            <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium flex-shrink-0">
              <CheckCircle2 className="w-2.5 h-2.5" />
              已上架
            </span>
          )}

          {isBigDeck && (
            <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-medium flex-shrink-0">
              <Layers className="w-2.5 h-2.5" />
              大卡组 · {sourceDeckCount} 源
            </span>
          )}
        </div>

        {/* ── 中：统计 ── */}
        <div className="flex items-center gap-2 text-[11px] text-gray-400 flex-shrink-0">
          <span className="text-gray-300">|</span>
          <span>
            <strong className="text-gray-700 tabular-nums">{cardCount}</strong> 张
          </span>
          {keywordCount > 0 && (
            <>
              <span className="text-gray-200">·</span>
              <span>
                <strong className="text-gray-700 tabular-nums">{keywordCount}</strong> 字
              </span>
            </>
          )}
          {riskTotal > 0 && (
            <>
              <span className="text-gray-200">·</span>
              <span
                className="flex items-center gap-0.5 text-amber-600"
                title={`${risk.multi} 张标了多处重点字，${risk.missing} 张未标重点字 —— 这些卡在学习端无法组同字干扰项池`}
              >
                <AlertTriangle className="w-3 h-3" />
                <strong className="tabular-nums">{riskTotal}</strong> 待修
              </span>
            </>
          )}
        </div>

        <div className="flex-1" />

        {/* ── 右：操作 ── */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onEdit}
            className="flex items-center gap-1 text-[11px] font-medium text-gray-600 bg-white hover:bg-gray-50 border border-gray-200 px-2 py-1 rounded-lg transition-colors"
            title="修改名称与描述"
          >
            <Pencil className="w-3 h-3" /> 改名
          </button>
          <button
            onClick={onMerge}
            className="flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-1 rounded-lg transition-colors"
            title="把多个小牌组合并为大卡组"
          >
            <GitMerge className="w-3 h-3" /> 合并
          </button>
          {isBigDeck && (
            <button
              onClick={onDissolve}
              className="flex items-center gap-1 text-[11px] font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-2 py-1 rounded-lg transition-colors"
              title="解散合并，源牌组恢复独立"
            >
              <Trash2 className="w-3 h-3" /> 解散
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
