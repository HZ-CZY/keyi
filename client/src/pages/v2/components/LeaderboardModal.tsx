import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, Medal, HelpCircle, Loader2, Zap } from 'lucide-react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { UserBadge } from '../../../components/UserBadge';

interface LbItem {
  rank: number;
  id: number;
  username: string;
  avatar_url: string;
  /** 账号金标文字（排行榜/一起背好友列表里显示金环 + 标签，如「老师」「管理员」） */
  badge_label?: string;
  count: number;
  deck_name?: string;
}

interface LbData {
  range: 'today' | 'total';
  list: LbItem[];
  me: { rank: number | null; count: number; deck_name?: string };
}

/** 背景星点（固定坐标，避免每次渲染抖动） */
const STARS = [
  { t: '8%', l: '12%', s: 2, o: 0.55 }, { t: '14%', l: '78%', s: 3, o: 0.4 },
  { t: '21%', l: '32%', s: 2, o: 0.35 }, { t: '27%', l: '58%', s: 2, o: 0.5 },
  { t: '33%', l: '88%', s: 2, o: 0.45 }, { t: '38%', l: '18%', s: 3, o: 0.3 },
  { t: '46%', l: '68%', s: 2, o: 0.4 }, { t: '52%', l: '42%', s: 2, o: 0.3 },
  { t: '59%', l: '86%', s: 2, o: 0.5 }, { t: '64%', l: '8%', s: 2, o: 0.35 },
  { t: '72%', l: '52%', s: 3, o: 0.28 }, { t: '79%', l: '74%', s: 2, o: 0.4 },
  { t: '85%', l: '24%', s: 2, o: 0.3 }, { t: '91%', l: '62%', s: 2, o: 0.35 },
];

/** 领奖台配置：按 2 / 1 / 3 的顺序渲染 */
const PODIUM = [
  {
    slot: 2, height: 118, avatar: 62,
    grad: 'linear-gradient(180deg,#6E8FE0 0%,#4B6FC4 60%,#3B57A3 100%)',
    ring: '#8FB0F0', badgeBg: '#E2E7FB', badgeText: '#7C82C9',
  },
  {
    slot: 1, height: 156, avatar: 76,
    grad: 'linear-gradient(180deg,#F0B168 0%,#D8884A 55%,#B4652C 100%)',
    ring: '#F5C542', badgeBg: '#FFC94D', badgeText: '#FFFFFF',
  },
  {
    slot: 3, height: 96, avatar: 62,
    grad: 'linear-gradient(180deg,#9B7CE0 0%,#7A58C6 60%,#6444B2 100%)',
    ring: '#B9A6EC', badgeBg: '#F5A65B', badgeText: '#FFFFFF',
  },
];

function Avatar({ url, name, size, ring, badgeLabel = '' }: { url: string; name: string; size: number; ring: string; badgeLabel?: string }) {
  // 账号金标（users.badge_label，如「老师」「管理员」）：金色描边 + 暖光 + 右下角文字标签
  const hasBadge = !!badgeLabel;
  const ringColor = hasBadge ? '#F5B301' : ring;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className="block w-full h-full rounded-full overflow-hidden flex items-center justify-center"
        style={{
          boxShadow: hasBadge
            ? `0 0 0 3px ${ringColor}, 0 0 14px rgba(251,191,36,0.75), 0 6px 16px rgba(0,0,0,0.35)`
            : `0 0 0 3px ${ringColor}, 0 6px 16px rgba(0,0,0,0.35)`,
          background: 'linear-gradient(135deg,#7aa0f0,#4a6fd0)',
        }}
      >
        {url ? (
          <img
            src={url} alt={name}
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <span className="text-white font-bold" style={{ fontSize: size * 0.4 }}>
            {(name || '?').charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      {hasBadge ? <UserBadge size={size} label={badgeLabel} /> : null}
    </span>
  );
}

/** 冠军金色翅膀 */
function GoldWings() {
  return (
    <svg
      viewBox="0 0 160 70"
      className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
      style={{ width: 158, top: -6 }}
    >
      <defs>
        <linearGradient id="wingG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFE08A" />
          <stop offset="100%" stopColor="#E8A02A" />
        </linearGradient>
      </defs>
      <path d="M74 34 C56 8 30 4 12 20 C26 20 34 26 36 38 C48 34 62 34 74 34 Z" fill="url(#wingG)" />
      <path d="M70 42 C54 26 34 24 20 34 C32 34 38 38 40 48 C52 44 62 44 70 42 Z" fill="#F5C542" opacity="0.85" />
      <path d="M86 34 C104 8 130 4 148 20 C134 20 126 26 124 38 C112 34 98 34 86 34 Z" fill="url(#wingG)" />
      <path d="M90 42 C106 26 126 24 140 34 C128 34 122 38 120 48 C108 44 98 44 90 42 Z" fill="#F5C542" opacity="0.85" />
    </svg>
  );
}

function PodiumColumn({ cfg, item }: { cfg: typeof PODIUM[number]; item?: LbItem }) {
  const name = item?.username || '虚位以待';
  const score = item?.count ?? 0;
  return (
    <motion.div
      className="flex flex-col items-center"
      style={{ width: cfg.slot === 1 ? 108 : 96 }}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: cfg.slot === 1 ? 0.05 : cfg.slot === 2 ? 0.12 : 0.19 }}
    >
      {/* 头像（冠军带金翅膀 + 闪电徽章） */}
      <div className="relative flex items-center justify-center" style={{ marginBottom: -6 }}>
        {cfg.slot === 1 && <GoldWings />}
        <div className="relative z-10">
          <Avatar url={item?.avatar_url || ''} name={name} size={cfg.avatar} ring={cfg.ring} badgeLabel={item?.badge_label || ''} />
          {cfg.slot === 1 && (
            <span
              className="absolute -bottom-2 left-1/2 -translate-x-1/2 z-20 w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#FFE08A,#E8A02A)', boxShadow: '0 2px 6px rgba(0,0,0,0.35)' }}
            >
              <Zap className="w-3.5 h-3.5 text-white" fill="white" strokeWidth={0} />
            </span>
          )}
        </div>
      </div>

      {/* 台柱 */}
      <div
        className="relative w-full flex flex-col items-center pt-4"
        style={{
          height: cfg.height,
          background: cfg.grad,
          borderRadius: cfg.slot === 1 ? '54px 54px 12px 12px / 40px 40px 12px 12px' : '48px 48px 10px 10px / 36px 36px 10px 10px',
          boxShadow: 'inset 0 3px 8px rgba(255,255,255,0.28), 0 8px 18px rgba(0,0,0,0.28)',
        }}
      >
        <span
          className="absolute left-1/2 -translate-x-1/2 w-[86%] rounded-full"
          style={{ top: 6, height: 20, background: 'rgba(255,255,255,0.22)' }}
        />
        <span
          className="relative w-8 h-8 rounded-full flex items-center justify-center text-[15px] font-extrabold"
          style={{ background: cfg.badgeBg, color: cfg.badgeText, boxShadow: '0 2px 6px rgba(0,0,0,0.22)' }}
        >
          {cfg.slot}
        </span>
        <span className="relative mt-2 px-2 max-w-[92%] truncate text-[13px] font-semibold text-white">
          {name}
        </span>
        <span
          className="relative mt-0.5 text-[16px] font-extrabold"
          style={{ color: '#FFD75E', textShadow: '0 1px 2px rgba(0,0,0,0.25)' }}
        >
          {score}<span className="text-[12px] font-bold ml-0.5">分</span>
        </span>
      </div>
    </motion.div>
  );
}

/**
 * 学习排行榜弹窗（仿百词斩排行榜）：
 *  - 深色星空背景 + 三座领奖台（2 / 1 / 3）
 *  - TOP20 列表，4 名以后名次为绿色
 *  - 底部固定显示自己的名次
 */
export default function LeaderboardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [range, setRange] = useState<'today' | 'total'>('today');
  const [data, setData] = useState<LbData | null>(null);
  const [loading, setLoading] = useState(false);
  /* 【2026-10-19】说明默认展开：之前是折叠的，学生看不到口径，
     把「今日榜每天 0 点重新统计」误当成「我的积分被重置了」。 */
  const [showHelp, setShowHelp] = useState(true);

  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    api.cards.leaderboard(range)
      .then((d: any) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open, range, user]);

  useEffect(() => {
    if (!open) setShowHelp(false);
  }, [open]);

  const list = data?.list ?? [];
  const top = useMemo(() => [1, 2, 3].map(r => list.find(i => i.rank === r)), [list]);
  const rest = useMemo(() => list.filter(i => i.rank > 3), [list]);
  const me = data?.me;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex flex-col text-white"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.22 }}
          style={{ background: 'linear-gradient(180deg,#2A3A55 0%,#1E2B41 32%,#16202F 100%)' }}
        >
          {/* 星空装饰 */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {STARS.map((s, i) => (
              <motion.span
                key={i}
                className="absolute rounded-full bg-white"
                style={{ top: s.t, left: s.l, width: s.s, height: s.s, opacity: s.o }}
                animate={{ opacity: [s.o * 0.4, s.o, s.o * 0.4] }}
                transition={{ duration: 2.4 + (i % 5) * 0.6, repeat: Infinity, ease: 'easeInOut' }}
              />
            ))}
            <span className="absolute text-[16px] text-[#9FC0F5]/50" style={{ top: '31%', left: '14%' }}>✦</span>
            <span className="absolute text-[12px] text-[#FFD75E]/50" style={{ top: '24%', left: '80%' }}>✦</span>
            <span className="absolute text-[14px] text-[#9FC0F5]/40" style={{ top: '38%', left: '90%' }}>✦</span>
            <span className="absolute text-[11px] text-[#FFD75E]/40" style={{ top: '45%', left: '7%' }}>✦</span>
            <span className="absolute text-[13px] text-[#9FC0F5]/35" style={{ top: '56%', left: '93%' }}>✦</span>
          </div>

          {/* 顶部栏 */}
          <header
            className="relative z-10 shrink-0 px-4 pt-4 pb-3"
            style={{ background: 'linear-gradient(180deg,#26364F 0%,rgba(38,54,79,0) 100%)' }}
          >
            <div className="relative flex items-center justify-between">
              <button
                onClick={onClose}
                className="w-9 h-9 -ml-1 flex items-center justify-center active:scale-90 transition-transform"
                aria-label="返回"
              >
                <ChevronLeft className="w-6 h-6 text-white" strokeWidth={2.6} />
              </button>

              {/* 【2026-10-11】标题文字严格居中：帮助图标用绝对定位挂在标题
                  右缘外侧，不参与容器宽度计算 —— 否则「标题+图标」整体居中会
                  把标题文字本身顶得偏左（实测偏左 11px）。 */}
              <div className="absolute left-1/2 -translate-x-1/2 flex items-center">
                <span className="text-[17px] font-bold whitespace-nowrap">学习排行榜</span>
                <button
                  onClick={() => setShowHelp(v => !v)}
                  className="absolute left-full top-1/2 -translate-y-1/2 ml-2 active:scale-90 transition-transform"
                  aria-label="排行榜说明"
                >
                  <HelpCircle className="w-4 h-4 text-white/70" />
                </button>
              </div>

              <Medal className="w-6 h-6 text-[#F5C542]" strokeWidth={2.2} />
            </div>

            {/* 今日 / 总计 */}
            <div className="mt-3 mx-auto w-fit flex rounded-full p-0.5" style={{ background: 'rgba(255,255,255,0.10)' }}>
              {([['today', '今日'], ['total', '总计']] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setRange(k)}
                  className="px-5 py-1.5 rounded-full text-[13px] font-semibold transition-all"
                  style={
                    range === k
                      ? { background: 'linear-gradient(135deg,#5B8BF5,#3B6BE8)', color: '#fff' }
                      : { color: 'rgba(255,255,255,0.6)' }
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            <AnimatePresence>
              {showHelp && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="mt-2 mx-auto w-fit max-w-[86%] px-3 py-2 rounded-xl text-[12px] leading-5 text-white/80"
                  style={{ background: 'rgba(0,0,0,0.28)' }}
                >
                  积分 = 答对次数 + 训练场收益，两项<b className="text-white/95">每天各最多计 200</b>（防止同一张卡反复刷）；
                  今日榜每天 0 点重新统计，总计榜为累计值。
                </motion.div>
              )}
            </AnimatePresence>
          </header>

          {/* 主体（可滚动） */}
          <main className="relative z-10 flex-1 overflow-y-auto px-4 pb-4">
            {loading ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="w-7 h-7 text-white/60 animate-spin" />
              </div>
            ) : list.length === 0 ? (
              <div className="text-center py-24 text-white/50 text-sm">
                {range === 'today' ? '今天还没有人上榜，快去抢第一' : '暂无积分数据'}
              </div>
            ) : (
              <>
                {/* 领奖台 */}
                <div className="flex items-end justify-center gap-2 pt-6 pb-6">
                  {PODIUM.map(cfg => (
                    <PodiumColumn key={cfg.slot} cfg={cfg} item={top[cfg.slot - 1]} />
                  ))}
                </div>

                {/* 4 名以后 */}
                <div className="space-y-0.5">
                  {rest.map((it, i) => (
                    <motion.div
                      key={it.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.24, delay: 0.05 + i * 0.03 }}
                      className="flex items-center gap-3 py-2.5"
                    >
                      <span
                        className="w-7 text-[16px] font-extrabold text-right flex-shrink-0"
                        style={{ color: '#4CD08D' }}
                      >
                        {it.rank}
                      </span>
                      <Avatar url={it.avatar_url} name={it.username} size={44} ring="rgba(255,255,255,0.18)" badgeLabel={it.badge_label || ''} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[15px] font-semibold text-white truncate">{it.username}</div>
                        {it.deck_name && (
                          <div className="text-[12px] text-white/45 truncate">{it.deck_name}</div>
                        )}
                      </div>
                      <span className="text-[15px] font-bold text-white/85 flex-shrink-0">
                        {it.count} <span className="text-[12px] font-medium text-white/50">分</span>
                      </span>
                    </motion.div>
                  ))}
                </div>

                {/* 不在 TOP20 时补一行显示自己名次 */}
                {me && me.rank && me.rank > 20 && (
                  <div className="mt-4 pt-4 border-t border-white/10 flex items-center gap-3">
                    <span className="w-7 text-[16px] font-extrabold text-right flex-shrink-0" style={{ color: '#4CD08D' }}>
                      {me.rank}
                    </span>
                    <Avatar url={user?.avatar_url || ''} name={user?.username || ''} size={44} ring="rgba(255,255,255,0.18)" badgeLabel={user?.badge_label || ''} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-semibold text-white truncate">{user?.username}</div>
                      {me.deck_name && <div className="text-[12px] text-white/45 truncate">{me.deck_name}</div>}
                    </div>
                    <span className="text-[15px] font-bold text-white/85">
                      {me.count} <span className="text-[12px] font-medium text-white/50">分</span>
                    </span>
                  </div>
                )}
              </>
            )}
          </main>

          {/* 底部我的名次 */}
          {user && (
            <footer
              className="relative z-10 shrink-0 px-4 py-3 flex items-center gap-3"
              style={{ background: '#243349', boxShadow: '0 -4px 14px rgba(0,0,0,0.25)' }}
            >
              <span
                className="w-7 text-[16px] font-extrabold text-right flex-shrink-0"
                style={{ color: me?.rank ? '#4CD08D' : 'rgba(255,255,255,0.45)' }}
              >
                {me?.rank ?? '--'}
              </span>
              <Avatar url={user.avatar_url || ''} name={user.username} size={40} ring="rgba(255,255,255,0.16)" badgeLabel={user.badge_label || ''} />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-white/90 truncate">{user.username}</div>
                <div className="text-[11px] text-white/45 truncate">
                  {me?.deck_name || (me?.rank ? '已上榜' : '还没有积分记录')}
                </div>
              </div>
              <span className="text-[15px] font-bold text-white">
                {me?.count ?? 0} <span className="text-[12px] font-medium text-white/50">分</span>
              </span>
            </footer>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
