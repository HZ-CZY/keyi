// 制卡中心 —— 牌组数据源
//
// 把原本散在 AdminCardsPage 里的 decks / decksLoading / 分组 / 排序 / 拼音
// 全部收进这个 hook，页面组件只消费结果。
//
// 【三重身份分组是必须的，不是设计偏好】
// 实测线上：151 个牌组里 150 个都已 merged_into_id=546，
// 真正的「独立小牌组」是 0 个。如果还按「大/小」二分，
// 「小卡组」区会永远塞着 149 个单字牌组，和现在一屏 pill 的问题一模一样。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { pinyin } from 'pinyin-pro';
import { api } from '../../../lib/api';
import { deckRole, type Deck, type DeckGroups } from '../types';

/** 取名字首字的拼音首字母；非汉字归入 '#' */
export function initialOf(name: string): string {
  const first = (name || '').trim()[0];
  if (!first) return '#';
  if (!/[\u4e00-\u9fa5]/.test(first)) return '#';
  const arr = pinyin(first, { pattern: 'first', toneType: 'none', type: 'array' });
  const letter = (arr?.[0] || '')[0];
  return letter ? letter.toUpperCase() : '#';
}

/** 牌组名的拼音全拼，用于「dang 命中 当」这类检索 */
function pinyinFull(name: string): string {
  if (!name) return '';
  if (!/[\u4e00-\u9fa5]/.test(name)) return name.toLowerCase();
  return pinyin(name, { toneType: 'none', type: 'string' }).replace(/\s+/g, '').toLowerCase();
}

export type DeckSortOrder = 'az' | 'za' | 'count';

export interface UseAdminDecksResult {
  decks: Deck[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;

  /** 三段式分组（未搜索时用） */
  groups: DeckGroups;
  /** 搜索后的结果：命中项 + 它们的角色。搜索非空时左栏改渲染这个 */
  searchResults: Deck[];
  searching: boolean;

  /** 已并入区的拼音分组：'D' -> [当, 道, 得...] */
  nestedByInitial: { letter: string; decks: Deck[] }[];

  /** 按 id 查牌组（多处要「当前牌组的 source_decks / published」） */
  deckById: (id: number | null) => Deck | undefined;
  /** 大牌组自己的名字，用于「已并入 XXX」文案 */
  hostNameOf: (d: Deck) => string;
}

export function useAdminDecks(adminId: number | undefined, search: string): UseAdminDecksResult {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!adminId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api.admin.decks();
      setDecks(Array.isArray(list) ? list : []);
    } catch (err: any) {
      setError(err?.message || '加载牌组失败');
      setDecks([]);
    } finally {
      setLoading(false);
    }
  }, [adminId]);

  useEffect(() => { reload(); }, [reload]);

  // ── 三段式分组 ─────────────────────────────────────────
  const groups = useMemo<DeckGroups>(() => {
    const g: DeckGroups = { big: [], independent: [], nested: [] };
    for (const d of decks) g[deckRole(d)].push(d);
    return g;
  }, [decks]);

  // ── 已并入区按拼音首字母分组 ───────────────────────────
  // 150 个单字平铺依然太长，按 A/B/C… 切成通讯录式的小段才扫得动。
  const nestedByInitial = useMemo(() => {
    const buckets = new Map<string, Deck[]>();
    for (const d of groups.nested) {
      const letter = initialOf(d.name);
      const arr = buckets.get(letter);
      if (arr) arr.push(d);
      else buckets.set(letter, [d]);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)))
      .map(([letter, list]) => ({
        letter,
        decks: [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
      }));
  }, [groups.nested]);

  // ── 搜索：中文名 / 拼音 / 牌组 id ──────────────────────
  // 只搜牌组名。搜卡片内容需要遍历 151 个牌组各调一次接口，不可接受；
  // 卡片搜索放在右栏、只针对当前牌组。
  const searching = search.trim().length > 0;
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return decks.filter(d => {
      if (d.name.toLowerCase().includes(q)) return true;
      if (pinyinFull(d.name).includes(q)) return true;
      return false;
    });
  }, [decks, search]);

  const deckById = useCallback(
    (id: number | null) => (id == null ? undefined : decks.find(d => d.id === id)),
    [decks],
  );

  const hostNameOf = useCallback(
    (d: Deck) => {
      if (!d.merged_into_id) return '';
      return decks.find(p => p.id === d.merged_into_id)?.name || '大卡组';
    },
    [decks],
  );

  return {
    decks, loading, error, reload,
    groups, searchResults, searching,
    nestedByInitial,
    deckById, hostNameOf,
  };
}

/** 左栏与右栏共用的排序器 */
export function sortDecks(list: Deck[], order: DeckSortOrder): Deck[] {
  const out = [...list];
  if (order === 'az') out.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  else if (order === 'za') out.sort((a, b) => b.name.localeCompare(a.name, 'zh-CN'));
  else out.sort((a, b) => b.card_count - a.card_count);
  return out;
}
