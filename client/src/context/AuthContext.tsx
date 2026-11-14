import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, onAccountBanned } from '../lib/api';

interface User {
  id: number;
  username: string;
  role?: string;
  avatar_url?: string;
  /** 账号金标文字（users.badge_label，如「老师」「管理员」）：头像显示金环 + 标签 */
  badge_label?: string;
  /** 老师标记（历史字段，等价 badge_label === '老师'） */
  is_teacher?: boolean | number;
  pending_avatar_url?: string;
  avatar_review_status?: string;
  avatar_review_reason?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  /**
   * 【2026-09-12 修复】原声明为 Promise<void>，但实现返回登录后的用户对象，
   * LoginModal 也正是靠它判断 role 决定是否跳转 /admin（LoginModal.tsx:364-365）。
   * 类型与实际不符导致 tsc 报 TS2322（vite 走 esbuild 不检查类型，故一直未暴露）。
   */
  login: (username: string, password: string) => Promise<User>;
  register: (username: string, password: string) => Promise<User>;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  loginModalOpen: boolean;
  openLoginModal: () => void;
  closeLoginModal: () => void;
  /** 登录框上方的提示条：标题 + 内容（封号、登录失效等不同场景共用） */
  banNotice: { title: string; message: string } | null;
  setBanNotice: (notice: { title: string; message: string } | null) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [banNotice, setBanNoticeState] = useState<{ title: string; message: string } | null>(null);

  // 任意接口返回 ACCOUNT_BANNED：清会话、强制登出并提示解封时间/原因
  useEffect(
    () =>
      onAccountBanned(info => {
        setUser(null);
        /* title 由服务端错误码决定（封号 / 登录失效），缺省仍按封号显示 */
        setBanNoticeState({ title: info.title || '账号已被封禁', message: info.message });
        setLoginModalOpen(true);
      }),
    []
  );

  // 首次加载:恢复会话;未登录访客第一时间自动弹出登录弹窗
  useEffect(() => {
    /* 【2026-10-01 安全修复】恢复登录态的两条路：
       ① localStorage 里有 token    → 走 Authorization 头
       ② localStorage 被清空        → **直接问服务端** /api/auth/me，
          cookie（keyi_token，现已 httpOnly）会由浏览器自动带上。

       为什么不再像以前那样用 document.cookie 读出 token 塞回 localStorage：
       httpOnly 的含义就是 JS 读不到 —— 这正是我们要的（XSS 拿不走 90 天凭证）。
       如果这里还去读 document.cookie，读到的是空字符串，逻辑会一直走 else 分支，
       表现就是"cookie 明明在，用户却掉登录"。
       服务端 authMiddleware 现在同时支持 Bearer 头与 cookie，所以 ② 能正常工作。 */
    const storedToken = localStorage.getItem('token');
    const clearSession = () => {
      localStorage.removeItem('token');
      // httpOnly cookie 无法用 JS 删除，但过期由服务端控制；
      // 这里保留一次尝试（对非 httpOnly 的历史 cookie 仍有效），失败无副作用。
      try {
        document.cookie = 'keyi_token=; Max-Age=0; path=/';
      } catch {
        // ignore
      }
    };
    let cancelled = false;
    let authenticated = false;
    const finish = () => {
      if (cancelled) return;
      setLoading(false);
      // 仅未登录时自动弹窗(已登录用户不打扰)
      if (!authenticated) setLoginModalOpen(true);
    };
    /* 无论有没有本地 token，都调一次 /me：
       · 有 token   → 校验它是否仍有效（被封/设备限制会返回 401/403）
       · 没 token   → 靠 cookie 兜底恢复（这是 localStorage 被清时的唯一出路）
       只需要一个入口，少一条分支就少一处出错的可能。 */
    void storedToken;
    api.auth
      .me()
      .then(u => {
        if (cancelled) return;
        authenticated = true;
        setUser({
          id: u.id,
          username: u.username,
          role: u.role,
          avatar_url: u.avatar_url,
          is_teacher: u.is_teacher,
          badge_label: u.badge_label,
          pending_avatar_url: u.pending_avatar_url,
          avatar_review_status: u.avatar_review_status,
          avatar_review_reason: u.avatar_review_reason,
        });
      })
      .catch(() => {
        if (!cancelled) clearSession();
      })
      .finally(finish);
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.auth.login(username, password);
    localStorage.setItem('token', res.token);
    const u = {
      id: res.userId,
      username: res.username,
      role: res.role,
      avatar_url: res.avatar_url,
      is_teacher: (res as any).is_teacher,
      badge_label: (res as any).badge_label,
      pending_avatar_url: (res as any).pending_avatar_url,
      avatar_review_status: (res as any).avatar_review_status,
      avatar_review_reason: (res as any).avatar_review_reason,
    };
    setUser(u);
    return u;
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const res = await api.auth.register(username, password);
    localStorage.setItem('token', res.token);
    const u = {
      id: res.userId,
      username: res.username,
      role: res.role,
      avatar_url: res.avatar_url,
      is_teacher: (res as any).is_teacher,
      badge_label: (res as any).badge_label,
      pending_avatar_url: (res as any).pending_avatar_url,
      avatar_review_status: (res as any).avatar_review_status,
      avatar_review_reason: (res as any).avatar_review_reason,
    };
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    document.cookie = 'keyi_token=; Max-Age=0; path=/';
    setUser(null);
  }, []);

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser(prev => prev ? { ...prev, ...updates } : null);
  }, []);

  const openLoginModal = useCallback(() => setLoginModalOpen(true), []);
  const closeLoginModal = useCallback(() => setLoginModalOpen(false), []);
  const setBanNotice = useCallback(
    (notice: { title: string; message: string } | null) => setBanNoticeState(notice),
    []
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateUser, loginModalOpen, openLoginModal, closeLoginModal, banNotice, setBanNotice }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
