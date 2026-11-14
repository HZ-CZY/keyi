// 删除确认（笔记/卡片）
//
// 原样搬运原有逻辑与确认文案 —— 这段是安全的，不需要重做。
// 唯一调整：不依赖 notetypeColors（已删除），改用中性标签。

import { Loader2, Trash2 } from 'lucide-react';
import Modal from '../../../components/Modal';
import { renderMarkup } from '../../../lib/markup';
import type { NoteItem } from '../types';

export default function DeleteNoteModal({
  note,
  deleting,
  onClose,
  onConfirm,
}: {
  note: NoteItem | null;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={!!note}
      onClose={onClose}
      title="确认删除"
      icon={<Trash2 className="w-5 h-5 text-red-500" />}
    >
      {note && (
        <div className="space-y-3">
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
            确定要删除这条笔记吗？关联的 <strong>{note.cards.length}</strong> 张卡片也将一并删除。此操作不可撤销。
          </div>

          <div className="text-[13px] text-gray-600 space-y-1 bg-gray-50 rounded-xl p-2.5">
            {note.fieldNames.slice(0, 2).map((name, i) => (
              <p key={i}>
                <span className="text-gray-400 font-medium">{name}：</span>
                {note.fields[i]
                  ? <span dangerouslySetInnerHTML={{ __html: renderMarkup(note.fields[i]) }} />
                  : <span className="text-gray-300 italic">空</span>}
              </p>
            ))}
            {note.fieldNames.length > 2 && (
              <p className="text-gray-400 text-xs">
                ...还有 {note.fieldNames.length - 2} 个字段
              </p>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={onConfirm}
              disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-xl flex items-center gap-2 disabled:bg-gray-300 transition-colors"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              确认删除
            </button>
            <button onClick={onClose} className="btn-secondary text-sm" disabled={deleting}>取消</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
