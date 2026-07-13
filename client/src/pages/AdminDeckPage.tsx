import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useNavigate } from 'react-router-dom';
import {
  Layers, BookOpen, Trash2, ArrowLeft, FileText, Loader2,
  Send, AlertCircle, CheckCircle, Users, RefreshCw, Pencil
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Modal from '../components/Modal';

interface AdminDeck {
  id: number;
  name: string;
  card_count: number;
  new_count?: number;
  learning_count?: number;
  review_count?: number;
  source_decks?: { id: number; name: string; card_count: number }[];
  merged_into_id?: number | null;
}

export default function AdminDeckPage() {
  const navigate = useNavigate();
  const [decks, setDecks] = useState<AdminDeck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [expandedMergedId, setExpandedMergedId] = useState<number | null>(null);

  // Viewing a deck's cards
  const [viewDeck, setViewDeck] = useState<AdminDeck | null>(null);
  const [deckCards, setDeckCards] = useState<any[]>([]);
  const [cardsLoading, setCardsLoading] = useState(false);

  // Send deck
  const [showSend, setShowSend] = useState(false);
  const [sendDeckId, setSendDeckId] = useState<number | null>(null);
  const [sendDeckName, setSendDeckName] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResults, setSendResults] = useState<{ success: number; fail: number; messages: string[] } | null>(null);
  const [sendError, setSendError] = useState('');

  // Rename deck
  const [renamingDeckId, setRenamingDeckId] = useState<number | null>(null);
  const [renameInput, setRenameInput] = useState('');

  const handleStartRename = (deck: AdminDeck) => {
    setRenamingDeckId(deck.id);
    setRenameInput(deck.name);
  };

  const handleRename = async (deckId: number) => {
    const trimmed = renameInput.trim();
    if (!trimmed) { setRenamingDeckId(null); return; }
    try {
      await api.decks.update(deckId, { name: trimmed });
      setDecks(prev => prev.map(d => d.id === deckId ? { ...d, name: trimmed } : d));
    } catch (err: any) {
      setError(err.message || '重命名失败');
    } finally {
      setRenamingDeckId(null);
    }
  };

  useEffect(() => {
    api.admin.decks()
      .then(data => {
        setDecks(data || []);
      })
      .catch((err: any) => {
        setError(err.message || '加载牌组失败');
      })
      .finally(() => setLoading(false));
  }, []);

  const clearMessages = () => { setError(''); setSuccess(''); };

  const viewDeckCards = async (deck: AdminDeck) => {
    setViewDeck(deck);
    setCardsLoading(true);
    try {
      const cards = await api.cards.deckCards(deck.id);
      setDeckCards(cards || []);
    } catch {
      setDeckCards([]);
    } finally {
      setCardsLoading(false);
    }
  };

  const deleteDeck = async (id: number) => {
    if (!confirm('确定删除此牌组及所有卡片？')) return;
    try {
      await api.decks.delete(id);
      setDecks(prev => prev.filter(d => d.id !== id));
      if (viewDeck?.id === id) {
        setViewDeck(null);
        setDeckCards([]);
      }
      // Reload to update source_decks if needed
      const data = await api.admin.decks();
      setDecks(data || []);
    } catch (err: any) {
      setError(err.message || '删除失败');
    }
  };

  const openSend = (deckId: number, deckName: string) => {
    setSendDeckId(deckId);
    setSendDeckName(deckName);
    setSendResults(null);
    setSendError('');
    setSending(false);
    setShowSend(true);
  };

  const handleSendToAll = async () => {
    if (!sendDeckId) return;
    setSendError('');
    setSendResults(null);
    setSending(true);

    try {
      const userList = await api.admin.users();
      const targets = userList.filter((u: any) => u.role !== 'admin');

      if (targets.length === 0) {
        setSendError('没有可发送的用户');
        setSending(false);
        return;
      }

      let success = 0, fail = 0;
      const messages: string[] = [];

      for (const t of targets) {
        try {
          const res = await api.admin.sendDeck(sendDeckId, t.id);
          success++;
          if (res.isUpdate) {
            messages.push(`${t.username}：已更新为最新版本`);
          } else {
            messages.push(`${t.username}：已新建牌组`);
          }
        } catch (err: any) {
          fail++;
          messages.push(`${t.username}：${err.message || '发送失败'}`);
        }
      }

      setSendResults({ success, fail, messages });
    } catch (err: any) {
      setSendError('获取用户列表失败：' + (err.message || '未知错误'));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  // ── Card list view ──
  if (viewDeck) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => { setViewDeck(null); setDeckCards([]); }}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Layers className="w-5 h-5 text-indigo-500" />
                {viewDeck.name}
              </h1>
              <p className="text-sm text-gray-500">{deckCards.length} 张卡片</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{error}</div>
        )}

        {cardsLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
          </div>
        ) : deckCards.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-200 shadow-sm">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">暂无卡片</p>
          </div>
        ) : (
          <div className="space-y-2">
            {deckCards.map((card, i) => {
              let fields: string[] = [];
              try { fields = JSON.parse(card.fields); } catch { fields = []; }
              return (
                <div key={card.id}
                  className="bg-white rounded-2xl border border-gray-200 p-4 flex items-start gap-3 shadow-sm">
                  <span className="text-xs text-gray-400 font-mono mt-1 w-6 flex-shrink-0">{i + 1}.</span>
                  <div className="flex-1 min-w-0 space-y-1">
                    {fields.map((f, fi) => (
                      <div key={fi}
                        className={`leading-relaxed ${fi === 0 ? 'text-sm font-medium text-gray-900' : 'text-sm text-gray-600'}`}>
                        {f || '(空)'}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      card.queue === 0 ? 'bg-blue-100 text-blue-700' :
                      card.queue === 1 ? 'bg-amber-100 text-amber-700' :
                      card.queue === 2 ? 'bg-green-100 text-green-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {['新', '学习中', '复习', '重学'][card.queue] || '?'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Deck list view ──
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Layers className="w-6 h-6 text-indigo-500" />
          牌组管理
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          {decks.filter(d => !d.merged_into_id).length} 个牌组
          {decks.some(d => d.merged_into_id) && <span className="text-gray-400">（{decks.filter(d => d.merged_into_id).length} 个已合并）</span>}
        </p>
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-start gap-2 text-sm text-green-700">
          <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{success}</span>
          <button onClick={() => setSuccess('')} className="ml-auto text-green-400 hover:text-green-600">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Send Confirmation Modal */}
      <Modal open={showSend} onClose={() => setShowSend(false)} title="一键发送牌组" icon={<Send className="w-6 h-6" />}>
        <div className="space-y-4">
          {sendError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-xl text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{sendError}
            </div>
          )}

          {sendResults ? (
            <div>
              <div className="flex items-center gap-4 mb-4">
                <div className="flex items-center gap-1.5 text-green-600 text-sm font-medium">
                  <CheckCircle className="w-4 h-4" /> 成功 {sendResults.success}
                </div>
                {sendResults.fail > 0 && (
                  <div className="flex items-center gap-1.5 text-red-500 text-sm font-medium">
                    <AlertCircle className="w-4 h-4" /> 失败 {sendResults.fail}
                  </div>
                )}
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1 mb-4 p-3 bg-gray-50 rounded-xl text-sm">
                  {sendResults.messages.map((msg, i) => (
                  <div key={i} className={`${msg.includes('失败') ? 'text-red-500' : msg.includes('更新') ? 'text-blue-600' : 'text-green-600'}`}>
                    {msg}
                  </div>
                ))}
              </div>
              <button onClick={() => setShowSend(false)} className="btn-secondary text-sm">关闭</button>
            </div>
          ) : sending ? (
            <div className="flex items-center gap-3 py-6">
              <div className="w-5 h-5 border-2 border-primary-300 border-t-primary-600 rounded-full animate-spin" />
              <span className="text-gray-600 text-sm">正在逐一向所有用户发送...</span>
            </div>
          ) : (
            <div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 flex items-start gap-3">
                <Users className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-amber-800 font-medium text-sm">确认发送给所有用户？</p>
                  <p className="text-amber-600 text-sm mt-1">
                    牌组「{sendDeckName}」将发送给所有普通用户。已存在该牌组的用户将自动更新为最新版本，学习进度不受影响。新增笔记将追加到牌组中。
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSendToAll} className="btn-primary text-sm flex items-center gap-2">
                  <Send className="w-4 h-4" /> 确认发送
                </button>
                <button onClick={() => setShowSend(false)} className="btn-secondary text-sm">取消</button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {decks.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-200 shadow-sm">
          <Layers className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">暂无牌组</p>
        </div>
      ) : (
        <div className="space-y-2">
          {decks.filter(d => !d.merged_into_id).map(deck => {
            const hasSources = deck.source_decks && deck.source_decks.length > 0;
            return (
            <div key={deck.id}
              className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
              {hasSources ? (
                // Merged deck with expandable sources
                <DeckRowWithSources deck={deck} expandedMergedId={expandedMergedId}
                  setExpandedMergedId={setExpandedMergedId} viewDeckCards={viewDeckCards}
                  deleteDeck={deleteDeck} openSend={openSend} navigate={navigate}
                  renamingDeckId={renamingDeckId} renameInput={renameInput}
                  setRenameInput={setRenameInput} handleStartRename={handleStartRename}
                  handleRename={handleRename} />
              ) : (
                // Regular deck
                <div className="p-4 flex items-center gap-4 cursor-pointer group" onClick={() => viewDeckCards(deck)}>
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-100 to-indigo-200 flex items-center justify-center flex-shrink-0">
                    <Layers className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div className="flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                    {renamingDeckId === deck.id ? (
                      <input
                        autoFocus
                        value={renameInput}
                        onChange={e => setRenameInput(e.target.value)}
                        onBlur={() => handleRename(deck.id)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRename(deck.id); if (e.key === 'Escape') setRenamingDeckId(null); }}
                        className="w-full px-2 py-1 text-sm font-semibold border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <h3 className="font-semibold text-gray-900 truncate flex items-center gap-2">
                        {deck.name}
                        <button onClick={() => handleStartRename(deck)}
                          className="p-0.5 text-gray-300 hover:text-amber-500 rounded transition-colors opacity-0 group-hover:opacity-100">
                          <Pencil className="w-3 h-3" />
                        </button>
                      </h3>
                    )}
                    <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                      <span>{deck.card_count} 张卡片</span>
                      {deck.new_count ? <span className="text-blue-600">{deck.new_count} 新</span> : null}
                      {deck.review_count ? <span className="text-green-600">{deck.review_count} 到期</span> : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <button onClick={() => openSend(deck.id, deck.name)}
                      className="p-2 text-purple-500 hover:bg-purple-50 rounded-lg transition-colors" title="一键发送给所有用户">
                      <Send className="w-4 h-4" />
                    </button>
                    <button onClick={() => navigate(`/study/${deck.id}`)}
                      className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors" title="学习">
                      <BookOpen className="w-5 h-5" />
                    </button>
                    <button onClick={() => deleteDeck(deck.id)}
                      className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors" title="删除">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );})}
        </div>
      )}
    </div>
  );
}

// ── Expandable merged deck row ───────────────────────

function DeckRowWithSources({ deck, expandedMergedId, setExpandedMergedId, viewDeckCards, deleteDeck, openSend, navigate,
  renamingDeckId, renameInput, setRenameInput, handleStartRename, handleRename }: {
  deck: AdminDeck; expandedMergedId: number | null;
  setExpandedMergedId: (id: number | null) => void;
  viewDeckCards: (d: AdminDeck) => void; deleteDeck: (id: number) => void;
  openSend: (id: number, name: string) => void; navigate: (path: string) => void;
  renamingDeckId: number | null; renameInput: string;
  setRenameInput: (v: string) => void;
  handleStartRename: (d: AdminDeck) => void; handleRename: (id: number) => void;
}) {
  const isExpanded = expandedMergedId === deck.id;
  const [resyncing, setResyncing] = useState(false);

  const handleResync = async () => {
    setResyncing(true);
    try {
      await api.admin.resyncDeck(deck.id);
      // Reload decks to refresh card counts
      const data = await api.admin.decks();
      // Find and update the deck's card_count
      if (data) {
        const updated = data.find((d: AdminDeck) => d.id === deck.id);
        if (updated) deck.card_count = updated.card_count;
      }
    } catch (err: any) {
      alert('同步失败：' + (err.message || '未知错误'));
    } finally {
      setResyncing(false);
    }
  };

  return (
    <div>
      <div className="flex items-center border-2 border-amber-200 bg-amber-50/50 rounded-2xl overflow-hidden">
        <button onClick={() => setExpandedMergedId(isExpanded ? null : deck.id)}
          className="flex-shrink-0 self-stretch px-3 flex items-center text-amber-400 hover:bg-amber-100/50 transition-colors">
          <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <div className="flex-1 flex items-center gap-3 px-2 py-3 cursor-pointer" onClick={() => viewDeckCards(deck)}>
          <Layers className="w-5 h-5 text-amber-500 flex-shrink-0" />
          <div className="flex-1 min-w-0" onClick={e => e.stopPropagation()}>
            {renamingDeckId === deck.id ? (
              <input
                autoFocus
                value={renameInput}
                onChange={e => setRenameInput(e.target.value)}
                onBlur={() => handleRename(deck.id)}
                onKeyDown={e => { if (e.key === 'Enter') handleRename(deck.id); if (e.key === 'Escape') setRenamingDeckId(null); }}
                className="w-full px-2 py-1 text-sm font-semibold border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <h3 className="font-semibold text-gray-900 truncate flex items-center gap-2">
                {deck.name}
                <button onClick={() => handleStartRename(deck)}
                  className="p-0.5 text-gray-400 hover:text-amber-500 rounded transition-colors">
                  <Pencil className="w-3 h-3" />
                </button>
              </h3>
            )}
            <p className="text-xs text-gray-500">
              {deck.source_decks?.length ?? 0} 子牌组 · {deck.card_count} 张卡片
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 px-2" onClick={e => e.stopPropagation()}>
          <button onClick={() => openSend(deck.id, deck.name)}
            className="p-2 text-purple-500 hover:bg-purple-50 rounded-lg transition-colors" title="发送">
            <Send className="w-4 h-4" />
          </button>
          <button onClick={handleResync} disabled={resyncing}
            className="p-2 text-amber-500 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-40" title="从源牌组重新同步">
            <RefreshCw className={`w-4 h-4 ${resyncing ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => navigate(`/study/${deck.id}`)}
            className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors" title="学习">
            <BookOpen className="w-5 h-5" />
          </button>
          <button onClick={() => deleteDeck(deck.id)}
            className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors" title="删除">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      {isExpanded && (
        <div className="ml-6 mt-1.5 pl-4 border-l-2 border-amber-200 space-y-1">
          {deck.source_decks?.map(sd => (
            <div key={sd.id}
              className="flex items-center justify-between px-3 py-2 bg-white rounded-xl border border-gray-200 cursor-pointer hover:border-gray-300 hover:bg-gray-50 transition-all group"
              onClick={() => viewDeckCards({ ...sd, card_count: sd.card_count } as AdminDeck)}>
              <div className="flex items-center gap-2">
                <BookOpen className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-sm font-medium text-gray-700">{sd.name}</span>
              </div>
              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                <span className="text-xs text-gray-400">{sd.card_count} 张</span>
                <button onClick={() => deleteDeck(sd.id)}
                  className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100" title="删除此子牌组">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
