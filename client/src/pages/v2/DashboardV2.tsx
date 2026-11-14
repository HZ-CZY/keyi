import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ListTodo, BookOpen, BookMarked,
  Library, Crown, Layers, Zap, Calendar, Loader2, Trophy, X, Palette, Swords, Lightbulb, ClipboardList, FlaskConical,
} from 'lucide-react';
import { api, type CheckinStatus } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { isFeatureEnabled, useFeatureFlags } from '../../lib/featureFlags';
import WordNetworkGraph from './components/WordNetworkGraph';
import StudyShortcut from './components/StudyShortcut';
import BottomNav from './components/BottomNav';
import LeaderboardModal from './components/LeaderboardModal';
import IdeaModal from './components/IdeaModal';
import TutorSurveyModal from './components/TutorSurveyModal';
import AnnouncementTicker from './components/AnnouncementTicker';
import { UserBadge, badgeRingCls, badgeGlow } from '../../components/UserBadge';
import WordnetPaletteControls from '../../components/WordnetPaletteControls';
import { loadPaletteFromAccount } from '../../lib/wordnetPalette';

/**
 * V2 dashboard — matches the reference design pixel-closely:
 *   - Very light blue-white gradient backdrop filling the screen
 *   - Top: avatar + 2 thin progress strips + dark-mode pill
 *   - Left: tasks button + "返回旧版" pill
 *   - Center: full-bleed word-association graph (transparent bg)
 *   - Right of graph: white study card with tabs + progress + check-in
 *   - Far right: vertical glass icon rail (查词 / 单词本 / 阅读 / 会员)
 *   - Bottom: white sticky nav
 *   - Marketing cards removed — main area holds only graph + study card
 */
/* [2026-11-09] 「新功能问卷」已下架：学生端入口整体关闭。
   收回/重新开放只需把 SURVEY_ENTRY_ON 改成 true，入口即恢复。
   后台数据页 /admin/tutor-survey 与历史数据不受影响（见 AdminTutorSurveyPage）。 */
const SURVEY_ENTRY_ON = false;

/* 不参与「新功能问卷」的账号：学生端不显示入口，后台也看不到数据。
   陈浩铎、朱栋安 —— 与站长保持一致的视图。 */
const SURVEY_HIDDEN_USERS = ['陈浩铎', '朱栋安'];

export default function DashboardV2() {
  const navigate = useNavigate();
  const { user, openLoginModal } = useAuth();

  // [2026-10-26] 管理员不进入用户端首页：一旦落在 /，自动回到后台
  useEffect(() => {
    // 仅主 admin 账号回跳；陈子洋 / 陈浩铎保留在用户端以便切换
    if (user?.username === 'admin') navigate('/admin', { replace: true });
  }, [user, navigate]);
  // 订阅功能开关变化，禁用模块入口随切换实时显隐
  useFeatureFlags();

  const [overview, setOverview] = useState<{
    totalCards: number; dueToday: number; dueTomorrow: number;
    newCards: number; todayReviews: number; streak: number; points: number;
  } | null>(null);
  // 打卡状态（独立于学习卡）
  const [checkin, setCheckin] = useState<CheckinStatus | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  /* 签到面板：连签档位 / 漏签日历 / 补打卡（反馈 83 / 149 / 150 / 168） */
  const [checkinPanel, setCheckinPanel] = useState(false);
  const [backfillBusy, setBackfillBusy] = useState('');
  const [checkinTip, setCheckinTip] = useState('');
  // 学习排行榜弹窗（仿百词斩）
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  // [2026-10-24] 想法征集弹窗
  const [showIdea, setShowIdea] = useState(false);
  // [2026-11-09] AI 讲题新功能问卷（陈浩铎 / 朱栋安不显示）
  const [showTutorSurvey, setShowTutorSurvey] = useState(false);
  // 铜板余额（全站统一显示服务器账号余额，来自 GET /api/coins）
  const [coinBalance, setCoinBalance] = useState<number>(0);
  // 任务中心是否有可领取奖励（有待领取任务才亮红点）
  const [hasPendingTasks, setHasPendingTasks] = useState<boolean>(false);
  // 888 铜板限时福利：弹窗与领取状态
  const [welfare, setWelfare] = useState<{ claimed: boolean; amount: number } | null>(null);
  const [welfareModal, setWelfareModal] = useState(false);
  const [welfareClaiming, setWelfareClaiming] = useState(false);
  const [welfareSuccess, setWelfareSuccess] = useState(false);
  // 词球配色面板（自定义调色板）
  const [showPalette, setShowPalette] = useState(false);
  /* 商城「更换首页背景图片」：登录后拉一次，有生效的自定义背景就用它，否则用默认图 */
  const [homeBg, setHomeBg] = useState<string | null>(null);
  /* 【2026-10-19】首页背景遮罩浓度（0~80，单位 %）。
     原来写死 bg-white/30，自定义背景一深或一浅就没法兼顾：深色图压不住文字、
     浅色图又显得发灰。现在由用户在「我的背景」里自己调，存 user_settings
     的 home_bg_mask，和背景图一样跨设备生效。默认 30 = 原来的观感。 */
  const [bgMask, setBgMask] = useState(30);

  useEffect(() => {
    if (!user) {
      setHomeBg(null);
      setBgMask(30);
      return;
    }
    let alive = true;
    api.shop
      .backgrounds()
      .then((res) => {
        if (!alive) return;
        const active = res.owned ? res.items.find((i) => i.active) : null;
        setHomeBg(active?.url || null);
      })
      .catch(() => {
        /* 拿不到就用默认背景，不影响首页 */
      });
    /* 遮罩浓度：和背景图并行拉，任一失败都退回默认，不阻塞首页渲染 */
    api.auth
      .getSettings()
      .then((st) => {
        if (!alive) return;
        const m = Number(st?.home_bg_mask);
        if (Number.isFinite(m)) setBgMask(Math.max(0, Math.min(80, m)));
      })
      .catch(() => { /* 保持默认 30 */ });
    return () => {
      alive = false;
    };
  }, [user]);

  // 登录后拉取账号里保存的词球配色（没有则保持本机设置）
  useEffect(() => {
    if (user) void loadPaletteFromAccount();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api.cards.statsOverview()
      .then((d: any) => setOverview(d))
      .catch(() => { /* stay null */ });
    api.coins.get()
      .then(c => setCoinBalance(c.balance))
      .catch(() => { /* keep 0 */ });
    // 任务中心红点：仅当存在「已完成但未领取」的任务时点亮
    api.tasks.today()
      .then(d => setHasPendingTasks(d.tasks.some(t => t.done && !t.claimed)))
      .catch(() => { /* 拉取失败时保持不亮 */ });
    // 888 福利：仅当用户尚未领取时才弹出领取弹窗；已领则完全不弹
    api.welfare.status()
      .then(d => {
        setWelfare(d);
        if (!d.claimed) setWelfareModal(true);
      })
      .catch(() => { /* 状态拉取失败不弹 */ });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api.checkin.status().then(s => setCheckin(s)).catch(() => { /* ignore */ });
  }, [user]);

  async function doCheckin() {
    if (checkingIn || !user) return;
    // 已打卡时点按钮 = 打开签到面板（看档位 / 补签），不再重复请求
    if (checkin?.checkedInToday) { setCheckinPanel(true); return; }
    setCheckingIn(true);
    try {
      const r = await api.checkin.today();
      if (r.coinsAwarded && r.coinsAwarded > 0) {
        setCheckinTip(`连续 ${r.streak} 天 · +${r.coinsAwarded} 铜板`);
        window.setTimeout(() => setCheckinTip(''), 3200);
        api.coins.get().then(c => setCoinBalance(c.balance)).catch(() => {});
      }
      const s = await api.checkin.status().catch(() => null);
      if (s) setCheckin(s);
      else setCheckin(prev => prev ? { ...prev, checkedInToday: true, streak: r.streak } : prev);
      setCheckinPanel(true);
    } catch {
      /* surface inline if needed */
    } finally {
      setCheckingIn(false);
    }
  }

  /** 补一天签到 */
  async function doBackfill(date: string) {
    if (backfillBusy) return;
    setBackfillBusy(date);
    try {
      const r = await api.checkin.backfill(date);
      setCheckinTip(`已补 ${date} · 连续 ${r.streak} 天`);
      window.setTimeout(() => setCheckinTip(''), 3200);
      api.coins.get().then(c => setCoinBalance(c.balance)).catch(() => {});
      const s = await api.checkin.status().catch(() => null);
      if (s) setCheckin(s);
    } catch (e: any) {
      setCheckinTip(e?.message || '补签失败');
      window.setTimeout(() => setCheckinTip(''), 3000);
    } finally {
      setBackfillBusy('');
    }
  }

  /** 领取 888 铜板福利（幂等，由后端保证不重复发币） */
  async function claimWelfare() {
    if (welfareClaiming || !user) return;
    setWelfareClaiming(true);
    try {
      const r = await api.welfare.claim();
      // 标记已领 + 刷新顶部铜板余额（复用现有余额拉取机制）
      setWelfare({ claimed: true, amount: r.amount ?? 888 });
      api.coins.get().then(c => setCoinBalance(c.balance)).catch(() => {});
      // 展示「领取成功」后自动关闭弹窗（本次会话不再弹）
      setWelfareSuccess(true);
      window.setTimeout(() => {
        setWelfareModal(false);
      }, 1500);
    } catch {
      /* 失败保持弹窗，可重试 */
    } finally {
      setWelfareClaiming(false);
    }
  }

  // Heartbeat — keep logged-in users marked as online (was in legacy TopHeaderLayout)
  useEffect(() => {
    if (!user) return;
    const beat = () => api.auth.heartbeat().catch(() => {});
    beat();
    const interval = setInterval(beat, 60 * 1000);
    return () => clearInterval(interval);
  }, [user]);



  const streak = overview?.streak ?? 0;

  // 右侧竖栏模块入口（按功能开关显隐）
  // 【2026-10-10】新增「训练场」放在「会员」上方：竞技场现在一打开直接进决斗场大厅，
  // 单人练习不再有竞技场内的入口，所以把它的快捷入口提到首页右栏。
  // 【2026-10-11】badge 为角标文字：考前突击带「限时」角标，
  // 时限由服务端 feature_flags.expire_at 控制（见 server/src/index.ts），
  // 到点后 crash 开关自动变 false，入口与角标一起消失。
  const railItems: { to: string; label: string; icon: React.ReactNode; flag: string; badge?: string; external?: boolean }[] = [
    { to: '/lookup', label: '查词', icon: <BookOpen className="w-[22px] h-[22px]" />, flag: 'lookup' },
    { to: '/wordbook', label: '单词本', icon: <BookMarked className="w-[22px] h-[22px]" />, flag: 'lookup' },
    { to: '/reading', label: '阅读', icon: <Library className="w-[22px] h-[22px]" />, flag: 'reading' },
    { to: '/arena/practice', label: '训练场', icon: <Swords className="w-[22px] h-[22px] text-indigo-500" />, flag: 'practice' },
    /* 【2026-11-12】刻忆讲题内测：独立顶层页（/tutor-lab），不是 React 路由，
       必须走 <a> 整页跳转，用 Link 会被前端路由吃掉变成空白。
       角标 HOT 常驻，内测结束后连同这条入口一起下线。 */
    { to: '/tutor-lab', label: '刻忆讲题', icon: <FlaskConical className="w-[22px] h-[22px] text-sky-500" />, flag: 'practice', badge: 'HOT', external: true },
    { to: '/crash', label: '考前突击', icon: <Zap className="w-[22px] h-[22px] text-rose-500" />, flag: 'crash', badge: '限时' },
    { to: '/member', label: '会员', icon: <Crown className="w-[22px] h-[22px] text-amber-400" fill="currentColor" />, flag: 'member' },
  ].filter(item => isFeatureEnabled(item.flag));

  return (
    <div className="keyi-dashboard min-h-screen relative overflow-hidden isolate">
      {/* 首页背景：默认云海吊桥实景图（/home-bg.webp）；在商城解锁「更换首页背景图片」后
          换成玩家自己上传的那张。轻遮罩保证文字可读性，兜底色防白屏 */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[#bcd3ec]">
        <img
          src={homeBg || '/home-bg.webp'}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover object-center select-none"
        />
        {/* 整体轻提亮：压低背景对比度，保证深色文字可读，同时保留画面观感。
            浓度由用户自己调（0~80%，见「我的背景」里的滑块），默认 30% 即原来的 bg-white/30。 */}
        <div className="absolute inset-0" style={{ background: `rgba(255,255,255,${bgMask / 100})` }} />
        {/* 底部渐变：保障页脚与底部导航区域文字清晰（固定值，不随遮罩变化，
            否则用户把遮罩调到 0 时底部导航会看不清） */}
        <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-white/65 via-white/25 to-transparent" />
      </div>

      {/* Top bar */}
      <header className="px-4 md:px-8 pt-5 pb-3 flex items-center gap-3">
        {/* Avatar — 未登录点击弹登录框,已登录进设置；未打卡时头像挂红点提醒 */}
        {user ? (
          <Link to="/settings" className="shrink-0 relative" title="个人设置">
            <div
              className={`w-11 h-11 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shadow-md overflow-hidden ${badgeRingCls(!!user.badge_label, 'ring-2 ring-white/60')}`}
              style={badgeGlow(!!user.badge_label)}
            >
              {user.avatar_url
                ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                : <span className="text-base font-bold">{user.username.slice(0, 1).toUpperCase()}</span>}
            </div>
            {/* 账号金标：右下角小标签（老师 / 管理员…） */}
            {user.badge_label ? <UserBadge size={44} label={user.badge_label} /> : null}
            {checkin && !checkin.checkedInToday && (
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 ring-2 ring-white animate-pulse" title="今日还未打卡" />
            )}
          </Link>
        ) : (
          <button
            onClick={openLoginModal}
            className="shrink-0 w-11 h-11 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shadow-md ring-2 ring-white/60 hover:scale-105 transition-transform"
            title="登录 / 注册"
            aria-label="登录 / 注册"
          >
            <span className="text-base font-bold">我</span>
          </button>
        )}

        {/* [2026-11-12] 原「AI 实验室」顶栏按钮已移到右侧竖栏「训练场」下方，
            改名「刻忆讲题」并带 HOT 角标，见 railItems。 */}

        {/* Streak pill — baicizhan: white capsule, violet bolt left, number centered */}
        <div className="flex-1 hidden sm:flex items-center min-w-0">
          <div className="relative w-full h-8 rounded-full keyi-glass flex items-center px-3.5">
            <Zap className="w-4 h-4 text-violet-500 shrink-0" fill="currentColor" />
            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-slate-800 tabular-nums pointer-events-none">
              {streak} 天
            </span>
          </div>
        </div>

        {/* 铜板余额 pill — baicizhan: white capsule, orange coin left, balance centered */}
        <div className="flex-1 hidden sm:flex items-center min-w-0" title="铜板余额">
          <div className="relative w-full h-8 rounded-full keyi-glass flex items-center px-3.5">
            <span className="w-3.5 h-3.5 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 ring-[3px] ring-orange-300/60 shrink-0" />
            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-slate-800 tabular-nums pointer-events-none">
              {coinBalance}
            </span>
          </div>
        </div>
</header>

      {/* 公告滚动播报（顶栏下方、主体内容上方，横向无缝跑马灯） */}
      <AnnouncementTicker />

      {/* 【2026-11-06 秒过提示】
          学生掉签必须知道原因，否则只会觉得系统坏了。
          只在「今天复习了但秒过占比 >= 80%、且今天因此不算有效学习日」时出现。 */}
      {checkin && !checkin.todayCounts && (checkin.todayFastReviews ?? 0) > 0 && (
        <div className="px-4 md:px-8 max-w-[1440px] mx-auto">
          <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200/80">
            <span className="shrink-0 mt-0.5 w-[18px] h-[18px] rounded-full bg-amber-400 text-white text-[11px] font-bold flex items-center justify-center">!</span>
            <p className="text-[13px] leading-relaxed text-amber-800">
              今天你有 <b className="tabular-nums">{checkin.todayFastReviews}</b> 张卡在 1 秒内就点了
              （占 {checkin.todayFastPct}%），这部分<b>不算学习</b>，连续天数今天不计入。
              认真看完一张再点，明天就能接上。
            </p>
          </div>
        </div>
      )}

      {/* Main body: tasks / center / right rail */}
      <div className="keyi-dashboard-grid px-4 md:px-8 grid gap-5 md:grid-cols-[auto_minmax(0,1fr)_auto] items-start max-w-[1440px] mx-auto">
        {/* Left rail — baicizhan style: chunky 3D colorful icon tiles + black labels */}
        <div className="flex md:flex-col gap-4 pt-2">
          {/* Tasks — 功能开关禁用时隐藏入口 */}
          {isFeatureEnabled('tasks') && (
          <button
            onClick={() => navigate('/tasks')}
            className="flex flex-col items-center gap-1 group"
            title={hasPendingTasks ? '任务 · 有任务可领取' : '任务'}
          >
            <span className="keyi-quick relative w-12 h-12 rounded-[1.05rem] flex items-center justify-center group-hover:scale-105 group-active:scale-95 transition-transform">
              <ListTodo className="w-6 h-6 text-amber-500" strokeWidth={2.2} />
              {hasPendingTasks && (
                <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 ring-2 ring-white" />
              )}
            </span>
            <span className="text-[11px] font-medium text-slate-700">任务</span>
          </button>
          )}

          {/* Leaderboard */}
          <button onClick={() => { user ? setShowLeaderboard(true) : openLoginModal(); }} className="flex flex-col items-center gap-1 group" title="学习排行榜">
            <span className="keyi-quick w-12 h-12 rounded-[1.05rem] flex items-center justify-center group-hover:scale-105 group-active:scale-95 transition-transform">
              <Trophy className="w-6 h-6 text-orange-500" strokeWidth={2.2} />
            </span>
            <span className="text-[11px] font-medium text-slate-700">排行榜</span>
          </button>

          {/* [2026-11-09] 新功能问卷 —— 已下架（SURVEY_ENTRY_ON=false）；陈浩铎 / 朱栋安本就不显示 */}
          {SURVEY_ENTRY_ON && !SURVEY_HIDDEN_USERS.includes(user?.username || '') && (
          <button
            onClick={() => { user ? setShowTutorSurvey(true) : openLoginModal(); }}
            className="flex flex-col items-center gap-1 group"
            title="新功能问卷"
          >
            <span className="keyi-quick relative w-12 h-12 rounded-[1.05rem] flex items-center justify-center group-hover:scale-105 group-active:scale-95 transition-transform">
              <ClipboardList className="w-6 h-6 text-indigo-500" strokeWidth={2.2} />
              <span className="absolute -top-1 -right-1 px-1 py-[1px] rounded-full bg-indigo-500 text-white text-[8px] font-bold leading-none ring-2 ring-white">
                新
              </span>
            </span>
            <span className="text-[10px] font-medium text-slate-700 leading-[1.15] text-center">
              新功能<br />问卷
            </span>
          </button>
          )}

          {/* [2026-10-28] 想法征集已下线（用户端入口移除，后台保留） */}

          {/* 实词大赛（一站到底）—— 功能开关禁用时隐藏入口 */}
          {isFeatureEnabled('contest') && (
          <button onClick={() => { user ? navigate('/contest') : openLoginModal(); }} className="flex flex-col items-center gap-1 group" title="实词大赛 · 一站到底">
            <span className="keyi-quick w-12 h-12 rounded-[1.05rem] flex items-center justify-center group-hover:scale-105 group-active:scale-95 transition-transform">
              <Swords className="w-6 h-6 text-rose-500" strokeWidth={2.2} />
            </span>
            <span className="text-[11px] font-medium text-slate-700">实词大赛</span>
          </button>
          )}
        </div>

        {/* Center column — full-bleed word graph + study card, vertically balanced */}
        <div className="min-w-0 flex flex-col justify-center min-h-[calc(100vh-15rem)]">
          {/* Word graph + study shortcut */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="grid gap-4 lg:grid-cols-[1fr_minmax(320px,420px)] items-start"
          >
            {/* Word graph — transparent bg, full-bleed */}
            <div className="rounded-3xl min-h-[460px] md:min-h-[520px] relative overflow-hidden flex items-center">
              <WordNetworkGraph />

              {/* 调色板入口：右下角小按钮，点开自定义词球配色 */}
              <button
                onClick={() => setShowPalette((v) => !v)}
                title="词球配色"
                aria-label="词球配色"
                className={`absolute bottom-3 right-3 z-30 w-9 h-9 rounded-full flex items-center justify-center shadow-[0_4px_14px_rgba(30,60,110,0.28)] transition-transform active:scale-95 hover:scale-105 ${
                  showPalette ? 'bg-slate-900 text-white' : 'bg-white/92 text-slate-700 ring-1 ring-white/70'
                }`}
              >
                <Palette className="w-4 h-4" />
              </button>

              {showPalette && (
                <div className="absolute bottom-14 right-3 z-30 w-[300px] max-w-[calc(100%-1.5rem)] rounded-2xl bg-white/97 backdrop-blur-md shadow-[0_10px_30px_rgba(30,60,110,0.22)] ring-1 ring-slate-200/80 p-3">
                  <WordnetPaletteControls variant="panel" onClose={() => setShowPalette(false)} />
                </div>
              )}
            </div>

            {/* Study shortcut — white rounded card, vertically centered next to the graph */}
            <div className="lg:self-center relative">
              {/* Check-in pill — floats at the study card's top-right (baicizhan) */}
              {user && (
                <button
                  onClick={doCheckin}
                  disabled={checkingIn}
                  className={`absolute -top-5 right-1 z-10 inline-flex items-center gap-1.5 px-3.5 h-8 rounded-full keyi-glass text-xs font-semibold transition-transform hover:scale-105 active:scale-95 disabled:cursor-default ${
                    checkin?.checkedInToday ? 'text-emerald-600' : 'text-slate-800 '
                  }`}
                  title="每日打卡"
                >
                  {checkingIn
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Calendar className="w-3.5 h-3.5" />}
                  {checkin?.checkedInToday
                    ? `已签 ${checkin.streak} 天`
                    : `打卡 +${checkin?.todayReward ?? 5}`}
                </button>
              )}
              <StudyShortcut />
            </div>
          </motion.div>
        </div>

        {/* Right rail — baicizhan style: one white vertical pill, black icons（按功能开关显隐） */}
        <nav className="hidden md:flex flex-col items-stretch gap-0.5 sticky top-6 rounded-[1.6rem] keyi-glass py-3 px-1.5">
          {railItems.map(item => (
            <RailLink key={item.label} to={item.to} icon={item.icon} label={item.label} badge={item.badge} external={item.external} />
          ))}
        </nav>
      </div>

      {/* Footer — copyright + ICP */}
      <footer className="text-center px-4 pb-24 pt-4 text-xs text-slate-500/80">
        @2026刻忆间隔学习平台 by HZ-CZY&nbsp;&nbsp;|&nbsp;&nbsp;
        <a href="https://beian.miit.gov.cn" target="_blank" rel="noopener noreferrer" className="hover:text-slate-600 transition-colors">
          粤ICP备2026085151号-1
        </a>
      </footer>

      {/* Bottom nav */}
      <BottomNav />

      {/* 学习排行榜弹窗 */}
      <LeaderboardModal open={showLeaderboard} onClose={() => setShowLeaderboard(false)} />
      <TutorSurveyModal open={showTutorSurvey} onClose={() => setShowTutorSurvey(false)} />
      {/* [2026-10-28] 想法弹窗已下线 */}

      {/* ── 打卡面板：连签档位 + 漏签补卡（2026-11-06）───────────── */}
      {checkinPanel && checkin && Array.isArray(checkin.tiers) && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/45 px-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setCheckinPanel(false); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="w-full max-w-sm overflow-hidden rounded-[26px] bg-white shadow-[0_28px_70px_rgba(30,20,70,0.32)]"
          >
            <div className="relative bg-gradient-to-br from-[#6C5CE7] via-[#8B7BF0] to-[#A78BFA] px-5 pb-5 pt-4 text-white">
              <button
                type="button"
                onClick={() => setCheckinPanel(false)}
                className="absolute right-3 top-3 rounded-full p-1.5 text-white/80 hover:bg-white/15"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
              <p className="text-[11.5px] font-semibold tracking-wide text-white/75">每日打卡</p>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className="text-[34px] font-black leading-none tabular-nums">{checkin.streak}</span>
                <span className="text-[13px] font-bold text-white/85">天连续</span>
              </p>
              <p className="mt-1.5 text-[11.5px] font-medium text-white/80">
                {checkin.checkedInToday
                  ? `今天已签，明天能拿 ${checkin.todayReward} 铜板`
                  : `今天还没签，现在签可拿 ${checkin.todayReward} 铜板`}
              </p>
            </div>

            <div className="px-5 py-4">
              {/* 档位表 */}
              <p className="text-[11.5px] font-bold text-slate-400">连续天数奖励</p>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {[...checkin.tiers].sort((a, b) => a.minDays - b.minDays).map((t) => {
                  const reached = checkin.streak >= t.minDays;
                  return (
                    <div
                      key={t.minDays}
                      className={`rounded-2xl px-1 py-2 text-center ring-1 ${
                        reached
                          ? 'bg-violet-50 ring-violet-200'
                          : 'bg-slate-50 ring-slate-100'
                      }`}
                    >
                      <p className={`text-[11px] font-bold ${reached ? 'text-violet-600' : 'text-slate-400'}`}>
                        {t.minDays} 天
                      </p>
                      <p className={`mt-0.5 text-[13px] font-black tabular-nums ${reached ? 'text-violet-700' : 'text-slate-400'}`}>
                        +{t.reward}
                      </p>
                    </div>
                  );
                })}
              </div>
              {checkin.nextTier ? (
                <p className="mt-2 text-[11px] font-semibold text-slate-400">
                  再连 {Math.max(0, checkin.nextTier.minDays - checkin.streak)} 天，每天变成 +
                  {checkin.nextTier.reward}
                </p>
              ) : (
                <p className="mt-2 text-[11px] font-semibold text-amber-600">
                  已达最高档，每天 +30，继续保持
                </p>
              )}

              {/* 补打卡 */}
              <div className="mt-3.5 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11.5px] font-bold text-slate-400">漏签补卡</p>
                  <p className="text-[10.5px] font-semibold text-slate-400">
                    {checkin.backfill.usedThisWeek}/{checkin.backfill.maxPerWeek} 次 · 每次{' '}
                    {checkin.backfill.cost} 铜板
                  </p>
                </div>
                {checkin.backfill.missingDays.length === 0 ? (
                  <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-[11.5px] font-semibold text-emerald-600">
                    最近 7 天没有漏签，继续保持
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {checkin.backfill.missingDays.map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => doBackfill(d)}
                        disabled={!!backfillBusy || checkin.backfill.usedThisWeek >= checkin.backfill.maxPerWeek}
                        className="rounded-xl bg-slate-100 px-2.5 py-1.5 text-[11.5px] font-bold text-slate-600 transition-transform active:scale-95 disabled:opacity-45"
                      >
                        {backfillBusy === d ? '补签中…' : `${d.slice(5)} 补签`}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-[10.5px] leading-relaxed text-slate-400">
                  只算真没来过的日子；那天学过词的系统已经算连签了，不用补。
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* 打卡结果轻提示 */}
      {checkinTip ? (
        <div className="pointer-events-none fixed bottom-24 left-1/2 z-[96] -translate-x-1/2 rounded-full bg-slate-900/88 px-4 py-2 text-[13px] font-bold text-white shadow-lg">
          {checkinTip}
        </div>
      ) : null}


      {/* 888 铜板限时福利弹窗（一次性领取） */}
      {welfareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="relative w-full max-w-sm rounded-3xl glass shadow-soft-lg p-8 text-center">
            <button
              onClick={() => setWelfareModal(false)}
              className="absolute top-3 right-3 p-2 text-gray-400 hover:text-gray-600 hover:bg-white/50 rounded-full transition-colors"
              aria-label="关闭"
              title="稍后领取"
            >
              <X className="w-5 h-5" />
            </button>
            {!welfareSuccess ? (
              <>
                <div className="text-5xl mb-3">🎁</div>
                <h2 className="text-xl font-bold text-slate-900">限时福利</h2>
                <p className="mt-1.5 text-slate-600">
                  登录即领 <span className="font-bold text-orange-500">888 铜板</span>
                </p>
                <button
                  onClick={claimWelfare}
                  disabled={welfareClaiming}
                  className="mt-6 w-full h-12 rounded-2xl bg-gradient-to-r from-orange-400 to-amber-500 text-white font-bold text-lg shadow-[0_6px_16px_rgba(245,158,11,0.4)] hover:scale-[1.02] active:scale-95 transition-transform disabled:opacity-70"
                >
                  {welfareClaiming ? '领取中…' : '领取'}
                </button>
              </>
            ) : (
              <>
                <div className="text-5xl mb-3">🎉</div>
                <h2 className="text-xl font-bold text-emerald-600">领取成功</h2>
                <p className="mt-1.5 text-slate-600">
                  已得 <span className="font-bold text-orange-500">888 铜板</span>
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RailLink({ to, icon, label, badge, external }: { to: string; icon: React.ReactNode; label: string; badge?: string; external?: boolean }) {
  const cls = 'w-[52px] flex flex-col items-center gap-0.5 py-2.5 rounded-2xl text-slate-800 hover:bg-slate-100/80 transition-colors';
  const body = (
    <>
      <span className="relative">
        {icon}
        {/* 角标：贴在图标右上角（「考前突击」限时 / 「刻忆讲题」HOT） */}
        {badge ? (
          <span className="pointer-events-none absolute -top-1.5 -right-2.5 whitespace-nowrap rounded-full bg-rose-500 px-1 py-[1px] text-[8.5px] font-bold leading-[1.25] text-white shadow-[0_1px_4px_rgba(244,63,94,0.45)]">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="text-[10px] font-medium text-slate-600">{label}</span>
    </>
  );
  /* 顶层独立页（如 /tutor-lab）必须整页跳转，交给前端路由会 404 */
  return external
    ? <a href={to} className={cls}>{body}</a>
    : <Link to={to} className={cls}>{body}</Link>;
}

// Reserved for future use; re-exported so tree-shakers don't drop the icon set.
export { Layers };
