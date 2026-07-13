import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, UserPlus, Trash2, KeyRound, AlertCircle, CheckCircle,
  Shield, Calendar, Layers, CreditCard, Send, BookOpen, Upload, Search, X, Loader2, RefreshCw
} from 'lucide-react';
import Modal from '../components/Modal';

interface AppUser {
  id: number;
  username: string;
  role: string;
  created_at: number;
  last_login_at: number | null;
  card_count: number;
  deck_count: number;
}

interface AdminDeck {
  id: number;
  name: string;
  card_count: number;
}

export default function AdminPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Create User modal
  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Reset Password modal
  const [showResetPwd, setShowResetPwd] = useState<{ id: number; username: string } | null>(null);
  const [resetPwd, setResetPwd] = useState('');

  // Edit Username modal
  const [showEditUser, setShowEditUser] = useState<{ id: number; username: string } | null>(null);
  const [editUsername, setEditUsername] = useState('');

  // Delete User confirmation modal
  const [showDelete, setShowDelete] = useState<{ id: number; username: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);

  // Registration toggle
  const [regEnabled, setRegEnabled] = useState(true);
  const [regLoading, setRegLoading] = useState(false);

  // Deck sending modal
  const [adminDecks, setAdminDecks] = useState<AdminDeck[]>([]);
  const [showSendDeck, setShowSendDeck] = useState(false);
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  // Batch import
  const [showBatchImport, setShowBatchImport] = useState(false);
  const [batchUsernames, setBatchUsernames] = useState('');
  const [batchPassword, setBatchPassword] = useState('123456');
  const [batchImporting, setBatchImporting] = useState(false);
  const [batchResult, setBatchResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null);

  // User detail modal
  const [detailUser, setDetailUser] = useState<any | null>(null);
  const [detailDecks, setDetailDecks] = useState<any[]>([]);
  const [detailStats, setDetailStats] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchUsers = () => {
    setLoading(true);
    api.admin.users()
      .then(setUsers)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const fetchDecks = () => {
    api.admin.decks().then(setAdminDecks).catch(() => {});
  };

  useEffect(() => {
    fetchUsers();
    api.admin.getRegistration().then(r => setRegEnabled(r.enabled)).catch(() => {});
  }, []);

  const clearMessages = () => { setError(''); setSuccess(''); };

  const handleCreate = async () => {
    clearMessages();
    if (!newUsername.trim() || !newPassword.trim()) {
      setError('请填写用户名和密码');
      return;
    }
    try {
      await api.admin.createUser(newUsername, newPassword);
      setSuccess(`用户 "${newUsername}" 创建成功！`);
      setNewUsername(''); setNewPassword(''); setShowCreate(false);
      fetchUsers();
    } catch (err: any) {
      setError(err.message || '创建失败');
    }
  };

  const handleDelete = async () => {
    if (!showDelete) return;
    clearMessages();
    setDeleting(true);
    try {
      await api.admin.deleteUser(showDelete.id);
      setSuccess(`用户 "${showDelete.username}" 已删除`);
      setShowDelete(null);
      fetchUsers();
    } catch (err: any) {
      setError(err.message || '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleClearAll = async () => {
    if (!confirm('确定要清除所有普通用户的全部牌组、卡片和学习记录吗？此操作不可撤销！')) return;
    clearMessages();
    setClearingAll(true);
    try {
      const res = await api.admin.clearAllUsers();
      setSuccess(res.message || '已清除所有用户数据');
      fetchUsers();
    } catch (err: any) {
      setError(err.message || '清除失败');
    } finally {
      setClearingAll(false);
    }
  };

  const handleClearUser = async (u: any) => {
    if (!confirm(`确定要清除用户「${u.username}」的全部牌组、卡片和学习记录吗？此操作不可撤销！`)) return;
    clearMessages();
    try {
      const res = await api.admin.clearUserData(u.id);
      setSuccess(res.message || '清除成功');
      fetchUsers();
    } catch (err: any) {
      setError(err.message || '清除失败');
    }
  };

  const handleResetPwd = async () => {
    if (!showResetPwd) return;
    if (!resetPwd.trim() || resetPwd.length < 6) {
      setError('密码至少需要6个字符');
      return;
    }
    clearMessages();
    try {
      await api.admin.resetPassword(showResetPwd.id, resetPwd);
      setSuccess('密码已重置');
      setShowResetPwd(null); setResetPwd('');
    } catch (err: any) {
      setError(err.message || '重置失败');
    }
  };

  const handleUpdateUsername = async () => {
    if (!showEditUser) return;
    if (!editUsername.trim()) {
      setError('用户名不能为空');
      return;
    }
    clearMessages();
    try {
      const result = await api.admin.updateUsername(showEditUser.id, editUsername.trim());
      setSuccess(`用户名已修改为「${result.username}」`);
      setShowEditUser(null); setEditUsername('');
      fetchUsers();
    } catch (err: any) {
      setError(err.message || '修改失败');
    }
  };

  const toggleRegistration = async () => {
    setRegLoading(true);
    clearMessages();
    try {
      const newVal = !regEnabled;
      await api.admin.setRegistration(newVal);
      setRegEnabled(newVal);
      setSuccess(newVal ? '注册功能已开启' : '注册功能已关闭');
    } catch (err: any) {
      setError(err.message || '操作失败');
    } finally {
      setRegLoading(false);
    }
  };

  const openUserDetail = async (u: any) => {
    setDetailUser(u);
    setDetailLoading(true);
    clearMessages();
    try {
      const [decks, stats] = await Promise.all([
        api.admin.userDecks(u.id),
        api.admin.userStats(u.id),
      ]);
      setDetailDecks(decks.decks || []);
      setDetailStats(stats);
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeUserDetail = () => {
    setDetailUser(null);
    setDetailDecks([]);
    setDetailStats(null);
  };

  const handleBatchImport = async () => {
    const names = batchUsernames.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    if (names.length === 0) {
      setError('请至少输入一个用户名');
      return;
    }
    if (!batchPassword.trim() || batchPassword.length < 6) {
      setError('密码至少需要6个字符');
      return;
    }
    clearMessages();
    setBatchImporting(true);
    setBatchResult(null);
    let succ = 0, fail = 0;
    const errors: string[] = [];
    for (const name of names) {
      try {
        await api.admin.createUser(name, batchPassword);
        succ++;
      } catch (err: any) {
        fail++;
        errors.push(`${name}: ${err.message}`);
      }
    }
    setBatchResult({ success: succ, failed: fail, errors });
    setBatchImporting(false);
    if (succ > 0) {
      setSuccess(`成功导入 ${succ} 个账号${fail > 0 ? `，${fail} 个失败` : ''}`);
      fetchUsers();
    } else {
      setError(`全部 ${fail} 个账号导入失败`);
    }
  };

  const handleSendDeck = async () => {
    if (!selectedDeckId || !selectedUserId) {
      setError('请选择牌组和目标用户');
      return;
    }
    clearMessages();
    setSending(true);
    try {
      const res = await api.admin.sendDeck(selectedDeckId, selectedUserId);
      setSuccess(res.message || '牌组已发送');
      setShowSendDeck(false);
      setSelectedDeckId(null);
      setSelectedUserId(null);
    } catch (err: any) {
      setError(err.message || '发送失败');
    } finally {
      setSending(false);
    }
  };

  if (loading && users.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    );
  }

  const filteredUsers = searchQuery
    ? users.filter(u => u.username.toLowerCase().includes(searchQuery.toLowerCase()))
    : users;

  const hasNoMatch = searchQuery && filteredUsers.length === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Shield className="w-8 h-8 text-amber-500" />
            用户管理
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-gray-500">管理所有用户账号</p>
            <div className="h-4 w-px bg-gray-200" />
            <button
              onClick={toggleRegistration}
              disabled={regLoading}
              className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border transition-all ${
                regEnabled
                  ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                  : 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
              }`}
            >
              <div className={`w-8 h-4 rounded-full relative transition-colors ${regEnabled ? 'bg-green-400' : 'bg-red-300'}`}>
                <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${regEnabled ? 'left-4' : 'left-0.5'}`} />
              </div>
              {regEnabled ? '注册已开启' : '注册已关闭'}
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleClearAll}
            disabled={clearingAll}
            className="btn-secondary flex items-center gap-2 text-red-500 border-red-200 hover:bg-red-50"
          >
            {clearingAll ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : <Trash2 className="w-4 h-4" />}
            清除所有用户
          </button>
          <button
            onClick={() => { setShowBatchImport(true); clearMessages(); setBatchResult(null); setBatchUsernames(''); setBatchPassword('123456'); }}
            className="btn-secondary flex items-center gap-2"
          >
            <Upload className="w-5 h-5" /> 批量导入
          </button>
          <button
            onClick={() => { setShowSendDeck(true); clearMessages(); fetchDecks(); }}
            className="btn-secondary flex items-center gap-2"
          >
            <Send className="w-5 h-5" /> 发送牌组
          </button>
          <button
            onClick={() => { setShowCreate(true); clearMessages(); setNewUsername(''); setNewPassword(''); }}
            className="btn-primary flex items-center gap-2"
          >
            <UserPlus className="w-5 h-5" /> 创建账号
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-red-700">{error}</p>
        </motion.div>
      )}
      {success && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-green-50 border border-green-200 rounded-2xl p-4 flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
          <p className="text-green-700">{success}</p>
        </motion.div>
      )}

      {/* ========== MODALS ========== */}

      {/* Create User Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="创建新账号" icon={<UserPlus className="w-6 h-6" />}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1 font-medium">用户名</label>
            <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)}
              className="input-field" placeholder="输入用户名" autoComplete="off" autoFocus />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1 font-medium">密码</label>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
              className="input-field" placeholder="至少6个字符" autoComplete="new-password" />
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={handleCreate} className="btn-primary text-sm flex items-center gap-2">
              <UserPlus className="w-4 h-4" /> 创建
            </button>
            <button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">取消</button>
          </div>
        </div>
      </Modal>

      {/* Batch Import Modal */}
      <Modal open={showBatchImport} onClose={() => { setShowBatchImport(false); setBatchResult(null); }} title="批量导入账号" icon={<Upload className="w-6 h-6" />}>
        <div className="space-y-4">
          <p className="text-sm text-gray-500">每行一个用户名，统一使用相同密码</p>
          <div>
            <label className="block text-sm text-gray-600 mb-1.5 font-medium">用户名列表</label>
            <textarea
              value={batchUsernames}
              onChange={e => setBatchUsernames(e.target.value)}
              className="input-field w-full h-32 resize-none font-mono text-sm"
              placeholder={"user1\nuser2\nuser3"}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1.5 font-medium">统一密码</label>
            <input
              type="text"
              value={batchPassword}
              onChange={e => setBatchPassword(e.target.value)}
              className="input-field w-48"
              placeholder="至少6个字符"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={handleBatchImport} disabled={batchImporting}
              className="btn-primary text-sm flex items-center gap-2 disabled:bg-gray-300"
            >
              {batchImporting ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              开始导入
            </button>
            <button onClick={() => { setShowBatchImport(false); setBatchResult(null); }} className="btn-secondary text-sm">取消</button>
          </div>

          {batchResult && (
            <div className={`p-4 rounded-xl text-sm ${
              batchResult.failed === 0
                ? 'bg-green-50 border border-green-200'
                : batchResult.success > 0
                  ? 'bg-yellow-50 border border-yellow-200'
                  : 'bg-red-50 border border-red-200'
            }`}>
              <div className="font-medium mb-1">
                ✅ 成功 {batchResult.success} 个
                {batchResult.failed > 0 && <span className="ml-2">❌ 失败 {batchResult.failed} 个</span>}
              </div>
              {batchResult.errors.length > 0 && (
                <div className="mt-2 max-h-32 overflow-y-auto space-y-0.5">
                  {batchResult.errors.map((e, i) => (
                    <div key={i} className="text-red-600 text-xs">{e}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Send Deck Modal */}
      <Modal open={showSendDeck} onClose={() => setShowSendDeck(false)} title="发送牌组给用户" icon={<Send className="w-6 h-6" />}>
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Deck selector */}
            <div>
              <label className="block text-sm text-gray-600 mb-2 font-medium">选择牌组</label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {adminDecks.length === 0 && <p className="text-sm text-gray-400">暂无牌组</p>}
                {adminDecks.map(d => (
                  <label key={d.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                      selectedDeckId === d.id ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input type="radio" name="deck" checked={selectedDeckId === d.id}
                      onChange={() => setSelectedDeckId(d.id)} className="text-primary-600" />
                    <div>
                      <div className="font-medium text-gray-900 text-sm">{d.name}</div>
                      <div className="text-xs text-gray-400">{d.card_count} 张卡片</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* User selector */}
            <div>
              <label className="block text-sm text-gray-600 mb-2 font-medium">选择目标用户</label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {users.filter(u => u.role !== 'admin').length === 0 && <p className="text-sm text-gray-400">暂无普通用户</p>}
                {users.filter(u => u.role !== 'admin').map(u => (
                  <label key={u.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                      selectedUserId === u.id ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input type="radio" name="user" checked={selectedUserId === u.id}
                      onChange={() => setSelectedUserId(u.id)} className="text-primary-600" />
                    <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
                      <span className="font-bold text-primary-700 text-sm">{u.username.charAt(0).toUpperCase()}</span>
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 text-sm">{u.username}</div>
                      <div className="text-xs text-gray-400">{u.card_count} 张卡片 / {u.deck_count} 牌组</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={handleSendDeck} disabled={sending || !selectedDeckId || !selectedUserId}
              className="btn-primary text-sm flex items-center gap-2 disabled:bg-gray-300">
              {sending ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              发送
            </button>
            <button onClick={() => setShowSendDeck(false)} className="btn-secondary text-sm">取消</button>
          </div>
        </div>
      </Modal>

      {/* Edit Username Modal */}
      <Modal open={!!showEditUser} onClose={() => { setShowEditUser(null); setEditUsername(''); }} title="修改用户名" icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>}>
        {showEditUser && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              当前用户：<span className="font-medium text-gray-900">{showEditUser.username}</span>
            </p>
            <div>
              <label className="block text-sm text-gray-600 mb-1 font-medium">新用户名</label>
              <input type="text" value={editUsername} onChange={e => setEditUsername(e.target.value)}
                className="input-field" placeholder="输入新用户名" autoFocus
                onKeyDown={e => e.key === 'Enter' && handleUpdateUsername()} />
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={handleUpdateUsername} className="btn-primary text-sm flex items-center gap-2">
                <CheckCircle className="w-4 h-4" /> 确认修改
              </button>
              <button onClick={() => { setShowEditUser(null); setEditUsername(''); }} className="btn-secondary text-sm">取消</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Reset Password Modal */}
      <Modal open={!!showResetPwd} onClose={() => { setShowResetPwd(null); setResetPwd(''); }} title="重置密码" icon={<KeyRound className="w-6 h-6" />}>
        {showResetPwd && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              重置用户 <span className="font-medium text-gray-900">{showResetPwd.username}</span> 的密码
            </p>
            <div>
              <label className="block text-sm text-gray-600 mb-1 font-medium">新密码</label>
              <input type="password" value={resetPwd} onChange={e => setResetPwd(e.target.value)}
                className="input-field" placeholder="至少6个字符" autoFocus
                onKeyDown={e => e.key === 'Enter' && handleResetPwd()} />
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={handleResetPwd} className="btn-primary text-sm flex items-center gap-2">
                <KeyRound className="w-4 h-4" /> 确认重置
              </button>
              <button onClick={() => { setShowResetPwd(null); setResetPwd(''); }} className="btn-secondary text-sm">取消</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete User Confirmation Modal */}
      <Modal open={!!showDelete} onClose={() => setShowDelete(null)} title="确认删除用户" icon={<Trash2 className="w-6 h-6 text-red-500" />}>
        {showDelete && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-red-700 text-sm">
                确定要删除用户 <span className="font-semibold">「{showDelete.username}」</span> 吗？
              </p>
              <p className="text-red-500 text-xs mt-2">此操作不可撤销，该用户的所有数据（牌组、卡片、学习记录）将被永久清除。</p>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleDelete} disabled={deleting}
                className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition-all disabled:bg-gray-300"
              >
                {deleting ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                确认删除
              </button>
              <button onClick={() => setShowDelete(null)} className="btn-secondary text-sm">取消</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Users List */}
        {hasNoMatch ? (
          <div className="bg-white rounded-2xl card-shadow">
            <div className="p-5 sm:p-6 border-b border-gray-100">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Users className="w-5 h-5 text-gray-400" />
                  <span className="text-gray-600">共 {users.length} 个用户</span>
                </div>
                <div className="relative flex-1 max-w-xs sm:ml-auto">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    className="input-field pl-9 py-2 text-sm w-full" placeholder="搜索用户名..." />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="text-center py-16">
              <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">未找到匹配的用户</p>
              <button onClick={() => setSearchQuery('')} className="text-sm text-primary-600 hover:text-primary-700 mt-2">清除搜索</button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl card-shadow">
            <div className="p-5 sm:p-6 border-b border-gray-100">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Users className="w-5 h-5 text-gray-400" />
                  <span className="text-gray-600">
                    共 {users.length} 个用户
                    {searchQuery && <span className="text-gray-400">（匹配 {filteredUsers.length} 个）</span>}
                  </span>
                </div>
                <div className="relative flex-1 max-w-xs sm:ml-auto">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    className="input-field pl-9 py-2 text-sm w-full" placeholder="搜索用户名..." />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
            {filteredUsers.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {filteredUsers.map((u, i) => (
                  <motion.div
                    key={u.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="p-5 flex flex-col sm:flex-row sm:items-center gap-4 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => openUserDetail(u)}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        u.role === 'admin' ? 'bg-amber-100' : 'bg-primary-100'
                      }`}>
                        <span className={`font-bold ${u.role === 'admin' ? 'text-amber-700' : 'text-primary-700'}`}>
                          {u.username.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 truncate">{u.username}</span>
                          {u.role === 'admin' && (
                            <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">管理</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />
                            {new Date(u.created_at * 1000).toLocaleDateString('zh-CN')}</span>
                          <span className="flex items-center gap-1"><Layers className="w-3 h-3" />{u.deck_count} 牌组</span>
                          <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" />{u.card_count} 卡片</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={(e) => {
                        e.stopPropagation();
                        handleClearUser(u);
                      }}
                        className="p-2 text-orange-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors" title="清除该用户数据">
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <button onClick={(e) => {
                        e.stopPropagation();
                        setShowEditUser({ id: u.id, username: u.username });
                        setEditUsername(u.username);
                        clearMessages();
                      }}
                        className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors" title="修改用户名">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button onClick={(e) => {
                        e.stopPropagation();
                        setShowResetPwd({ id: u.id, username: u.username });
                        setResetPwd('');
                        clearMessages();
                      }}
                        className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="重置密码">
                        <KeyRound className="w-4 h-4" />
                      </button>
                      {u.role !== 'admin' && (
                        <button onClick={(e) => {
                          e.stopPropagation();
                          setShowDelete({ id: u.id, username: u.username });
                          clearMessages();
                        }}
                          className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors" title="删除用户">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="text-center py-16">
                <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">暂无用户</p>
              </div>
            )}
          </div>
        )}

      {/* User Detail Modal */}
      <AnimatePresence>
        {detailUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4 pb-8"
            onClick={closeUserDetail}
          >
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()}
              className="relative bg-white rounded-2xl card-shadow w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6 sm:p-8"
            >
              <button onClick={closeUserDetail} className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>

              {detailLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold ${
                      detailUser.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700'
                    }`}>
                      {detailUser.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">{detailUser.username}</h2>
                      <p className="text-sm text-gray-500">
                        {detailUser.role === 'admin' ? '管理员' : '用户'}
                        {' · '}注册于 {new Date(detailUser.created_at * 1000).toLocaleDateString('zh-CN')}
                      </p>
                    </div>
                  </div>

                  {detailStats && (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="bg-primary-50 rounded-xl p-4 text-center">
                          <div className="text-2xl font-bold text-primary-700">{detailStats.totalCards}</div>
                          <div className="text-xs text-primary-600 mt-1">总卡片</div>
                        </div>
                        <div className="bg-amber-50 rounded-xl p-4 text-center">
                          <div className="text-2xl font-bold text-amber-700">{detailStats.deckCount}</div>
                          <div className="text-xs text-amber-600 mt-1">牌组数</div>
                        </div>
                      </div>
                    </>
                  )}

                  <div>
                    <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-gray-400" />
                      牌组 ({detailDecks.length})
                    </h3>
                    {detailDecks.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-4">暂无牌组</p>
                    ) : (
                      <div className="space-y-2">
                        {detailDecks.map(deck => (
                          <div key={deck.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                            <div className="flex items-center gap-3 min-w-0">
                              <BookOpen className="w-4 h-4 text-gray-400 flex-shrink-0" />
                              <span className="text-sm font-medium text-gray-900 truncate">{deck.name}</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-gray-500 flex-shrink-0">
                              <span className="text-gray-400">共 {deck.card_count} 张卡片</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
