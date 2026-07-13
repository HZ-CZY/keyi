import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Info, Hash, Plus, Pencil, Trash2, Check, X, Save, AlertCircle, CheckCircle2 } from 'lucide-react';

type TabKey = 'changelog' | 'version' | 'software';

const tabs: { key: TabKey; icon: React.ReactNode; label: string }[] = [
  { key: 'changelog', icon: <FileText className="w-4 h-4" />, label: '更新日志' },
  { key: 'version', icon: <Info className="w-4 h-4" />, label: '版本信息' },
  { key: 'software', icon: <Hash className="w-4 h-4" />, label: '软件声明' },
];

export default function AdminSiteContentPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('changelog');

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">站点内容管理</h1>
        <p className="text-sm text-gray-500 mt-1">管理用户端展示的更新日志、版本信息和软件声明</p>
      </div>

      {/* Pill tabs */}
      <div className="flex items-center gap-1.5">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all duration-250 ease-premium ${
              activeTab === tab.key
                ? 'pill-link-active'
                : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'changelog' && <ChangelogManager />}
          {activeTab === 'version' && <VersionEditor />}
          {activeTab === 'software' && <SoftwareEditor />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ── Changelog Manager ─────────────────────────────────

function ChangelogManager() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ version: '', date: '', description: '' });
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showNew, setShowNew] = useState(false);

  const fetchData = () => {
    setLoading(true);
    api.admin.getChangelog()
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(fetchData, []);

  const resetForm = () => setForm({ version: '', date: '', description: '' });

  const handleCreate = async () => {
    if (!form.version || !form.date || !form.description) {
      setMsg({ type: 'error', text: '请填写所有字段' });
      return;
    }
    try {
      await api.admin.createChangelog(form);
      setMsg({ type: 'success', text: '已添加' });
      setShowNew(false); resetForm();
      fetchData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  const handleUpdate = async () => {
    if (!form.version || !form.date || !form.description || !editingId) return;
    try {
      await api.admin.updateChangelog(editingId, form);
      setMsg({ type: 'success', text: '已更新' });
      setEditingId(null); resetForm();
      fetchData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除这条更新记录？')) return;
    try {
      await api.admin.deleteChangelog(id);
      fetchData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  const startEdit = (entry: any) => {
    setEditingId(entry.id);
    setForm({ version: entry.version, date: entry.date, description: entry.description });
    setShowNew(false);
  };

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`flex items-center gap-2 p-3 rounded-xl text-sm ${
          msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {msg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Add new button */}
      {!showNew && !editingId && (
        <button onClick={() => { setShowNew(true); resetForm(); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 text-sm font-medium transition-all">
          <Plus className="w-4 h-4" /> 添加更新记录
        </button>
      )}

      {/* Form (create/edit) */}
      {(showNew || editingId) && (
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-5 border border-white/40 space-y-3">
          <div className="flex gap-3">
            <input value={form.version} onChange={e => setForm(p => ({ ...p, version: e.target.value }))}
              placeholder="版本号 (如 v2.1.0)" className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
            <input value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
              placeholder="日期 (如 2026-06-22)" className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
          </div>
          <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            placeholder="更新描述" rows={3}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 resize-none" />
          <div className="flex gap-2">
            <button onClick={editingId ? handleUpdate : handleCreate}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 text-sm font-medium transition-all">
              <Save className="w-4 h-4" /> {editingId ? '更新' : '创建'}
            </button>
            <button onClick={() => { setShowNew(false); setEditingId(null); resetForm(); }}
              className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 text-sm font-medium transition-all">
              取消
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover border border-white/40">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">暂无更新记录</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {entries.map((entry: any) => (
              <div key={entry.id} className="flex items-center gap-4 p-4">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900">
                    {entry.version}
                    <span className="text-xs font-normal text-gray-400 ml-2">{entry.date}</span>
                  </div>
                  <div className="text-sm text-gray-600 mt-0.5 truncate">{entry.description}</div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => startEdit(entry)}
                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(entry.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Version Info Editor ──────────────────────────────

function VersionEditor() {
  const [content, setContent] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchData = () => {
    setLoading(true);
    api.admin.getSiteContent()
      .then(setContent)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(fetchData, []);

  const fields = [
    { key: 'app_name', label: '应用名称', placeholder: '刻忆间隔学习平台' },
    { key: 'app_version', label: '当前版本', placeholder: 'v2.1.0' },
    { key: 'build_date', label: '构建日期', placeholder: '2026-06-22' },
  ];

  const handleSave = async (key: string, value: string) => {
    setSaving(true);
    try {
      await api.admin.updateSiteContent(key, value);
      setContent(p => ({ ...p, [key]: value }));
      setMsg({ type: 'success', text: '已保存' });
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-5 border border-white/40">
      {msg && (
        <div className={`flex items-center gap-2 p-3 rounded-xl text-sm mb-4 ${
          msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {msg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
        </div>
      ) : (
        <div className="space-y-4">
          {fields.map(f => (
            <FieldEditor
              key={f.key}
              label={f.label}
              value={content[f.key] || ''}
              placeholder={f.placeholder}
              onSave={(val) => handleSave(f.key, val)}
              saving={saving}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Software Statement Editor ─────────────────────────

function SoftwareEditor() {
  const [content, setContent] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    api.admin.getSiteContent()
      .then(data => { setContent(data); setValue(data.software_statement || ''); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.admin.updateSiteContent('software_statement', value);
      setMsg({ type: 'success', text: '已保存' });
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-5 border border-white/40">
      {msg && (
        <div className={`flex items-center gap-2 p-3 rounded-xl text-sm mb-4 ${
          msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {msg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
        </div>
      ) : (
        <div className="space-y-3">
          <textarea value={value} onChange={e => setValue(e.target.value)} rows={8}
            placeholder="输入软件声明内容..."
            className="w-full px-3.5 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 resize-y" />
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-50 text-sm font-medium transition-all">
            <Save className="w-4 h-4" /> {saving ? '保存中...' : '保存'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Inline field editor ──────────────────────────────

function FieldEditor({ label, value, placeholder, onSave, saving }: {
  label: string; value: string; placeholder: string; onSave: (val: string) => void; saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(value);

  useEffect(() => { setEditVal(value); }, [value]);

  const handleSave = () => {
    if (editVal !== value) onSave(editVal);
    setEditing(false);
  };

  return (
    <div className="flex items-center justify-between py-2.5 px-4 rounded-lg bg-gray-50/70 gap-3">
      <span className="text-sm text-gray-500 flex-shrink-0 w-20">{label}</span>
      {editing ? (
        <div className="flex-1 flex items-center gap-2">
          <input value={editVal} onChange={e => setEditVal(e.target.value)}
            placeholder={placeholder}
            className="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
          <button onClick={handleSave} className="p-1 text-green-600 hover:bg-green-50 rounded transition-all"><Check className="w-4 h-4" /></button>
          <button onClick={() => { setEditing(false); setEditVal(value); }} className="p-1 text-gray-400 hover:bg-gray-100 rounded transition-all"><X className="w-4 h-4" /></button>
        </div>
      ) : (
        <>
          <span className="flex-1 text-sm text-gray-900 font-medium truncate">{value || placeholder}</span>
          <button onClick={() => setEditing(true)} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-all">
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
