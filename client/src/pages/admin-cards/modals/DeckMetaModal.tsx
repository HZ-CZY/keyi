// 通用：牌组名称 / 描述编辑弹窗
//
// 合并了原来两个弹窗：
//   · NewDeckModal  新建牌组（新建时多一个「创建后立即使用」的行为）
//   · EditDeckMetaModal  修改现有牌组（大牌组会额外提示「推送出去的副本需重发」）
//
// 逻辑差异很小，字段完全一样，合并成一个 mode 可控的组件更省事。

import { useEffect, useState } from 'react';
import { CheckCircle, FolderPlus, Info, Loader2, Pencil } from 'lucide-react';
import Modal from '../../../components/Modal';

export default function DeckMetaModal({
  open,
  mode,
  initialName,
  initialDesc,
  isBigDeck,
  sourceDeckCount,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  initialName: string;
  initialDesc: string;
  isBigDeck?: boolean;
  sourceDeckCount?: number;
  saving: boolean;
  onClose: () => void;
  onSubmit: (name: string, desc: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [desc, setDesc] = useState(initialDesc);

  // 每次打开时用最新值重置 —— 否则编辑第二个牌组会看到上一个的名字
  useEffect(() => {
    if (open) {
      setName(initialName);
      setDesc(initialDesc);
    }
  }, [open, initialName, initialDesc]);

  const isCreate = mode === 'create';
  const title = isCreate ? '新建牌组' : '修改牌组';

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title={title}
      icon={isCreate
        ? <FolderPlus className="w-5 h-5" />
        : <Pencil className="w-5 h-5 text-primary-500" />}
    >
      <div className="space-y-3">
        {!isCreate && isBigDeck && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-[13px] text-blue-700">
            <p className="font-medium flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" />
              这是大卡组（由 {sourceDeckCount} 个子牌组合并而成）
            </p>
            <p className="mt-1 text-blue-600 text-xs leading-relaxed">
              改名不会改动任何卡片内容，也不会把它变回普通牌组。
              但已推送给学生的副本需要重新「发送卡组」才会同步新名称。
            </p>
          </div>
        )}

        <div>
          <label className="block text-[13px] text-gray-600 mb-1 font-medium">牌组名称</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="input-field w-full"
            placeholder="输入牌组名称"
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onSubmit(name.trim(), desc); }}
          />
        </div>

        <div>
          <label className="block text-[13px] text-gray-600 mb-1 font-medium">描述（可选）</label>
          {isCreate ? (
            <input
              type="text"
              value={desc}
              onChange={e => setDesc(e.target.value)}
              className="input-field w-full"
              placeholder="简短描述"
            />
          ) : (
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              className="input-field w-full resize-none"
              rows={3}
              placeholder="简短描述，可留空"
            />
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onSubmit(name.trim(), desc)}
            disabled={saving || !name.trim()}
            className="btn-primary text-sm flex items-center gap-2 disabled:bg-gray-300"
          >
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" /> 保存中...</>
              : isCreate
                ? <>创建</>
                : <><CheckCircle className="w-4 h-4" /> 保存</>}
          </button>
          <button onClick={onClose} className="btn-secondary text-sm" disabled={saving}>取消</button>
        </div>
      </div>
    </Modal>
  );
}
