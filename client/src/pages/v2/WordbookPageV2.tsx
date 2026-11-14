import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { ChevronLeft, BookMarked, AlertCircle, Trash2, CheckCircle2, Loader2 } from 'lucide-react';
import InsightPanel from './InsightPanel';

const INK = '#3A2318';
const INK2 = '#8B6A57';

/** 去掉 HTML 标签 / **高亮** / ==释义== 标记，只留纯文本 */
function plain(s: string): string {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/==(.+?)==/g, '$1')
    .trim();
}

interface FavItem {
  id: number; cardId: number; deckId: number | null; deckName: string;
  front: string; back: string; extra: string; createdAt: number;
}
interface WrongItem {
  id: number; cardId: number; deckId: number | null; deckName: string;
  front: string; back: string; extra: string; wrongCount: number; lastWrongAt: number;
}

/**
 * 单词本 / 错题本
 * ─────────────────────────────────────────────────────────
 * 单词本：答题时点星标收藏的字词，按时间倒序展示，可取消收藏。
 * 错题本：答错自动记录（重复答错累计次数），掌握后点勾移除。
 */
export default function WordbookPageV2() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'fav' | 'wrong' | 'insight'>('fav');
  const [favs, setFavs] = useState<FavItem[]>([]);
  const [wrongs, setWrongs] = useState<WrongItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, w] = await Promise.all([api.wordbook.favorites(), api.wordbook.wrong()]);
      setFavs(f as FavItem[]);
      setWrongs(w as WrongItem[]);
    } catch {
      /* 忽略：保持空态 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const removeFav = async (cardId: number) => {
    setBusy(cardId);
    try {
      await api.wordbook.unfavorite(cardId);
      setFavs((prev) => prev.filter((x) => x.cardId !== cardId));
    } finally {
      setBusy(null);
    }
  };

  const resolveWrong = async (cardId: number) => {
    setBusy(cardId);
    try {
      await api.wordbook.resolveWrong(cardId);
      setWrongs((prev) => prev.filter((x) => x.cardId !== cardId));
    } finally {
      setBusy(null);
    }
  };

  const list: any[] = tab === 'fav' ? favs : wrongs;
  const isInsight = tab === 'insight';

  return (
    <div className="min-h-screen pb-10" style={{ background: 'linear-gradient(180deg,#FFF8F2 0%,#FDF1E8 100%)' }}>
      <header className="sticky top-0 z-20 bg-white/85 backdrop-blur-md border-b border-black/5">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 -ml-1 flex items-center justify-center active:scale-90 transition-transform"
            aria-label="返回"
          >
            <ChevronLeft className="w-6 h-6" style={{ color: INK }} strokeWidth={2.6} />
          </button>
          <h1 className="text-[17px] font-black" style={{ color: INK }}>单词本</h1>
          <span
            className="ml-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(232,52,42,.08)', color: '#C04A2A' }}
          >
            {isInsight ? '按字归纳' : `收藏 ${favs.length} · 错题 ${wrongs.length}`}
          </span>
        </div>
        <div className="max-w-3xl mx-auto px-4 pb-3 flex gap-2">
          {([['fav', '我的收藏'], ['wrong', '错题本'], ['insight', '举一反三']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className="px-4 py-1.5 rounded-full text-[13px] font-bold transition"
              style={
                tab === k
                  ? { background: 'linear-gradient(135deg,#FF6A3D,#E8342A)', color: '#fff' }
                  : { background: 'rgba(0,0,0,.05)', color: INK2 }
              }
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-4">
        {isInsight ? (
          <InsightPanel />
        ) : loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-7 h-7 animate-spin" style={{ color: '#E8342A' }} />
          </div>
        ) : list.length === 0 ? (
          <div className="text-center py-24">
            {tab === 'fav' ? (
              <BookMarked className="w-10 h-10 mx-auto mb-3" style={{ color: '#D9B8A5' }} />
            ) : (
              <AlertCircle className="w-10 h-10 mx-auto mb-3" style={{ color: '#D9B8A5' }} />
            )}
            <div className="text-[14px] font-semibold" style={{ color: INK2 }}>
              {tab === 'fav' ? '还没有收藏的字词' : '还没有错题，继续保持！'}
            </div>
            <div className="text-[12px] mt-1" style={{ color: '#B08A76' }}>
              {tab === 'fav' ? '答题时点右上角的星标，即可收藏到这里' : '答错的字词会自动进入错题本'}
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {list.map((it) => (
              <div key={it.cardId} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-bold leading-6" style={{ color: INK }}>{plain(it.front)}</div>
                    <div className="text-[13px] mt-1" style={{ color: INK2 }}>{plain(it.back)}</div>
                    <div className="flex items-center gap-2 mt-1.5">
                      {it.deckName && <span className="text-[11px]" style={{ color: '#B08A76' }}>{it.deckName}</span>}
                      {tab === 'wrong' && (
                        <span
                          className="text-[11px] font-bold px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(232,52,42,.08)', color: '#C04A2A' }}
                        >
                          错 {it.wrongCount} 次
                        </span>
                      )}
                    </div>
                  </div>
                  {tab === 'fav' ? (
                    <button
                      disabled={busy === it.cardId}
                      onClick={() => removeFav(it.cardId)}
                      className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center hover:bg-rose-50 disabled:opacity-40 transition"
                      title="取消收藏"
                    >
                      <Trash2 className="w-4 h-4 text-rose-400" />
                    </button>
                  ) : (
                    <button
                      disabled={busy === it.cardId}
                      onClick={() => resolveWrong(it.cardId)}
                      className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center hover:bg-emerald-50 disabled:opacity-40 transition"
                      title="标记已掌握"
                    >
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
