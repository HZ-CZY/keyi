// 制卡中心 —— 当前牌组的卡片数据源
//
// 负责：拉 deckNotes、按重点字分组、搜索、排序、以及所有增删改后的刷新。
//
// 【为什么分组放在这里而不是组件里】
// 分组要跟着「搜索 + 排序」联动：搜到 3 张卡时，分组也要只剩这 3 张所属的组。
// 放在组件里会变成三处 useMemo 互相依赖，容易漏依赖数组。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { groupKeyOf, parseKeyword, UNMARKED_KEY } from '../keyword';
import type { KeywordGroup, NoteItem } from '../types';

export type CardSortField = 'keyword' | 'front' | 'cards';
export type CardSortOrder = 'asc' | 'desc';
/** keyword = 按重点字分组（默认）；flat = 平铺列表 */
export type CardViewMode = 'keyword' | 'flat';

export interface UseAdminNotesResult {
  notes: NoteItem[];
  deckName: string;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;

  /** 搜索 + 排序后的结果 */
  filtered: NoteItem[];
  /** 分组结果（viewMode='flat' 时不消费，但仍然算出，供数字统计用） */
  groups: KeywordGroup[];
  /** 本牌组用到的不同重点字数量 */
  keywordCount: number;
  /** 全牌组的风险卡统计，用于标题栏提示 */
  risk: { multi: number; missing: number };

  search: string;
  setSearch: (v: string) => void;
  sortField: CardSortField;
  setSortField: (v: CardSortField) => void;
  sortOrder: CardSortOrder;
  setSortOrder: (v: CardSortOrder) => void;
  resetFilters: () => void;
}

export function useAdminNotes(adminId: number | undefined, deckId: number | null): UseAdminNotesResult {
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [deckName, setDeckName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<CardSortField>('keyword');
  const [sortOrder, setSortOrder] = useState<CardSortOrder>('asc');

  const resetFilters = useCallback(() => {
    setSearch('');
    setSortField('keyword');
    setSortOrder('asc');
  }, []);

  const load = useCallback(async (id: number, clearFilters: boolean) => {
    if (!adminId) return;
    setLoading(true);
    setError(null);
    // 切换牌组时清空筛选 —— 上一轮行为如此（原 handleDeckChange / loadNotes）
    if (clearFilters) resetFilters();
    try {
      const res = await api.admin.deckNotes(adminId, id);
      setNotes(res?.notes || []);
      setDeckName(res?.deckName || '');
    } catch (err: any) {
      setError(err?.message || '加载卡片失败');
      setNotes([]);
      setDeckName('');
    } finally {
      setLoading(false);
    }
  }, [adminId, resetFilters]);

  useEffect(() => {
    if (deckId == null) {
      setNotes([]);
      setDeckName('');
      return;
    }
    load(deckId, true);
  }, [deckId, load]);

  /** 增删改后刷新，但保留当前搜索/排序 —— 老师改完一张卡不该被踢回顶部 */
  const reload = useCallback(async () => {
    if (deckId == null) return;
    await load(deckId, false);
  }, [deckId, load]);

  // ── 搜索 + 排序 ────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = notes;

    if (q) {
      list = list.filter(n =>
        n.fields.some(f => (f || '').toLowerCase().includes(q)) ||
        (n.tags || '').toLowerCase().includes(q),
      );
    }

    const sorted = [...list];
    const dir = sortOrder === 'asc' ? 1 : -1;
    if (sortField === 'front') {
      sorted.sort((a, b) => dir * (a.fields[0] || '').localeCompare(b.fields[0] || '', 'zh-CN'));
    } else if (sortField === 'cards') {
      sorted.sort((a, b) => dir * (a.cards.length - b.cards.length));
    } else {
      // keyword：先按重点字排，同字再按原句排 —— 同字多义项自然相邻
      sorted.sort((a, b) => {
        const ka = groupKeyOf(a.fields[0]);
        const kb = groupKeyOf(b.fields[0]);
        const c = ka.localeCompare(kb, 'zh-CN');
        if (c !== 0) return dir * c;
        return (a.fields[0] || '').localeCompare(b.fields[0] || '', 'zh-CN');
      });
    }
    return sorted;
  }, [notes, search, sortField, sortOrder]);

  // ── 全牌组的风险统计（不吃搜索影响，标题栏要显示真实情况）──
  const risk = useMemo(() => {
    let multi = 0, missing = 0;
    for (const n of notes) {
      const { state } = parseKeyword(n.fields[0]);
      if (state === 'multi') multi++;
      else if (state === 'missing') missing++;
    }
    return { multi, missing };
  }, [notes]);

  // ── 按重点字分组 ───────────────────────────────────────
  const groups = useMemo<KeywordGroup[]>(() => {
    const map = new Map<string, KeywordGroup>();
    for (const n of filtered) {
      const info = parseKeyword(n.fields[0]);
      const key = info.keyword || UNMARKED_KEY;
      let g = map.get(key);
      if (!g) {
        g = { key, keyword: info.keyword, notes: [], issues: { multi: 0, missing: 0 } };
        map.set(key, g);
      }
      g.notes.push(n);
      if (info.state === 'multi') g.issues.multi++;
      else if (info.state === 'missing') g.issues.missing++;
    }

    const arr = [...map.values()];
    // 未标记组永远沉底 —— 它是「待整理」区，不该抢占视线
    arr.sort((a, b) => {
      if (a.key === UNMARKED_KEY) return 1;
      if (b.key === UNMARKED_KEY) return -1;
      // 卡片多的字排前面（线上「当」15 张最多）
      return b.notes.length - a.notes.length || a.key.localeCompare(b.key, 'zh-CN');
    });
    return arr;
  }, [filtered]);

  const keywordCount = useMemo(
    () => new Set(notes.map(n => parseKeyword(n.fields[0]).keyword).filter(Boolean)).size,
    [notes],
  );

  return {
    notes, deckName, loading, error, reload,
    filtered, groups, keywordCount, risk,
    search, setSearch,
    sortField, setSortField,
    sortOrder, setSortOrder,
    resetFilters,
  };
}
