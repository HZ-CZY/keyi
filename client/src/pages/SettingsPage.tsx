import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { motion } from 'framer-motion';
import ScrollReveal from '../components/ScrollReveal';
import {
  User, Lock, BookOpen, FileText, Info,
  CheckCircle2, AlertCircle, Save, Hash, ArrowLeft,
  ChevronRight, Camera, Upload,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';

type TabKey = '账号设置' | '学习设置' | '更新日志' | '版本信息' | '软件声明' | '帮助与反馈';

const tabs: { key: TabKey; icon: React.ReactNode; label: string }[] = [
  { key: '账号设置', icon: <User className="w-4 h-4" />, label: '账号' },
  { key: '学习设置', icon: <BookOpen className="w-4 h-4" />, label: '学习' },
  { key: '更新日志', icon: <FileText className="w-4 h-4" />, label: '日志' },
  { key: '版本信息', icon: <Info className="w-4 h-4" />, label: '版本' },
  { key: '软件声明', icon: <Hash className="w-4 h-4" />, label: '声明' },
  { key: '帮助与反馈', icon: <AlertCircle className="w-4 h-4" />, label: '反馈' },
];

// ── Account section ──────────────────────────────────

function AccountTab({ user, openLoginModal }: { user: any; openLoginModal: () => void }) {
  if (!user) {
    return <LoginRequired message="登录后修改密码" openLoginModal={openLoginModal} />;
  }
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // Avatar state
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { updateUser } = useAuth();

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setAvatarMsg({ type: 'error', text: '请选择图片文件' });
      return;
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setAvatarMsg({ type: 'error', text: '图片大小不能超过5MB' });
      return;
    }

    // Show local preview
    const localUrl = URL.createObjectURL(file);
    setAvatarPreview(localUrl);
    setAvatarUploading(true);
    setAvatarMsg(null);

    try {
      const result = await api.auth.uploadAvatar(file);
      // Update user context with new avatar URL
      updateUser({ avatar_url: result.avatarUrl });
      setAvatarMsg({ type: 'success', text: '头像上传成功' });
    } catch (err: any) {
      setAvatarMsg({ type: 'error', text: err.message || '头像上传失败' });
      setAvatarPreview(null);
    } finally {
      setAvatarUploading(false);
      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      setMsg({ type: 'error', text: '请填写所有密码字段' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMsg({ type: 'error', text: '两次输入的新密码不一致' });
      return;
    }
    setLoading(true); setMsg(null);
    try {
      await api.auth.changePassword(oldPassword, newPassword);
      setMsg({ type: 'success', text: '密码修改成功' });
      setOldPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || '修改失败' });
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center">
          <User className="w-4 h-4 text-indigo-600" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">账号设置</h2>
          <p className="text-xs text-gray-400">{user?.username}</p>
        </div>
      </div>

      {/* Avatar upload card */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-5 border border-white/40">
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Camera className="w-4 h-4 text-indigo-500" /> 头像设置
        </h3>
        <div className="flex items-center gap-5">
          {/* Avatar preview */}
          <div className="relative flex-shrink-0">
            <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-gray-100 bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center">
              {avatarPreview || user?.avatar_url ? (
                <img
                  src={avatarPreview || user?.avatar_url}
                  alt="头像"
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <span className="text-2xl font-bold text-indigo-400">
                  {user?.username?.charAt(0).toUpperCase() || 'U'}
                </span>
              )}
              {avatarUploading && (
                <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                </div>
              )}
            </div>
          </div>
          <div className="flex-1">
            <p className="text-sm text-gray-600 mb-2">支持 JPG / PNG / GIF，最大 5MB</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <button
              onClick={handleAvatarClick}
              disabled={avatarUploading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-xl hover:bg-indigo-100 disabled:opacity-50 text-sm font-medium transition-all"
            >
              <Upload className="w-4 h-4" />
              {avatarUploading ? '上传中...' : '上传头像'}
            </button>
            {avatarMsg && (
              <div className={`flex items-center gap-1.5 text-xs mt-2 ${avatarMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                {avatarMsg.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {avatarMsg.text}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Password change card */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-5 border border-white/40">
        <div className="space-y-3">
          <input type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)}
            placeholder="当前密码"
            className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white/80 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 text-sm transition-all" />
          <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
            placeholder="新密码"
            className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white/80 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 text-sm transition-all" />
          <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
            placeholder="确认新密码"
            className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white/80 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 text-sm transition-all" />
          <button onClick={handleSubmit} disabled={loading}
            className="px-5 py-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-50 text-sm font-medium transition-all">
            {loading ? '修改中...' : '修改密码'}
          </button>
          {msg && (
            <div className={`flex items-center gap-1.5 text-xs ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
              {msg.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
              {msg.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Learning tab ─────────────────────────────────────

function LearningTab({ user, openLoginModal }: { user: any; openLoginModal: () => void }) {
  if (!user) {
    return <LoginRequired message="登录后调整学习参数" openLoginModal={openLoginModal} />;
  }
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    api.auth.getSettings()
      .then(setSettings)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const fields = [
    { key: 'new_cards_per_day', label: '每日新卡片数', min: 1, max: 100, step: 1 },
    { key: 'reviews_per_day', label: '每日复习上限', min: 1, max: 500, step: 10 },
    { key: 'learning_steps', label: '学习步骤 (分钟)', min: 1, max: 60, step: 1 },
  ];

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.auth.updateSettings(settings);
      setMsg({ type: 'success', text: '学习设置已保存' });
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || '保存失败' });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
          <BookOpen className="w-4 h-4 text-blue-600" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">学习设置</h2>
          <p className="text-xs text-gray-400">调整学习参数以优化复习体验</p>
        </div>
      </div>
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-5 border border-white/40">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : (
          <div className="space-y-6">
            {fields.map(field => (
              <div key={field.key}>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">{field.label}</label>
                  <span className="text-sm text-gray-500 font-mono">{settings[field.key] || '0'}</span>
                </div>
                <Slider
                  value={[parseInt(settings[field.key] || '0')]}
                  min={field.min} max={field.max} step={field.step}
                  onValueChange={([val]) => setSettings(prev => ({ ...prev, [field.key]: String(val) }))}
                />
              </div>
            ))}
            <div className="pt-2 flex items-center gap-3">
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-50 text-sm font-medium transition-all">
                <Save className="w-4 h-4" />
                {saving ? '保存中...' : '保存设置'}
              </button>
              {msg && (
                <span className={`text-xs flex items-center gap-1 ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                  {msg.type === 'success' ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                  {msg.text}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Changelog tab ────────────────────────────────────

function ChangelogTab() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.content.getChangelog()
      .then(data => setEntries(data.length > 0 ? data : [
        { version: 'v2.1.0', date: '2026-06-22', description: '新增个人中心，优化学习流程，修复复习卡片显示问题' },
        { version: 'v2.0.0', date: '2026-06-01', description: '全新Ebbinghaus间隔重复算法，支持学习阶段三步骤' },
        { version: 'v1.0.0', date: '2026-05-01', description: '刻忆间隔学习平台正式上线' },
      ]))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-8 h-8 rounded-xl bg-rose-100 flex items-center justify-center">
          <FileText className="w-4 h-4 text-rose-600" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">更新日志</h2>
          <p className="text-xs text-gray-400">查看平台更新历史</p>
        </div>
      </div>
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-5 border border-white/40">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">暂无更新记录</div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry: any, idx: number) => (
              <div key={entry.id || idx}
                className={`flex items-start gap-3 p-3 rounded-xl ${
                  idx === 0
                    ? 'bg-gradient-to-r from-primary-50/80 to-purple-50/80 border border-primary-100/50'
                    : 'bg-white/60 border border-gray-100'
                }`}>
                <div className={`flex-shrink-0 w-2 h-2 mt-2 rounded-full ${idx === 0 ? 'bg-primary-500' : 'bg-indigo-400'}`} />
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    {entry.version} <span className="text-xs font-normal text-gray-400 ml-2">{entry.date}</span>
                  </div>
                  <div className="text-sm text-gray-600 mt-0.5">{entry.description}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Version tab ──────────────────────────────────────

function VersionTab() {
  const [content, setContent] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.content.getSiteContent()
      .then(setContent)
      .catch(() => setContent({}))
      .finally(() => setLoading(false));
  }, []);

  const fields = [
    { key: 'app_name', label: '应用名称', fallback: '刻忆间隔学习平台' },
    { key: 'app_version', label: '当前版本', fallback: 'v2.1.0' },
    { key: 'build_date', label: '构建日期', fallback: '2026-06-22' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-8 h-8 rounded-xl bg-sky-100 flex items-center justify-center">
          <Info className="w-4 h-4 text-sky-600" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">版本信息</h2>
          <p className="text-xs text-gray-400">关于刻忆平台</p>
        </div>
      </div>
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-5 border border-white/40">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            {fields.map(f => (
              <div key={f.key} className="flex justify-between py-2.5 px-4 rounded-lg bg-gray-50/70">
                <span className="text-gray-500">{f.label}</span>
                <span className="text-gray-900 font-medium">{content[f.key] || f.fallback}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Software tab ─────────────────────────────────────

function SoftwareTab() {
  const [content, setContent] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.content.getSiteContent()
      .then(setContent)
      .catch(() => setContent({}))
      .finally(() => setLoading(false));
  }, []);

  const statement = content.software_statement || '刻忆间隔学习平台 (Keyi) 是一个基于间隔重复原理的开源学习工具。\n\n本平台使用 Ebbinghaus 遗忘曲线算法优化学习效率，数据存储在本地服务器。\n\n平台不收集任何个人隐私数据，所有学习数据仅存储于您部署的服务器上。\n\n本软件按"原样"提供，不提供任何明示或暗示的保证。';

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center">
          <Hash className="w-4 h-4 text-amber-600" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">软件声明</h2>
          <p className="text-xs text-gray-400">使用条款与声明</p>
        </div>
      </div>
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-5 border border-white/40">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : (
          <div className="text-sm text-gray-600 space-y-3 whitespace-pre-line">
            {statement.split('\n').map((line, i) => <p key={i}>{line}</p>)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Help & Feedback tab ────────────────────────────

function FeedbackTab({ user, openLoginModal }: { user: any; openLoginModal: () => void }) {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!content.trim()) {
      setError('请输入反馈内容');
      return;
    }
    setSending(true); setError('');
    try {
      await api.content.submitFeedback({ content: content.trim() });
      setSent(true);
      setContent('');
    } catch (err: any) {
      setError(err.message || '提交失败');
    } finally { setSending(false); }
  };

  if (!user) {
    return <LoginRequired message="登录后提交反馈" openLoginModal={openLoginModal} />;
  }

  if (sent) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center">
            <AlertCircle className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">帮助与反馈</h2>
            <p className="text-xs text-gray-400">感谢你的反馈</p>
          </div>
        </div>
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-8 border border-white/40 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-900 mb-1">提交成功</h3>
          <p className="text-sm text-gray-500 mb-4">感谢你的反馈，我们会认真处理</p>
          <button onClick={() => setSent(false)}
            className="px-5 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 text-sm font-medium transition-all">
            继续反馈
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center">
          <AlertCircle className="w-4 h-4 text-emerald-600" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">帮助与反馈</h2>
          <p className="text-xs text-gray-400">遇到问题或有建议？告诉我们</p>
        </div>
      </div>
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-5 border border-white/40 space-y-4">
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
          <User className="w-3.5 h-3.5" />
          <span>{user?.username}</span>
        </div>
        <textarea value={content} onChange={e => setContent(e.target.value)}
          placeholder="描述你遇到的问题或建议..."
          rows={5}
          className="w-full px-3.5 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 resize-none" />
        {error && (
          <div className="flex items-center gap-1.5 text-xs text-red-600">
            <AlertCircle className="w-3.5 h-3.5" />{error}
          </div>
        )}
        <button onClick={handleSubmit} disabled={sending || !content.trim()}
          className="px-5 py-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-40 text-sm font-medium transition-all">
          {sending ? '提交中...' : '提交反馈'}
        </button>
      </div>
    </div>
  );
}

// ── Login required overlay ───────────────────────────

function LoginRequired({ message, openLoginModal }: { message: string; openLoginModal: () => void }) {
  return (
    <div className="text-center py-12">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center mx-auto mb-3">
        <User className="w-7 h-7 text-gray-300" />
      </div>
      <p className="text-sm text-gray-400 mb-4">{message}</p>
      <button onClick={openLoginModal}
        className="px-6 py-2.5 rounded-full bg-gradient-to-r from-primary-600 to-indigo-600 text-white text-sm font-medium shadow-soft hover:shadow-lg hover:translate-y-[-1px] transition-all duration-250 ease-premium">
        登录
      </button>
    </div>
  );
}

// ── Main page ────────────────────────────────────────

export default function SettingsPage() {
  const { user, openLoginModal } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey | null>(null);

  const tabContent: Record<TabKey, React.ReactNode> = {
    '账号设置': <AccountTab user={user} openLoginModal={openLoginModal} />,
    '学习设置': <LearningTab user={user} openLoginModal={openLoginModal} />,
    '更新日志': <ChangelogTab />,
    '版本信息': <VersionTab />,
    '软件声明': <SoftwareTab />,
    '帮助与反馈': <FeedbackTab user={user} openLoginModal={openLoginModal} />,
  };

  // Detail view
  if (activeTab) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setActiveTab(null)}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-all">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">设置</h2>
            <p className="text-xs text-gray-400">
              {tabs.find(t => t.key === activeTab)?.label}
            </p>
          </div>
        </div>
        {tabContent[activeTab]}
      </div>
    );
  }

  // Menu list
  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">设置</h1>
      <div className="grid gap-3">
        {tabs.map(tab => (
          <motion.button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="w-full text-left bg-white/80 backdrop-blur-sm rounded-2xl card-shadow-hover p-4 border border-white/40 hover:bg-white/90 transition-all flex items-center gap-4"
            whileHover={{ scale: 1.005 }}
            transition={{ duration: 0.15 }}
          >
            <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0">
              {tab.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900">{tab.key}</div>
              <div className="text-xs text-gray-400 mt-0.5">
                {tab.key === '账号设置' && '修改密码'}
                {tab.key === '学习设置' && '调整学习参数'}
                {tab.key === '更新日志' && '查看平台更新历史'}
                {tab.key === '版本信息' && '关于刻忆平台'}
                {tab.key === '软件声明' && '使用条款与声明'}
                {tab.key === '帮助与反馈' && '提交问题或建议'}
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-300 flex-shrink-0" />
          </motion.button>
        ))}
      </div>
    </div>
  );
}
