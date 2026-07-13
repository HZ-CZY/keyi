import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import ScrollReveal from '../components/ScrollReveal';
import {
  Megaphone, Plus, Edit2, Trash2, Eye, EyeOff,
  Check, X, RefreshCw, Save
} from 'lucide-react';

interface Announcement {
  id: number;
  title: string;
  content: string;
  published: number;
  created_at: number;
  updated_at: number;
}

export default function AdminAnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formPublished, setFormPublished] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const fetch = () => {
    setLoading(true);
    api.announcements.list()
      .then(setAnnouncements)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(fetch, []);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  const openCreate = () => {
    setEditingId(null);
    setFormTitle('');
    setFormContent('');
    setFormPublished(true);
    setShowForm(true);
  };

  const openEdit = (a: Announcement) => {
    setEditingId(a.id);
    setFormTitle(a.title);
    setFormContent(a.content);
    setFormPublished(!!a.published);
    setShowForm(true);
  };

  const save = async () => {
    if (!formTitle.trim() || !formContent.trim()) {
      showToast('error', '标题和内容不能为空');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.announcements.update(editingId, {
          title: formTitle,
          content: formContent,
          published: formPublished ? 1 : 0,
        });
        showToast('success', '公告已更新');
      } else {
        await api.announcements.create({
          title: formTitle,
          content: formContent,
          published: formPublished ? 1 : 0,
        });
        showToast('success', '公告已创建');
      }
      setShowForm(false);
      fetch();
    } catch (err: any) {
      showToast('error', err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此公告？')) return;
    try {
      await api.announcements.delete(id);
      showToast('success', '已删除');
      fetch();
    } catch { }
  };

  const handleTogglePublish = async (id: number) => {
    try {
      await api.announcements.togglePublish(id);
      showToast('success', '已更新发布状态');
      fetch();
    } catch { }
  };

  const formatDate = (ts: number) =>
    new Date(ts * 1000).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

  return (
    <div className="space-y-6">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ${
              toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
            }`}
          >
            {toast.type === 'success' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <ScrollReveal variant="fade-up">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Megaphone className="w-8 h-8 text-primary-500" />
              公告管理
            </h1>
            <p className="text-gray-500 mt-1">管理用户端弹窗公告</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetch}
              className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 text-sm font-medium transition-all"
            >
              <RefreshCw className="w-4 h-4" /> 刷新
            </button>
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl hover:shadow-md text-sm font-medium transition-all"
            >
              <Plus className="w-4 h-4" /> 新建公告
            </button>
          </div>
        </div>
      </ScrollReveal>

      {/* Form Modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingId ? '编辑公告' : '新建公告'}
                </h3>
                <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">标题</label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="input-field"
                    placeholder="公告标题"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">内容</label>
                  <textarea
                    value={formContent}
                    onChange={(e) => setFormContent(e.target.value)}
                    className="input-field resize-none"
                    rows={5}
                    placeholder="公告内容（支持 HTML）"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="publish-toggle"
                    checked={formPublished}
                    onChange={(e) => setFormPublished(e.target.checked)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label htmlFor="publish-toggle" className="text-sm text-gray-700">立即发布（用户可见）</label>
                </div>
              </div>
              <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3">
                <button
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all"
                >
                  取消
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-4 py-2 text-sm text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-all flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" /> {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Announcement List */}
      <ScrollReveal variant="fade-up" delay={100}>
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/40 shadow-soft card-shadow-hover">
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="text-xs text-gray-400">共 {announcements.length} 条公告</p>
          </div>
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
            </div>
          ) : announcements.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              <Megaphone className="w-12 h-12 mx-auto mb-3 opacity-30" />
              暂无公告
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {announcements.map((a, i) => (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="p-5 hover:bg-gray-50/50 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      a.published ? 'bg-green-100' : 'bg-gray-100'
                    }`}>
                      {a.published ? (
                        <Megaphone className="w-5 h-5 text-green-600" />
                      ) : (
                        <EyeOff className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900">{a.title}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          a.published ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {a.published ? '已发布' : '草稿'}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 line-clamp-2">{a.content}</p>
                      <div className="text-xs text-gray-400 mt-1">
                        创建于 {formatDate(a.created_at)} · 更新于 {formatDate(a.updated_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => openEdit(a)}
                        className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-all"
                        title="编辑"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleTogglePublish(a.id)}
                        className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                        title={a.published ? '取消发布' : '发布'}
                      >
                        {a.published ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => handleDelete(a.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </ScrollReveal>
    </div>
  );
}
