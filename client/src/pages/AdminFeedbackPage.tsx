import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import {
  MessageCircle, Trash2, RefreshCw, Send, Loader2, Pencil, X,
  ListTodo, ChevronDown, ChevronRight, CheckCircle2, Circle, AlertTriangle,
} from 'lucide-react';

/**
 * 后台 · 用户反馈
 * 【2026-10-15】新增回复通道：管理员可对每条反馈写一条答复，
 * 学生在「帮助与反馈」里能看到；修改答复会重新点亮学生端红点。
 *
 * 【2026-11-06】接入自动分诊：
 *   · 每条反馈带 类型/模块/严重度/一句话摘要（来自 feedback_triage）
 *   · 顶部多一块「待办清单」——同根因的多条反馈归成一条，按 P0→P3 排
 *   · 待办可标 完成/进行中，状态存 feedback_todos
 */
export default function AdminFeedbackPage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'replied'>('all');

  /* 待办 */
  const [todos, setTodos] = useState<any[]>([]);
  const [todoOpen, setTodoOpen] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [busyGrp, setBusyGrp] = useState<string | null>(null);

  const fetchData = () => {
    setLoading(true);
    api.admin.getFeedback()
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const fetchTodos = () => {
    api.admin.getFeedbackTodos()
      .then(setTodos)
      .catch(() => {});
  };

  useEffect(() => { fetchData(); fetchTodos(); }, []);

  const refreshAll = () => { fetchData(); fetchTodos(); };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此反馈？')) return;
    try {
      await api.admin.deleteFeedback(id);
      fetchData();
    } catch { }
  };

  const startReply = (entry: any) => {
    setEditingId(entry.id);
    setDraft(entry.reply || '');
  };

  const submitReply = async (id: number) => {
    setSaving(true);
    try {
      await api.admin.replyFeedback(id, draft);
      setEditingId(null);
      setDraft('');
      fetchData();
    } catch (e: any) {
      alert(e?.message || '回复失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const toggleTodo = async (grp: string, status: string) => {
    const next = status === 'done' ? 'todo' : 'done';
    setBusyGrp(grp);
    try {
      await api.admin.setFeedbackTodoStatus(grp, next as any);
      setTodos(prev => prev.map(t => (t.grp === grp ? { ...t, status: next } : t)));
    } catch {
      alert('状态没存上，再点一次');
    } finally {
      setBusyGrp(null);
    }
  };

  const replied = (e: any) => !!(e.reply && String(e.reply).trim());
  const pendingCount = entries.filter(e => !replied(e)).length;
  const shown = entries.filter(e =>
    filter === 'all' ? true : filter === 'replied' ? replied(e) : !replied(e)
  );

  /* 待办统计 */
  const openTodos = todos.filter(t => t.status !== 'done');
  const doneTodos = todos.filter(t => t.status === 'done');
  const p0Count = openTodos.filter(t => t.priority === 0).length;
  const shownTodos = showDone ? todos : openTodos;

  /* 徽章配色 */
  const sevStyle = (s: number) =>
    s === 0 ? 'bg-red-50 text-red-600 border-red-200'
    : s === 1 ? 'bg-orange-50 text-orange-600 border-orange-200'
    : s === 2 ? 'bg-sky-50 text-sky-600 border-sky-200'
    : 'bg-gray-50 text-gray-500 border-gray-200';
  const typeStyle = (t: string) =>
    t === 'bug' ? 'bg-red-50 text-red-600'
    : t === '建议' ? 'bg-emerald-50 text-emerald-600'
    : t === '咨询' ? 'bg-sky-50 text-sky-600'
    : t === '投诉' ? 'bg-amber-50 text-amber-600'
    : 'bg-gray-50 text-gray-500';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">用户反馈</h1>
          <p className="text-sm text-gray-500 mt-1">
            查看并回复用户提交的反馈
            {pendingCount > 0 && (
              <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
                {pendingCount} 条待回复
              </span>
            )}
          </p>
        </div>
        <button onClick={refreshAll}
          className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 text-sm font-medium transition-all">
          <RefreshCw className="w-4 h-4" /> 刷新
        </button>
      </div>

      {/* ── 待办清单 ─────────────────────────────── */}
      {todos.length > 0 && (
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover border border-white/40 overflow-hidden">
          <button onClick={() => setTodoOpen(v => !v)}
            className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-gray-50/60 transition-all">
            <div className="flex items-center gap-2">
              <ListTodo className="w-4 h-4 text-indigo-500" />
              <span className="text-sm font-bold text-gray-800">待办</span>
              <span className="text-xs text-gray-400">
                {openTodos.length} 条未处理
              </span>
              {p0Count > 0 && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[11px] font-bold">
                  <AlertTriangle className="w-3 h-3" /> {p0Count} 条 P0
                </span>
              )}
            </div>
            {todoOpen ? <ChevronDown className="w-4 h-4 text-gray-400" />
                      : <ChevronRight className="w-4 h-4 text-gray-400" />}
          </button>

          {todoOpen && (
            <>
              <div className="px-5 pb-2 flex items-center gap-3">
                <button onClick={() => setShowDone(v => !v)}
                  className="text-[11px] text-gray-400 hover:text-gray-600 font-medium">
                  {showDone ? `隐藏已完成（${doneTodos.length}）` : `显示已完成（${doneTodos.length}）`}
                </button>
              </div>
              <div className="divide-y divide-gray-50 max-h-[420px] overflow-y-auto">
                {shownTodos.map(t => {
                  const done = t.status === 'done';
                  return (
                    <div key={t.grp} className={`px-5 py-3 flex items-start gap-3 ${done ? 'opacity-45' : ''}`}>
                      <button onClick={() => toggleTodo(t.grp, t.status)}
                        disabled={busyGrp === t.grp}
                        className="mt-0.5 shrink-0 text-gray-300 hover:text-emerald-500 transition-all disabled:opacity-40">
                        {done ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                              : <Circle className="w-4 h-4" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${sevStyle(t.priority)}`}>
                            P{t.priority}
                          </span>
                          <span className="text-[11px] text-gray-400">{t.module}</span>
                          {t.n_feedback > 1 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-500 font-semibold">
                              {t.n_feedback} 人反馈
                            </span>
                          )}
                        </div>
                        <p className={`text-sm mt-1 ${done ? 'line-through text-gray-400' : 'text-gray-800 font-medium'}`}>
                          {t.title}
                        </p>
                        {t.fix && (
                          <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{t.fix}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
                {shownTodos.length === 0 && (
                  <div className="px-5 py-10 text-center text-xs text-gray-400">
                    没有待处理的，全清了
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover border border-white/40">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {([['all', '全部'], ['pending', '待回复'], ['replied', '已回复']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  filter === k ? 'bg-primary-600 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}>
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">共 {entries.length} 条</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : shown.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            {entries.length === 0 ? '暂无用户反馈' : '该分类下没有反馈'}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {shown.map((entry: any) => {
              const hasReply = replied(entry);
              const editing = editingId === entry.id;
              return (
                <div key={entry.id} className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span className="font-medium text-gray-600">{entry.username}</span>
                      <span>·</span>
                      <span>{new Date(entry.created_at * 1000).toLocaleString('zh-CN', {
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })}</span>
                      {/* 分诊徽章 */}
                      {entry.ftype && (
                        <>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${typeStyle(entry.ftype)}`}>
                            {entry.ftype === 'bug' ? 'BUG' : entry.ftype}
                          </span>
                          <span className="text-[10px] text-gray-400">{entry.module}</span>
                          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${sevStyle(entry.severity)}`}>
                            P{entry.severity}
                          </span>
                          {entry.grp && (
                            <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-600 text-[10px] font-bold">
                              {entry.grp}
                            </span>
                          )}
                          {entry.need_human === 1 && (
                            <span className="px-1.5 py-0.5 rounded border border-rose-200 bg-rose-50 text-rose-600 text-[10px] font-bold">
                              需人工
                            </span>
                          )}
                        </>
                      )}
                      {!hasReply && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-semibold">待回复</span>
                      )}
                    </div>
                    <button onClick={() => handleDelete(entry.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* 分诊摘要 */}
                  {entry.brief && (
                    <div className="text-[11px] text-gray-500 bg-gray-50/80 rounded-lg px-2.5 py-1.5 inline-block">
                      分诊：{entry.brief}
                    </div>
                  )}

                  <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{entry.content}</div>

                  {/* 已有回复 */}
                  {hasReply && !editing && (
                    <div className="rounded-xl bg-indigo-50/70 border border-indigo-100 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-bold text-indigo-600">
                          已回复{entry.replied_by ? ` · ${entry.replied_by}` : ''}
                        </span>
                        <div className="flex items-center gap-2">
                          {entry.replied_at && (
                            <span className="text-[11px] text-indigo-300">
                              {new Date(entry.replied_at * 1000).toLocaleString('zh-CN', {
                                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                              })}
                            </span>
                          )}
                          <button onClick={() => startReply(entry)}
                            className="flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 font-medium">
                            <Pencil className="w-3 h-3" />修改
                          </button>
                        </div>
                      </div>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{entry.reply}</div>
                    </div>
                  )}

                  {/* 回复输入 */}
                  {editing ? (
                    <div className="space-y-2">
                      <textarea value={draft} onChange={e => setDraft(e.target.value)}
                        rows={3} autoFocus
                        placeholder="写一条答复，学生将在「帮助与反馈」里看到…"
                        className="w-full px-3.5 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 resize-none bg-white" />
                      <div className="flex items-center gap-2">
                        <button onClick={() => submitReply(entry.id)} disabled={saving}
                          className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-50 text-sm font-medium transition-all">
                          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                          {saving ? '发送中…' : '发送回复'}
                        </button>
                        <button onClick={() => { setEditingId(null); setDraft(''); }}
                          className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-500 rounded-xl hover:bg-gray-200 text-sm font-medium transition-all">
                          <X className="w-4 h-4" />取消
                        </button>
                        <span className="text-[11px] text-gray-400">留空并发送 = 撤回回复</span>
                      </div>
                    </div>
                  ) : !hasReply ? (
                    <button onClick={() => startReply(entry)}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-primary-50 text-primary-700 rounded-xl hover:bg-primary-100 text-sm font-medium transition-all">
                      <Send className="w-4 h-4" />回复
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
