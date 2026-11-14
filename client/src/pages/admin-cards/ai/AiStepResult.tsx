// AI 向导 · 第 3 步：入库结果

import { AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react';
import type { CommitResult } from '../types';

export default function AiStepResult({
  result,
  onViewCards,
  onAgain,
}: {
  result: CommitResult;
  onViewCards: () => void;
  onAgain: () => void;
}) {
  const s = result.stats;

  return (
    <div className="space-y-3">
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
        <div className="flex items-center gap-2 text-emerald-800">
          <CheckCircle2 className="w-5 h-5" />
          <span className="font-semibold">{result.message}</span>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-3">
          <div className="bg-white/70 rounded-lg px-3 py-2">
            <div className="text-[19px] font-bold text-emerald-700 tabular-nums">{s.created}</div>
            <div className="text-[10px] text-emerald-600">新增</div>
          </div>
          <div className="bg-white/70 rounded-lg px-3 py-2">
            <div className="text-[19px] font-bold text-gray-600 tabular-nums">{s.skippedDuplicate}</div>
            <div className="text-[10px] text-gray-500">跳过重复</div>
          </div>
          <div className="bg-white/70 rounded-lg px-3 py-2">
            <div className="text-[19px] font-bold text-amber-600 tabular-nums">{s.needsReview}</div>
            <div className="text-[10px] text-amber-600">打了待复核标签</div>
          </div>
        </div>

        <p className="mt-2.5 text-[11px] text-emerald-600">
          笔记类型：{s.notetypeName}
          {s.notetypeCreated && '（本次新建）'}
          {' · '}
          「待复核」的卡片已入库，但打了 <code className="px-1 bg-white/70 rounded">待复核</code> 标签，方便日后筛出来重看。
        </p>
      </div>

      {result.rejected.length > 0 && (
        <div className="border border-rose-200 rounded-xl overflow-hidden">
          <div className="bg-rose-50 px-3 py-2 flex items-center gap-1.5 text-[13px] font-medium text-rose-700">
            <AlertTriangle className="w-4 h-4" />
            未入库 {result.rejected.length} 张
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
            {result.rejected.map((r, i) => (
              <div key={i} className="px-3 py-2">
                <p className="text-[12px] text-gray-700 line-clamp-2">{r.front}</p>
                <p className="text-[11px] text-rose-500 mt-0.5">
                  {r.reasons.join('；') || '未通过校验'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onViewCards}
          className="flex items-center gap-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded-xl transition-colors"
        >
          查看卡片
        </button>
        <button
          onClick={onAgain}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 px-4 py-2 rounded-xl transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" /> 再导一份
        </button>
      </div>
    </div>
  );
}
