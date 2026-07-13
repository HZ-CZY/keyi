import { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { renderMarkup } from '../lib/markup';

import {
  Layers, Plus, Edit2, Trash2, AlertCircle, CheckCircle,
  BookOpen, FileText, Sparkles, Upload, Loader2, Search,
  PenLine, LayoutGrid, X as XIcon, Wand2, ChevronDown, ChevronRight,
  Filter, ArrowUpDown, Keyboard
} from 'lucide-react';
import Modal from '../components/Modal';

interface Deck {
  id: number;
  name: string;
  card_count: number;
  merged_into_id?: number | null;
  source_decks?: { id: number; name: string; card_count: number }[];
}

interface Notetype {
  id: number;
  name: string;
  field_names: string;
}

interface CardSummary {
  id: number;
  templateIdx: number;
  queue: number;
  reps: number;
  interval: number;
}

interface NoteItem {
  id: number;
  notetypeId: number;
  notetypeName: string;
  fieldNames: string[];
  fields: string[];
  tags: string;
  cards: CardSummary[];
}

const queueLabel = (q: number) => {
  switch (q) {
    case 0: return { text: '新', color: 'bg-blue-100 text-blue-700', bar: 'bg-blue-400' };
    case 1: return { text: '学习中', color: 'bg-amber-100 text-amber-700', bar: 'bg-amber-400' };
    case 2: return { text: '复习', color: 'bg-green-100 text-green-700', bar: 'bg-green-400' };
    case 3: return { text: '重学', color: 'bg-red-100 text-red-700', bar: 'bg-red-400' };
    default: return { text: '未知', color: 'bg-gray-100 text-gray-600', bar: 'bg-gray-400' };
  }
};

const notetypeColors: Record<string, string> = {
  '基本': 'bg-indigo-50 text-indigo-700 border-indigo-200',
  '选择题': 'bg-pink-50 text-pink-700 border-pink-200',
  'AI导入': 'bg-purple-50 text-purple-700 border-purple-200',
  '古诗词': 'bg-amber-50 text-amber-700 border-amber-200',
  '古文': 'bg-teal-50 text-teal-700 border-teal-200',
  '古文翻译': 'bg-teal-50 text-teal-700 border-teal-200',
  'Basic': 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

const notetypeBorderColors: Record<string, string> = {
  '基本': 'border-l-indigo-400',
  '选择题': 'border-l-pink-400',
  'AI导入': 'border-l-purple-400',
  '古诗词': 'border-l-amber-400',
  '古文': 'border-l-teal-400',
  '古文翻译': 'border-l-teal-400',
  'Basic': 'border-l-indigo-400',
};

function getNotetypeColor(name: string): string {
  return notetypeColors[name] || 'bg-gray-50 text-gray-700 border-gray-200';
}

function getNotetypeBorder(name: string): string {
  return notetypeBorderColors[name] || 'border-l-gray-300';
}

function MarkField({ label, value, onChange, placeholder, autoFocus }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const wrap = (before: string, after: string) => {
    const ta = ref.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const text = value;
    let selected = text.substring(start, end);
    if (!selected) selected = '重点词语';
    const newVal = text.substring(0, start) + before + selected + after + text.substring(end);
    onChange(newVal);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'q') {
      e.preventDefault();
      wrap('**', '**');
    } else if (mod && e.key === 'e') {
      e.preventDefault();
      wrap('==', '==');
    }
  };

  return (
    <div>
      <label className="block text-sm text-gray-600 mb-1 font-medium">{label}</label>
      <div className="flex gap-1 mb-1.5">
        <button
          type="button"
          onClick={() => wrap('**', '**')}
          className="w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-100 hover:border-gray-300 transition-colors"
          title="加粗 (Ctrl+Q)"
        >B</button>
        <button
          type="button"
          onClick={() => wrap('==', '==')}
          className="w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 text-sm text-gray-600 hover:bg-amber-50 hover:border-amber-300 transition-colors"
          title="高亮 (Ctrl+E)"
        ><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M10.5 2.5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v7l4.5 4.5V16h-12v-2.5L10.5 9.5v-7z"/></svg></button>
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="input-field w-full resize-none"
        rows={3}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      <p className="text-[10px] text-gray-400 mt-0.5">Ctrl+Q 加粗 · Ctrl+E 高亮</p>
    </div>
  );
}

export default function AdminCardsPage() {
  const { user } = useAuth();
  const adminId = (user as any)?.id;

  // ── State ──────────────────────────────────────
  const [decks, setDecks] = useState<Deck[]>([]);
  const [decksLoading, setDecksLoading] = useState(true);
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(null);
  const [deckName, setDeckName] = useState('');

  const [showNewDeck, setShowNewDeck] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [newDeckDesc, setNewDeckDesc] = useState('');
  const [creatingDeck, setCreatingDeck] = useState(false);

  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<'notetype' | 'cards' | 'name'>('notetype');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [filterNotetype, setFilterNotetype] = useState<string>('');

  const [notetypes, setNotetypes] = useState<Notetype[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [createNotetypeId, setCreateNotetypeId] = useState<number | null>(null);
  const [createFields, setCreateFields] = useState<string[]>([]);
  const [createFieldNames, setCreateFieldNames] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createJustCreated, setCreateJustCreated] = useState(false);

  const [editNote, setEditNote] = useState<NoteItem | null>(null);
  const [editFields, setEditFields] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [deleteNote, setDeleteNote] = useState<NoteItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [generating, setGenerating] = useState(false);

  const [showAiImport, setShowAiImport] = useState(false);
  const [aiFile, setAiFile] = useState<File | null>(null);
  const [aiImporting, setAiImporting] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiProgressText, setAiProgressText] = useState('');
  const [aiResult, setAiResult] = useState<{ success: number; message: string } | null>(null);

  const [showMerge, setShowMerge] = useState(false);
  const [mergeDeckName, setMergeDeckName] = useState('');
  const [mergeDeckDesc, setMergeDeckDesc] = useState('');
  const [selectedMergeDeckIds, setSelectedMergeDeckIds] = useState<number[]>([]);
  const [merging, setMerging] = useState(false);

  const [showDissolve, setShowDissolve] = useState(false);
  const [dissolving, setDissolving] = useState(false);

  const [expandedMergedDeckId, setExpandedMergedDeckId] = useState<number | null>(null);

  const [deckSortOrder, setDeckSortOrder] = useState<'az' | 'za' | 'count'>('az');
  const [mergeDeckSortOrder, setMergeDeckSortOrder] = useState<'az' | 'za' | 'count'>('az');
  const [deckGroupMode, setDeckGroupMode] = useState<'flat' | 'bySize'>('bySize');
  const [expandedSizeGroup, setExpandedSizeGroup] = useState<'big' | 'small' | null>(null);

  // ── Delete source deck ──────────────────────────

  const handleDeleteSourceDeck = async (e: React.MouseEvent, deckId: number) => {
    e.stopPropagation();
    if (!confirm('确定删除此子牌组及所有卡片？')) return;
    try {
      await api.decks.delete(deckId);
      loadData();
    } catch (err: any) {
      setError(err.message || '删除失败');
    }
  };

  // ── Card expand state
  const [expandedCardId, setExpandedCardId] = useState<number | null>(null);

  // ── Computed ───────────────────────────────────

  const queueStats = (() => {
    const stats = { new: 0, learning: 0, review: 0, relearn: 0 };
    notes.forEach(n => n.cards.forEach(c => {
      if (c.queue === 0) stats.new++;
      else if (c.queue === 1) stats.learning++;
      else if (c.queue === 2) stats.review++;
      else stats.relearn++;
    }));
    return stats;
  })();

  const totalCards = notes.reduce((sum, n) => sum + n.cards.length, 0);

  const availableNotetypes = Array.from(new Set(notes.map(n => n.notetypeName))).sort();

  const filteredNotes = notes
    .filter(note => {
      if (filterNotetype && note.notetypeName !== filterNotetype) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return note.fields.some(f => f?.toLowerCase().includes(q))
        || note.notetypeName.toLowerCase().includes(q)
        || (note.tags && note.tags.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === 'notetype') cmp = a.notetypeName.localeCompare(b.notetypeName, 'zh-CN');
      else if (sortField === 'cards') cmp = a.cards.length - b.cards.length;
      else if (sortField === 'name') cmp = (a.fields[0] || '').localeCompare(b.fields[0] || '', 'zh-CN');
      return sortOrder === 'asc' ? cmp : -cmp;
    });

  // ── Load data ──────────────────────────────────

  const loadData = async () => {
    if (!adminId) return;
    setDecksLoading(true);
    try {
      const d = await api.admin.decks();
      setDecks(d || []);
      const nt = await api.notes.notetypes();
      setNotetypes(nt || []);
    } catch {
      setDecks([]);
    } finally {
      setDecksLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [adminId]);

  const loadNotes = async (deckId: number) => {
    if (!adminId) return;
    setNotesLoading(true);
    setError('');
    setSearchQuery('');
    setFilterNotetype('');
    setExpandedCardId(null);
    try {
      const res = await api.admin.deckNotes(adminId, deckId);
      setNotes(res.notes || []);
      setDeckName(res.deckName || '');
    } catch (err: any) {
      setError(err.message || '加载卡片失败');
      setNotes([]);
    } finally {
      setNotesLoading(false);
    }
  };

  const handleDeckChange = (deckId: number) => {
    setSelectedDeckId(deckId);
    setExpandedMergedDeckId(null);
    setExpandedCardId(null);
    loadNotes(deckId);
  };

  const handleToggleMergedDeck = (deckId: number) => {
    setExpandedMergedDeckId(prev => prev === deckId ? null : deckId);
  };

  // ── New Deck ───────────────────────────────────

  const handleCreateDeck = async () => {
    if (!newDeckName.trim()) { setError('请输入牌组名称'); return; }
    setCreatingDeck(true);
    setError('');
    try {
      const result = await api.decks.create({ name: newDeckName.trim(), description: newDeckDesc.trim() });
      setSuccess(`牌组「${newDeckName}」创建成功！`);
      setShowNewDeck(false);
      setNewDeckName('');
      setNewDeckDesc('');
      loadData();
      handleDeckChange(result.id);
    } catch (err: any) {
      setError(err.message || '创建失败');
    } finally {
      setCreatingDeck(false);
    }
  };

  // ── Create Note ────────────────────────────────

  const openCreateModal = () => {
    setCreateNotetypeId(null);
    setCreateFields([]);
    setCreateFieldNames([]);
    setCreateJustCreated(false);
    setError('');
    setShowCreate(true);
  };

  const handleNotetypeSelect = (ntId: number) => {
    setCreateNotetypeId(ntId);
    const nt = notetypes.find(n => n.id === ntId);
    if (nt) {
      let names: string[];
      try { names = JSON.parse(nt.field_names); } catch { names = []; }
      setCreateFieldNames(names);
      setCreateFields(new Array(names.length).fill(''));
    }
  };

  const handleCreate = async () => {
    if (!adminId || !selectedDeckId || !createNotetypeId) return;
    if (createFields.some(f => !f.trim())) {
      setError('请填写所有字段');
      return;
    }
    setCreating(true);
    setError('');
    try {
      await api.admin.createNote({
        userId: adminId,
        notetypeId: createNotetypeId,
        deckId: selectedDeckId,
        fields: createFields,
      });
      setCreateJustCreated(true);
      setCreateFields(new Array(createFieldNames.length).fill(''));
      setError('');
      loadNotes(selectedDeckId);
      setTimeout(() => setCreateJustCreated(false), 2000);
      setTimeout(() => {
        const firstTextarea = document.querySelector('.create-modal textarea');
        if (firstTextarea) (firstTextarea as HTMLTextAreaElement).focus();
      }, 50);
    } catch (err: any) {
      setError(err.message || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  // ── Edit Note ──────────────────────────────────

  const openEditModal = (note: NoteItem) => {
    setEditNote(note);
    setEditFields([...note.fields]);
    setError('');
  };

  const handleSaveEdit = async () => {
    if (!editNote) return;
    if (editFields.some(f => !f.trim())) {
      setError('字段不能为空');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.admin.updateNote(editNote.id, { fields: editFields });
      setSuccess('卡片已更新');
      setEditNote(null);
      if (selectedDeckId) loadNotes(selectedDeckId);
    } catch (err: any) {
      setError(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete Note ────────────────────────────────

  const handleDelete = async () => {
    if (!deleteNote) return;
    setDeleting(true);
    setError('');
    try {
      await api.admin.deleteNote(deleteNote.id);
      setSuccess('笔记已删除');
      setDeleteNote(null);
      if (selectedDeckId) loadNotes(selectedDeckId);
    } catch (err: any) {
      setError(err.message || '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  // ── AI Import ──────────────────────────────────

  const handleAiImport = async () => {
    if (!aiFile || !adminId || !selectedDeckId) {
      setError('请先选择牌组，然后选择文件');
      return;
    }
    setAiImporting(true);
    setAiProgress(0);
    setAiProgressText('解析文档中...');
    setAiResult(null);
    setError('');

    const progressTimer = setInterval(() => {
      setAiProgress(p => {
        if (p < 15) return p + 1;
        if (p < 75) return p + 0.5;
        if (p < 90) return p + 0.3;
        return p;
      });
    }, 800);

    setTimeout(() => setAiProgressText('AI 分析文档内容中...'), 2000);
    setTimeout(() => setAiProgressText('正在生成卡片...'), 6000);

    try {
      const res = await api.admin.aiImport(aiFile, adminId, selectedDeckId);
      clearInterval(progressTimer);
      setAiProgress(100);
      setAiProgressText('完成！');
      setAiResult({ success: res.stats?.created || 0, message: res.message || '完成' });
      setSuccess(res.message || 'AI 制卡完成！');
      loadNotes(selectedDeckId);
    } catch (err: any) {
      clearInterval(progressTimer);
      setAiProgress(0);
      setError(err.message || 'AI 制卡失败');
    } finally {
      setAiImporting(false);
    }
  };

  const openAiImport = () => {
    if (!selectedDeckId) { setError('请先选择牌组'); return; }
    setAiFile(null);
    setAiResult(null);
    setError('');
    setShowAiImport(true);
  };

  // ── Merge Decks ──────────────────────────────

  const openMergeModal = () => {
    setMergeDeckName('');
    setMergeDeckDesc('');
    setSelectedMergeDeckIds([]);
    setError('');
    setShowMerge(true);
  };

  const handleMergeDeckToggle = (deckId: number) => {
    setSelectedMergeDeckIds(prev =>
      prev.includes(deckId) ? prev.filter(id => id !== deckId) : [...prev, deckId]
    );
  };

  const handleMerge = async () => {
    if (selectedMergeDeckIds.length < 2) { setError('请选择至少两个牌组进行合并'); return; }
    if (!mergeDeckName.trim()) { setError('请为新牌组命名'); return; }
    setMerging(true);
    setError('');
    try {
      const res = await api.admin.mergeDecks(selectedMergeDeckIds, mergeDeckName.trim(), mergeDeckDesc.trim());
      setSuccess(`合并成功！${res.message}`);
      setShowMerge(false);
      setMerging(false);
      loadData();
      handleDeckChange(res.deck.id);
    } catch (err: any) {
      setError(err.message || '合并失败');
      setMerging(false);
    }
  };

  // ── Dissolve Deck ────────────────────────────

  const handleDissolve = async () => {
    if (!selectedDeckId) return;
    setDissolving(true);
    setError('');
    try {
      const res = await api.admin.dissolveDeck(selectedDeckId);
      setSuccess(res.message || '已解散合并牌组');
      setShowDissolve(false);
      setDissolving(false);
      setSelectedDeckId(null);
      setNotes([]);
      loadData();
    } catch (err: any) {
      setError(err.message || '解散失败');
      setDissolving(false);
    }
  };

  // ── Keyboard shortcuts ────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'n') { e.preventDefault(); openCreateModal(); }
      if (mod && e.key === 'k') { e.preventDefault(); document.getElementById('card-search')?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedDeckId]);

  // ── Clear messages ─────────────────────────────

  useEffect(() => {
    if (error || success) {
      const t = setTimeout(() => { setError(''); setSuccess(''); }, 6000);
      return () => clearTimeout(t);
    }
  }, [error, success]);

  // ── Render ─────────────────────────────────────

  return (
    <div className="space-y-5">
      <style>{`.mark-highlight { background: linear-gradient(120deg, #fde68a 0%, #fde68a 40%, #fbbf24 100%); padding: 0 4px; border-radius: 3px; font-weight: 600; }`}</style>
      <style>{`.admin-card-list b { color: #7c3aed; font-weight: 700; background: #f3e8ff; padding: 0 2px; border-radius: 3px; }`}</style>

      {/* ═══ Header ═══ */}
      <div className="bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-2xl p-5 text-white shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="bg-white/20 rounded-xl p-2">
                <LayoutGrid className="w-5 h-5" />
              </div>
              <h1 className="text-xl font-bold">制卡中心</h1>
            </div>
            <p className="text-white/70 text-sm ml-1">
              {selectedDeckId ? `当前：${deckName}` : '选择牌组开始制卡'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedDeckId && (
              <button
                onClick={openCreateModal}
                className="bg-white text-purple-700 px-3 py-1.5 rounded-xl text-sm font-medium flex items-center gap-1.5 hover:bg-white/90 transition-all shadow-sm"
              >
                <Plus className="w-4 h-4" /> 新建卡片
                <span className="text-[10px] text-gray-400 ml-1 hidden sm:inline">Ctrl+N</span>
              </button>
            )}
          </div>
        </div>
        {selectedDeckId && !notesLoading && (
          <div className="flex gap-3 mt-3 pt-3 border-t border-white/20">
            <div className="text-center">
              <div className="text-xl font-bold">{notes.length}</div>
              <div className="text-[10px] text-white/60">笔记</div>
            </div>
            <div className="w-px bg-white/20" />
            <div className="text-center">
              <div className="text-xl font-bold">{totalCards}</div>
              <div className="text-[10px] text-white/60">卡片</div>
            </div>
            <div className="w-px bg-white/20" />
            <div className="text-center">
              <div className="text-xl font-bold">{decks.length}</div>
              <div className="text-[10px] text-white/60">牌组</div>
            </div>
          </div>
        )}
      </div>

      {/* ═══ Messages ═══ */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2.5 text-sm">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-red-700 flex-1">{error}</p>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 p-0.5">
              <XIcon className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
        {success && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-start gap-2.5 text-sm">
            <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
            <p className="text-green-700 flex-1">{success}</p>
            <button onClick={() => setSuccess('')} className="text-green-400 hover:text-green-600 p-0.5">
              <XIcon className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ Deck Selector ═══ */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Layers className="w-4 h-4 text-indigo-500" />
            选择牌组
          </label>
          <div className="flex items-center gap-2">
            {/* Group mode toggle */}
            <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => { setDeckGroupMode('flat'); setExpandedSizeGroup(null); }}
                className={`px-2 py-1 text-xs font-medium transition-colors ${
                  deckGroupMode === 'flat' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-100'
                }`}
                title="平铺显示"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                  <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
              </button>
              <button
                onClick={() => setDeckGroupMode('bySize')}
                className={`px-2 py-1 text-xs font-medium transition-colors ${
                  deckGroupMode === 'bySize' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-100'
                }`}
                title="按大小分组"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
                </svg>
              </button>
            </div>
            {deckGroupMode === 'bySize' && (
              <span className="text-xs text-gray-400">合并=大 / 普通=小</span>
            )}
            <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
              {[
                { key: 'az' as const, label: 'A-Z', title: '名称升序' },
                { key: 'za' as const, label: 'Z-A', title: '名称降序' },
                { key: 'count' as const, label: '#', title: '卡片数量' },
              ].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setDeckSortOrder(opt.key)}
                  className={`px-2 py-1 text-xs font-medium transition-colors ${
                    deckSortOrder === opt.key
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                  title={opt.title}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setShowNewDeck(true); setError(''); setNewDeckName(''); setNewDeckDesc(''); }}
              className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> 新建牌组
            </button>
          </div>
        </div>
        {decksLoading ? (
          <div className="flex items-center justify-center py-5">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-500" />
          </div>
        ) : decks.length === 0 ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-2">
              <Layers className="w-6 h-6 text-indigo-300" />
            </div>
            <p className="text-sm text-gray-500">还没有牌组</p>
            <p className="text-xs text-gray-400 mt-0.5">点击「新建牌组」开始</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(() => {
              const sortDecks = (list: Deck[]) => {
                const sorted = [...list];
                if (deckSortOrder === 'az') sorted.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
                else if (deckSortOrder === 'za') sorted.sort((a, b) => b.name.localeCompare(a.name, 'zh-CN'));
                else sorted.sort((a, b) => b.card_count - a.card_count);
                return sorted;
              };
              const regularDecks = sortDecks(decks.filter(d => !d.merged_into_id && (!d.source_decks || d.source_decks.length === 0)));
              const mergedDecks = sortDecks(decks.filter(d => d.source_decks && d.source_decks.length > 0));

              const renderDeckPill = (d: Deck) => {
                const isSelected = selectedDeckId === d.id;
                return (
                  <button
                    key={d.id}
                    onClick={() => handleDeckChange(d.id)}
                    className={`relative px-3.5 py-2 rounded-xl text-sm font-medium border-2 transition-all ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm'
                        : 'border-gray-200 text-gray-600 hover:border-indigo-300 hover:bg-indigo-50/50'
                    }`}
                  >
                    <span className={isSelected ? 'font-semibold' : ''}>{d.name}</span>
                    <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-md ${
                      isSelected ? 'bg-indigo-100 text-indigo-500' : 'bg-gray-100 text-gray-400'
                    }`}>
                      {d.card_count}
                    </span>
                  </button>
                );
              };

              const renderMergedDeck = (d: Deck) => {
                const isExpanded = expandedMergedDeckId === d.id;
                const isSelected = selectedDeckId === d.id;
                return (
                  <div key={d.id} className="w-full">
                    <div className={`w-full flex items-center rounded-xl text-sm font-medium border-2 transition-all overflow-hidden ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm'
                        : 'border-amber-200 bg-amber-50/50 text-amber-700 hover:border-amber-300'
                    }`}>
                      <button
                        onClick={() => handleToggleMergedDeck(d.id)}
                        className={`flex-shrink-0 self-stretch px-2.5 flex items-center transition-colors ${
                          isExpanded ? 'bg-amber-100 text-amber-600' : 'text-amber-400 hover:bg-amber-100/50'
                        }`}
                      >
                        <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.15 }}>
                          <ChevronRight className="w-4 h-4" />
                        </motion.div>
                      </button>
                      <button
                        onClick={() => handleDeckChange(d.id)}
                        className="flex-1 flex items-center gap-2 px-2 py-2.5 text-left"
                      >
                        <Layers className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-indigo-500' : 'text-amber-500'}`} />
                        <span className="font-semibold">{d.name}</span>
                        <span className={`text-xs font-medium ${isSelected ? 'text-indigo-400' : 'text-amber-500'}`}>
                          {d.source_decks?.length ?? 0} 子牌组 · {d.card_count} 张
                        </span>
                      </button>
                      {isSelected && <span className="w-2 h-2 bg-indigo-500 rounded-full mr-3" />}
                    </div>
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="ml-5 mt-1.5 pl-3 border-l-2 border-amber-200 space-y-1">
                            {d.source_decks?.map(sd => {
                              const isSourceSelected = selectedDeckId === sd.id;
                              return (
                                <div key={sd.id}
                                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium border transition-all group ${
                                    isSourceSelected
                                      ? 'border-indigo-400 bg-indigo-50 text-indigo-700 shadow-sm'
                                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                                  }`}>
                                  <button
                                    onClick={() => handleDeckChange(sd.id)}
                                    className="flex-1 flex items-center gap-2 text-left"
                                  >
                                    <BookOpen className="w-3.5 h-3.5 text-amber-400" />
                                    <span>{sd.name}</span>
                                  </button>
                                  <div className="flex items-center gap-2">
                                    <span className={`text-xs ${isSourceSelected ? 'text-indigo-400' : 'text-gray-400'}`}>
                                      {sd.card_count} 张
                                    </span>
                                    <button onClick={(e) => handleDeleteSourceDeck(e, sd.id)}
                                      className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100">
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              };

              // Flat mode
              if (deckGroupMode === 'flat') {
                return (
                  <>
                    {regularDecks.map(renderDeckPill)}
                    {mergedDecks.map(renderMergedDeck)}
                  </>
                );
              }

              // Group by size mode: 大卡组=合并牌组, 小卡组=普通牌组
              const isBigExpanded = expandedSizeGroup === 'big';
              const isSmallExpanded = expandedSizeGroup === 'small';

              const renderSizeGroup = (
                label: string, icon: React.ReactNode, decks: Deck[], groupKey: 'big' | 'small', count: number, total: number, color: 'blue' | 'emerald', renderFn: (d: Deck) => React.ReactNode
              ) => {
                const isExpanded = expandedSizeGroup === groupKey;
                const colorClasses = color === 'blue'
                  ? { active: 'border-blue-300 bg-blue-50 text-blue-700', hover: 'hover:border-blue-200 hover:bg-blue-50/30', badge: 'bg-blue-100 text-blue-600' }
                  : { active: 'border-emerald-300 bg-emerald-50 text-emerald-700', hover: 'hover:border-emerald-200 hover:bg-emerald-50/30', badge: 'bg-emerald-100 text-emerald-600' };
                return (
                  <div className="w-full">
                    <button
                      onClick={() => setExpandedSizeGroup(isExpanded ? null : groupKey)}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${
                        isExpanded
                          ? colorClasses.active
                          : `border-gray-200 bg-white text-gray-600 ${colorClasses.hover}`
                      }`}
                    >
                      {icon}
                      <span className="font-semibold">{label}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-md ${colorClasses.badge}`}>
                        {count} 个牌组
                      </span>
                      <span className="text-xs text-gray-400 ml-auto">{total} 张卡片</span>
                      <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.15 }}>
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      </motion.div>
                    </button>
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="ml-5 mt-1.5 pl-3 border-l-2 border-gray-200 space-y-1">
                            {decks.length === 0 ? (
                              <p className="text-xs text-gray-400 py-2">暂无牌组</p>
                            ) : (
                              decks.map(renderFn)
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              };

              return (
                <>
                  {renderSizeGroup(
                    '大卡组',
                    <svg className="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
                    </svg>,
                    mergedDecks, 'big', mergedDecks.length, mergedDecks.reduce((s, d) => s + d.card_count, 0), 'blue',
                    (d) => {
                      const isExpanded = expandedMergedDeckId === d.id;
                      const isSelected = selectedDeckId === d.id;
                      return (
                        <div key={d.id}>
                          <div className={`w-full flex items-center rounded-lg text-sm font-medium border transition-all overflow-hidden ${
                            isSelected
                              ? 'border-indigo-400 bg-indigo-50 text-indigo-700 shadow-sm'
                              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                          }`}>
                            <button
                              onClick={() => handleToggleMergedDeck(d.id)}
                              className={`flex-shrink-0 self-stretch px-2 flex items-center transition-colors ${
                                isExpanded ? 'bg-blue-100 text-blue-600' : 'text-blue-400 hover:bg-blue-50'
                              }`}
                            >
                              <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.15 }}>
                                <ChevronRight className="w-3.5 h-3.5" />
                              </motion.div>
                            </button>
                            <button
                              onClick={() => handleDeckChange(d.id)}
                              className="flex-1 flex items-center gap-2 px-2 py-2 text-left"
                            >
                              <Layers className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-indigo-500' : 'text-blue-400'}`} />
                              <span className="font-semibold">{d.name}</span>
                              <span className={`text-xs font-medium ${isSelected ? 'text-indigo-400' : 'text-blue-500'}`}>
                                {d.source_decks?.length ?? 0} 子牌组 · {d.card_count} 张
                              </span>
                            </button>
                            {isSelected && <span className="w-2 h-2 bg-indigo-500 rounded-full mr-2" />}
                          </div>
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden"
                              >
                                <div className="ml-4 mt-1 pl-3 border-l-2 border-blue-200 space-y-1">
                                  {d.source_decks?.map(sd => {
                                    const isSourceSelected = selectedDeckId === sd.id;
                                    return (
                                      <div key={sd.id}
                                        className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm font-medium border transition-all group ${
                                          isSourceSelected
                                            ? 'border-indigo-400 bg-indigo-50 text-indigo-700 shadow-sm'
                                            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                                        }`}>
                                        <button
                                          onClick={() => handleDeckChange(sd.id)}
                                          className="flex-1 flex items-center gap-1.5 text-left"
                                        >
                                          <BookOpen className="w-3 h-3 text-blue-400" />
                                          <span>{sd.name}</span>
                                        </button>
                                        <div className="flex items-center gap-1.5">
                                          <span className={`text-xs ${isSourceSelected ? 'text-indigo-400' : 'text-gray-400'}`}>
                                            {sd.card_count} 张
                                          </span>
                                          <button onClick={(e) => handleDeleteSourceDeck(e, sd.id)}
                                            className="p-0.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-all opacity-0 group-hover:opacity-100">
                                            <Trash2 className="w-3 h-3" />
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    }
                  )}
                  {renderSizeGroup(
                    '小卡组',
                    <svg className="w-4 h-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                    </svg>,
                    regularDecks, 'small', regularDecks.length, regularDecks.reduce((s, d) => s + d.card_count, 0), 'emerald',
                    renderDeckPill
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* ═══ Quick Actions (when deck selected) ═══ */}
      {selectedDeckId && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[
            { icon: PenLine, label: '手动制卡', desc: '逐张创建', color: 'from-indigo-400 to-indigo-600', onClick: openCreateModal, shortcut: 'Ctrl+N' },
            { icon: Sparkles, label: 'AI 智能制卡', desc: '上传文档', color: 'from-purple-400 to-purple-600', onClick: openAiImport },
            { icon: Layers, label: '合并牌组', desc: '多个合一', color: 'from-amber-400 to-orange-500', onClick: openMergeModal },
            { icon: Plus, label: '新建牌组', desc: '创建新组', color: 'from-emerald-400 to-emerald-600', onClick: () => { setShowNewDeck(true); setError(''); setNewDeckName(''); setNewDeckDesc(''); } },
          ].map(item => (
            <motion.button
              key={item.label}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={item.onClick}
              className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm hover:shadow-md transition-all text-left group"
            >
              <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${item.color} flex items-center justify-center mb-2 group-hover:scale-105 transition-transform`}>
                <item.icon className="w-4 h-4 text-white" />
              </div>
              <h3 className="font-semibold text-gray-900 text-sm leading-tight">{item.label}</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">{item.desc}</p>
              {item.shortcut && (
                <span className="text-[9px] text-gray-300 mt-1 inline-block">{item.shortcut}</span>
              )}
            </motion.button>
          ))}
        </div>
      )}

      {/* ═══ Cards List ═══ */}
      {selectedDeckId && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
          {/* Queue distribution bar */}
          {totalCards > 0 && (
            <div className="px-4 pt-3 pb-0">
              <div className="flex items-center gap-3 text-[11px] text-gray-500 mb-1.5">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" />新 {queueStats.new}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />学习 {queueStats.learning}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" />复习 {queueStats.review}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" />重学 {queueStats.relearn}</span>
              </div>
              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden flex">
                {queueStats.new > 0 && <div className="bg-blue-400 h-full" style={{ width: `${(queueStats.new / totalCards) * 100}%` }} />}
                {queueStats.learning > 0 && <div className="bg-amber-400 h-full" style={{ width: `${(queueStats.learning / totalCards) * 100}%` }} />}
                {queueStats.review > 0 && <div className="bg-green-400 h-full" style={{ width: `${(queueStats.review / totalCards) * 100}%` }} />}
                {queueStats.relearn > 0 && <div className="bg-red-400 h-full" style={{ width: `${(queueStats.relearn / totalCards) * 100}%` }} />}
              </div>
            </div>
          )}

          {/* List header */}
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-indigo-500" />
                {deckName}
                <span className="text-xs font-normal text-gray-400">
                  {filteredNotes.length}{filterNotetype || searchQuery ? `/${notes.length}` : ''} 条笔记 · {totalCards} 张卡片
                </span>
              </h2>
              <div className="flex items-center gap-1.5">
                {(() => {
                  const cd = decks.find(d => d.id === selectedDeckId);
                  if (cd?.source_decks && cd.source_decks.length > 0) {
                    return (
                      <button
                        onClick={() => { setShowDissolve(true); setError(''); }}
                        className="text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" /> 解散
                      </button>
                    );
                  }
                  return null;
                })()}
                {notes.length > 0 && (
                  <button
                    onClick={openCreateModal}
                    className="text-xs font-medium text-white bg-indigo-500 hover:bg-indigo-600 px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3 h-3" /> 新建
                  </button>
                )}
              </div>
            </div>
            {/* Search + filter + sort */}
            {notes.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    id="card-search"
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="搜索卡片..."
                    className="w-full pl-8 pr-7 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 bg-gray-50"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <XIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <select
                  value={filterNotetype}
                  onChange={e => setFilterNotetype(e.target.value)}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 text-gray-600"
                >
                  <option value="">全部类型</option>
                  {availableNotetypes.map(nt => (
                    <option key={nt} value={nt}>{nt}</option>
                  ))}
                </select>
                <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden flex-shrink-0">
                  <select
                    value={sortField}
                    onChange={e => setSortField(e.target.value as any)}
                    className="text-xs border-0 rounded-l-lg px-1.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 text-gray-600"
                  >
                    <option value="notetype">类型</option>
                    <option value="cards">卡片数</option>
                    <option value="name">首字段</option>
                  </select>
                  <button
                    onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                    className="px-1.5 py-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors border-l border-gray-200"
                    title={sortOrder === 'asc' ? '升序' : '降序'}
                  >
                    <ArrowUpDown className={`w-3.5 h-3.5 transition-transform ${sortOrder === 'desc' ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Body */}
          {notesLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-2">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500" />
                <p className="text-xs text-gray-400">加载中...</p>
              </div>
            </div>
          ) : notes.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-3">
                <BookOpen className="w-7 h-7 text-indigo-300" />
              </div>
              <p className="text-gray-500 font-medium text-sm">该牌组暂无卡片</p>
              <p className="text-xs text-gray-400 mt-1 mb-4">选择一种方式开始制卡</p>
              <div className="flex items-center justify-center gap-2">
                <button onClick={openAiImport} className="text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-200 text-purple-600 hover:bg-purple-50 transition-colors">
                  <Sparkles className="w-3.5 h-3.5" /> AI制卡
                </button>
                <button onClick={openCreateModal} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                  新建卡片
                </button>
              </div>
            </div>
          ) : filteredNotes.length === 0 && (searchQuery || filterNotetype) ? (
            <div className="text-center py-12">
              <Search className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-500 font-medium text-sm">未找到匹配的卡片</p>
              <button onClick={() => { setSearchQuery(''); setFilterNotetype(''); }} className="text-xs text-indigo-500 hover:text-indigo-600 mt-1">
                清除筛选
              </button>
            </div>
          ) : (
            <div className="admin-card-list">
              <AnimatePresence initial={false}>
                {filteredNotes.map((note, idx) => {
                  const isExpanded = expandedCardId === note.id;
                  const ql = note.cards.length > 0 ? queueLabel(note.cards[0].queue) : null;
                  return (
                    <motion.div
                      key={note.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className={`border-b border-gray-50 last:border-0 transition-colors ${
                        isExpanded ? 'bg-gray-50/80' : 'hover:bg-gray-50/60'
                      }`}
                    >
                      <div
                        className={`px-4 py-3 border-l-3 cursor-pointer ${getNotetypeBorder(note.notetypeName)}`}
                        onClick={() => setExpandedCardId(isExpanded ? null : note.id)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            {/* Badge row */}
                            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${getNotetypeColor(note.notetypeName)}`}>
                                {note.notetypeName}
                              </span>
                              {ql && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${ql.color}`}>
                                  {ql.text}
                                </span>
                              )}
                              {note.tags && note.tags.split(/\s+/).filter(Boolean).slice(0, 2).map((tag, ti) => (
                                <span key={ti} className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                  #{tag}
                                </span>
                              ))}
                              {note.tags && note.tags.split(/\s+/).filter(Boolean).length > 2 && (
                                <span className="text-[10px] text-gray-300">+{note.tags.split(/\s+/).filter(Boolean).length - 2}</span>
                              )}
                            </div>
                            {/* Fields */}
                            <div className="space-y-0.5">
                              {note.fieldNames.slice(0, isExpanded ? note.fieldNames.length : 2).map((name, i) => (
                                <div key={i} className="flex items-start gap-2 text-sm">
                                  <span className="text-gray-300 w-12 flex-shrink-0 font-medium text-[11px] pt-0.5">{name}</span>
                                  <span
                                    className={`text-gray-700 leading-relaxed ${isExpanded ? '' : 'truncate'}`}
                                    dangerouslySetInnerHTML={{ __html: renderMarkup(note.fields[i] || '') }}
                                  />
                                </div>
                              ))}
                              {!isExpanded && note.fieldNames.length > 2 && (
                                <p className="text-[10px] text-gray-300 pl-14">+{note.fieldNames.length - 2} 个字段</p>
                              )}
                            </div>
                          </div>
                          {/* Actions */}
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            <button
                              onClick={(e) => { e.stopPropagation(); openEditModal(note); }}
                              className="p-1.5 text-gray-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all"
                              title="编辑"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeleteNote(note); setError(''); }}
                              className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-all"
                              title="删除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <motion.div
                              animate={{ rotate: isExpanded ? 90 : 0 }}
                              transition={{ duration: 0.15 }}
                              className="p-1 text-gray-300"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </motion.div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {/* ═══ Source Decks (for merged decks) ═══ */}
      {selectedDeckId && (() => {
        const currentDeck = decks.find(d => d.id === selectedDeckId);
        if (!currentDeck || !currentDeck.source_decks || currentDeck.source_decks.length === 0) return null;
        return (
          <div className="bg-white rounded-2xl border border-amber-200 overflow-hidden shadow-sm">
            <div className="px-4 py-3 flex items-center justify-between bg-amber-50/80">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-500" />
                <h2 className="font-semibold text-amber-900 text-sm">
                  子牌组 ({currentDeck.source_decks.length})
                </h2>
                <span className="text-xs text-amber-600">
                  {currentDeck.card_count} 张卡片
                </span>
              </div>
              <button
                onClick={() => { setShowDissolve(true); setError(''); }}
                className="text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors"
              >
                <Trash2 className="w-3 h-3" /> 解散
              </button>
            </div>
            <div className="p-2.5 space-y-1">
              {currentDeck.source_decks.map(sd => {
                const isSelected = selectedDeckId === sd.id;
                return (
                  <button
                    key={sd.id}
                    onClick={() => handleDeckChange(sd.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium border transition-all ${
                      isSelected
                        ? 'border-indigo-400 bg-indigo-50 text-indigo-700 shadow-sm'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-3.5 h-3.5 text-amber-400" />
                      <span>{sd.name}</span>
                    </div>
                    <span className={`text-xs ${isSelected ? 'text-indigo-400' : 'text-gray-400'}`}>
                      {sd.card_count} 张
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ═══ New Deck Modal ═══ */}
      <Modal open={showNewDeck} onClose={() => setShowNewDeck(false)} title="新建牌组" icon={<Layers className="w-5 h-5" />}>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1 font-medium">牌组名称</label>
            <input type="text" value={newDeckName} onChange={e => setNewDeckName(e.target.value)}
              className="input-field w-full" placeholder="输入牌组名称" autoFocus
              onKeyDown={e => e.key === 'Enter' && handleCreateDeck()} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1 font-medium">描述（可选）</label>
            <input type="text" value={newDeckDesc} onChange={e => setNewDeckDesc(e.target.value)}
              className="input-field w-full" placeholder="简短描述" />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleCreateDeck} disabled={creatingDeck || !newDeckName.trim()}
              className="btn-primary text-sm flex items-center gap-2 disabled:bg-gray-300">
              {creatingDeck ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus className="w-4 h-4" />}
              创建
            </button>
            <button onClick={() => setShowNewDeck(false)} className="btn-secondary text-sm">取消</button>
          </div>
        </div>
      </Modal>

      {/* ═══ Create Modal ═══ */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="新建卡片" icon={<Plus className="w-5 h-5" />}>
        <div className="create-modal space-y-3">
          {createJustCreated && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
              className="bg-green-50 border border-green-200 rounded-lg p-2.5 flex items-center gap-2 text-sm text-green-700">
              <CheckCircle className="w-4 h-4" />
              已创建！继续添加下一张...
            </motion.div>
          )}
          <div>
            <label className="block text-sm text-gray-600 mb-1 font-medium">笔记类型</label>
            <select
              value={createNotetypeId || ''}
              onChange={e => handleNotetypeSelect(parseInt(e.target.value))}
              className="input-field w-full"
            >
              <option value="">选择笔记类型...</option>
              {notetypes.filter(nt => ['Basic', '选择题', '古文翻译', 'AI导入'].includes(nt.name)).map(nt => (
                <option key={nt.id} value={nt.id}>{nt.name}</option>
              ))}
            </select>
          </div>
          {createFieldNames.length > 0 && (
            <div className="space-y-2.5">
              {createFieldNames.map((name, i) => (
                <MarkField
                  key={i}
                  label={name}
                  value={createFields[i] || ''}
                  onChange={v => { const newF = [...createFields]; newF[i] = v; setCreateFields(newF); }}
                  placeholder={`输入${name}内容...`}
                  autoFocus={i === 0}
                />
              ))}
              {(() => {
                const nt = notetypes.find(n => n.id === createNotetypeId);
                if (nt && nt.name === '选择题') {
                  const answerLetter = (createFields[5] || '').trim().toUpperCase();
                  const optIdx = { 'A': 1, 'B': 2, 'C': 3, 'D': 4 }[answerLetter];
                  const correctWord = optIdx ? createFields[optIdx] || '' : '';
                  return (
                    <div className="pt-1">
                      <button
                        onClick={async () => {
                          if (!correctWord.trim()) { setError('请先填写正确答案和对应选项内容'); return; }
                          setError('');
                          setGenerating(true);
                          try {
                            const res = await fetch(`/wantwords/ChineseRD/?q=${encodeURIComponent(correctWord)}&m=ZhZh&f=1`);
                            const data = await res.json();
                            const words: string[] = (data?.data || []).map((d: any) => typeof d === 'string' ? d : (d.word || d.name || ''));
                            const filtered = words.filter((w: string) => w !== correctWord && w.length > 0);
                            const newFields = [...createFields];
                            let distIdx = 0;
                            for (const letter of ['A', 'B', 'C', 'D']) {
                              const idx = { 'A': 1, 'B': 2, 'C': 3, 'D': 4 }[letter];
                              if (idx !== undefined && idx !== optIdx && !newFields[idx]?.trim() && distIdx < filtered.length) {
                                newFields[idx] = filtered[distIdx++];
                              }
                            }
                            setCreateFields(newFields);
                            if (distIdx === 0) setError('未找到合适的干扰词，请手动填写');
                            else setSuccess(`已生成 ${distIdx} 个干扰词`);
                          } catch { setError('获取干扰词失败，请检查网络'); }
                          finally { setGenerating(false); }
                        }}
                        disabled={generating || !correctWord.trim()}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border-2 border-dashed border-pink-200 text-sm font-medium text-pink-600 hover:bg-pink-50 hover:border-pink-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                        {generating ? '生成中...' : 'WantWords 智能生成干扰项'}
                      </button>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={handleCreate} disabled={creating || !createNotetypeId}
              className="btn-primary text-sm flex items-center gap-2 disabled:bg-gray-300">
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              创建并继续
            </button>
            <button onClick={() => setShowCreate(false)} className="btn-secondary text-sm" disabled={creating}>完成</button>
          </div>
        </div>
      </Modal>

      {/* ═══ AI Import Modal ═══ */}
      <Modal open={showAiImport} onClose={() => setShowAiImport(false)} title="AI 智能制卡" icon={<Sparkles className="w-5 h-5 text-purple-500" />}>
        <div className="space-y-3">
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-sm text-purple-700">
            <p>上传文档（.txt / .pdf / .docx），AI 自动识别知识点并生成问答卡片。</p>
            <p className="mt-1 font-medium">目标牌组：{deckName}</p>
          </div>
          <div
            className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer
              ${aiFile ? 'border-purple-400 bg-purple-50' : 'border-gray-300 hover:border-purple-300 hover:bg-gray-50'}`}
            onClick={() => document.getElementById('ai-file-input')?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) setAiFile(file); }}
          >
            {aiFile ? (
              <div className="flex flex-col items-center gap-2">
                <FileText className="w-8 h-8 text-purple-500" />
                <p className="font-medium text-gray-900 text-sm">{aiFile.name}</p>
                <p className="text-xs text-gray-400">{(aiFile.size / 1024).toFixed(1)} KB</p>
                <button onClick={e => { e.stopPropagation(); setAiFile(null); }} className="text-xs text-red-500 hover:underline">移除</button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-8 h-8 text-gray-300" />
                <p className="font-medium text-gray-600 text-sm">点击或拖拽文件到此处</p>
                <p className="text-xs text-gray-400">支持 .txt .pdf .docx（最大 50MB）</p>
              </div>
            )}
            <input id="ai-file-input" type="file" accept=".txt,.pdf,.docx" className="hidden"
              onChange={e => { if (e.target.files?.[0]) setAiFile(e.target.files[0]); }} />
          </div>
          {aiResult && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-green-700 font-medium">AI 制卡完成！</span>
              </div>
              <p className="text-green-600 mt-1">{aiResult.message}</p>
            </motion.div>
          )}
          {aiImporting && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                  {aiProgressText}
                </span>
                <span className="text-gray-400 font-mono text-xs">{Math.round(aiProgress)}%</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${aiProgress}%` }}
                  transition={{ duration: 0.3 }}
                  className="h-full rounded-full bg-gradient-to-r from-purple-500 to-indigo-500"
                />
              </div>
            </motion.div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={handleAiImport} disabled={aiImporting || !aiFile}
              className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-xl flex items-center gap-2 disabled:bg-gray-300 disabled:from-gray-300 disabled:to-gray-300 transition-all shadow-sm">
              {aiImporting ? <><Loader2 className="w-4 h-4 animate-spin" /> 处理中...</> : <><Sparkles className="w-4 h-4" /> 开始 AI 制卡</>}
            </button>
            <button onClick={() => { setShowAiImport(false); setAiResult(null); setAiProgress(0); }} className="btn-secondary text-sm" disabled={aiImporting}>取消</button>
          </div>
        </div>
      </Modal>

      {/* ═══ Dissolve Confirmation ═══ */}
      <Modal open={showDissolve} onClose={() => !dissolving && setShowDissolve(false)} title="解散合并牌组" icon={<Trash2 className="w-5 h-5 text-red-500" />}>
        <div className="space-y-3">
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 space-y-2">
            <p className="font-medium">确定要解散「{deckName}」吗？</p>
            {(() => {
              const currentDeck = decks.find(d => d.id === selectedDeckId);
              const src = currentDeck?.source_decks;
              if (src && src.length > 0) {
                return (
                  <div className="text-red-600 space-y-1">
                    <p>操作后：</p>
                    <ul className="list-disc list-inside text-sm space-y-0.5">
                      <li>合并牌组「{deckName}」将被删除</li>
                      <li>{src.map(sd => sd.name).join('、')} 等 <strong>{src.length}</strong> 个源牌组将恢复独立</li>
                      <li>源牌组中原有的卡片不受影响</li>
                    </ul>
                  </div>
                );
              }
              return null;
            })()}
            <p className="text-xs text-red-400">此操作不可撤销。</p>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleDissolve} disabled={dissolving}
              className="bg-red-500 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-xl flex items-center gap-2 disabled:bg-gray-300 transition-all">
              {dissolving ? <><Loader2 className="w-4 h-4 animate-spin" /> 解散中...</> : <><Trash2 className="w-4 h-4" /> 确认解散</>}
            </button>
            <button onClick={() => setShowDissolve(false)} className="btn-secondary text-sm" disabled={dissolving}>取消</button>
          </div>
        </div>
      </Modal>

      {/* ═══ Merge Decks Modal ═══ */}
      <Modal open={showMerge} onClose={() => !merging && setShowMerge(false)} title="合并牌组" icon={<Layers className="w-5 h-5 text-amber-500" />}>
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700">
            选择多个小牌组合并为一个大牌组。原牌组保持不变，卡片会被复制到新牌组中。
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1 font-medium">新牌组名称</label>
            <input type="text" value={mergeDeckName} onChange={e => setMergeDeckName(e.target.value)}
              className="input-field w-full" placeholder="例如：高考英语词汇大全" autoFocus
              onKeyDown={e => e.key === 'Enter' && handleMerge()} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1 font-medium">描述（可选）</label>
            <input type="text" value={mergeDeckDesc} onChange={e => setMergeDeckDesc(e.target.value)}
              className="input-field w-full" placeholder="简短描述" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm text-gray-600 font-medium">
                选择要合并的牌组 <span className="text-gray-400 font-normal">({selectedMergeDeckIds.length} 个已选)</span>
              </label>
              <div className="flex items-center gap-1">
                <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                  {[
                    { key: 'az' as const, label: 'A-Z' },
                    { key: 'za' as const, label: 'Z-A' },
                    { key: 'count' as const, label: '#' },
                  ].map(opt => (
                    <button key={opt.key} type="button" onClick={() => setMergeDeckSortOrder(opt.key)}
                      className={`px-2 py-0.5 text-xs font-medium transition-colors ${
                        mergeDeckSortOrder === opt.key ? 'bg-amber-100 text-amber-700' : 'text-gray-500 hover:bg-gray-100'
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => {
                  setSelectedMergeDeckIds(selectedMergeDeckIds.length === decks.length ? [] : decks.map(d => d.id));
                }} className="text-xs text-amber-600 hover:text-amber-700 underline underline-offset-2">
                  {selectedMergeDeckIds.length === decks.length ? '取消全选' : '全选'}
                </button>
              </div>
            </div>
            {decks.length < 2 ? (
              <div className="text-center py-5 text-gray-400 text-sm">
                <Layers className="w-8 h-8 mx-auto mb-2 opacity-40" />
                需要至少 2 个牌组才能合并
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1 border border-gray-200 rounded-xl p-2">
                {[...decks].sort((a, b) => {
                  if (mergeDeckSortOrder === 'az') return a.name.localeCompare(b.name, 'zh-CN');
                  if (mergeDeckSortOrder === 'za') return b.name.localeCompare(a.name, 'zh-CN');
                  return b.card_count - a.card_count;
                }).map(d => {
                  const checked = selectedMergeDeckIds.includes(d.id);
                  return (
                    <label key={d.id}
                      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all ${
                        checked ? 'bg-amber-50 border border-amber-200' : 'hover:bg-gray-50 border border-transparent'
                      }`}>
                      <input type="checkbox" checked={checked} onChange={() => handleMergeDeckToggle(d.id)}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-amber-500 focus:ring-amber-400" />
                      <span className={`text-sm font-medium flex-1 ${checked ? 'text-amber-900' : 'text-gray-700'}`}>{d.name}</span>
                      <span className="text-xs text-gray-400">{d.card_count} 张</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          {selectedMergeDeckIds.length >= 2 && (
            <div className="bg-gray-50 rounded-xl p-2.5 text-sm text-gray-600">
              将合并 <strong className="text-amber-700">{selectedMergeDeckIds.length}</strong> 个牌组，
              预计 <strong className="text-amber-700">
                {decks.filter(d => selectedMergeDeckIds.includes(d.id)).reduce((sum, d) => sum + d.card_count, 0)}
              </strong> 张卡片
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={handleMerge} disabled={merging || selectedMergeDeckIds.length < 2 || !mergeDeckName.trim()}
              className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-sm font-medium px-4 py-2 rounded-xl flex items-center gap-2 disabled:bg-gray-300 disabled:from-gray-300 disabled:to-gray-300 transition-all shadow-sm">
              {merging ? <><Loader2 className="w-4 h-4 animate-spin" /> 合并中...</> : <><Layers className="w-4 h-4" /> 开始合并</>}
            </button>
            <button onClick={() => setShowMerge(false)} className="btn-secondary text-sm" disabled={merging}>取消</button>
          </div>
        </div>
      </Modal>

      {/* ═══ Edit Modal ═══ */}
      <Modal open={!!editNote} onClose={() => setEditNote(null)} title="编辑卡片" icon={<Edit2 className="w-5 h-5" />}>
        {editNote && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">笔记类型：</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${getNotetypeColor(editNote.notetypeName)}`}>
                {editNote.notetypeName}
              </span>
            </div>
            <div className="space-y-2.5">
              {editNote.fieldNames.map((name, i) => (
                <MarkField
                  key={i}
                  label={name}
                  value={editFields[i] || ''}
                  onChange={v => { const newF = [...editFields]; newF[i] = v; setEditFields(newF); }}
                  autoFocus={i === 0}
                />
              ))}
              {editNote.notetypeName === '选择题' && (
                <div className="pt-1">
                  <button
                    onClick={async () => {
                      const answerLetter = (editFields[5] || '').trim().toUpperCase();
                      const optIdx = { 'A': 1, 'B': 2, 'C': 3, 'D': 4 }[answerLetter];
                      const correctWord = optIdx ? editFields[optIdx] || '' : '';
                      if (!correctWord.trim()) { setError('请先填写正确答案和对应选项内容'); return; }
                      setError('');
                      setGenerating(true);
                      try {
                        const res = await fetch(`/wantwords/ChineseRD/?q=${encodeURIComponent(correctWord)}&m=ZhZh&f=1`);
                        const data = await res.json();
                        const words: string[] = (data?.data || []).map((d: any) => typeof d === 'string' ? d : (d.word || d.name || ''));
                        const filtered = words.filter((w: string) => w !== correctWord && w.length > 0);
                        const newFields = [...editFields];
                        let distIdx = 0;
                        for (const letter of ['A', 'B', 'C', 'D']) {
                          const idx = { 'A': 1, 'B': 2, 'C': 3, 'D': 4 }[letter];
                          if (idx !== undefined && idx !== optIdx && !newFields[idx]?.trim() && distIdx < filtered.length) {
                            newFields[idx] = filtered[distIdx++];
                          }
                        }
                        setEditFields(newFields);
                        if (distIdx === 0) setError('未找到合适的干扰词，请手动填写');
                        else setSuccess(`已生成 ${distIdx} 个干扰词`);
                      } catch { setError('获取干扰词失败，请检查网络'); }
                      finally { setGenerating(false); }
                    }}
                    disabled={generating}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border-2 border-dashed border-pink-200 text-sm font-medium text-pink-600 hover:bg-pink-50 hover:border-pink-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                    {generating ? '生成中...' : 'WantWords 智能生成干扰项'}
                  </button>
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleSaveEdit} disabled={saving}
                className="btn-primary text-sm flex items-center gap-2 disabled:bg-gray-300">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                保存
              </button>
              <button onClick={() => setEditNote(null)} className="btn-secondary text-sm">取消</button>
            </div>
          </div>
        )}
      </Modal>

      {/* ═══ Delete Confirmation ═══ */}
      <Modal open={!!deleteNote} onClose={() => setDeleteNote(null)} title="确认删除" icon={<Trash2 className="w-5 h-5 text-red-500" />}>
        {deleteNote && (
          <div className="space-y-3">
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
              确定要删除此笔记吗？关联的 <strong>{deleteNote.cards.length}</strong> 张卡片也将被删除。此操作不可撤销。
            </div>
            <div className="text-sm text-gray-600 space-y-1 bg-gray-50 rounded-xl p-2.5">
              {deleteNote.fieldNames.slice(0, 2).map((name, i) => (
                <p key={i}>
                  <span className="text-gray-400 font-medium">{name}：</span>
                  {deleteNote.fields[i] || <span className="text-gray-300 italic">空</span>}
                </p>
              ))}
              {deleteNote.fieldNames.length > 2 && (
                <p className="text-gray-400 text-xs">...还有 {deleteNote.fieldNames.length - 2} 个字段</p>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleDelete} disabled={deleting}
                className="bg-red-500 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-xl flex items-center gap-2 disabled:bg-gray-300 transition-all">
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                确认删除
              </button>
              <button onClick={() => setDeleteNote(null)} className="btn-secondary text-sm">取消</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
