import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Loader2, Plus, Search, BookMarked } from 'lucide-react';
import { api } from '../../../lib/api';

interface ShelfDeck {
  id: number;
  name: string;
  description?: string;
  card_count: number;
  added: number; // 0/1 当前用户是否已添加
}

interface ShelfModalProps {
  open: boolean;
  onClose: () => void;
  onAdded?: () => void; // 添加成功后回调（父组件刷新牌组列表）
}

/**
 * 书架 · 全屏书城 (2026-09-08 重设计，参照「全部内容」书城样式)
 * - 全屏浅蓝沉浸背景，替代旧的居中小弹窗
 * - 顶栏（返回 + 全部内容）+ 搜索框 + 书封列表
 * - 书行 = 彩色渐变竖排书封 + 书名 / 描述 / 共 N 词；已添加整行灰化
 * - 语言切换行与左侧分类侧栏因当前数据只有文言文单类，暂不渲染
 */
const COVER_TONES = [
  'from-[#d9534e] via-[#c8423f] to-[#a53232]', // 红
  'from-[#eb9c3f] via-[#dd862c] to-[#c06c1d]', // 橙
  'from-[#82b7e9] via-[#5f9cd8] to-[#3f7cba]', // 蓝
  'from-[#a08fe9] via-[#8670d8] to-[#6549b8]', // 紫
];

export default function ShelfModal({ open, onClose, onAdded }: ShelfModalProps) {
  const [decks, setDecks] = useState<ShelfDeck[] | null>(null);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [kw, setKw] = useState('');

  useEffect(() => {
    if (!open) return;
    setDecks(null);
    setError('');
    setKw('');
    api.decks.shelf()
      .then((d: ShelfDeck[]) => setDecks(d || []))
      .catch((e: any) => setError(e.message || '加载失败'));
  }, [open]);

  const handleAdd = async (deck: ShelfDeck) => {
    setAddingId(deck.id);
    setError('');
    try {
      await api.decks.addFromShelf(deck.id);
      setDecks(prev => (prev || []).map(d => d.id === deck.id ? { ...d, added: 1 } : d));
      onAdded?.();
    } catch (e: any) {
      setError(e.message || '添加失败');
    } finally {
      setAddingId(null);
    }
  };

  if (!open) return null;

  const q = kw.trim().toLowerCase();
  const shown = (decks || []).filter(d =>
    !q || `${d.name} ${d.description || ''}`.toLowerCase().includes(q)
  );

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-gradient-to-b from-[#dfeaf8] via-[#d4e3f5] to-[#c8dbf1]">
      {/* ── 顶栏：返回 + 居中标题 ── */}
      <div className="sticky top-0 z-10 bg-gradient-to-b from-[#dfeaf8] via-[#dfeaf8]/95 to-[#dfeaf8]/0">
        <div className="relative flex items-center justify-center px-5 pt-6 pb-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="返回"
            className="absolute left-4 w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/60 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-slate-600" />
          </button>
          <h1 className="text-[17px] font-bold text-slate-800">全部内容</h1>
        </div>

        {/* ── 搜索框 ── */}
        <div className="px-5 pb-2">
          <div className="flex items-center gap-2.5 h-11 rounded-full bg-white/75 px-4 shadow-sm">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              value={kw}
              onChange={e => setKw(e.target.value)}
              placeholder="搜索"
              className="flex-1 bg-transparent outline-none text-[15px] text-slate-700 placeholder:text-slate-400"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-3 p-3 bg-rose-100/80 text-rose-600 rounded-2xl text-sm">{error}</div>
      )}

      {/* ── 内容区 ── */}
      {decks === null ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-[#2E6BE6]" />
        </div>
      ) : decks.length === 0 ? (
        <div className="text-center py-24">
          <div className="w-16 h-16 mx-auto mb-4 rounded-3xl bg-white/60 flex items-center justify-center shadow-sm">
            <BookMarked className="w-7 h-7 text-slate-300" />
          </div>
          <p className="text-slate-500 text-[15px]">书架暂无内容，等老师上架后即可添加</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="text-center py-24">
          <p className="text-slate-400 text-[15px]">没有找到「{kw.trim()}」相关的内容</p>
        </div>
      ) : (
        <div className="px-5 mt-4 pb-16 bg-gradient-to-b from-transparent via-white/25 to-white/45">
          {shown.map((d, i) => {
            const tone = COVER_TONES[Math.abs(d.id) % COVER_TONES.length];
            const spine = d.name.replace(/\s/g, '').slice(0, 6);
            return (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06, duration: 0.25 }}
                className={`flex items-stretch gap-4 py-6 ${d.added ? 'opacity-45' : ''}`}
              >
                {/* 书封：渐变 + 竖排书名 + 书脊高光 */}
                <div
                  className={`relative w-[58px] shrink-0 rounded-[6px] overflow-hidden bg-gradient-to-b ${tone} shadow-[0_10px_20px_rgba(70,100,150,0.28)]`}
                  style={{ height: 80 }}
                >
                  <div className="absolute top-0 inset-x-0 h-[3px] bg-white/35" />
                  <div className="h-full flex items-center justify-center px-1">
                    <span className="[writing-mode:vertical-rl] text-white font-bold text-[13px] leading-[1.15] tracking-[0.12em] text-center">
                      {spine}
                    </span>
                  </div>
                  <div className="absolute bottom-0 inset-x-0 h-[7px] bg-white/25" />
                  <div className="absolute left-0 inset-y-0 w-[2.5px] bg-black/10" />
                </div>

                {/* 信息区 */}
                <div className="flex-1 min-w-0 flex flex-col pt-0.5">
                  <p className="text-[17px] font-bold text-slate-800 leading-snug">{d.name}</p>
                  {d.description ? (
                    <p className="mt-1.5 text-[13px] text-slate-500 leading-relaxed line-clamp-2">{d.description}</p>
                  ) : null}
                  <p className="mt-auto pt-3 text-[13px] text-slate-400">共 {d.card_count} 词</p>
                </div>

                {/* 状态区：已添加灰字 / 添加按钮 */}
                {d.added ? (
                  <span className="self-end mb-1 text-[12px] text-slate-400 shrink-0">已添加</span>
                ) : (
                  <button
                    onClick={() => handleAdd(d)}
                    disabled={addingId === d.id}
                    className="self-center shrink-0 flex items-center gap-1 pl-3 pr-3.5 py-2 rounded-full bg-[#2E6BE6] hover:bg-[#2559c4] active:scale-95 text-white text-[13px] font-semibold shadow-[0_6px_14px_rgba(46,107,230,0.35)] transition-all disabled:opacity-60"
                  >
                    {addingId === d.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Plus className="w-3.5 h-3.5" />}
                    {addingId === d.id ? '添加中' : '添加'}
                  </button>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
