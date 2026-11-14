import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { UserTag } from '../../components/UserBadge';
import BottomNav from './components/BottomNav';
import {
  AccountTab, ChangelogTab, FeedbackTab, SoftwareTab, VersionTab,
} from '../SettingsPage';
import MyBackgroundTab from './MyBackgroundTab';
import {
  ChevronRight, Settings as SettingsIcon, CalendarDays, Flame, Trophy, Layers,
  LineChart, Search, SlidersHorizontal, Info, Hash,
  FileText, MessageSquare, ShieldCheck, LogOut, Pencil, Coins, Sparkles, Image as ImageIcon,
  Rocket,
} from 'lucide-react';

type DetailKey = 'account' | 'changelog' | 'version' | 'software' | 'feedback' | 'background';

const DETAIL_TITLE: Record<DetailKey, string> = {
  account: '账号与安全',
  changelog: '更新日志',
  version: '版本信息',
  software: '软件声明',
  feedback: '帮助与反馈',
  /* 商城商品「更换首页背景图片」的使用入口（2026-09-30 上架） */
  background: '我的背景',
};

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 生成「上周日 ~ 本周六」共 14 天的日历格子 */
function buildCalendar(recent: string[]) {
  const set = new Set(recent);
  const today = new Date();
  const todayK = dateKey(today);
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() - 7);

  const days: { key: string; day: number; checked: boolean; isToday: boolean; future: boolean }[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = dateKey(d);
    days.push({
      key,
      day: d.getDate(),
      checked: set.has(key),
      isToday: key === todayK,
      future: d.getTime() > today.getTime(),
    });
  }
  return days;
}

// ── 小组件 ────────────────────────────────────────────

function Row({
  icon, title, desc, right, onClick, danger,
}: {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  right?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left active:bg-slate-50 transition-colors"
    >
      <span
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: danger ? '#fef2f2' : '#f3f6fb' }}
      >
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-[15px] font-semibold ${danger ? 'text-red-500' : 'text-slate-900'}`}>
          {title}
        </span>
        {desc && <span className="block text-xs text-slate-400 mt-0.5 truncate">{desc}</span>}
      </span>
      {right}
      <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
    </button>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`keyi-glass-panel rounded-[20px] ${className}`}
    >
      {children}
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────

export default function ProfilePageV2() {
  const { user, openLoginModal, logout } = useAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<DetailKey | null>(null);
  const [stats, setStats] = useState<any>(null);
  // 铜板余额（全站统一显示服务器账号余额，来自 GET /api/coins）
  const [coinBalance, setCoinBalance] = useState<number>(0);
  /* 「帮助与反馈」的未读回复数 —— 驱动入口红点。
     依赖 detail：从反馈页返回后 detail 变回 null，会重新拉一次，
     此时学生已读过（页面内标记已读），红点自然消失。 */
  const [fbUnread, setFbUnread] = useState(0);
  /* 与首页完全一致的壁纸与遮罩：个人中心不再是另一套浅灰底，进页面像还在同一个空间里 */
  const [homeBg, setHomeBg] = useState<string | null>(null);
  const [bgMask, setBgMask] = useState(30);

  useEffect(() => {
    if (!user) { setHomeBg(null); setBgMask(30); return; }
    let alive = true;
    api.shop.backgrounds()
      .then((res) => {
        if (!alive) return;
        const active = res.owned ? res.items.find((i) => i.active) : null;
        setHomeBg(active?.url || null);
      })
      .catch(() => { /* 用默认壁纸 */ });
    api.auth.getSettings()
      .then((st) => {
        if (!alive) return;
        const m = Number(st?.home_bg_mask);
        if (Number.isFinite(m)) setBgMask(Math.max(0, Math.min(80, m)));
      })
      .catch(() => { /* 默认 30 */ });
    return () => { alive = false; };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api.cards.statsOverview()
      .then(setStats)
      .catch(() => setStats(null));
    api.coins.get()
      .then(c => setCoinBalance(c.balance))
      .catch(() => setCoinBalance(0));
  }, [user]);

  useEffect(() => {
    if (!user) { setFbUnread(0); return; }
    api.content.feedbackUnread()
      .then(d => setFbUnread(Number(d && d.unread) || 0))
      .catch(() => { /* 拉取失败就不显示红点，不打扰 */ });
  }, [user, detail]);

  const recent: string[] = Array.isArray(stats?.recentCheckins) ? stats.recentCheckins : [];
  const days = useMemo(() => buildCalendar(recent), [recent.join(',')]);

  const streak = stats?.streak ?? 0;
  const totalReviews = stats?.totalReviews ?? 0;
  const mastered = stats?.masteredCards ?? 0;
  const todayNew = stats?.todayNew ?? 0;
  const todayReview = stats?.todayReview ?? 0;
  const dueToday = stats?.dueToday ?? 0;
  const newLeft = stats?.newCards ?? 0;
  const todayTotal = todayNew + todayReview;
  const hasTask = dueToday > 0 || newLeft > 0;

  // ── 二级详情页 ──
  if (detail) {
    const common = { user, openLoginModal } as any;
    const body =
      detail === 'account' ? <AccountTab {...common} /> :
      detail === 'feedback' ? <FeedbackTab {...common} /> :
      detail === 'background' ? <MyBackgroundTab {...common} /> :
      detail === 'changelog' ? <ChangelogTab /> :
      detail === 'version' ? <VersionTab /> :
      <SoftwareTab />;

    return (
      <div className="keyi-profile-detail min-h-screen bg-[#f4f6fa] pb-24">
        <header className="sticky top-0 z-30 bg-[#f4f6fa]/95 backdrop-blur px-4 py-3 flex items-center gap-2 border-b border-slate-200/60">
          <button
            onClick={() => setDetail(null)}
            className="w-9 h-9 rounded-full flex items-center justify-center active:bg-slate-200/60"
            aria-label="返回"
          >
            <ChevronRight className="w-5 h-5 text-slate-500 rotate-180" />
          </button>
          <h1 className="text-[17px] font-bold text-slate-900">{DETAIL_TITLE[detail]}</h1>
        </header>
        <main className="px-4 pt-4">{body}</main>
      </div>
    );
  }

  return (
    <div className="keyi-profile min-h-screen relative overflow-hidden isolate pb-28 text-slate-900">
      {/* 背景：与首页同一张壁纸、同一遮罩浓度，切换页面不会「换一个世界」 */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[#bcd3ec]">
        <img
          src={homeBg || '/home-bg.webp'}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover object-center select-none"
        />
        <div className="absolute inset-0" style={{ background: `rgba(255,255,255,${bgMask / 100})` }} />
        <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-white/70 via-white/30 to-transparent" />
      </div>

      {/* ── 顶部个人信息（直接浮在壁纸上） ── */}
      <div className="relative">
        <div className="relative mx-auto max-w-2xl px-5 pt-6 pb-20">
          {/* 右上角设置 */}
          <div className="flex justify-end">
            <button
              onClick={() => setDetail('account')}
              className="keyi-glass w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-transform"
              style={{ boxShadow: '0 2px 10px rgba(23,43,77,0.06)' }}
              aria-label="设置"
            >
              <SettingsIcon className="w-[18px] h-[18px] text-slate-600" strokeWidth={2.2} />
            </button>
          </div>

          {/* 头像 + 昵称 */}
          <div className="mt-3 flex items-center gap-4">
            <button
              onClick={() => (user ? setDetail('account') : openLoginModal())}
              className="relative flex-shrink-0 active:scale-95 transition-transform"
            >
              <span
                className="block w-[74px] h-[74px] rounded-full overflow-hidden bg-white flex items-center justify-center"
                style={
                  user?.badge_label
                    ? { boxShadow: '0 0 16px rgba(251,191,36,0.7)', border: '3px solid #F5B301' }
                    : { boxShadow: '0 4px 16px rgba(23,43,77,0.12)', border: '3px solid #fff' }
                }
              >
                {user?.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt="头像"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <span
                    className="w-full h-full flex items-center justify-center text-[26px] font-bold text-white"
                    style={{ background: 'linear-gradient(135deg,#5b8bf5,#3B6BE8)' }}
                  >
                    {(user?.username || '?').charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
              {user && (
                <span
                  className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-white flex items-center justify-center"
                  style={{ boxShadow: '0 2px 6px rgba(23,43,77,0.15)' }}
                >
                  <Pencil className="w-3 h-3 text-[#3B6BE8]" strokeWidth={2.6} />
                </span>
              )}
            </button>

            <div className="flex-1 min-w-0">
              {user ? (
                <>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[19px] font-bold text-slate-900 truncate drop-shadow-[0_1px_2px_rgba(255,255,255,0.75)]">
                      {user.username}
                    </span>
                    {user.badge_label ? <UserTag label={user.badge_label} /> : null}
                  </div>
                  {user.avatar_review_status === 'pending' && (
                    <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      头像审核中
                    </div>
                  )}
                  {user.avatar_review_status === 'rejected' && (
                    <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                      头像被驳回{user.avatar_review_reason ? `：${user.avatar_review_reason}` : ''}
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-700 drop-shadow-[0_1px_1px_rgba(255,255,255,0.75)]">
                    <span className="px-2 py-0.5 rounded-full bg-white/70 font-medium">
                      ID {user.id}
                    </span>
                    <span className="inline-flex items-center gap-0.5">
                      <Flame className="w-3.5 h-3.5 text-orange-500" />
                      已坚持 {streak} 天
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <button
                    onClick={openLoginModal}
                    className="text-[19px] font-bold text-slate-900"
                  >
                    点击登录
                  </button>
                  <div className="mt-1 text-xs text-slate-500">登录后查看学习数据与打卡记录</div>
                </>
              )}
            </div>

            {user && (
              <button
                onClick={() => setDetail('account')}
                className="keyi-glass flex-shrink-0 flex items-center gap-0.5 px-3 py-1.5 rounded-full text-xs font-semibold text-[#2F5BD1] active:scale-95 transition-transform"
              >
                编辑资料
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── 内容区（上移与头部重叠） ── */}
      <div className="relative z-10 mx-auto max-w-2xl px-4 -mt-14 space-y-4">
        {/* 数据卡 */}
        <Card className="px-2 py-4">
          <div className="flex">
            {[
              { value: totalReviews, label: '累计学习', icon: <Layers className="w-4 h-4 text-blue-500" /> },
              { value: streak, label: '坚持天数', icon: <Flame className="w-4 h-4 text-orange-500" /> },
              { value: mastered, label: '已掌握', icon: <Trophy className="w-4 h-4 text-amber-500" /> },
            ].map((s, i) => (
              <div
                key={s.label}
                className={`flex-1 flex flex-col items-center gap-1 ${i > 0 ? 'border-l border-slate-100' : ''}`}
              >
                <span className="flex items-center gap-1 text-[22px] font-extrabold text-slate-900 leading-none">
                  {s.value}
                </span>
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  {s.icon}
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* 打卡日历 */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <CalendarDays className="w-4 h-4 text-[#3B6BE8]" />
              <span className="text-[15px] font-bold text-slate-900">打卡日历</span>
            </div>
            <span className="text-xs text-slate-400">
              已累计打卡 <b className="text-[#3B6BE8]">{stats?.checkinDays ?? 0}</b> 天
            </span>
          </div>
          <div className="grid grid-cols-7 gap-y-2">
            {WEEK_LABELS.map(w => (
              <div key={w} className="text-center text-[11px] text-slate-400">{w}</div>
            ))}
            {days.map(d => (
              <div key={d.key} className="flex justify-center">
                <span
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold ${
                    d.future
                      ? 'text-slate-300'
                      : d.checked
                        ? 'text-white'
                        : 'text-slate-400 bg-slate-50'
                  }`}
                  style={
                    d.checked
                      ? { background: 'linear-gradient(135deg,#5b8bf5,#3B6BE8)', boxShadow: '0 2px 6px rgba(59,107,232,0.35)' }
                      : d.isToday
                        ? { boxShadow: 'inset 0 0 0 1.5px #3B6BE8', color: '#3B6BE8' }
                        : undefined
                  }
                >
                  {d.day}
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* 今日学习 + CTA */}
        <Card className="p-4">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-xs text-slate-400">今日已学</div>
              <div className="mt-0.5 flex items-baseline gap-1">
                <span className="text-[28px] font-extrabold text-slate-900 leading-none">{todayTotal}</span>
                <span className="text-xs text-slate-400">词</span>
              </div>
            </div>
            <div className="text-right text-xs text-slate-400 leading-5">
              <div>新学 <b className="text-slate-600">{todayNew}</b> · 复习 <b className="text-slate-600">{todayReview}</b></div>
              <div>待复习 <b className="text-[#3B6BE8]">{dueToday}</b> · 新词剩余 <b className="text-[#3B6BE8]">{newLeft}</b></div>
            </div>
          </div>
          <button
            onClick={() => navigate(dueToday > 0 ? '/study' : newLeft > 0 ? '/study' : '/decks')}
            className="keyi-cta mt-3.5 w-full h-11 rounded-full text-[15px] font-bold"
          >
            {hasTask ? '继续学习' : '去看看卡组'}
          </button>
        </Card>

        {/* 功能宫格 */}
        <Card className="grid grid-cols-4 py-4">
          {[
            { label: '我的卡组', icon: <Layers className="w-5 h-5 text-blue-500" />, to: '/decks' },
            { label: '学习统计', icon: <LineChart className="w-5 h-5 text-emerald-500" />, to: '/stats' },
            { label: '查单词', icon: <Search className="w-5 h-5 text-violet-500" />, to: '/lookup' },
            { label: '学习计划', icon: <SlidersHorizontal className="w-5 h-5 text-amber-500" />, to: '/study-settings' },
          ].map(g => (
            <button
              key={g.label}
              onClick={() => navigate(g.to)}
              className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform"
            >
              <span className="w-11 h-11 rounded-2xl bg-white/65 flex items-center justify-center">
                {g.icon}
              </span>
              <span className="text-[12px] text-slate-600 font-medium">{g.label}</span>
            </button>
          ))}
        </Card>

        {/* 功能列表 */}
        <Card className="divide-y divide-slate-200/55 overflow-hidden">
          <Row
            icon={<Coins className="w-[18px] h-[18px] text-amber-500" />}
            title="铜板"
            desc="在训练场答题、决斗获胜、完成校园任务都能赚铜板"
            right={<span className="text-[15px] font-extrabold text-amber-500">{coinBalance}</span>}
            onClick={() => navigate('/coins')}
          />
          <Row
            icon={<Sparkles className="w-[18px] h-[18px] text-[#3B6BE8]" />}
            title="学习数据"
            desc="遗忘曲线、学习量与记忆持久度"
            onClick={() => navigate('/stats')}
          />
          <Row
            icon={<ShieldCheck className="w-[18px] h-[18px] text-emerald-500" />}
            title="账号与安全"
            desc="修改头像与登录密码"
            onClick={() => setDetail('account')}
          />
          {/* 站点升级进度（2026-11-06）：把「采纳了但还没做」的想法公开，
              避免学生以为采纳 = 明天就能用 */}
          <Row
            icon={<Rocket className="w-[18px] h-[18px] text-indigo-500" />}
            title="站点升级进度"
            desc="计划中 / 待开始 / 进行中 / 已完成"
            onClick={() => navigate('/roadmap')}
          />
          <Row
            icon={<FileText className="w-[18px] h-[18px] text-rose-500" />}
            title="更新日志"
            onClick={() => setDetail('changelog')}
          />
          <Row
            icon={<Info className="w-[18px] h-[18px] text-sky-500" />}
            title="版本信息"
            onClick={() => setDetail('version')}
          />
          <Row
            icon={<Hash className="w-[18px] h-[18px] text-slate-500" />}
            title="软件声明"
            onClick={() => setDetail('software')}
          />
          <Row
            icon={<ImageIcon className="w-[18px] h-[18px] text-indigo-500" />}
            title="首页背景"
            desc="把首页换成你自己的图片（商城解锁）"
            onClick={() => setDetail('background')}
          />
          <Row
            icon={<MessageSquare className="w-[18px] h-[18px] text-violet-500" />}
            title="帮助与反馈"
            desc={fbUnread > 0 ? '管理员回复了你的反馈' : '遇到问题或有建议？告诉我们'}
            right={fbUnread > 0 ? (
              <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center">
                {fbUnread > 9 ? '9+' : fbUnread}
              </span>
            ) : undefined}
            onClick={() => setDetail('feedback')}
          />
        </Card>

        {/* 退出登录 */}
        {user && (
          <Card className="overflow-hidden">
            <button
              onClick={() => { logout(); navigate('/'); }}
              className="w-full h-12 flex items-center justify-center gap-1.5 text-[15px] font-semibold text-red-500 active:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              退出登录
            </button>
          </Card>
        )}

        <p className="text-center text-[11px] text-slate-300 pt-2">
          @2026 刻忆间隔学习平台
        </p>
      </div>

      <BottomNav />
    </div>
  );
}
