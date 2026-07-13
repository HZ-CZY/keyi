import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import ScrollReveal from '../components/ScrollReveal';
import { Trash2, BookOpen, ArrowLeft, Layers, Send, AlertCircle, CheckCircle, Users, FileText, Search, Pencil } from 'lucide-react';

import { renderMarkup } from '../lib/markup';

export default function DecksPage() {
  const navigate = useNavigate();
  const { user, openLoginModal } = useAuth();
  const isAdmin = (user as any)?.role === 'admin';

  // Non-logged-in skeleton
  if (!user) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-400">牌组管理</h1>
          <p className="text-gray-300 mt-1">管理你的学习牌组</p>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white/40 backdrop-blur-sm rounded-2xl border-2 border-dashed border-gray-200 p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                <Layers className="w-6 h-6 text-gray-300" />
              </div>
              <div className="flex-1">
                <div className="h-4 w-32 bg-gray-100 rounded" />
                <div className="flex gap-2 mt-2">
                  <div className="h-3 w-16 bg-gray-100 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="text-center py-8">
          <p className="text-gray-400 text-sm mb-4">登录后查看你的牌组</p>
          <button
            onClick={openLoginModal}
            className="px-6 py-2.5 rounded-full bg-gradient-to-r from-primary-600 to-indigo-600 text-white text-sm font-medium shadow-soft hover:shadow-lg hover:translate-y-[-1px] transition-all duration-250 ease-premium"
          >
            登录
          </button>
        </div>
      </div>
    );
  }
  const [decks, setDecks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Deck card viewing (full page)
  const [viewingDeck, setViewingDeck] = useState<any>(null);
  const [deckCards, setDeckCards] = useState<any[]>([]);
  const [cardsLoading, setCardsLoading] = useState(false);

  // Send deck state
  const [showSend, setShowSend] = useState(false);
  const [sendDeckId, setSendDeckId] = useState<number | null>(null);
  const [sendDeckName, setSendDeckName] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResults, setSendResults] = useState<{success: number; fail: number; messages: string[]} | null>(null);
  const [sendError, setSendError] = useState('');

  // Rename deck state
  const [renamingDeckId, setRenamingDeckId] = useState<number | null>(null);
  const [renamingName, setRenamingName] = useState('');

  const fetchDecks = () => {
    api.decks.list()
      .then(data => {
        console.log('DecksPage: received', data?.length, 'decks');
        setDecks(data || []);
      })
      .catch(err => {
        console.error('DecksPage: fetch error', err);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchDecks(); }, []);

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此牌组及所有卡片？')) return;
    await api.decks.delete(id);
    if (viewingDeck && viewingDeck.id === id) {
      setViewingDeck(null);
      setDeckCards([]);
    }
    fetchDecks();
  };

  const openDeckCards = async (deck: any) => {
    setViewingDeck(deck);
    setCardsLoading(true);
    api.cards.deckCards(deck.id)
      .then(setDeckCards)
      .catch(() => setDeckCards([]))
      .finally(() => setCardsLoading(false));
  };

  const closeDeckView = () => {
    setViewingDeck(null);
    setDeckCards([]);
  };

  const openSendConfirm = (deckId: number, deckName: string) => {
    setSendDeckId(deckId);
    setSendDeckName(deckName);
    setSendResults(null);
    setSendError('');
    setSending(false);
    setShowSend(true);
  };

  const handleSendToAll = async () => {
    if (!sendDeckId) return;
    setSendError(''); setSendResults(null); setSending(true);

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
          if (res.skipped) {
            messages.push(`${t.username}：已存在，跳过`);
          } else {
            messages.push(`${t.username}：发送成功`);
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

  const handleRename = async (deckId: number) => {
    const trimmed = renamingName.trim();
    if (!trimmed) return;
    try {
      await api.decks.update(deckId, { name: trimmed });
      setRenamingDeckId(null);
      setRenamingName('');
      fetchDecks();
    } catch (err: any) {
      alert('重命名失败：' + (err.message || '未知错误'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    );
  }

  // ── Full-page card list view ──
  if (viewingDeck) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={closeDeckView} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-white/60 rounded-lg transition-colors" title="返回">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Layers className="w-6 h-6 text-primary-600" />
                {viewingDeck.name}
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">{deckCards.length} 张卡片</p>
            </div>
          </div>
          <button onClick={() => navigate(`/study/${viewingDeck.id}`)} className="btn-primary flex items-center gap-2 text-sm">
            <BookOpen className="w-4 h-4" /> 开始学习
          </button>
        </div>

        {/* Card list */}
        {cardsLoading ? (
          <div className="flex items-center justify-center py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : deckCards.length === 0 ? (
          <div className="text-center py-16 bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover border border-white/40">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-500">暂无卡片</h3>
            <p className="text-gray-400 text-sm mt-1">此牌组还没有卡片</p>
          </div>
        ) : (
          <div className="space-y-2">
            {deckCards.map((card, i) => {
              let fields: string[] = [];
              try { fields = JSON.parse(card.fields); } catch { fields = []; }
              return (
                <ScrollReveal key={card.id} variant="fade-up" delay={i * 20}>
                  <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-4 flex items-start gap-3 border border-white/40">
                    <span className="text-xs text-gray-400 font-mono mt-1 w-6 flex-shrink-0">{i + 1}.</span>
                    <div className="flex-1 min-w-0 space-y-1">
                      {fields.map((f, fi) => (
                        <div
                          key={fi}
                          className={`leading-relaxed ${fi === 0 ? 'text-sm font-medium text-gray-900' : 'text-sm text-gray-600'}`}
                          dangerouslySetInnerHTML={{ __html: renderMarkup(f) }}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        card.queue === 0 ? 'bg-blue-100 text-blue-700' :
                        card.queue === 1 ? 'bg-amber-100 text-amber-700' :
                        card.queue === 2 ? 'bg-green-100 text-green-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {['新', '学习中', '复习', '重学'][card.queue] || '?'}
                      </span>
                      <button onClick={() => handleDelete(card.id)}
                        className="p-1.5 text-red-300 hover:text-red-500 hover:bg-red-50/70 rounded-lg transition-colors" title="删除">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </ScrollReveal>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Deck list view ──
  return (
    <div className="space-y-6">
      <ScrollReveal variant="fade-up">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">牌组管理</h1>
            <p className="text-gray-500 mt-1">管理你的学习牌组</p>
          </div>
        </div>
      </ScrollReveal>

      {/* Send Deck Confirmation */}
      <AnimatePresence>
        {showSend && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="bg-white/90 backdrop-blur-sm rounded-2xl card-shadow p-6 overflow-hidden border border-white/40"
          >
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Send className="w-5 h-5 text-primary-600" /> 一键发送 — {sendDeckName}
            </h3>

            {sendError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-xl text-sm mb-4">
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
                <div className="max-h-40 overflow-y-auto space-y-1 mb-4 p-3 bg-gray-50/80 rounded-xl text-sm">
                  {sendResults.messages.map((msg, i) => (
                    <div key={i} className={`${msg.includes('失败') ? 'text-red-500' : msg.includes('跳过') ? 'text-amber-500' : 'text-green-600'}`}>
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
                <div className="bg-amber-50/90 border border-amber-200/60 rounded-xl p-4 mb-4 flex items-start gap-3">
                  <Users className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-amber-800 font-medium text-sm">确认发送给所有用户？</p>
                    <p className="text-amber-600 text-sm mt-1">
                      牌组「{sendDeckName}」将发送给所有普通用户。已存在同名牌组的用户将自动跳过。
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
          </motion.div>
        )}
      </AnimatePresence>

      {/* Decks List */}
      <ScrollReveal variant="fade-up" delay={100}>
        {decks.length === 0 ? (
          <div className="text-center py-16 bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover border border-white/40">
            <Layers className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-500">暂无牌组</h3>
            <p className="text-gray-400">创建一个牌组开始使用</p>
          </div>
        ) : (
          <div className="space-y-3">
            {decks.map((deck, i) => (
              <div
                key={deck.id}
                className="deck-row bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-5 flex items-center gap-4 cursor-pointer border border-white/40"
                onClick={() => renamingDeckId !== deck.id && openDeckCards(deck)}
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-100 to-indigo-100 flex items-center justify-center flex-shrink-0">
                  <Layers className="w-6 h-6 text-primary-600" />
                </div>
                <div className="flex-1 min-w-0">
                  {renamingDeckId === deck.id ? (
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      <input
                        autoFocus
                        value={renamingName}
                        onChange={e => setRenamingName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleRename(deck.id);
                          if (e.key === 'Escape') { setRenamingDeckId(null); setRenamingName(''); }
                        }}
                        className="flex-1 px-3 py-1.5 text-sm font-semibold border border-primary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                      <button onClick={() => handleRename(deck.id)} className="text-sm text-primary-600 font-medium hover:text-primary-700">确定</button>
                      <button onClick={() => { setRenamingDeckId(null); setRenamingName(''); }} className="text-sm text-gray-400 hover:text-gray-600">取消</button>
                    </div>
                  ) : (
                    <h3 className="font-semibold text-gray-900 truncate">{deck.name}</h3>
                  )}
                  <div className="flex gap-2 mt-1">
                    <span className="text-xs text-gray-500">{deck.card_count || 0} 张卡片</span>
                    {deck.new_count > 0 && <span className="text-xs text-blue-600">{deck.new_count} 新</span>}
                    {deck.review_count > 0 && <span className="text-xs text-green-600">{deck.review_count} 到期</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <button onClick={() => navigate(`/study/${deck.id}`)} className="p-2 text-primary-600 hover:bg-primary-50/70 rounded-lg transition-colors" title="学习"><BookOpen className="w-5 h-5" /></button>
                  {isAdmin && (
                    <button onClick={() => openSendConfirm(deck.id, deck.name)} className="p-2 text-purple-500 hover:bg-purple-50/70 rounded-lg transition-colors" title="一键发送给所有用户">
                      <Send className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={() => { setRenamingDeckId(deck.id); setRenamingName(deck.name); }} className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50/70 rounded-lg transition-colors" title="重命名"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => handleDelete(deck.id)} className="p-2 text-red-400 hover:bg-red-50/70 rounded-lg transition-colors" title="删除"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollReveal>
    </div>
  );
}
