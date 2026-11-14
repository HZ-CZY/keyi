import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Swords, Trophy, Medal, Users } from 'lucide-react';
import { api } from '../../lib/api';
import { useFeatureFlags, isFeatureEnabled } from '../../lib/featureFlags';
import BottomNav from './components/BottomNav';
import LeaderboardModal from './components/LeaderboardModal';

/** 单人练习 5 题型（P1 仅作入口胶囊；可练题数后端未提供，统一显示「—」禁止造假） */
const PRACTICE_MODES = [
  { key: 's2m', label: '据句选义' },
  { key: 'm2s', label: '据义选句' },
  { key: 'cloze', label: '挖空默写' },
  { key: 'judge', label: '义项速判' },
  { key: 'couplet', label: '名句接龙' },
];

interface RankTier {
  key: string;
  name: string;
  color: string;
  light: string;
}

/** 段位仅看真人胜场（沿用现有逻辑，见设计稿 5.4）：0-2 青铜 / 3-5 白银 / 6-9 黄金 / 10+ 钻石 */
function rankFromWins(wins: number): RankTier {
  if (wins >= 10) return { key: 'diamond', name: '钻石', color: '#3b82f6', light: '#93c5fd' };
  if (wins >= 6) return { key: 'gold', name: '黄金', color: '#f59e0b', light: '#fcd34d' };
  if (wins >= 3) return { key: 'silver', name: '白银', color: '#94a3b8', light: '#e2e8f0' };
  return { key: 'bronze', name: '青铜', color: '#b45309', light: '#d9a066' };
}

/** 自绘段位徽章（盾牌 + 绶带 + 星） */
function RankBadge({ tier }: { tier: RankTier }) {
  const gid = `rank-grad-${tier.key}`;
  return (
    <svg viewBox="0 0 64 72" className="w-14 h-14 drop-shadow-sm" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tier.light} />
          <stop offset="100%" stopColor={tier.color} />
        </linearGradient>
      </defs>
      <path d="M22 5 L18 27 L31 21 Z" fill={tier.color} opacity="0.85" />
      <path d="M42 5 L46 27 L33 21 Z" fill={tier.color} opacity="0.6" />
      <path
        d="M32 19 L52 27 V40 C52 54 42 62 32 66 C22 62 12 54 12 40 V27 Z"
        fill={`url(#${gid})`}
        stroke="#ffffff"
        strokeWidth="2"
      />
      <path
        d="M32 33 l3 6 6.6 0.9 -4.8 4.7 1.1 6.5 -6-3.2 -6 3.2 1.1-6.5 -4.8-4.7 6.6-0.9 Z"
        fill="#ffffff"
        opacity="0.95"
      />
    </svg>
  );
}

function StatCell({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl bg-slate-50 py-2 text-center">
      <div className="text-lg font-bold text-slate-800 tabular-nums">{value}</div>
      <div className="text-[11px] text-slate-400 mt-0.5">{label}</div>
    </div>
  );
}

interface FeedItem {
  id: number;
  p1Name: string;
  p2Name: string;
  p1Score: number;
  p2Score: number;
  winnerName: string | null;
  isBot: boolean;
  finishedAt: number | null;
}

/** 相对时间：刚刚 / x 分钟前 / x 小时前 / x 天前 */
function relTime(finishedAt: number | null): string {
  if (!finishedAt) return "刚刚";
  const diff = Math.max(0, Date.now() / 1000 - finishedAt);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

/** 实时战报：轮询全站最近结算对局，新条目从顶部滑入（animate-slide-up），最多 6 条 */
function LiveFeed() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api.battles
        .feed(6)
        .then((data: any) => {
          if (!alive) return;
          const list = Array.isArray(data?.feed) ? (data.feed as FeedItem[]) : [];
          const sorted = [...list]
            .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
            .slice(0, 6);
          setFeed(sorted);
          setLoaded(true);
        })
        .catch(() => {
          if (alive) setLoaded(true);
        });
    };
    load();
    const timer = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <section className="rounded-3xl bg-white/90 shadow-soft-lg p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base" role="img" aria-label="fire">🔥</span>
        <h2 className="text-lg font-bold text-slate-800">实时战报</h2>
        <span className="ml-auto text-[11px] text-slate-400">每 4 秒刷新</span>
      </div>
      {!loaded ? (
        <div className="text-sm text-slate-400 py-2">加载中…</div>
      ) : feed.length === 0 ? (
        <div className="text-sm text-slate-400 py-2">暂无对局，快来开一局！</div>
      ) : (
        <ul className="space-y-2">
          {feed.map((item) => {
            const p1Win = item.winnerName != null && item.winnerName === item.p1Name;
            const p2Win = item.winnerName != null && item.winnerName === item.p2Name;
            return (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2 animate-slide-up"
              >
                <div className="flex items-center gap-1.5 text-sm min-w-0">
                  <span className={`truncate ${p1Win ? "font-bold text-primary-600" : "text-slate-700"}`}>
                    {item.p1Name}
                  </span>
                  <span className="text-slate-500 tabular-nums font-medium">{item.p1Score}</span>
                  <span className="text-slate-300">:</span>
                  <span className="text-slate-500 tabular-nums font-medium">{item.p2Score}</span>
                  <span className={`truncate ${p2Win ? "font-bold text-rose-500" : "text-slate-700"}`}>
                    {item.p2Name}
                  </span>
                </div>
                <span className="shrink-0 text-[11px] text-slate-400">{relTime(item.finishedAt)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function ArenaHubPage() {
  const navigate = useNavigate();

  const [coins, setCoins] = useState<number | null>(null);
  const [stats, setStats] = useState<{ total: number; wins: number; losses: number; draws: number } | null>(null);
  const [decks, setDecks] = useState<{ id: number; name: string }[]>([]);
  const [deckId, setDeckId] = useState<number | ''>('');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [home, setHome] = useState<{ today: { questions: number; correct: number; accuracy: number } } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.coins.get().catch(() => null),
      api.battles.stats().catch(() => null),
      api.decks.list().catch(() => []),
      api.arena.home().catch(() => null),
    ]).then(([c, st, d, h]) => {
      if (cancelled) return;
      setCoins(c ? (c as { balance: number }).balance : null);
      setStats(st as { total: number; wins: number; losses: number; draws: number } | null);
      setDecks(Array.isArray(d) ? (d as { id: number; name: string }[]) : []);
      setHome(h as { today: { questions: number; correct: number; accuracy: number } } | null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const tier = rankFromWins(stats?.wins ?? 0);

  // 真人 PK（决斗场）开关：关闭时卡片显示「正在升级优化中」，不再提供匹配入口
  useFeatureFlags();
  const pkEnabled = isFeatureEnabled('battle');

  return (
    <div className="keyi-arena min-h-screen relative overflow-hidden">
      {/* 浅蓝渐变背景 —— 与首页/学习页同款 */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-[#cfe0f4] via-[#bcd3ec] to-[#a9c6e6]" />
        <div className="absolute -top-32 -left-24 w-[36rem] h-[36rem] rounded-full bg-white/45 blur-3xl" />
        <div className="absolute top-1/3 -right-40 w-[32rem] h-[32rem] rounded-full bg-[#eaf2fc]/70 blur-3xl" />
      </div>

      {/* 顶栏：铜板余额 + 段位徽章 + 排行榜入口 */}
      <header className="px-4 md:px-8 pt-5 pb-3 flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-3 h-9 rounded-full bg-white/85 shadow-soft" title="铜板余额">
          <span className="w-3.5 h-3.5 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 ring-2 ring-orange-300/60" />
          <span className="text-sm font-bold text-slate-800 tabular-nums">{coins ?? '—'}</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 pr-1">
          <RankBadge tier={tier} />
          <div className="leading-tight">
            <div className="text-[11px] text-slate-500">段位</div>
            <div className="text-sm font-bold text-slate-800">{tier.name}</div>
          </div>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setShowLeaderboard(true)}
          className="w-10 h-10 rounded-full bg-white/85 shadow-soft flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
          title="排行榜"
          aria-label="排行榜"
        >
          <Trophy className="w-5 h-5 text-amber-500" />
        </button>
      </header>

      {/* 主体 */}
      <div className="px-4 md:px-8 pb-28 space-y-5 max-w-5xl mx-auto">
        <div className="pt-1">
          <h1 className="text-2xl font-bold text-slate-800">竞技场</h1>
          <p className="text-sm text-slate-500 mt-0.5">单人练习 · 真人对战，一个入口搞定</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* 大卡① 单人练习 */}
          <section className="rounded-3xl bg-white/90 shadow-soft-lg p-5">
            <div className="flex items-center gap-2 mb-3">
              <Swords className="w-5 h-5 text-primary-600" />
              <h2 className="text-lg font-bold text-slate-800">单人练习</h2>
            </div>

            <div className="flex flex-wrap gap-2">
          {PRACTICE_MODES.map((m) => (
            <div
              key={m.key}
              className="flex flex-col items-center px-3 py-2 rounded-2xl bg-slate-50 border border-slate-100 min-w-[72px]"
            >
              <span className="text-sm font-medium text-slate-700">{m.label}</span>
              <span className="text-[11px] text-slate-400 mt-0.5">单人训练</span>
            </div>
          ))}

          {/* 今日单人进度（真实数据，来自 GET /api/arena/home） */}
          {home ? (
            <div className="w-full grid grid-cols-2 gap-2 mt-1">
              <div className="rounded-2xl bg-slate-50 py-2 text-center">
                <div className="text-base font-bold text-slate-800 tabular-nums">{home.today.questions}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">今日单人题量</div>
              </div>
              <div className="rounded-2xl bg-slate-50 py-2 text-center">
                <div className="text-base font-bold text-slate-800 tabular-nums">{home.today.accuracy}%</div>
                <div className="text-[11px] text-slate-400 mt-0.5">今日正确率</div>
              </div>
            </div>
          ) : null}
            </div>

            <label className="block mt-4 mb-1 text-sm text-slate-500">选择卡组</label>
            <select
              value={deckId}
              onChange={(e) => setDeckId(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full h-11 rounded-2xl bg-white border border-slate-200 px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-300"
            >
              {decks.length === 0 ? (
                <option value="" disabled>
                  暂无可用卡组（先去添加）
                </option>
              ) : (
                <>
                  <option value="">默认卡组</option>
                  {decks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </>
              )}
            </select>

            <button
              onClick={() => navigate('/arena/practice')}
              className="mt-4 w-full h-12 rounded-2xl bg-primary-600 hover:bg-primary-700 text-white font-semibold shadow-glow-primary transition-all active:scale-[0.98]"
            >
              开始练习
            </button>
          </section>

          {/* 大卡② 真人 PK */}
          <section className="rounded-3xl bg-white/90 shadow-soft-lg p-5">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-5 h-5 text-rose-500" />
              <h2 className="text-lg font-bold text-slate-800">真人 PK</h2>
              {!pkEnabled && (
                <span className="ml-auto px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 text-[11px] font-semibold border border-amber-200">
                  升级优化中
                </span>
              )}
            </div>

            {pkEnabled ? (
              <>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <StatCell label="胜" value={stats?.wins ?? '—'} />
                  <StatCell label="负" value={stats?.losses ?? '—'} />
                  <StatCell label="平" value={stats?.draws ?? '—'} />
                </div>

                <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-600 space-y-1">
                  <div>入场 <b className="text-rose-500">-50</b> 铜板</div>
                  <div>胜利 <b className="text-emerald-600">+100</b> 铜板</div>
                  <div>平局 <b className="text-slate-700">退费</b>（不扣铜板）</div>
                </div>

                <button
                  onClick={() => navigate('/arena/pk')}
                  className="mt-4 w-full h-12 rounded-2xl bg-gradient-to-r from-rose-500 to-orange-500 hover:opacity-90 text-white font-semibold shadow-soft-lg transition-all active:scale-[0.98]"
                >
                  匹配对战
                </button>
              </>
            ) : (
              <div className="rounded-2xl bg-amber-50/70 border border-amber-200/70 px-4 py-6 text-center">
                <p className="text-sm font-semibold text-amber-700">正在升级优化中</p>
                <p className="mt-1 text-[12px] text-amber-600/90 leading-5">
                  真人 PK 板块正在升级优化，暂时关闭<br />可先玩左侧「单人练习」，敬请期待~
                </p>
              </div>
            )}
          </section>
        </div>

        {/* 战绩区块 */}
        <section className="rounded-3xl bg-white/90 shadow-soft-lg p-5">
          <div className="flex items-center gap-2 mb-1">
            <Medal className="w-5 h-5 text-primary-600" />
            <h2 className="text-lg font-bold text-slate-800">战绩</h2>
          </div>
          <div className="text-[11px] text-slate-400 mb-2">单人记录 / 决斗记录</div>
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-left">
                  <th className="px-3 py-2 font-medium">日期</th>
                  <th className="px-3 py-2 font-medium">模式</th>
                  <th className="px-3 py-2 font-medium">结果</th>
                  <th className="px-3 py-2 font-medium">得分</th>
                </tr>
              </thead>
              <tbody className="text-slate-600">
                <tr className="border-t border-slate-100">
                  <td colSpan={4} className="px-3 py-3 text-center text-slate-400">
                    单人练习战绩即将上线（P2 接入 arena_sessions）
                  </td>
                </tr>
                <tr className="border-t border-slate-100">
                  <td colSpan={4} className="px-3 py-3 text-center text-slate-500">
                    决斗本赛季：{stats?.wins ?? 0} 胜 / {stats?.losses ?? 0} 负 / {stats?.draws ?? 0} 平
                    （共 {stats?.total ?? 0} 局）· 逐局明细 P2 上线
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* 实时战报 */}
      <LiveFeed />

      <BottomNav />
      <LeaderboardModal open={showLeaderboard} onClose={() => setShowLeaderboard(false)} />
    </div>
  );
}
