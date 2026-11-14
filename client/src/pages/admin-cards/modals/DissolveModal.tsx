// 解散合并牌组确认
//
// 逻辑与文案原样搬运 —— 这是破坏性操作，措辞已经写得很明确，不动。

import { Loader2, Trash2 } from 'lucide-react';
import Modal from '../../../components/Modal';
import type { Deck } from '../types';

export default function DissolveModal({
  deck,
  dissolving,
  onClose,
  onConfirm,
}: {
  deck: Deck | undefined;
  dissolving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const src = deck?.source_decks || [];

  return (
    <Modal
      open={!!deck}
      onClose={() => !dissolving && onClose()}
      title="解散合并牌组"
      icon={<Trash2 className="w-5 h-5 text-red-500" />}
    >
      <div className="space-y-3">
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-[13px] text-red-700 space-y-2">
          <p className="font-medium">确定要解散「{deck?.name}」吗？</p>

          {src.length > 0 && (
            <div className="text-red-600 space-y-1">
              <p>操作后：</p>
              <ul className="list-disc list-inside text-[13px] space-y-0.5">
                <li>合并牌组「{deck?.name}」将被删除</li>
                <li>
                  {src.slice(0, 5).map(sd => sd.name).join('、')}
                  {src.length > 5 && ' 等'} <strong>{src.length}</strong> 个源牌组将恢复独立
                </li>
                <li>源牌组中原有的卡片不受影响</li>
              </ul>
            </div>
          )}

          <p className="text-xs text-red-400">此操作不可撤销。</p>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onConfirm}
            disabled={dissolving}
            className="bg-red-500 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-xl flex items-center gap-2 disabled:bg-gray-300 transition-colors"
          >
            {dissolving ? <><Loader2 className="w-4 h-4 animate-spin" /> 解散中...</> : <><Trash2 className="w-4 h-4" /> 确认解散</>}
          </button>
          <button onClick={onClose} className="btn-secondary text-sm" disabled={dissolving}>取消</button>
        </div>
      </div>
    </Modal>
  );
}
