import { getDeviceHint, getDeviceId, rememberDeviceId } from './deviceInfo';
import { getTabId } from './tabId';

const BASE = '/api';

/** 带业务错误码的请求异常，便于前端按 code 分支处理 */
export class ApiError extends Error {
  code?: string;
  status: number;
  payload: any;

  constructor(message: string, status: number, code?: string, payload?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export interface AccountBannedInfo {
  /** 提示条标题。不传时按「账号已被封禁」显示（兼容旧调用）。 */
  title?: string;
  message: string;
  bannedUntil: number | null;
  reason: string;
}

// 全局封号广播：任意接口返回 ACCOUNT_BANNED 时清 token 并通知 UI
type BannedListener = (info: AccountBannedInfo) => void;
const bannedListeners = new Set<BannedListener>();

export function onAccountBanned(listener: BannedListener): () => void {
  bannedListeners.add(listener);
  return () => {
    bannedListeners.delete(listener);
  };
}

function notifyAccountBanned(info: AccountBannedInfo): void {
  try {
    localStorage.removeItem('token');
  } catch {
    // ignore
  }
  try {
    document.cookie = 'keyi_token=; Max-Age=0; path=/';
  } catch {
    // ignore
  }
  bannedListeners.forEach(listener => {
    try {
      listener(info);
    } catch {
      // ignore
    }
  });
}

/* ── 商城（2026-09-30）── */
export interface ShopItemInfo {
  key: string;
  name: string;
  description: string;
  price: number;
  kind: string;
  enabled: boolean;
  owned: boolean;
  /** 消耗品专用：部落保护卡的护盾到期时间（Unix 秒，0/空 = 未生效） */
  shieldUntil?: number;
}
export interface ShopBackgroundInfo {
  id: number;
  url: string;
  bytes: number;
  active: boolean;
  createdAt: number;
}
export interface AdminShopItem {
  key: string;
  name: string;
  description: string;
  price: number;
  kind: string;
  enabled: number;
  sort: number;
  updated_at: number;
  owners: number;
}
export interface AdminShopPurchase {
  user_id: number;
  username: string;
  item_key: string;
  price_paid: number;
  status: 'active' | 'refunded';
  created_at: number;
  refunded_at: number | null;
}
export interface AdminShopSummary {
  item_key: string;
  active_count: number;
  income: number;
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    /* 【2026-10-14】标签页标识：服务端据此判定「这个页面是否已被新页面接管」。
       一个账号只能在一个页面里用，被判定的页面会拿到 401 SESSION_REPLACED。 */
    'X-KEYI-TAB': getTabId(),
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${url}`, { ...options, headers });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as any;
    const message: string = err.error || `HTTP ${res.status}`;
    // 封号：清本地会话 + 广播，前端据此强制登出并提示
    // 设备限制导致旧会话失效（SESSION_REVOKED）：同样清会话 + 弹提示，让用户看到原因
    if (err.code === 'ACCOUNT_BANNED') {
      notifyAccountBanned({
        title: '账号已被封禁',
        message,
        bannedUntil: typeof err.bannedUntil === 'number' ? err.bannedUntil : null,
        reason: err.reason || '',
      });
    } else if (err.code === 'SESSION_REVOKED' || err.code === 'SESSION_REPLACED') {
      /* SESSION_REVOKED   设备限制生效，旧会话作废
         SESSION_REPLACED 【2026-10-14】账号在别的页面/设备登录了
         两者都走同一条「清会话 + 弹提示 + 强制登出」的链路，
         用户看到的就是服务端给的那句话（比如「这个账号已在别处登录，本页已退出」）。 */
      /* 登录失效（设备限制 / 账号在别处登录 / 系统升级要求重登）——
         标题不能再用「账号已被封禁」，否则会让人以为号被封了。 */
      notifyAccountBanned({ title: '登录已失效', message, bannedUntil: null, reason: '' });
    }
    throw new ApiError(message, res.status, err.code, err);
  }

  return res.json();
}

/**
 * 上传文件专用：multipart 表单**不能**手写 Content-Type
 * （浏览器要自己带 boundary，手写 application/json 会让后端解析不出文件）。
 */
async function requestForm<T>(url: string, form: FormData): Promise<T> {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = { 'X-KEYI-TAB': getTabId() };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${url}`, { method: 'POST', body: form, headers });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as any;
    throw new ApiError(err.error || `HTTP ${res.status}`, res.status, err.code, err);
  }
  return res.json();
}

// Auth
/** 签到状态（含连续奖励档位与补打卡信息，2026-11-06 起） */
export interface CheckinStatus {
  checkedInToday: boolean;
  streak: number;
  todayReviews: number;
  checkedDate: string;
  /** 今天是否算有效学习日（秒过占比 >= 80% 时不算，2026-11-06） */
  todayCounts: boolean;
  /** 今天 1 秒内点完的次数 */
  todayFastReviews: number;
  /** 秒过占比（整数百分比） */
  todayFastPct: number;
  todayReward: number;
  nextTier: { minDays: number; reward: number } | null;
  tiers: { minDays: number; reward: number; label: string }[];
  backfill: {
    cost: number;
    usedThisWeek: number;
    maxPerWeek: number;
    missingDays: string[];
  };
}

/** 站点升级进度（路线图）条目 */
export interface RoadmapItem {
  id: number;
  title: string;
  detail: string;
  category: 'feature' | 'improve' | 'bug' | 'balance';
  status: 'planned' | 'todo' | 'doing' | 'done';
  version: string | null;
  sort: number;
  updated_at: number;
}

export interface RoadmapData {
  counts: Record<string, number>;
  updatedAt: number;
  items: RoadmapItem[];
}

export const api = {
  auth: {
    register: (username: string, password: string) =>
      request<{ token: string; userId: number; username: string; role?: string; avatar_url?: string }>('/auth/register', {
        method: 'POST', body: JSON.stringify({ username, password }),
      }),
    login: async (username: string, password: string) => {
      const res = await request<{ token: string; userId: number; username: string; role?: string; avatar_url?: string; is_teacher?: number; badge_label?: string; deviceId?: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password, device: await getDeviceHint(), deviceId: getDeviceId() }),
      });
      rememberDeviceId(res?.deviceId);
      return res;
    },
    me: () => request<any>('/auth/me'),
    getRegistrationStatus: () => request<{ enabled: boolean }>('/auth/registration-status'),
    changePassword: (oldPassword: string, newPassword: string) =>
      request<any>('/auth/password', {
        method: 'PUT', body: JSON.stringify({ oldPassword, newPassword }),
      }),

    getSettings: () =>
      request<Record<string, string>>('/auth/settings'),
    updateSettings: (settings: Record<string, string>) =>
      request<{ success: boolean }>('/auth/settings', {
        method: 'PUT', body: JSON.stringify(settings),
      }),
    heartbeat: async () => {
      const res = await request<{ success: boolean; deviceId?: string }>('/auth/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ device: await getDeviceHint(), deviceId: getDeviceId() }),
      });
      rememberDeviceId(res?.deviceId);
      return res;
    },

    uploadAvatar: async (file: File) => {
      const formData = new FormData();
      formData.append('avatar', file);
      const token = localStorage.getItem('token');
      const res = await fetch(`${BASE}/auth/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '头像上传失败' }));
        throw new Error(err.error || '头像上传失败');
      }
      return res.json() as Promise<{
        pendingUrl: string;
        status: 'pending';
        effective: boolean;
        effectiveAvatarUrl: string;
        message?: string;
      }>;
    },
  },

  decks: {
    list: () => request<any[]>('/decks'),
    get: (id: number) => request<any>(`/decks/${id}`),
    create: (data: { name: string; description?: string; parentId?: number }) =>
      request<any>('/decks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<{ name: string; description: string; parentId: number }>) =>
      request<any>(`/decks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<any>(`/decks/${id}`, { method: 'DELETE' }),
    config: (id: number) => request<any>(`/decks/${id}/config`),
    updateConfig: (id: number, config: Partial<any>) =>
      request<any>(`/decks/${id}/config`, { method: 'PUT', body: JSON.stringify(config) }),
    stats: (id: number) => request<any>(`/decks/${id}/stats`),
    // 书架（2026-08-21）: 上架牌组列表 + 自助添加
    shelf: () => request<any[]>('/decks/shelf'),
    addFromShelf: (deckId: number) =>
      request<any>(`/decks/shelf/${deckId}/add`, { method: 'POST' }),
  },

  // 决斗场（2026-08-22）：在线匹配 PK 对战
  battles: {
    match: () => request<any>('/battles/match', { method: 'POST' }),
    state: (id: number) => request<any>(`/battles/${id}`),
    question: (id: number, index: number) => request<any>(`/battles/${id}/question/${index}`),
    answer: (id: number, index: number, choice: number) =>
      request<any>(`/battles/${id}/answer`, { method: 'POST', body: JSON.stringify({ index, choice }) }),
    stats: () => request<any>('/battles/stats'),
    // 匹配中主动取消（仅发起人）：waiting 局立即退款 50
    cancel: (id: number) => request<any>(`/battles/${id}/cancel`, { method: 'POST' }),
    // 实时战报：正在打 + 最近结算的对局，前端每 4s 轮询
    feed: (limit: number = 6) =>
      request<any>("/battles/feed?limit=" + limit),
    /** 嘲讽配置：是否已解锁 + 文案 + 每局上限/冷却（文案由服务端下发） */
    tauntConfig: () =>
      request<{ owned: boolean; items: { idx: number; text: string }[]; maxPerBattle: number; cooldownSeconds: number }>(
        '/battles/taunts'
      ),
    /** 发嘲讽：只传下标，文本与校验全在服务端 */
    taunt: (id: number, idx: number) =>
      request<{ success: boolean; id: number; text: string; at: number; remaining: number }>(
        `/battles/${id}/taunt`,
        { method: 'POST', body: JSON.stringify({ idx }) }
      ),
    /* 好友开房间（2026-11-06）：房主开房拿 6 位码，对方凭码加入 */
    createRoom: () =>
      request<{ ok: boolean; battleId: number; roomCode: string; reused?: boolean }>('/battles/room', {
        method: 'POST',
      }),
    joinRoom: (code: string) =>
      request<{ ok: boolean; battleId: number; status?: string; alreadyIn?: boolean }>(
        `/battles/room/${encodeURIComponent(code)}/join`,
        { method: 'POST' }
      ),
    roomInfo: (code: string) =>
      request<{
        battleId: number;
        roomCode: string;
        status: string;
        hostName: string;
        guestName: string | null;
        isHost: boolean;
        startsIn: number;
      }>(`/battles/room/${encodeURIComponent(code)}`),
  },

  // 铜板经济（2026-08-22）：服务器账号资产与训练场记账
  coins: {
    get: () => request<{ balance: number; todayEarned: number; todaySpent: number }>('/coins'),
    ledger: (offset = 0, limit = 50) =>
      request<{ total: number; items: any[] }>(`/coins/ledger?offset=${offset}&limit=${limit}`),
    trainingEntry: (mode: string) =>
      request<{ balance: number; deducted: number; mode: string }>('/coins/training/entry', {
        method: 'POST', body: JSON.stringify({ mode }),
      }),
    trainingReport: (correct: number) =>
      request<{ balance: number; added: number }>('/coins/training/report', {
        method: 'POST', body: JSON.stringify({ correct }),
      }),
    // 校园小岛每日任务领奖（key: learn20 / checkin / review20，服务端权威校验）
    taskClaim: (key: string) =>
      request<{ added: number; balance: number }>('/coins/task/claim', {
        method: 'POST', body: JSON.stringify({ key }),
      }),
  },

  /* ── 商城 ── */
  shop: {
    /** 商品目录（含「我是否已拥有」+ 我的铜板余额） */
    items: () => request<{ balance: number; items: ShopItemInfo[] }>('/shop/items'),
    /** 购买：价格由服务端定，这里只报 key */
    buy: (key: string) =>
      request<{
        success: boolean;
        key: string;
        name: string;
        spent: number;
        balance: number;
        /** 消耗品购买后返回新的到期时间（Unix 秒） */
        shieldUntil?: number;
      }>('/shop/buy', {
        method: 'POST',
        body: JSON.stringify({ key }),
      }),
    /** 切换已拥有的称号（买断后可随时免费切换） */
    activateTitle: (key: string) =>
      request<{ success: boolean; badge: string }>('/shop/title/activate', {
        method: 'POST',
        body: JSON.stringify({ key }),
      }),
    /** 我的背景图 + 配额 */
    backgrounds: () =>
      request<{ owned: boolean; max: number; activeId: number | null; items: ShopBackgroundInfo[] }>('/shop/backgrounds'),
    /** 上传背景图（需先解锁） */
    uploadBackground: (file: File) => {
      const fd = new FormData();
      fd.append('image', file);
      return requestForm<{ success: boolean; id: number; url: string; bytes: number; active: boolean }>('/shop/backgrounds', fd);
    },
    /** 选用某张 */
    setActiveBackground: (id: number) =>
      request<{ success: boolean; activeId: number }>(`/shop/backgrounds/${id}/active`, { method: 'POST' }),
    /** 删除某张 */
    deleteBackground: (id: number) =>
      request<{ success: boolean; deleted: number; wasActive: boolean }>(`/shop/backgrounds/${id}`, { method: 'DELETE' }),
  },

  // 每日任务（2026-09-09）：首页任务中心 + 一起背任务小车共用同一数据源
  tasks: {
    today: () =>
      request<{
        date: string;
        tasks: {
          id: number;
          key: string;
          type: 'learn' | 'review' | 'checkin' | 'due' | 'accuracy' | 'streak';
          title: string;
          target: number;
          reward: number;
          sort: number;
          progress: number;
          /** due 任务专用：没有复习卡时该任务「不适用」而非「未完成」 */
          notApplicable?: boolean;
          done: boolean;
          claimed: boolean;
        }[];
      }>('/tasks/today'),
  },

  cards: {
    due: (params: { deckId?: number; limit?: number; mode?: 'new' | 'review' } = {}) => {
      const searchParams = new URLSearchParams();
      if (params.deckId) searchParams.set('deck_id', String(params.deckId));
      if (params.limit) searchParams.set('limit', String(params.limit));
      if (params.mode) searchParams.set('mode', params.mode);
      return request<any[]>(`/cards/due?${searchParams.toString()}`);
    },
    answer: (cardId: number, rating: number, timeMs: number = 0) =>
      request<any>(`/cards/${cardId}/answer`, {
        method: 'POST', body: JSON.stringify({ rating, timeMs }),
      }),
    deckCards: (deckId: number) => request<any[]>(`/cards/deck/${deckId}`),
    // 重学：把当前用户在该卡组下所有卡片重置为新卡状态，重新进入学习队列
    resetDeck: (deckId: number) =>
      request<{ reset: number }>(`/cards/deck/${deckId}/reset`, { method: 'POST' }),
    distractors: (deckId: number) => request<{ text: string; front?: string; notetype: string; keyword?: string }[]>(`/cards/distractors/${deckId}`),
    allDistractors: () => request<{ text: string; front?: string; notetype: string; keyword?: string }[]>('/cards/all-distractors'),
    statsOverview: () => request<any>('/cards/stats/overview'),
    // 统计页图表（百词斩风格）：未来10天复习计划 / 记忆阶段现状+趋势
    reviewPlan: () => request<{
      days: { label: string; offset: number; count: number; isToday: boolean }[];
      overdue: number;
      todayCount: number;
    }>('/cards/stats/review-plan'),
    stages: () => request<{
      now: Record<string, number>;
      total: number;
      percent: Record<string, number>;
      trend: { date: string; label: string; stages: Record<string, number> }[];
    }>('/cards/stats/stages'),
    // 学习排行榜（仿百词斩）：今日/总计 TOP20 + 我的排名
    leaderboard: (range: 'today' | 'total' = 'today') =>
      request<any>(`/cards/leaderboard?range=${range}`),
  },

  notes: {
    notetypes: () => request<any[]>('/notes/notetypes'),
    createNotetype: (data: any) =>
      request<any>('/notes/notetypes', { method: 'POST', body: JSON.stringify(data) }),
    create: (data: { notetypeId: number; deckId: number; fields: string[]; tags?: string }) =>
      request<any>('/notes', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<{ fields: string[]; tags: string }>) =>
      request<any>(`/notes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },

  import: {
    apkg: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const token = localStorage.getItem('token');
      const res = await fetch(`${BASE}/import/apkg`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Import failed' }));
        throw new Error(err.error || 'Import failed');
      }
      return res.json();
    },
    csv: async (file: File, deckId: number, notetypeId: number, fieldNames: string) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('deckId', String(deckId));
      formData.append('notetypeId', String(notetypeId));
      formData.append('fieldNames', fieldNames);
      const token = localStorage.getItem('token');
      const res = await fetch(`${BASE}/import/csv`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Import failed' }));
        throw new Error(err.error || 'Import failed');
      }
      return res.json();
    },
  },

  admin: {
    dashboard: () => request<any>('/admin/dashboard'),
    heartbeat: async () => {
      const res = await request<any>('/admin/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ device: await getDeviceHint(), deviceId: getDeviceId() }),
      });
      rememberDeviceId(res?.deviceId);
      return res;
    },
    users: () => request<any[]>('/admin/users'),
    createUser: (username: string, password: string) =>
      request<any>('/admin/users', { method: 'POST', body: JSON.stringify({ username, password }) }),
    deleteUser: (id: number) => request<any>(`/admin/users/${id}`, { method: 'DELETE' }),
    resetPassword: (id: number, password: string) =>
      request<any>(`/admin/users/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
    updateUsername: (id: number, username: string) =>
      request<any>(`/admin/users/${id}/username`, { method: 'PUT', body: JSON.stringify({ username }) }),
    decks: () => request<any[]>('/admin/decks'),
    sendDeck: (deckId: number, targetUserId: number) =>
      request<any>(`/admin/decks/${deckId}/send`, { method: 'POST', body: JSON.stringify({ targetUserId }) }),
    getRegistration: () => request<{ enabled: boolean }>('/admin/settings/registration'),
    setRegistration: (enabled: boolean) =>
      request<any>('/admin/settings/registration', { method: 'PUT', body: JSON.stringify({ enabled }) }),
    // 头像审核（2026-09-09）
    avatarReviews: (status: 'pending' | 'approved' | 'rejected' = 'pending') =>
      request<any[]>(`/admin/avatar-reviews?status=${status}`),
    approveAvatar: (reviewId: number) =>
      request<any>(`/admin/avatar-reviews/${reviewId}/approve`, { method: 'POST' }),
    rejectAvatar: (reviewId: number, reason: string) =>
      request<any>(`/admin/avatar-reviews/${reviewId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    // 封号系统（2026-09-09）
    banUser: (userId: number, duration: '1d' | '7d' | '30d' | 'perm', reason: string) =>
      request<any>(`/admin/users/${userId}/ban`, {
        method: 'POST',
        body: JSON.stringify({ duration, reason }),
      }),
    unbanUser: (userId: number) =>
      request<any>(`/admin/users/${userId}/unban`, { method: 'POST' }),
    bannedUsers: () => request<any[]>('/admin/banned-users'),
    auditLogs: (limit: number = 100) => request<any[]>(`/admin/audit-logs?limit=${limit}`),
    userDecks: (userId: number) => request<any>(`/admin/users/${userId}/decks`),
    userStats: (userId: number) => request<any>(`/admin/users/${userId}/stats`),
    clearUserData: (userId: number) =>
      request<any>(`/admin/users/${userId}/clear`, { method: 'DELETE' }),
    clearAllUsers: () =>
      request<any>('/admin/clear-all', { method: 'POST' }),
    /* 班级学情报表（2026-11-06）：数据由 scripts/class_report.js 预计算 */
    classReport: () => request<any>('/admin/class-report'),
    classTrend: (days = 30) => request<any[]>(`/admin/class-report/trend?days=${days}`),
    classStudent: (id: number) => request<any>(`/admin/class-report/student/${id}`),
    classAttention: () => request<any>('/admin/class-report/attention'),
    forceSendDeck: (deckId: number, targetUserId: number) =>
      request<any>(`/admin/decks/${deckId}/force-send`, { method: 'POST', body: JSON.stringify({ targetUserId }) }),
    userNotetypes: (userId: number) => request<any[]>(`/admin/users/${userId}/notetypes`),
    deckNotes: (userId: number, deckId: number) =>
      request<any>(`/admin/users/${userId}/decks/${deckId}/notes`),
    createNote: (data: { userId: number; notetypeId: number; deckId: number; fields: string[]; tags?: string }) =>
      request<any>('/admin/notes', { method: 'POST', body: JSON.stringify(data) }),
    updateNote: (noteId: number, data: { fields?: string[]; tags?: string }) =>
      request<any>(`/admin/notes/${noteId}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteNote: (noteId: number) =>
      request<any>(`/admin/notes/${noteId}`, { method: 'DELETE' }),
    // 原地修改牌组（含大牌组）的名称/描述 —— 不动内容、不改 id
    updateDeck: (deckId: number, data: { name?: string; description?: string }) =>
      request<any>(`/admin/decks/${deckId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    mergeDecks: (sourceDeckIds: number[], newDeckName: string, description?: string) =>
      request<any>('/admin/decks/merge', {
        method: 'POST',
        body: JSON.stringify({ sourceDeckIds, newDeckName, description }),
      }),
    sourceDecks: (deckId: number) =>
      request<any[]>(`/admin/decks/${deckId}/source-decks`),
    dissolveDeck: (deckId: number) =>
      request<any>(`/admin/decks/${deckId}/dissolve`, { method: 'POST' }),
    resyncDeck: (deckId: number) =>
      request<any>(`/admin/decks/${deckId}/resync`, { method: 'POST' }),
    syncDeckCopies: (deckId: number) =>
      request<any>(`/admin/decks/${deckId}/sync-copies`, { method: 'POST' }),
    /* 从大牌组里拆出选中卡片，生成独立新牌组 */
    extractDeck: (deckId: number, name: string, noteIds: number[]) =>
      request<any>(`/admin/decks/${deckId}/extract`, {
        method: 'POST',
        body: JSON.stringify({ name, noteIds }),
      }),
    publishDeck: (deckId: number, published: boolean) =>
      request<any>(`/admin/decks/${deckId}/publish`, {
        method: 'PUT',
        body: JSON.stringify({ published }),
      }),
    // Site content management
    getChangelog: () => request<any[]>('/admin/changelog'),
    createChangelog: (data: { version: string; date: string; description: string }) =>
      request<any>('/admin/changelog', { method: 'POST', body: JSON.stringify(data) }),
    updateChangelog: (id: number, data: { version: string; date: string; description: string }) =>
      request<any>(`/admin/changelog/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteChangelog: (id: number) =>
      request<any>(`/admin/changelog/${id}`, { method: 'DELETE' }),
    getSiteContent: () => request<Record<string, string>>('/admin/site-content'),
    updateSiteContent: (key: string, value: string) =>
      request<any>('/admin/site-content', { method: 'PUT', body: JSON.stringify({ key, value }) }),
    getFeedback: () => request<any[]>('/admin/feedback'),
    /* 反馈待办（2026-11-06 自动分诊配套）：一条待办 = 一个根因，可能对应多条反馈 */
    getFeedbackTodos: () => request<any[]>('/admin/feedback/todos'),
    setFeedbackTodoStatus: (grp: string, status: 'todo' | 'doing' | 'done') =>
      request<any>(`/admin/feedback/todos/${grp}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    deleteFeedback: (id: number) =>
      request<any>(`/admin/feedback/${id}`, { method: 'DELETE' }),
    /* 回复反馈（2026-10-15 回复通道）。传空字符串 = 撤回回复。 */
    replyFeedback: (id: number, reply: string) =>
      request<any>(`/admin/feedback/${id}/reply`, { method: 'PUT', body: JSON.stringify({ reply }) }),
    // 任务管理/布置任务（2026-09-09）：CRUD 每日任务（learn/review/checkin）
    tasks: () => request<any[]>('/admin/tasks'),
    createTask: (data: { type: 'learn' | 'review' | 'checkin'; title: string; target: number; reward: number; sort?: number }) =>
      request<any>('/admin/tasks', { method: 'POST', body: JSON.stringify(data) }),
    updateTask: (id: number, data: { title?: string; target?: number; reward?: number; sort?: number; enabled?: boolean }) =>
      request<any>(`/admin/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteTask: (id: number) =>
      request<any>(`/admin/tasks/${id}`, { method: 'DELETE' }),
    // ── AI 制卡（2026-09-28 重写为「预览 → 确认」两步）──
    // preview：只解析+校验，不写库，返回带校验状态的卡片供老师逐条修改
    // commit ：把老师确认/编辑过的卡片入库
    aiImportPreview: async (file: File, userId: number) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', String(userId));
      const token = localStorage.getItem('token');
      const res = await fetch(`${BASE}/admin/ai-import/preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'AI 解析失败' }));
        throw new Error(err.error || 'AI 解析失败');
      }
      return res.json();
    },
    aiImportCommit: (data: {
      userId: number;
      deckId: number;
      notetypeName?: string;
      cards: { front: string; back: string; plain: string; source?: string }[];
    }) =>
      request<any>('/admin/ai-import/commit', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    // 兼容旧一步式接口（保留给外部脚本/兜底）
    aiImport: async (file: File, userId: number, deckId: number) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', String(userId));
      formData.append('deckId', String(deckId));
      const token = localStorage.getItem('token');
      const res = await fetch(`${BASE}/admin/ai-import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'AI 制卡失败' }));
        throw new Error(err.error || 'AI 制卡失败');
      }
      return res.json();
    },
    // Security
    loginLogs: (params?: { user_id?: number; page?: number; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.user_id) qs.set('user_id', String(params.user_id));
      if (params?.page) qs.set('page', String(params.page));
      if (params?.limit) qs.set('limit', String(params.limit));
      return request<any>(`/admin/security/login-logs${qs.toString() ? '?' + qs.toString() : ''}`);
    },
    onlineUsers: () => request<any[]>('/admin/security/online-users'),
    devices: () => request<any[]>('/admin/security/devices'),
    userLoginHistory: (userId: number) => request<any[]>(`/admin/security/user-login-history/${userId}`),
    // 全局功能开关（后台管理）
    /* ── 商城管理 ── */
    shop: {
      items: () => request<AdminShopItem[]>('/admin/shop/items'),
      updateItem: (key: string, patch: { name?: string; description?: string; price?: number; enabled?: boolean; sort?: number }) =>
        request<{ success: boolean; item: AdminShopItem }>(`/admin/shop/items/${key}`, {
          method: 'PUT',
          body: JSON.stringify(patch),
        }),
      purchases: (params?: { key?: string; q?: string }) => {
        const qs = new URLSearchParams();
        if (params?.key) qs.set('key', params.key);
        if (params?.q) qs.set('q', params.q);
        const suffix = qs.toString() ? `?${qs.toString()}` : '';
        return request<{ rows: AdminShopPurchase[]; summary: AdminShopSummary[] }>(`/admin/shop/purchases${suffix}`);
      },
      refund: (userId: number, itemKey: string) =>
        request<{ success: boolean; refunded: number; item: string }>('/admin/shop/purchases/refund', {
          method: 'POST',
          body: JSON.stringify({ userId, itemKey }),
        }),
      deleteBackground: (id: number) => request<{ success: boolean; deleted: number }>(`/admin/shop/backgrounds/${id}`, { method: 'DELETE' }),
    },

    featureFlags: {
      list: () => request<any[]>('/admin/feature-flags'),
      set: (key: string, enabled: boolean) =>
        request<any>(`/admin/feature-flags/${key}`, {
          method: 'PUT',
          body: JSON.stringify({ enabled }),
          headers: { 'Content-Type': 'application/json' },
        }),
    },
  },

  // 全局功能开关（普通用户查询）
  featureFlags: {
    get: () => request<Record<string, boolean>>('/feature-flags'),
  },
  // [2026-10-24] 想法征集（实词大赛排行榜下方）
  tutorSurvey: {
    mine: () =>
      request<{ hidden: boolean; filled: boolean; data?: { willPay: string; price: string; grade: string; wants: string[]; comment: string; at: number } }>(
        '/tutor-survey/mine'
      ),
    submit: (body: { willPay: string; price?: string; grade?: string; wants?: string[]; comment?: string }) =>
      request<{ ok: boolean }>('/tutor-survey', { method: 'POST', body: JSON.stringify(body) }),
    adminList: () => request<any>('/tutor-survey/admin/list'),
  },
  // [2026-11-12] 管理后台 · 讲题队列实时面板（仅 admin）
  lessonVideoAdminQueue: () => request<any>('/lesson-video/admin/queue'),
  /* reason: simple=题目较简单（默认） / single=请上传单题（整页练习册） */
  lessonVideoAdminCancelJob: (id: string, reason: 'simple' | 'single' = 'simple') =>
    request<any>(`/lesson-video/admin/jobs/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  suggestions: {
    submit: (content: string) =>
      request<{ id: number }>('/suggestions', { method: 'POST', body: JSON.stringify({ content }) }),
    mine: () => request<any[]>('/suggestions/mine'),
    adminList: () => request<any[]>('/suggestions/admin/list'),
    accept: (id: number) => request<any>(`/suggestions/admin/${id}/accept`, { method: 'POST' }),
    reject: (id: number) => request<any>(`/suggestions/admin/${id}/reject`, { method: 'POST' }),
  },

  // [2026-10-26] 点击统计
  analytics: {
    click: (events: any[]) =>
      request<any>('/analytics/click', { method: 'POST', body: JSON.stringify({ events }) }),
    overview: () => request<any>('/analytics/admin/overview'),
  },

  // [2026-10-25] 单词本 + 错题本
  wordbook: {
    favorites: () => request<any[]>('/wordbook/favorites'),
    favorite: (cardId: number) =>
      request<any>('/wordbook/favorites', { method: 'POST', body: JSON.stringify({ cardId }) }),
    unfavorite: (cardId: number) =>
      request<any>(`/wordbook/favorites/${cardId}`, { method: 'DELETE' }),
    isFavorite: (cardId: number) => request<{ favorited: boolean }>(`/wordbook/favorites/${cardId}`),
    wrong: () => request<any[]>('/wordbook/wrong'),
    addWrong: (cardId: number) =>
      request<any>('/wordbook/wrong', { method: 'POST', body: JSON.stringify({ cardId }) }),
    resolveWrong: (cardId: number) =>
      request<any>(`/wordbook/wrong/${cardId}/resolve`, { method: 'POST' }),
    removeWrong: (cardId: number) =>
      request<any>(`/wordbook/wrong/${cardId}`, { method: 'DELETE' }),
    /* 举一反三（2026-11-06）：错得最多的字 + 各自亏在哪几条义项 */
    insight: () => request<any[]>('/wordbook/insight'),
    insightOf: (char: string) => request<any>(`/wordbook/insight/${encodeURIComponent(char)}`),
  },

  // Public content
  content: {
    getChangelog: () => request<any[]>('/changelog'),
    getSiteContent: () => request<Record<string, string>>('/site-content'),
    submitFeedback: (data: { content: string }) =>
      request<any>('/feedback', { method: 'POST', body: JSON.stringify(data) }),
    /* ── 学生端：反馈回复通道（2026-10-15） ── */
    myFeedback: () => request<{ items: any[]; unread: number }>('/feedback/mine'),
    feedbackUnread: () => request<{ unread: number }>('/feedback/unread'),
    markFeedbackRead: () => request<{ success: boolean; marked: number }>('/feedback/read', { method: 'POST' }),
    // 字典查询（2026-11-06 换源为汉典，统一走 /dict/lookup；
    //   zd / cd / cy / wyw 四个旧方法仍保留，后端已统一到同一个解析器）
    lookup: (wd: string) => request<any>(`/dict/lookup?wd=${encodeURIComponent(wd)}`),
    zd: (wd: string) => request<any>(`/dict/zd?wd=${encodeURIComponent(wd)}`),

    // 阅读板块 —— 文言文内容库
    readings: (params?: { q?: string; dynasty?: string; page?: number; limit?: number; sort?: string }) => {
      const qs = new URLSearchParams();
      if (params?.q) qs.set('q', params.q);
      if (params?.dynasty) qs.set('dynasty', params.dynasty);
      if (params?.page) qs.set('page', String(params.page));
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.sort) qs.set('sort', params.sort);
      return request<{ total: number; page: number; limit: number; items: any[] }>(
        `/readings${qs.toString() ? '?' + qs.toString() : ''}`
      );
    },
    readingMeta: () =>
      request<{ total: number; dynasties: { dynasty: string; count: number }[] }>('/readings/meta'),
    readingDetail: (id: number) => request<any>(`/readings/${id}`),

    cd: (wd: string) => request<any>(`/dict/cd?wd=${encodeURIComponent(wd)}`),
    cy: (wd: string) => request<any>(`/dict/cy?wd=${encodeURIComponent(wd)}`),
    wyw: (wd: string) => request<any>(`/dict/wyw?wd=${encodeURIComponent(wd)}`),
  },

  // Announcement management (admin)
  announcements: {
    list: () => request<any[]>('/admin/announcements'),
    create: (data: { title: string; content: string; published?: number }) =>
      request<any>('/admin/announcements', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: { title?: string; content?: string; published?: number }) =>
      request<any>(`/admin/announcements/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) =>
      request<any>(`/admin/announcements/${id}`, { method: 'DELETE' }),
    togglePublish: (id: number) =>
      request<any>(`/admin/announcements/${id}/toggle-publish`, { method: 'POST' }),
    // Public announcement
    getLatest: () => request<any | null>('/announcements/latest'),
    /** 首页顶部滚动播报：已发布公告（最新在前），limit 默认 3、上限 10 */
    ticker: (limit: number = 3) =>
      request<any[]>(`/announcements/ticker?limit=${limit}`),
    dismiss: (id: number) =>
      request<any>(`/announcements/${id}/dismiss`, { method: 'POST' }),
  },

  quiz: {
    session: (deckId: number, limit: number = 10, studiedOnly: boolean = true) =>
      request<any>(`/quiz/session?deck_id=${deckId}&limit=${limit}&studied_only=${studiedOnly}`),
    submit: (sessionId: string, answers: { cardId: number; correct: boolean }[], deckId?: number) =>
      request<any>('/quiz/submit', { method: 'POST', body: JSON.stringify({ sessionId, answers, deckId }) }),
    history: (deckId?: number, limit: number = 20) =>
      request<any>(`/quiz/history${deckId ? `?deck_id=${deckId}` : ''}&limit=${limit}`),
    stats: (deckId: number) =>
      request<any>(`/quiz/stats?deck_id=${deckId}`),
  },
  // v2 home — word association graph
  wordnet: {
    graph: (params?: { limit?: number }) => {
      const q = params?.limit ? `?limit=${params.limit}` : '';
      return request<{ nodes: { id: string; label: string; weight: number }[]; edges: { source: string; target: string; weight: number }[] }>(`/wordnet/graph${q}`);
    },
    // 最近学过的不同重点字（首页 3D 词球数据源，含词间关联线）
    recent: (limit = 10) =>
      request<{ words: string[]; edges: { source: string; target: string; weight: number }[] }>(`/wordnet/recent?limit=${limit}`),
  },

  // v2 home — daily check-in（首页打卡与「每日一句」/daily 共用同一份记录）
  checkin: {
    status: () =>
      request<CheckinStatus>('/checkin/status'),
    today: () =>
      request<{
        ok: boolean;
        alreadyCheckedIn: boolean;
        streak: number;
        todayReviews: number;
        checkedDate: string;
        /** 本次发放的铜板（重复打卡为 0） */
        coinsAwarded?: number;
        /** 发放后余额 */
        balance?: number;
        nextTier?: { minDays: number; reward: number } | null;
      }>('/checkin', { method: 'POST' }),
    /* 补打卡（2026-11-06）：补最近 7 天漏掉的一天，扣铜板 */
    backfill: (date: string) =>
      request<{
        ok: boolean;
        date: string;
        cost: number;
        streak: number;
        balance: number;
        usedThisWeek: number;
        maxPerWeek: number;
        missingDays: string[];
      }>('/checkin/backfill', { method: 'POST', body: JSON.stringify({ date }) }),
  },

  // 每日时政（人民日报电子版当天头版，只返回标题，不含链接）
  dailyNews: () =>
    request<{ day: string; source: string; items: { title: string; summary?: string }[] }>('/daily/news'),

  // v2 home — marketing cards
  marketing: {
    cards: () => request<{ cards: { id: string; title: string; subtitle: string; icon: string; color: string; link_url: string }[] }>('/marketing/cards'),
  },

  // 课程解锁口令 — 现仅「一起背」页面在用（课程中心已下线）；口令独立于登录密码
  course: {
    unlock: (password: string) =>
      request<{ ok: boolean }>('/course/unlock', { method: 'POST', body: JSON.stringify({ password }) }),
  },

  // 竞技场 · 单人训练（P2 深度服务端化）：出题/判分/结算/放弃 全程服务端
  arena: {
    start: (body: { mode: string; deckId?: number; count?: number }) =>
      request<{
        sessionId: number;
        balance: number;
        questions: {
          index: number;
          mode: string;
          type: 'choice' | 'bool' | 'input';
          stem: string;
          stemPlain: string;
          keyword: string;
          source: string;
          meaning: string;
          options?: string[];
          hint?: string;
          reveal?: string;
        }[];
      }>('/arena/start', { method: 'POST', body: JSON.stringify(body) }),
    answer: (body: { sessionId: number; index: number; choice?: number; text?: string }) =>
      request<{ correct: boolean; correctAnswer: string; index: number; answered: number; correctCount: number }>(
        '/arena/answer',
        { method: 'POST', body: JSON.stringify(body) }
      ),
    abandon: (body: { sessionId: number }) =>
      request<{ reward: number; correctCount: number; refund?: number; capped?: boolean; dailyCap?: number }>('/arena/abandon', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    finish: (body: { sessionId: number }) =>
      request<{
        reward: number;
        correctCount: number;
        total: number;
        capped?: boolean;
        dailyCap?: number;
      }>('/arena/finish', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    home: () =>
      request<{
        balance: number;
        today: { questions: number; correct: number; accuracy: number };
        battle: { total: number; wins: number; losses: number; draws: number };
        rank: { key: string; name: string; color: string };
      }>('/arena/home'),
  },

  // 实词大赛（一站到底）：服务端出题判分，答错或超时即结束，成绩=连对题数
  contest: {
    start: (limit?: number) =>
      request<{
        runId: number;
        perQuestionSec: number;
        timeLadder: { from: number; sec: number; label: string }[];
        total: number;
        questions: {
          index: number;
          stem: string;
          keyword: string;
          source: string;
          options: { label: string; text: string }[];
          /** 本题限时（秒）：随连对数递减 */
          timeLimit: number;
        }[];
      }>('/contest/start', { method: 'POST', body: JSON.stringify({ limit }) }),
    answer: (body: { runId: number; index: number; label?: string; timeout?: boolean }) =>
      request<{
        correct: boolean;
        finished?: boolean;
        cleared?: boolean;
        correctLabel: string;
        correctMeaning: string;
        chosenLabel?: string;
        timedOut?: boolean;
        score: number;
        best?: number;
        newRecord?: boolean;
        nextIndex?: number;
      }>('/contest/answer', { method: 'POST', body: JSON.stringify(body) }),
    abandon: (runId: number) =>
      request<{ score: number; best: number | null; newRecord: boolean }>('/contest/abandon', {
        method: 'POST',
        body: JSON.stringify({ runId }),
      }),
    leaderboard: () =>
      request<{
        list: {
          rank: number;
          id: number;
          username: string;
          avatar_url: string;
          is_teacher: boolean;
          badge_label: string;
          count: number;
          /** 该名次奖励铜板（未结算=预计，已结算=实际发放） */
          prize: number;
        }[];
        me: { rank: number | null; best: number; plays: number; prize: number };
        prize: {
          settleDate: string;
          topN: number;
          tiers: { label: string; amount: number }[];
          participation: number;
          pool: number;
          participationNote: string;
          settled: boolean;
          settledAt: number | null;
        };
      }>('/contest/leaderboard'),
  },

  // 888 铜板限时福利（一次性领取，按 user × type 去重）
  welfare: {
    // GET /api/welfare/status → { claimed: boolean, amount: 888 }
    status: () =>
      request<{ claimed: boolean; amount: number }>('/welfare/status'),
    // POST /api/welfare/claim → 幂等；重复请求不重复发币
    claim: () =>
      request<{ claimed: boolean; balance: number; amount?: number; already?: boolean }>(
        '/welfare/claim',
        { method: 'POST' }
      ),
  },

  /* 站点升级进度（2026-11-06）：只读，数据在后台维护 */
  roadmap: {
    get: () => request<RoadmapData>('/roadmap'),
  },

  /* [2026-11-09] AI 讲题实验室（档位 C：公式 + 板书动画）
     仅站长可见，后端每个接口都做 ownerOnly 校验 */
  tutorLab: {
    ping: () =>
      request<{ ok: boolean; owner: string; source?: string; base?: string; models: { ocr: string; talk: string }; cooldownSec: number }>(
        '/tutor/ping'
      ),
    ocr: (file: File) => {
      const fd = new FormData();
      fd.append('image', file);
      return requestForm<{
        latex: string;
        question: string;
        ok: boolean;
        warns: string[];
        ms: number;
        model: string;
      }>('/tutor/ocr', fd);
    },
    explain: (body: { question: string; grade?: string }) =>
      request<{
        title: string;
        think: string[];
        steps: { index: number; title: string; text: string; highlight?: string; board: any[] }[];
        keyMethod: string;
        pitfall: { wrong: string; right: string };
        answer: string;
        ms: number;
        model: string;
        retried?: boolean;
        issue?: string;
      }>('/tutor/explain', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
};
