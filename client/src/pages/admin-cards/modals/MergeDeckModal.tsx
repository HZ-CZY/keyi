// 合并牌组弹窗
//
// 【逻辑原样搬运，语义一字未改】
// 上一轮刚给老师做了两个需求，都在这个弹窗里：
//   1. 嵌套合并 —— 小牌组并进大牌组后，仍能继续并进另一个大牌组
//      （开关 allowNestedMerge，勾上才让"已合并过"的牌组出现在候选列表）
//   2. 合并前预告 —— 哪些下层牌组会被一起搬走、哪个旧大牌组会被搬空而自动删除
//
// 候选牌组的三条规则（原样保留）：
//   · 独立小牌组（未合并、无源牌组）—— 始终可选
//   · 已并入别的大牌组的牌组     —— 开启嵌套合并后可选，连同其内容一起搬
//   · 大牌组本身（有源牌组）     —— 始终不可选，需先解散
//
// 【不复用 Modal 的宽度】候选列表可能很长，但 Modal 是 max-w-lg，够用，保持。

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Layers, Loader2 } from 'lucide-react';
import Modal from '../../../components/Modal';
import type { Deck } from '../types';

export interface MergeSelection {
  selectedIds: number[];
  name: string;
  desc: string;
  allowNested: boolean;
}

export default function MergeDeckModal({
  open,
  decks,
  merging,
  onClose,
  onConfirm,
}: {
  open: boolean;
  decks: Deck[];
  merging: boolean;
  onClose: () => void;
  onConfirm: (sel: MergeSelection) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [allowNested, setAllowNested] = useState(false);
  const [sortOrder, setSortOrder] = useState<'az' | 'za' | 'count'>('az');

  useEffect(() => {
    if (open) {
      setSelectedIds([]);
      setName('');
      setDesc('');
      setAllowNested(false);
      setSortOrder('az');
    }
  }, [open]);

  const isBigDeck = (d: Deck) => !!(d.source_decks && d.source_decks.length > 0);
  const independentDecks = decks.filter(d => !d.merged_into_id && !isBigDeck(d));
  const nestedCandidateDecks = decks.filter(d => !!d.merged_into_id && !isBigDeck(d));
  const mergeableDecks = allowNested
    ? [...independentDecks, ...nestedCandidateDecks]
    : independentDecks;

  const selectedNestedDecks = mergeableDecks.filter(
    d => selectedIds.includes(d.id) && !!d.merged_into_id,
  );

  /** 被选中牌组的下层源牌组（仅提示用；真实展开在后端做） */
  const selectedNestedDescendants = selectedNestedDecks.flatMap(d => {
    const parent = decks.find(p => p.id === d.merged_into_id);
    return parent?.source_decks
      ? parent.source_decks.filter(sd => sd.id !== d.id).map(sd => ({ from: d.name, deck: sd }))
      : [];
  });

  /** 开启嵌套后，这些大牌组会因为源被搬空而自动删除 */
  const decksToVanish = useMemo(() => {
    const parents = new Set(
      selectedNestedDecks.map(d => d.merged_into_id).filter(Boolean) as number[],
    );
    return [...parents]
      .map(id => decks.find(d => d.id === id))
      .filter((p): p is Deck => !!p)
      .filter(p => {
        const srcs = p.source_decks || [];
        return srcs.length > 0 && srcs.every(sd => selectedIds.includes(sd.id));
      });
  }, [selectedNestedDecks, decks, selectedIds]);

  const totalCards = mergeableDecks
    .filter(d => selectedIds.includes(d.id))
    .reduce((sum, d) => sum + d.card_count, 0);

  const sorted = [...mergeableDecks].sort((a, b) => {
    if (sortOrder === 'az') return a.name.localeCompare(b.name, 'zh-CN');
    if (sortOrder === 'za') return b.name.localeCompare(a.name, 'zh-CN');
    return b.card_count - a.card_count;
  });

  const toggle = (id: number) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <Modal
      open={open}
      onClose={() => !merging && onClose()}
      title="合并牌组"
      icon={<Layers className="w-5 h-5 text-amber-500" />}
    >
      <div className="space-y-3">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[13px] text-amber-700">
          选择多个小牌组合并为一个大卡组。源牌组保持不变，卡片会被复制到新牌组中。
        </div>

        {/* 嵌套合并开关 */}
        <label className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
          allowNested ? 'bg-primary-50 border-primary-200' : 'bg-gray-50 border-gray-200 hover:border-gray-300'
        }`}>
          <input
            type="checkbox"
            checked={allowNested}
            onChange={e => {
              setAllowNested(e.target.checked);
              if (!e.target.checked) {
                // 关掉时剔除已选的「已合并」牌组，避免悄悄合并
                setSelectedIds(prev =>
                  prev.filter(id => !decks.find(d => d.id === id)?.merged_into_id),
                );
              }
            }}
            className="w-3.5 h-3.5 mt-0.5 rounded border-gray-300 text-primary-500 focus:ring-primary-400"
          />
          <div className="flex-1">
            <div className={`text-[13px] font-medium ${allowNested ? 'text-primary-900' : 'text-gray-700'}`}>
              允许嵌套合并（含已合并过的小牌组）
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
              勾选后，已经并进某个大牌组的小牌组也会出现在下方列表里。
              它会连同原本的大牌组内容一起并入新牌组；若旧大牌组被搬空会自动删除。
            </div>
          </div>
        </label>

        <div>
          <label className="block text-[13px] text-gray-600 mb-1 font-medium">新牌组名称</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="input-field w-full"
            placeholder="例如：文言文150实词2.1"
            onKeyDown={e => {
              if (e.key === 'Enter' && selectedIds.length >= 2 && name.trim()) {
                onConfirm({ selectedIds, name: name.trim(), desc: desc.trim(), allowNested });
              }
            }}
          />
        </div>

        <div>
          <label className="block text-[13px] text-gray-600 mb-1 font-medium">描述（可选）</label>
          <input
            type="text"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            className="input-field w-full"
            placeholder="简短描述"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[13px] text-gray-600 font-medium">
              选择要合并的牌组
              <span className="text-gray-400 font-normal ml-1">({selectedIds.length} 个已选)</span>
            </label>
            <div className="flex items-center gap-1">
              <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                {([['az', 'A-Z'], ['za', 'Z-A'], ['count', '#']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSortOrder(key)}
                    className={`px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      sortOrder === key ? 'bg-amber-100 text-amber-700' : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSelectedIds(
                  selectedIds.length === mergeableDecks.length ? [] : mergeableDecks.map(d => d.id),
                )}
                className="text-[11px] text-amber-600 hover:text-amber-700 underline underline-offset-2"
              >
                {selectedIds.length === mergeableDecks.length ? '取消全选' : '全选'}
              </button>
            </div>
          </div>

          {mergeableDecks.length < 2 ? (
            <div className="text-center py-5 text-gray-400 text-[13px]">
              <Layers className="w-8 h-8 mx-auto mb-2 opacity-40" />
              需要至少 2 个独立小牌组才能合并
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-1 border border-gray-200 rounded-xl p-2">
              {sorted.map(d => {
                const checked = selectedIds.includes(d.id);
                const isNested = !!d.merged_into_id;
                const host = isNested ? decks.find(p => p.id === d.merged_into_id) : null;
                return (
                  <label
                    key={d.id}
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                      checked
                        ? (isNested ? 'bg-primary-50 border border-primary-200' : 'bg-amber-50 border border-amber-200')
                        : 'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(d.id)}
                      className={`w-3.5 h-3.5 rounded border-gray-300 focus:ring-amber-400 ${
                        isNested ? 'text-primary-500' : 'text-amber-500'
                      }`}
                    />
                    <span className={`text-[13px] font-medium flex-1 ${
                      checked ? (isNested ? 'text-primary-900' : 'text-amber-900') : 'text-gray-700'
                    }`}>
                      {d.name}
                      {isNested && (
                        <span className="ml-1.5 text-[10px] font-normal text-primary-500">
                          已并入「{host?.name || '大卡组'}」
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] text-gray-400 tabular-nums">{d.card_count} 张</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* 合并预告 */}
        {selectedIds.length >= 2 && (
          <div className="bg-gray-50 rounded-xl p-2.5 text-[13px] text-gray-600 space-y-1.5">
            <div>
              将合并 <strong className="text-amber-700">{selectedIds.length}</strong> 个牌组，
              预计 <strong className="text-amber-700">{totalCards}</strong> 张卡片
            </div>

            {selectedNestedDescendants.length > 0 && (
              <div className="text-[11px] text-primary-700 bg-primary-50 rounded-lg px-2 py-1.5 leading-relaxed">
                含 <strong>{selectedNestedDecks.length}</strong> 个已合并的牌组，将连同其下层内容一起并过来：
                {selectedNestedDescendants.slice(0, 6).map((item, i) => (
                  <span key={i} className="text-primary-600">
                    「{item.deck.name}」{i < Math.min(selectedNestedDescendants.length, 6) - 1 ? '、' : ''}
                  </span>
                ))}
                {selectedNestedDescendants.length > 6 && (
                  <span> 等 {selectedNestedDescendants.length} 个</span>
                )}
              </div>
            )}

            {decksToVanish.length > 0 && (
              <div className="text-[11px] text-rose-600 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  大卡组 {decksToVanish.map(p => `「${p.name}」`).join('、')} 的源牌组已全部被选中，
                  合并后它会被清空并自动删除
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onConfirm({ selectedIds, name: name.trim(), desc: desc.trim(), allowNested })}
            disabled={merging || selectedIds.length < 2 || !name.trim()}
            className="bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium px-4 py-2 rounded-xl flex items-center gap-2 disabled:bg-gray-300 transition-colors"
          >
            {merging ? <><Loader2 className="w-4 h-4 animate-spin" /> 合并中...</> : <><Layers className="w-4 h-4" /> 开始合并</>}
          </button>
          <button onClick={onClose} className="btn-secondary text-sm" disabled={merging}>取消</button>
        </div>
      </div>
    </Modal>
  );
}
