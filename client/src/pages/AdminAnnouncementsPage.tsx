import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import ScrollReveal from '../components/ScrollReveal';
import AnnouncementRichText, { announcementPlainText, sanitizeAnnouncementHtml } from '../components/AnnouncementRichText';
import {
  Megaphone, Plus, Edit2, Trash2, EyeOff,
  Check, X, RefreshCw, Save, Bold, Underline, Eraser, Eye as EyeIcon,
} from 'lucide-react';

interface Announcement {
  id: number;
  title: string;
  content: string;
  published: number;
  created_at: number;
  updated_at: number;
}

/** 颜色调色板：加粗 / 下划线 / 高亮色 / 清除格式 */
const PALETTE = [
  { name: '红', color: '#ef4444' },
  { name: '橙', color: '#f97316' },
  { name: '黄', color: '#eab308' },
  { name: '绿', color: '#22c55e' },
  { name: '蓝', color: '#3b82f6' },
  { name: '紫', color: '#8b5cf6' },
  { name: '粉', color: '#ec4899' },
  { name: '灰', color: '#64748b' },
];

/**
 * 轻量富文本编辑器（公告正文）：
 * 换行=段落、加粗/下划线/颜色高亮 走 execCommand，实时同步 innerHTML。
 * 输出 HTML 保存前统一 sanitize（AnnouncementRichText 渲染端也会再净化一道）。
 */
function AnnouncementEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  const exec = (cmd: string, val?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, val);
    if (ref.current) onChange(ref.current.innerHTML);
  };

  // contentEditable 不能真正"受控": 每次输入都用 state 回写 innerHTML 会让
  // iPad/iOS Safari 光标重置到开头(输入跳顶)。因此只在外部 value 变化且
  // 用户不在编辑器内时同步内容, 输入过程中一律不覆盖 DOM。
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!initialized.current) {
      el.innerHTML = value;
      initialized.current = true;
    } else if (el.innerHTML !== value && document.activeElement !== el) {
      el.innerHTML = value;
    }
  }, [value]);

  // 工具栏按钮统一防失焦
  const toolBtn =
    'flex items-center justify-center h-8 min-w-8 px-1.5 rounded-lg text-slate-600 hover:bg-primary-50 hover:text-primary-600 transition-colors';

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-100 transition-all">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 bg-slate-50/80 px-2 py-1.5">
        <button
          type="button"
          title="加粗"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('bold')}
          className={toolBtn}
        >
          <Bold style={{ width: 16, height: 16 }} />
        </button>
        <button
          type="button"
          title="下划线"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('underline')}
          className={toolBtn}
        >
          <Underline style={{ width: 16, height: 16 }} />
        </button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <span className="px-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">字体颜色</span>
        {PALETTE.map((c) => (
          <button
            key={c.name}
            type="button"
            title={`高亮 ${c.name}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec('foreColor', c.color)}
            className="mx-0.5 flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-125"
            style={{ backgroundColor: c.color }}
            aria-label={`高亮颜色 ${c.name}`}
          />
        ))}
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button
          type="button"
          title="清除格式（去颜色 / 加粗 / 下划线）"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('removeFormat')}
          className={`${toolBtn} text-rose-400 hover:bg-rose-50 hover:text-rose-500`}
        >
          <Eraser style={{ width: 16, height: 16 }} />
        </button>
      </div>
      {/* 编辑区 */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-placeholder="输入公告内容…支持：回车换行排版；选中文字后用上方工具栏加粗或上色"
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        className="announcement-editor min-h-[150px] max-h-[220px] overflow-y-auto px-4 py-3 text-[15px] leading-relaxed text-slate-700 outline-none announcement-scroll"
      />
    </div>
  );
}

/** 管理端「用户视角」实时预览：与用户端弹窗共用同一渲染器，保证显示一致 */
function PopupPreview({ title, html }: { title: string; html: string }) {
  return (
    <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-2xl bg-white shadow-[0_16px_40px_rgba(30,41,82,0.18)] ring-1 ring-slate-100">
      <div className="relative overflow-hidden bg-gradient-to-br from-primary-500 via-primary-500 to-primary-700 px-4 pb-4 pt-3.5 text-white">
        <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/15 blur-2xl" />
        <div className="flex items-center gap-1.5 text-[10px] font-semibold">
          <Megaphone style={{ width: 12, height: 12 }} />
          系统公告
        </div>
        <h3 className="relative mt-1.5 pr-4 text-[16px] font-bold leading-snug">{title || '（未输入标题）'}</h3>
        <p className="relative mt-0.5 text-[10px] text-white/70">发布于 预览</p>
      </div>
      <div className="max-h-[220px] min-h-[110px] overflow-y-auto announcement-scroll px-4 py-3">
        {html.trim() ? (
          <AnnouncementRichText html={html} className="text-[13px] leading-[1.8] text-slate-600" />
        ) : (
          <p className="text-[13px] leading-relaxed text-slate-300">输入内容后，这里实时预览用户端效果</p>
        )}
      </div>
      <div className="flex justify-end border-t border-slate-100 bg-slate-50/80 px-4 py-2.5">
        <span className="rounded-full bg-gradient-to-r from-primary-500 to-primary-600 px-4 py-1 text-[11px] font-semibold text-white">
          我已知晓
        </span>
      </div>
    </div>
  );
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
    api.announcements
      .list()
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
    if (!formTitle.trim() || !sanitizeAnnouncementHtml(formContent).trim()) {
      showToast('error', '标题和内容不能为空');
      return;
    }
    setSaving(true);
    try {
      const content = sanitizeAnnouncementHtml(formContent); // 入库前净化
      if (editingId) {
        await api.announcements.update(editingId, {
          title: formTitle.trim(),
          content,
          published: formPublished ? 1 : 0,
        });
        showToast('success', '公告已更新');
      } else {
        await api.announcements.create({
          title: formTitle.trim(),
          content,
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
    } catch { /* ignore */ }
  };

  const handleTogglePublish = async (id: number) => {
    try {
      await api.announcements.togglePublish(id);
      showToast('success', '已更新发布状态');
      fetch();
    } catch { /* ignore */ }
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
            className={`fixed top-4 right-4 z-[110] px-5 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ${
              toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
            }`}
          >
            {toast.type === 'success' ? <Check style={{ width: 16, height: 16 }} /> : <X style={{ width: 16, height: 16 }} />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <ScrollReveal variant="fade-up">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Megaphone style={{ width: 32, height: 32 }} className="text-primary-500" />
              公告管理
            </h1>
            <p className="text-gray-500 mt-1">富文本编辑 · 换行排版 · 颜色高亮 · 实时预览与用户端一致</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetch}
              className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 text-sm font-medium transition-all"
            >
              <RefreshCw style={{ width: 15, height: 15 }} /> 刷新
            </button>
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl hover:shadow-md text-sm font-medium transition-all"
            >
              <Plus style={{ width: 16, height: 16 }} /> 新建公告
            </button>
          </div>
        </div>
      </ScrollReveal>

      {/* Form Modal：编辑区 + 实时预览并排 */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 26 }}
              className="w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
                  {editingId ? (
                    <>
                      <Edit2 style={{ width: 18, height: 18 }} className="text-primary-500" /> 编辑公告
                    </>
                  ) : (
                    <>
                      <Plus style={{ width: 18, height: 18 }} className="text-primary-500" /> 新建公告
                    </>
                  )}
                </h3>
                <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 transition-colors" aria-label="关闭">
                  <X style={{ width: 20, height: 20 }} />
                </button>
              </div>

              <div className="grid gap-5 p-6 md:grid-cols-[1fr_300px]">
                {/* 左：编辑 */}
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">标题</label>
                    <input
                      type="text"
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-[15px] outline-none transition-all focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                      placeholder="公告标题"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">内容（富文本）</label>
                    <AnnouncementEditor value={formContent} onChange={setFormContent} />
                    <p className="mt-1.5 text-xs text-slate-400">
                      快捷技巧：选中文字可「加粗 / 改色」；直接回车即换行分段；橡皮图标可一键清除所选文字的颜色与加粗。
                    </p>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={formPublished}
                      onChange={(e) => setFormPublished(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 accent-primary-600"
                    />
                    保存后立即发布（用户弹窗可见）
                  </label>
                </div>
                {/* 右：用户端预览（同一渲染器，所见即所得） */}
                <div className="rounded-2xl bg-slate-50/90 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <EyeIcon style={{ width: 14, height: 14 }} /> 用户端预览
                  </p>
                  <PopupPreview title={formTitle} html={formContent} />
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
                <button
                  onClick={() => setShowForm(false)}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm text-slate-600 transition-all hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-xl bg-primary-600 px-6 py-2 text-sm font-medium text-white transition-all hover:bg-primary-700 disabled:opacity-50"
                >
                  <Save style={{ width: 15, height: 15 }} /> {saving ? '保存中...' : '保存公告'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Announcement List */}
      <ScrollReveal variant="fade-up" delay={100}>
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/40 shadow-soft card-shadow-hover">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <p className="text-xs text-slate-400">共 {announcements.length} 条公告</p>
            <p className="text-[11px] text-slate-300">支持富文本：加粗 / 颜色高亮 / 换行排版</p>
          </div>
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin h-6 w-6 rounded-full border-b-2 border-primary-600" />
            </div>
          ) : announcements.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-400">
              <Megaphone className="mx-auto mb-3 w-12 h-12 opacity-30" />
              暂无公告
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {announcements.map((a, i) => (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="p-5 transition-colors hover:bg-slate-50/60"
                >
                  <div className="flex items-start gap-4">
                    <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
                      a.published ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400'
                    }`}>
                      {a.published ? <Megaphone style={{ width: 20, height: 20 }} /> : <EyeOff style={{ width: 20, height: 20 }} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="truncate font-semibold text-slate-800">{a.title}</span>
                        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                          a.published ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {a.published ? '已发布' : '草稿'}
                        </span>
                      </div>
                      <p className="line-clamp-2 text-sm text-slate-500">{announcementPlainText(a.content)}</p>
                      <div className="mt-1 text-xs text-slate-400">
                        创建于 {formatDate(a.created_at)} · 更新于 {formatDate(a.updated_at)}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <button
                        onClick={() => openEdit(a)}
                        className="rounded-lg p-2 text-slate-400 transition-all hover:bg-primary-50 hover:text-primary-600"
                        title="编辑"
                      >
                        <Edit2 style={{ width: 16, height: 16 }} />
                      </button>
                      <button
                        onClick={() => handleTogglePublish(a.id)}
                        className="rounded-lg p-2 text-slate-400 transition-all hover:bg-amber-50 hover:text-amber-600"
                        title={a.published ? '取消发布' : '发布'}
                      >
                        {a.published ? <EyeOff style={{ width: 16, height: 16 }} /> : <EyeIcon style={{ width: 16, height: 16 }} />}
                      </button>
                      <button
                        onClick={() => handleDelete(a.id)}
                        className="rounded-lg p-2 text-slate-400 transition-all hover:bg-red-50 hover:text-red-600"
                        title="删除"
                      >
                        <Trash2 style={{ width: 16, height: 16 }} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </ScrollReveal>

      {/* 富文本样式（编辑器 placeholder / 滚动条） */}
      <style>{`
        .announcement-editor:empty::before {
          content: attr(data-placeholder);
          color: #cbd5e1;
          pointer-events: none;
        }
        .announcement-scroll::-webkit-scrollbar { width: 6px; }
        .announcement-scroll::-webkit-scrollbar-thumb { background: #c7d2fe; border-radius: 3px; }
        .announcement-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
  );
}
