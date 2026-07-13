const BASE = '/api';

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${url}`, { ...options, headers });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// Auth
export const api = {
  auth: {
    register: (username: string, password: string) =>
      request<{ token: string; userId: number; username: string; role?: string; avatar_url?: string }>('/auth/register', {
        method: 'POST', body: JSON.stringify({ username, password }),
      }),
    login: (username: string, password: string) =>
      request<{ token: string; userId: number; username: string; role?: string; avatar_url?: string }>('/auth/login', {
        method: 'POST', body: JSON.stringify({ username, password }),
      }),
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
    heartbeat: () => request<{ success: boolean }>('/auth/heartbeat', { method: 'POST' }),

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
      return res.json() as Promise<{ avatarUrl: string }>;
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
  },

  cards: {
    due: (params: { deckId?: number; limit?: number } = {}) => {
      const searchParams = new URLSearchParams();
      if (params.deckId) searchParams.set('deck_id', String(params.deckId));
      if (params.limit) searchParams.set('limit', String(params.limit));
      return request<any[]>(`/cards/due?${searchParams.toString()}`);
    },
    answer: (cardId: number, rating: number, timeMs: number = 0) =>
      request<any>(`/cards/${cardId}/answer`, {
        method: 'POST', body: JSON.stringify({ rating, timeMs }),
      }),
    deckCards: (deckId: number) => request<any[]>(`/cards/deck/${deckId}`),
    distractors: (deckId: number) => request<{ text: string; notetype: string }[]>(`/cards/distractors/${deckId}`),
    allDistractors: () => request<{ text: string; notetype: string }[]>('/cards/all-distractors'),
    statsOverview: () => request<any>('/cards/stats/overview'),
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
    heartbeat: () => request<any>('/admin/heartbeat', { method: 'POST' }),
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
    userDecks: (userId: number) => request<any>(`/admin/users/${userId}/decks`),
    userStats: (userId: number) => request<any>(`/admin/users/${userId}/stats`),
    clearUserData: (userId: number) =>
      request<any>(`/admin/users/${userId}/clear`, { method: 'DELETE' }),
    clearAllUsers: () =>
      request<any>('/admin/clear-all', { method: 'POST' }),
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
    deleteFeedback: (id: number) =>
      request<any>(`/admin/feedback/${id}`, { method: 'DELETE' }),
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
    userLoginHistory: (userId: number) => request<any[]>(`/admin/security/user-login-history/${userId}`),
    // Terminal
    terminalExecute: (command: string, clean: boolean = true) =>
      request<any>('/admin/terminal/execute', { method: 'POST', body: JSON.stringify({ command, clean }) }),
    terminalSystemInfo: () => request<any>('/admin/terminal/system-info'),
    terminalCreate: (opts: { cols?: number; rows?: number }) =>
      request<any>('/admin/terminal/create', { method: 'POST', body: JSON.stringify(opts) }),
    terminalKill: (opts: { sessionId: string }) =>
      request<any>('/admin/terminal/kill', { method: 'POST', body: JSON.stringify(opts) }),
    terminalResize: (opts: { sessionId: string; cols: number; rows: number }) =>
      request<any>('/admin/terminal/resize', { method: 'POST', body: JSON.stringify(opts) }),
  },

  // Public content
  content: {
    getChangelog: () => request<any[]>('/changelog'),
    getSiteContent: () => request<Record<string, string>>('/site-content'),
    submitFeedback: (data: { content: string }) =>
      request<any>('/feedback', { method: 'POST', body: JSON.stringify(data) }),
    // 汉文学网字典查询
    zd: (wd: string) => request<any>(`/dict/zd?wd=${encodeURIComponent(wd)}`),
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
};
