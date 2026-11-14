// 制卡中心 —— 页面容器（2026-09-28 UI 重做）
//
// 【重做依据】
// 实测线上数据：151 个牌组 / 1738 张卡 / 只有「古文翻译」一种有效笔记类型。
// 其中 546 大卡组 869 张卡，而它的 869 张卡与 150 个字牌组里的卡是**同一条笔记**
// （869/869 的 source_note_id 非空、字段零差异）—— 改一次两边同时生效。
// 所以这个页面实质是单用途工具：围绕「一个字 → 它的若干个义项」做卡片维护。
//
// 【本文件职责】
// 只做编排：左栏牌组树 + 右栏工作区 + 若干弹窗。
// 所有数据逻辑在 hooks/，所有 UI 在子组件。原来 1947 行 ~30 个 useState，
// 现在容器只有 3 个核心 state（选中牌组、AI 向导开关、消息条）。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CheckCircle, PanelLeft, X as XIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

import DeckTree from './admin-cards/DeckTree';
import WorkArea from './admin-cards/WorkArea';
import AiImportWizard from './admin-cards/AiImportWizard';
import { useAdminDecks } from './admin-cards/hooks/useAdminDecks';
import { useAdminNotes } from './admin-cards/hooks/useAdminNotes';
import { deckRole, type Deck, type Message, type NoteItem } from './admin-cards/types';
import type { DeckNodeActions } from './admin-cards/DeckTreeItem';

import DeckMetaModal from './admin-cards/modals/DeckMetaModal';
import CreateNoteModal from './admin-cards/modals/CreateNoteModal';
import EditNoteModal from './admin-cards/modals/EditNoteModal';
import DeleteNoteModal from './admin-cards/modals/DeleteNoteModal';
import MergeDeckModal, { type MergeSelection } from './admin-cards/modals/MergeDeckModal';
import DissolveModal from './admin-cards/modals/DissolveModal';

/** WantWords 干扰词生成（仅「选择题」类型用） */
async function fetchDistractors(correctWord: string): Promise<string[]> {
  const res = await fetch(`/wantwords/ChineseRD/?q=${encodeURIComponent(correctWord)}&m=ZhZh&f=1`);
  const data = await res.json();
  const words: string[] = (data?.data || []).map((d: any) =>
    typeof d === 'string' ? d : (d.word || d.name || ''),
  );
  return words.filter((w: string) => w && w !== correctWord);
}

/** 在 fields 里把空选项位用干扰词填上 */
function fillDistractors(fields: string[], correctIdx: number, pool: string[]): { next: string[]; filled: number } {
  const next = [...fields];
  let cursor = 0;
  let filled = 0;
  for (const idx of [1, 2, 3, 4]) {
    if (idx === correctIdx) continue;
    if (next[idx]?.trim()) continue;
    if (cursor >= pool.length) break;
    next[idx] = pool[cursor++];
    filled++;
  }
  return { next, filled };
}

export default function AdminCardsPage() {
  const { user } = useAuth();
  const adminId = (user as any)?.id;

  // ── 核心状态（只有 3 个）──────────────────────────
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  // ── UI 状态 ────────────────────────────────────
  const [deckSearch, setDeckSearch] = useState('');
  const [viewMode, setViewMode] = useState<'keyword' | 'flat'>('keyword');
  /**
   * 牌组栏是否展开。
   * 初值由视口宽度决定：< 1280px 收成抽屉，宽屏展开。
   * 用惰性初始化而不是 useEffect，避免首帧闪一下。
   */
  // 【2026-10-12】改为无条件默认展开：老师反馈窄屏打开时左栏默认收着，
  // 一进来只看到右栏、以为牌组没了。仍可用标题栏 / Ctrl+B 手动收起。
  const [treeOpen, setTreeOpen] = useState(true);
  const [treeMounted, setTreeMounted] = useState(treeOpen);

  // ── 弹窗状态 ────────────────────────────────────
  const [deckMetaModal, setDeckMetaModal] = useState<{ open: boolean; mode: 'create' | 'edit' }>(
    { open: false, mode: 'create' },
  );
  const [savingDeckMeta, setSavingDeckMeta] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState(false);
  const [editNote, setEditNote] = useState<NoteItem | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [deleteNote, setDeleteNote] = useState<NoteItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [merging, setMerging] = useState(false);
  const [showDissolve, setShowDissolve] = useState(false);
  const [dissolving, setDissolving] = useState(false);
  const [generating, setGenerating] = useState(false);

  // ── 数据 ───────────────────────────────────────
  const deckData = useAdminDecks(adminId, deckSearch);
  const notesData = useAdminNotes(adminId, selectedDeckId);

  const currentDeck = useMemo(
    () => deckData.deckById(selectedDeckId),
    [deckData, selectedDeckId],
  );
  const isBigDeck = !!currentDeck && deckRole(currentDeck) === 'big';

  /**
   * 当前牌组是「字牌组」时，找出它所属的大卡组名。
   * 用于卡片行提示「与 XXX 是同一张」—— 实测这两个牌组的卡是同一条笔记。
   */
  const hostBigDeckName = useMemo(() => {
    if (!currentDeck) return undefined;
    if (deckRole(currentDeck) === 'big') return undefined;
    // 从大卡组的 source_decks 里找自己
    const host = deckData.decks.find(d =>
      d.source_decks?.some(sd => sd.id === currentDeck.id),
    );
    return host?.name;
  }, [currentDeck, deckData.decks]);

  // ── 消息条自动消失 ─────────────────────────────
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(t);
  }, [message]);

  const notify = useCallback((type: 'error' | 'success', text: string) => {
    setMessage({ type, text });
  }, []);

  // ── 选中牌组 ──────────────────────────────────
  // 注意：这里不再自动收起牌组栏。上一版窄屏点一下就收起，宽屏下点牌组栏会
  // 莫名其妙消失；现在收起与否完全由用户控制（按钮 / Ctrl+B）。
  const handleSelectDeck = useCallback((d: Deck) => {
    setSelectedDeckId(d.id);
  }, []);

  // 收起的瞬间保留内容，等过渡播完再卸载 —— 否则宽度动画会跳
  useEffect(() => {
    if (treeOpen) { setTreeMounted(true); return; }
    const t = setTimeout(() => setTreeMounted(false), 200);
    return () => clearTimeout(t);
  }, [treeOpen]);

  // ── 牌组操作 ──────────────────────────────────
  const openCreateDeck = () => setDeckMetaModal({ open: true, mode: 'create' });
  const openEditDeck = () => {
    if (!currentDeck) return;
    setDeckMetaModal({ open: true, mode: 'edit' });
  };

  const handleSubmitDeckMeta = async (name: string, desc: string) => {
    if (!adminId) return;
    setSavingDeckMeta(true);
    try {
      if (deckMetaModal.mode === 'create') {
        const res = await api.decks.create({ name, description: desc });
        notify('success', `牌组「${name}」创建成功`);
        setDeckMetaModal({ open: false, mode: 'create' });
        await deckData.reload();
        setSelectedDeckId(res.id);
      } else {
        if (!selectedDeckId) return;
        const res = await api.admin.updateDeck(selectedDeckId, { name, description: desc });
        notify('success', res.message || '已更新牌组');
        setDeckMetaModal({ open: false, mode: 'edit' });
        await deckData.reload();
        notesData.reload();
      }
    } catch (err: any) {
      notify('error', err?.message || '保存失败');
    } finally {
      setSavingDeckMeta(false);
    }
  };

  const handleMerge = async (sel: MergeSelection) => {
    setMerging(true);
    try {
      const res = await api.admin.mergeDecks(sel.selectedIds, sel.name, sel.desc);
      notify('success', `合并成功！${res.message}`);
      setShowMerge(false);
      await deckData.reload();
      if (res.deck?.id) setSelectedDeckId(res.deck.id);
    } catch (err: any) {
      notify('error', err?.message || '合并失败');
    } finally {
      setMerging(false);
    }
  };

  const handleDissolve = async () => {
    if (!selectedDeckId) return;
    setDissolving(true);
    try {
      const res = await api.admin.dissolveDeck(selectedDeckId);
      notify('success', res.message || '已解散合并牌组');
      setShowDissolve(false);
      setSelectedDeckId(null);
      await deckData.reload();
    } catch (err: any) {
      notify('error', err?.message || '解散失败');
    } finally {
      setDissolving(false);
    }
  };

  const handleDeleteSourceDeck = async (e: React.MouseEvent, deckId: number) => {
    e.stopPropagation();
    if (!confirm('确定删除此子牌组及所有卡片？')) return;
    try {
      await api.decks.delete(deckId);
      await deckData.reload();
      if (selectedDeckId === deckId) setSelectedDeckId(null);
    } catch (err: any) {
      notify('error', err?.message || '删除失败');
    }
  };

  // ── 卡片操作 ──────────────────────────────────
  const handleCreateNote = async (notetypeId: number, fields: string[]) => {
    if (!adminId || !selectedDeckId) return;
    if (fields.some(f => !f.trim())) {
      notify('error', '请填写所有字段');
      return;
    }
    setCreating(true);
    try {
      await api.admin.createNote({ userId: adminId, notetypeId, deckId: selectedDeckId, fields });
      setJustCreated(true);
      setTimeout(() => setJustCreated(false), 2000);
      await notesData.reload();
      // 连打：把焦点送回第一个输入框
      requestAnimationFrame(() => {
        const ta = document.querySelector<HTMLTextAreaElement>('.fixed textarea');
        ta?.focus();
      });
    } catch (err: any) {
      notify('error', err?.message || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const openEditNote = (n: NoteItem) => setEditNote(n);

  const handleSaveNote = async (fields: string[]) => {
    if (!editNote) return;
    if (fields.some(f => !f.trim())) {
      notify('error', '字段不能为空');
      return;
    }
    setSavingNote(true);
    try {
      await api.admin.updateNote(editNote.id, { fields });
      notify('success', '卡片已更新');
      setEditNote(null);
      // 大卡组 ↔ 字牌组改的是同一条笔记，两边都要重算
      await notesData.reload();
      await deckData.reload();
    } catch (err: any) {
      notify('error', err?.message || '保存失败');
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNote = async () => {
    if (!deleteNote) return;
    setDeleting(true);
    try {
      await api.admin.deleteNote(deleteNote.id);
      notify('success', '笔记已删除');
      setDeleteNote(null);
      await notesData.reload();
      await deckData.reload();
    } catch (err: any) {
      notify('error', err?.message || '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  /** 选题专用：拿干扰词填进空选项位，返回填好的 fields 交给弹窗 */
  const handleWantWords = async (fields: string[]): Promise<string[]> => {
    const answerLetter = (fields[5] || '').trim().toUpperCase();
    const correctIdx = ({ A: 1, B: 2, C: 3, D: 4 } as Record<string, number>)[answerLetter];
    const correctWord = correctIdx ? fields[correctIdx] || '' : '';
    if (!correctWord.trim()) {
      notify('error', '请先填写正确答案和对应选项内容');
      return fields;
    }
    setGenerating(true);
    try {
      const pool = await fetchDistractors(correctWord);
      const { next, filled } = fillDistractors(fields, correctIdx, pool);
      if (filled === 0) notify('error', '未找到合适的干扰词，请手动填写');
      else notify('success', `已生成 ${filled} 个干扰词`);
      return next;
    } catch {
      notify('error', '获取干扰词失败，请检查网络');
      return fields;
    } finally {
      setGenerating(false);
    }
  };

  // ── 快捷键 ────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = e.target as HTMLElement;
      if (tag instanceof HTMLInputElement || tag instanceof HTMLTextAreaElement || tag instanceof HTMLSelectElement) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'n') {
        e.preventDefault();
        if (selectedDeckId) setShowCreate(true);
      }
      if (mod && e.key === 'k') {
        e.preventDefault();
        document.getElementById('card-search')?.focus();
      }
      if (mod && e.key === 'b') {
        e.preventDefault();
        setTreeOpen(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedDeckId]);

  const actions: DeckNodeActions = {
    onEdit: d => { setSelectedDeckId(d.id); setDeckMetaModal({ open: true, mode: 'edit' }); },
    onMerge: () => setShowMerge(true),
    onDissolve: d => { setSelectedDeckId(d.id); setShowDissolve(true); },
    onDelete: d => {
      if (!confirm(`确定删除牌组「${d.name}」及其中所有卡片？`)) return;
      api.decks.delete(d.id)
        .then(() => deckData.reload())
        .then(() => { if (selectedDeckId === d.id) setSelectedDeckId(null); })
        .catch((err: any) => notify('error', err?.message || '删除失败'));
    },
  };

  // 编辑弹窗的同步目标信息
  const syncTarget = useMemo(() => {
    if (!currentDeck) return { bigDeck: null, childDeck: null };
    if (isBigDeck) return { bigDeck: null, childDeck: null };
    const host = deckData.decks.find(d => d.source_decks?.some(sd => sd.id === currentDeck.id));
    if (!host) return { bigDeck: null, childDeck: null };
    return {
      bigDeck: { id: host.id, name: host.name, published: host.published === 1 },
      childDeck: { id: currentDeck.id, name: currentDeck.name },
    };
  }, [currentDeck, isBigDeck, deckData.decks]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-start">
        {/* ── 左栏：可折叠牌组抽屉 ── */}
        <div
          className={`flex-shrink-0 transition-[width,opacity] duration-200 ease-premium ${
            treeOpen ? 'w-[260px] opacity-100' : 'w-0 opacity-0'
          }`}
          style={{ overflow: treeOpen ? 'visible' : 'hidden' }}
          aria-hidden={!treeOpen}
        >
          {treeMounted && (
            <DeckTree
              data={deckData}
              selectedDeckId={selectedDeckId}
              search={deckSearch}
              onSearchChange={setDeckSearch}
              onSelect={handleSelectDeck}
              actions={actions}
              onNewDeck={openCreateDeck}
              onDeleteSourceDeck={handleDeleteSourceDeck}
              onCollapse={() => setTreeOpen(false)}
            />
          )}
        </div>

        {/* ── 折叠态的唤醒条 ── */}
        {!treeOpen && (
          <button
            onClick={() => setTreeOpen(true)}
            title="展开牌组栏 (Ctrl+B)"
            className="flex-shrink-0 sticky top-5 flex flex-col items-center gap-1.5 w-7 py-2.5 rounded-xl bg-white border border-gray-200 shadow-sm text-gray-400 hover:text-primary-600 hover:border-primary-200 hover:bg-primary-50/60 transition-colors"
          >
            <PanelLeft className="w-3.5 h-3.5" />
            <span
              className="text-[10px] tracking-widest text-gray-400"
              style={{ writingMode: 'vertical-rl' }}
            >
              牌组
            </span>
          </button>
        )}

        {/* ── 右栏：工作区 ── */}
        <WorkArea
          hasDeck={!!selectedDeckId}
          deckName={notesData.deckName || currentDeck?.name || ''}
          cardCount={notesData.notes.length}
          keywordCount={notesData.keywordCount}
          risk={notesData.risk}
          isBigDeck={isBigDeck}
          isPublished={currentDeck?.published === 1}
          sourceDeckCount={currentDeck?.source_decks?.length ?? 0}
          handleDeckId={selectedDeckId}
          bigDeckName={hostBigDeckName}
          loading={notesData.loading}
          groups={notesData.groups}
          filtered={notesData.filtered}
          notesCount={notesData.notes.length}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          search={notesData.search}
          onSearchChange={notesData.setSearch}
          onClearSearch={notesData.resetFilters}
          sortField={notesData.sortField}
          onSortFieldChange={notesData.setSortField}
          sortOrder={notesData.sortOrder}
          onSortOrderToggle={() => notesData.setSortOrder(notesData.sortOrder === 'asc' ? 'desc' : 'asc')}
          onEditDeck={openEditDeck}
          onMerge={() => setShowMerge(true)}
          onDissolve={() => setShowDissolve(true)}
          onEditNote={openEditNote}
          onDeleteNote={n => { setDeleteNote(n); setMessage(null); }}
          onAi={() => {
            if (!selectedDeckId) { notify('error', '请先选择牌组'); return; }
            setAiOpen(true);
          }}
          onNew={() => {
            if (!selectedDeckId) { notify('error', '请先选择牌组'); return; }
            setJustCreated(false);
            setShowCreate(true);
          }}
        />
      </div>

      {/* ── 消息条（固定右下角，不挤占布局）── */}
      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-6 right-6 z-[80] max-w-sm"
          >
            <div className={`flex items-start gap-2.5 px-4 py-3 rounded-xl shadow-lg border ${
              message.type === 'error'
                ? 'bg-red-50 border-red-200'
                : 'bg-green-50 border-green-200'
            }`}>
              {message.type === 'error'
                ? <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                : <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />}
              <p className={`flex-1 text-[13px] ${message.type === 'error' ? 'text-red-700' : 'text-green-700'}`}>
                {message.text}
              </p>
              <button
                onClick={() => setMessage(null)}
                className={`p-0.5 ${message.type === 'error' ? 'text-red-400 hover:text-red-600' : 'text-green-400 hover:text-green-600'}`}
              >
                <XIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 弹窗 ── */}
      <DeckMetaModal
        open={deckMetaModal.open}
        mode={deckMetaModal.mode}
        initialName={deckMetaModal.mode === 'edit' ? (currentDeck?.name || '') : ''}
        initialDesc={deckMetaModal.mode === 'edit' ? (currentDeck?.description || '') : ''}
        isBigDeck={isBigDeck}
        sourceDeckCount={currentDeck?.source_decks?.length ?? 0}
        saving={savingDeckMeta}
        onClose={() => setDeckMetaModal(m => ({ ...m, open: false }))}
        onSubmit={handleSubmitDeckMeta}
      />

      <CreateNoteModal
        userId={adminId ?? 0}
        open={showCreate}
        creating={creating}
        justCreated={justCreated}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreateNote}
        onWantWords={handleWantWords}
        generating={generating}
      />

      <EditNoteModal
        note={editNote}
        syncTarget={syncTarget}
        saving={savingNote}
        onClose={() => setEditNote(null)}
        onSave={handleSaveNote}
        onWantWords={handleWantWords}
        generating={generating}
      />

      <DeleteNoteModal
        note={deleteNote}
        deleting={deleting}
        onClose={() => setDeleteNote(null)}
        onConfirm={handleDeleteNote}
      />

      <MergeDeckModal
        open={showMerge}
        decks={deckData.decks}
        merging={merging}
        onClose={() => setShowMerge(false)}
        onConfirm={handleMerge}
      />

      <DissolveModal
        deck={showDissolve ? currentDeck : undefined}
        dissolving={dissolving}
        onClose={() => setShowDissolve(false)}
        onConfirm={handleDissolve}
      />

      <AiImportWizard
        open={aiOpen}
        adminId={adminId}
        deckId={selectedDeckId}
        deckName={notesData.deckName || currentDeck?.name || ''}
        onClose={() => setAiOpen(false)}
        onImported={async msg => {
          notify('success', msg);
          await notesData.reload();
          await deckData.reload();
        }}
        onMessage={notify}
      />
    </div>
  );
}
