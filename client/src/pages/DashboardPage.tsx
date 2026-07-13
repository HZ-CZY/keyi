import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import ScrollReveal from '../components/ScrollReveal';
import { BookOpen, PlusCircle, Clock, Zap, TrendingUp, Layers, BarChart3, Send, AlertCircle, CheckCircle, Users } from 'lucide-react';

// Dashboard skeleton for non-logged-in users — shows outline with login prompt
function DashboardSkeleton() {
  const { openLoginModal } = useAuth();
  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="text-center sm:text-left">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">欢迎来到刻忆</h1>
        <p className="text-gray-500">登录后查看你的学习数据</p>
      </div>

      {/* Stats Grid — dashed outline cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { icon: Layers, label: '总卡片', color: 'bg-primary-50 text-primary-200' },
          { icon: Clock, label: '明天复习', color: 'bg-orange-50 text-orange-200' },
          { icon: Zap, label: '今日待复习', color: 'bg-green-50 text-green-200' },
          { icon: BookOpen, label: '今日已复习', color: 'bg-blue-50 text-blue-200' },
          { icon: TrendingUp, label: '连续天数', color: 'bg-purple-50 text-purple-200' },
        ].map((item, i) => (
          <div key={i} className="bg-white/40 backdrop-blur-sm rounded-2xl border-2 border-dashed border-gray-200 p-4">
            <div className={`w-10 h-10 rounded-xl ${item.color} flex items-center justify-center mb-3`}>
              <item.icon className="w-5 h-5" />
            </div>
            <div className="text-2xl font-bold text-gray-300">---</div>
            <div className="text-sm text-gray-400">{item.label}</div>
          </div>
        ))}
      </div>

      {/* Due cards section — faded CTA */}
      <div className="bg-gradient-to-br from-gray-100 to-gray-200 rounded-2xl p-6 shadow-soft-lg relative overflow-hidden">
        <div className="absolute inset-0 bg-white/50 backdrop-blur-[2px]" />
        <div className="relative z-10 flex flex-col items-center justify-center py-8">
          <h2 className="text-xl font-bold text-gray-500 mb-2">待复习</h2>
          <p className="text-gray-400 text-sm mb-4">登录后可查看今日待复习内容</p>
          <button
            onClick={openLoginModal}
            className="px-6 py-2.5 rounded-full bg-gradient-to-r from-primary-600 to-indigo-600 text-white text-sm font-medium shadow-soft hover:shadow-lg hover:translate-y-[-1px] transition-all duration-250 ease-premium"
          >
            登录
          </button>
        </div>
      </div>

      {/* Decks List placeholder */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-500">我的牌组</h2>
          <span className="text-gray-300 text-sm">管理牌组 →</span>
        </div>
        <div className="text-center py-16 bg-white/40 backdrop-blur-sm rounded-2xl border-2 border-dashed border-gray-200">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <PlusCircle className="w-8 h-8 text-gray-300" />
          </div>
          <h3 className="text-lg font-semibold text-gray-400 mb-2">登录后查看牌组</h3>
          <p className="text-gray-300 mb-4">登录账号以查看和管理你的学习牌组</p>
          <button
            onClick={openLoginModal}
            className="px-6 py-2.5 rounded-full bg-gradient-to-r from-primary-600 to-indigo-600 text-white text-sm font-medium shadow-soft hover:shadow-lg hover:translate-y-[-1px] transition-all duration-250 ease-premium"
          >
            登录
          </button>
        </div>
      </div>
    </div>
  );
}

// Authenticated dashboard
function AuthenticatedDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === 'admin';
  const [decks, setDecks] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Send deck state
  const [showSend, setShowSend] = useState(false);
  const [sendDeckId, setSendDeckId] = useState<number | null>(null);
  const [sendDeckName, setSendDeckName] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResults, setSendResults] = useState<{success: number; fail: number; messages: string[]} | null>(null);
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    Promise.all([api.decks.list(), api.cards.statsOverview()])
      .then(([decksData, statsData]) => {
        setDecks(decksData);
        setStats(statsData);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero */}
      <ScrollReveal variant="fade-up">
        <div className="text-center sm:text-left">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{user?.username}，欢迎回来</h1>
          <p className="text-gray-500">继续你的学习之旅</p>
        </div>
      </ScrollReveal>

      {/* Stats Grid */}
      <ScrollReveal variant="fade-up" delay={100}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard icon={Layers} label="总卡片" value={stats?.totalCards || 0} color="bg-primary-50 text-primary-700" delay={0} />
          <StatCard icon={Clock} label="明天复习" value={stats?.dueTomorrow || 0} color="bg-orange-50 text-orange-700" delay={50} />
          <StatCard icon={Zap} label="今日待复习" value={stats?.dueToday || 0} color="bg-green-50 text-green-700" delay={100} />
          <StatCard icon={BookOpen} label="今日已复习" value={stats?.todayReviews || 0} color="bg-blue-50 text-blue-700" delay={150} />
          <StatCard icon={TrendingUp} label="连续天数" value={stats?.streak || 0} color="bg-purple-50 text-purple-700" delay={200} />
        </div>
      </ScrollReveal>

      {/* Due cards section */}
      {decks.some(d => d.review_count > 0 || d.learning_count > 0) && (
        <ScrollReveal variant="fade-up" delay={200}>
          <div className="bg-gradient-to-br from-primary-600 via-primary-700 to-indigo-700 rounded-2xl p-6 text-white shadow-soft-lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">待复习</h2>
              <button
                onClick={() => navigate('/study')}
                className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-250 ease-premium hover:translate-y-[-1px]"
              >
                全部学习
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {decks.filter(d => d.review_count > 0 || d.learning_count > 0).slice(0, 3).map(deck => (
                <button
                  key={deck.id}
                  onClick={() => navigate(`/study/${deck.id}`)}
                  className="bg-white/10 hover:bg-white/20 rounded-xl p-4 text-left transition-all duration-250 ease-premium hover:translate-y-[-2px]"
                >
                  <div className="font-medium mb-1 truncate">{deck.name}</div>
                  <div className="text-sm text-white/70">
                    {deck.review_count > 0 && <span>{deck.review_count} 复习 </span>}
                    {deck.learning_count > 0 && <span>{deck.learning_count} 学习中</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </ScrollReveal>
      )}

      {/* Decks List */}
      <ScrollReveal variant="fade-up" delay={300}>
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">我的牌组</h2>
            <Link to="/decks" className="text-primary-600 hover:text-primary-700 text-sm font-medium transition-colors">
              管理牌组 →
            </Link>
          </div>

          {decks.length === 0 ? (
            <div className="text-center py-16 bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover border border-white/40">
              <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <PlusCircle className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">暂无牌组</h3>
              <p className="text-gray-400 mb-4">创建一个牌组开始学习</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {decks.map((deck, i) => (
                <div key={deck.id} className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-5 border border-white/40">
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="font-semibold text-gray-900 truncate flex-1">{deck.name}</h3>
                      <span className="text-xs text-gray-400 ml-2">{deck.card_count || 0} 张卡片</span>
                    </div>
                    <div className="flex gap-2 mb-4">
                      {deck.new_count > 0 && (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-medium">
                          {deck.new_count} 新
                        </span>
                      )}
                      {deck.learning_count > 0 && (
                        <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-lg text-xs font-medium">
                          {deck.learning_count} 学习中
                        </span>
                      )}
                      {deck.review_count > 0 && (
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-lg text-xs font-medium">
                          {deck.review_count} 到期
                        </span>
                      )}
                    </div>
                    {/* Progress bar */}
                    {deck.card_count > 0 && (
                      <div className="mb-3">
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-primary-500 to-indigo-500 rounded-full transition-all duration-500 ease-premium"
                            style={{ width: `${deck.card_count > 0 ? Math.max(5, ((deck.card_count - (deck.new_count + deck.learning_count + deck.review_count)) / deck.card_count) * 100) : 0}%` }}
                          />
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => navigate(`/study/${deck.id}`)}
                        disabled={deck.card_count === 0}
                        className="flex-1 btn-primary text-sm py-2 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:translate-y-0"
                      >
                        <BookOpen className="w-4 h-4" /> 学习
                      </button>
                      <button
                        onClick={() => navigate(`/review/${deck.id}`)}
                        disabled={deck.card_count === 0}
                        className="flex-1 btn-primary text-sm py-2 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:translate-y-0"
                      >
                        <BarChart3 className="w-4 h-4" /> 复习
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => openSendConfirm(deck.id, deck.name)}
                          disabled={deck.card_count === 0}
                          className="px-3 py-2 bg-amber-50 text-amber-700 rounded-xl text-sm font-medium hover:bg-amber-100 transition-all duration-250 ease-premium hover:translate-y-[-1px] disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed disabled:hover:translate-y-0 flex items-center gap-1"
                          title="一键发送给所有用户"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
              ))}
            </div>
          )}
        </div>
      </ScrollReveal>

      {/* Send Deck Dialog */}
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
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();

  if (!user) {
    return <DashboardSkeleton />;
  }

  return <AuthenticatedDashboard />;
}

function StatCard({ icon: Icon, label, value, color, delay }: {
  icon: any; label: string; value: number; color: string; delay?: number;
}) {
  return (
    <ScrollReveal variant="fade-up" delay={delay || 0}>
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-4 border border-white/40">
        <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center mb-3`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        <div className="text-sm text-gray-500">{label}</div>
      </div>
    </ScrollReveal>
  );
}
