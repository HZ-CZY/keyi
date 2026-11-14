// AI 向导 · 第 2 步：预览 + 逐卡编辑
//
// 【这是整个向导的价值所在】
// AI 会犯错，而错误卡会污染出题干扰项池 —— 一张没标字的卡会让学习端
// 阶段1/2/3 静默退化（不报错，但题目变水）。所以入库前必须让老师逐条过目。
//
// 四种状态用颜色区分：绿=可入库 / 琥珀=待复核 / 玫红=不通过 / 灰=重复。
// 老师可以把任何一张标成「忽略」，也可以用「只留可入库」一键筛。

import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, Info, Loader2 } from 'lucide-react';
import KeywordBadge from '../KeywordBadge';
import { parseKeyword } from '../keyword';
import { STATUS_META, validateLocal } from './validateFront';
import type { EditableCard, PreviewResult } from '../types';

/** 后端 commit 单次上限，与 admin-ai-import.ts 的 500 一致 */
const MAX_COMMIT = 500;

function StatChip({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium border ${className}`}>
      {label} <strong className="tabular-nums">{value}</strong>
    </span>
  );
}

function CardEditorRow({
  card,
  index,
  onChange,
  onToggleSkip,
}: {
  card: EditableCard;
  index: number;
  onChange: (patch: Partial<EditableCard>) => void;
  onToggleSkip: () => void;
}) {
  const [openIssues, setOpenIssues] = useState(false);

  // 实时按本地规则重算 —— 老师改一下 front 立刻能看到徽章变化
  const local = useMemo(
    () => validateLocal(card.front, card.back, card.plain),
    [card.front, card.back, card.plain],
  );
  const meta = STATUS_META[card.status];
  const fatal = local.issues.filter(i => i.level === 'fatal');

  const inputCls = 'w-full px-2 py-1 text-[12px] border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300';

  return (
    <div className={`border-b border-gray-100 last:border-0 ${card.__skip ? 'opacity-40' : ''}`}>
      <div className="flex items-start gap-2 px-3 py-2">
        {/* 状态点 */}
        <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} title={meta.label} />
        <span className="mt-1 w-5 text-[10px] text-gray-300 tabular-nums flex-shrink-0">{index + 1}</span>

        <div className="flex-1 min-w-0 space-y-1">
          {/* 原句 */}
          <div className="flex items-start gap-2">
            <input
              value={card.front}
              onChange={e => onChange({ front: e.target.value })}
              placeholder="原句（必须含 1 处 **重点字**）"
              className={inputCls}
            />
            <KeywordBadge info={parseKeyword(card.front)} />
          </div>

          {/* 释义 + 白话 */}
          <div className="grid grid-cols-2 gap-1.5">
            <input
              value={card.back}
              onChange={e => onChange({ back: e.target.value })}
              placeholder="释义（≤40 字，只写本句义项）"
              className={inputCls}
            />
            <input
              value={card.plain}
              onChange={e => onChange({ plain: e.target.value })}
              placeholder="白话翻译（整句）"
              className={inputCls}
            />
          </div>

          {/* 出处 + 状态 */}
          <div className="flex items-center gap-1.5">
            <input
              value={card.source || ''}
              onChange={e => onChange({ source: e.target.value })}
              placeholder="出处（可选，如《劝学》）"
              className={`${inputCls} max-w-[200px]`}
            />
            <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${meta.chip} ${meta.text}`}>
              {meta.label}
            </span>
            {local.issues.length > 0 && (
              <button
                onClick={() => setOpenIssues(v => !v)}
                className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                  fatal.length > 0
                    ? 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100'
                    : 'bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100'
                }`}
              >
                <Info className="w-3 h-3" />
                {local.issues.length} 项提示
                <ChevronDown className={`w-3 h-3 transition-transform ${openIssues ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>

          {/* 展开的问题列表 */}
          {openIssues && local.issues.length > 0 && (
            <ul className="space-y-0.5 pt-0.5">
              {local.issues.map((it, i) => (
                <li
                  key={i}
                  className={`text-[11px] flex items-start gap-1.5 ${
                    it.level === 'fatal' ? 'text-rose-600' : 'text-amber-600'
                  }`}
                >
                  <span className="font-mono text-[9px] mt-0.5 opacity-60">{it.code}</span>
                  <span>{it.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 忽略开关 */}
        <label className="flex flex-col items-center gap-0.5 flex-shrink-0 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={!!card.__skip}
            onChange={onToggleSkip}
            className="w-3.5 h-3.5 rounded border-gray-300 text-rose-500 focus:ring-rose-400"
          />
          <span className="text-[9px] text-gray-400">忽略</span>
        </label>
      </div>
    </div>
  );
}

export default function AiStepPreview({
  preview,
  cards,
  onCardsChange,
  onBack,
  onCommit,
  committing,
}: {
  preview: PreviewResult;
  cards: EditableCard[];
  onCardsChange: (next: EditableCard[]) => void;
  onBack: () => void;
  onCommit: (cards: EditableCard[]) => void;
  committing: boolean;
}) {
  const [onlyImportable, setOnlyImportable] = useState(false);

  const stats = preview.stats;
  const truncated = cards.length > MAX_COMMIT;
  const visible = cards.slice(0, MAX_COMMIT);

  // 真正会提交的卡：非 rejected、非 skip
  const importable = useMemo(
    () => visible.filter(c => !c.__skip && c.status !== 'rejected' && c.status !== 'duplicate'),
    [visible],
  );

  const shown = onlyImportable ? visible.filter(c => c.status === 'ok') : visible;

  const patch = (idx: number, p: Partial<EditableCard>) => {
    const next = [...cards];
    next[idx] = { ...next[idx], ...p };
    onCardsChange(next);
  };

  return (
    <div className="space-y-3">
      {/* legacyFormat 告警 */}
      {preview.legacyFormat && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex items-start gap-2 text-[13px] text-amber-800">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">AI 没有遵守 JSON 协议，已按旧格式兜底解析</p>
            <p className="text-[11px] text-amber-600 mt-0.5 leading-relaxed">
              卡片可能缺少白话翻译或重点字标记，请逐条核对后再入库。
            </p>
          </div>
        </div>
      )}

      {/* 统计条 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <StatChip label="共" value={stats.total} className="bg-gray-50 border-gray-200 text-gray-600" />
        <StatChip label="可入库" value={stats.ok} className="bg-emerald-50 border-emerald-200 text-emerald-700" />
        {stats.needsReview > 0 && (
          <StatChip label="待复核" value={stats.needsReview} className="bg-amber-50 border-amber-200 text-amber-700" />
        )}
        {stats.rejected > 0 && (
          <StatChip label="不通过" value={stats.rejected} className="bg-rose-50 border-rose-200 text-rose-700" />
        )}
        {(stats.duplicateInBatch + stats.duplicateInLibrary) > 0 && (
          <StatChip
            label="重复"
            value={stats.duplicateInBatch + stats.duplicateInLibrary}
            className="bg-gray-50 border-gray-200 text-gray-500"
          />
        )}
        <span className="ml-auto text-[11px] text-gray-400">
          文档 {preview.documentLength} 字
        </span>
      </div>

      {truncated && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-2.5 text-[12px] text-rose-700">
          解析出 {cards.length} 张，超过单次入库上限 {MAX_COMMIT} 张。
          本次只会提交前 {MAX_COMMIT} 张，剩余 {cards.length - MAX_COMMIT} 张请分批处理。
        </div>
      )}

      {/* 筛选 */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyImportable}
            onChange={e => setOnlyImportable(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-gray-300 text-primary-500 focus:ring-primary-400"
          />
          <span className="text-[12px] text-gray-600">只看可入库（{stats.ok} 张）</span>
        </label>
        <span className="ml-auto text-[12px] text-gray-500">
          将提交 <strong className="text-primary-600 tabular-nums">{importable.length}</strong> 张
        </span>
      </div>

      {/* 表格 */}
      <div className="border border-gray-200 rounded-xl max-h-[46vh] overflow-y-auto bg-white">
        {shown.length === 0 ? (
          <p className="text-center py-8 text-[13px] text-gray-400">没有符合条件的卡片</p>
        ) : (
          shown.map((c, i) => (
            <CardEditorRow
              key={i}
              card={c}
              index={cards.indexOf(c)}
              onChange={p => patch(cards.indexOf(c), p)}
              onToggleSkip={() => patch(cards.indexOf(c), { __skip: !c.__skip })}
            />
          ))
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={onBack} className="btn-secondary text-sm" disabled={committing}>上一步</button>
        <button
          onClick={() => onCommit(importable)}
          disabled={committing || importable.length === 0}
          className="flex items-center gap-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 px-4 py-2 rounded-xl transition-colors"
        >
          {committing
            ? <><Loader2 className="w-4 h-4 animate-spin" /> 入库中...</>
            : <>确认入库 {importable.length} 张</>}
        </button>
      </div>
    </div>
  );
}
