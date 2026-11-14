import { formatCoins } from '../../../../lib/coins';
import { api } from '../../../../lib/api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronUp, Coins, Trophy, ScrollText, Star, Swords, Copy, Check } from 'lucide-react';
import RankBadge, { rankOf, rankByKey } from './RankBadge';
import BattleLiveFeed from './BattleLiveFeed';
import type { Stats } from './types';

/**
 * 大厅（lobby）——参考图：紫色渐变背景 + 左侧白色玻璃面板 + 右侧模式卡 / 大插画卡。
 *
 * 只读取真实数据：铜板余额 balance、战绩 stats（总场次 / 胜 / 负 / 平）。
 * 段位由 stats.wins 纯前端映射，不写库。
 */

/** 三种模式。
 *  【2026-11-06】第一张「答题PK赛」原来是「敬请期待」占位，现在换成真正可用的
 *  「好友对战」——同一个格子，不再额外占一个按钮的位置。
 *  action 决定点击行为：friend = 打开房间弹层，其余按 soon 走「敬请期待」。 */
const MODE_CARDS: {
  key: string;
  title: string;
  desc: string;
  soon: boolean;
  action: 'friend' | 'none' | 'soon';
}[] = [
  { key: 'friend', title: '好友对战', desc: '开房间邀同学单挑', soon: false, action: 'friend' },
  /* 大乱斗保持原行为（点击无动作，统一从下方「开始匹配」进）——避免误触直接扣 50 铜板 */
  { key: 'brawl', title: '习题大乱斗', desc: '不分章节随机选题', soon: false, action: 'none' },
  { key: 'super', title: '超级挑战赛', desc: '挑战成功获得对方段位', soon: true, action: 'soon' },
];

/** 大厅主视觉卡上的艺术字标题 */
const ARENA_TITLE = '习题 VS 乱斗';

/** 轻量 toast：不引新依赖，1.5 秒自动消失 */
function useToast(): { text: string; show: (t: string) => void } {
  const [text, setText] = useState('');
  const timerRef = useRef<number | null>(null);

  const show = useCallback((t: string) => {
    setText(t);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setText(''), 1500);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    []
  );

  return { text, show };
}

export default function BattleLobby({
  balance,
  stats,
  busy,
  error,
  onStart,
  onBack,
  onRoomReady,
}: {
  balance: number;
  stats: Stats;
  busy: boolean;
  error: string;
  onStart: () => void;
  onBack: () => void;
  /** 好友房开局 / 加入成功：把 battleId 交给父组件，走正常的对局流程 */
  onRoomReady: (battleId: number) => void;
}) {
  const { text: toast, show } = useToast();
  /* 【2026-10-10】战绩明细与玩法规则改为**默认展开**（原来是折叠的，用户要主动点
     底部两个小按钮才看得到，容易以为没有这些信息）。按钮保留，可再点收起。 */
  const [showRecord, setShowRecord] = useState(true);
  const [showRule, setShowRule] = useState(true);

  /* ── 好友开房间（反馈 #21/#70/#71/#72/#95/#155）─────────────────
     房间就是「带邀请码的等待局」，开局后的答题、计分、结算全走原路径。
     这里只负责 创建/加入/等对方 三个动作。 */
  const [roomMode, setRoomMode] = useState<null | 'create' | 'join'>(null);
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [roomBusy, setRoomBusy] = useState(false);
  const [roomError, setRoomError] = useState('');
  const [copied, setCopied] = useState(false);
  const roomPollRef = useRef<number | null>(null);

  const stopRoomPoll = useCallback(() => {
    if (roomPollRef.current) {
      window.clearInterval(roomPollRef.current);
      roomPollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopRoomPoll(), [stopRoomPoll]);

  const closeRoom = useCallback(() => {
    stopRoomPoll();
    setRoomMode(null);
    setRoomCode('');
    setJoinCode('');
    setRoomError('');
    setCopied(false);
  }, [stopRoomPoll]);

  const handleCreateRoom = useCallback(async () => {
    if (roomBusy) return;
    setRoomBusy(true);
    setRoomError('');
    try {
      const r = await api.battles.createRoom();
      setRoomCode(r.roomCode);
      setRoomMode('create');
      // 每 2 秒看一次对方进没进来；进来就直接开打
      stopRoomPoll();
      roomPollRef.current = window.setInterval(async () => {
        try {
          const info = await api.battles.roomInfo(r.roomCode);
          if (info.status === 'playing') {
            stopRoomPoll();
            onRoomReady(info.battleId);
          } else if (info.status === 'expired') {
            stopRoomPoll();
            setRoomError('房间已过期，重新开一个吧');
          }
        } catch {
          /* 单次失败忽略 */
        }
      }, 2000);
    } catch (e: any) {
      setRoomError(e?.message || '开房失败');
      setRoomMode('create');
    } finally {
      setRoomBusy(false);
    }
  }, [roomBusy, onRoomReady, stopRoomPoll]);

  const handleJoinRoom = useCallback(async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) {
      setRoomError('邀请码是 6 位');
      return;
    }
    if (roomBusy) return;
    setRoomBusy(true);
    setRoomError('');
    try {
      const r = await api.battles.joinRoom(code);
      stopRoomPoll();
      onRoomReady(r.battleId);
    } catch (e: any) {
      setRoomError(e?.message || '加入失败');
    } finally {
      setRoomBusy(false);
    }
  }, [joinCode, roomBusy, onRoomReady, stopRoomPoll]);

  const copyCode = useCallback(() => {
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    };
    try {
      void navigator.clipboard.writeText(roomCode).then(done).catch(done);
    } catch {
      done();
    }
  }, [roomCode]);
  /* 【2026-11-06 段位系统】段位改由服务端下发（ELO 积分），
     原来按胜场数纯前端映射：赢 10 场就是钻石，刷人机也能刷上去。
     没有 duel 字段（老接口 / 请求失败）时才退回旧算法。 */
  const duel = stats.duel;
  const meta = rankByKey(duel?.tier.key) || rankOf(stats.wins);
  const notEnough = balance < 50;
  const winRate =
    stats.total > 0 ? Math.round((stats.wins / stats.total) * 100) : 0;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-3 pb-28 sm:pt-4">
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:gap-5">
        {/* ── 左侧：段位面板 ───────────────────────────────── */}
        <aside className="order-1 flex flex-col rounded-[26px] bg-white/80 p-4 shadow-[0_18px_44px_rgba(76,45,140,0.20)] ring-1 ring-white/60 backdrop-blur-xl">
          {/* 返回 + 胶囊标题 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              aria-label="返回首页"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-sm ring-1 ring-slate-200 transition-transform active:scale-95"
            >
              <ChevronLeft className="h-4 w-4 text-slate-500" />
            </button>
            <span className="rounded-full bg-gradient-to-r from-[#7c5cf0] to-[#a78bfa] px-3.5 py-1 text-[13px] font-extrabold tracking-wide text-white shadow-sm">
              决斗场
            </span>
          </div>

          {/* 段位徽章 */}
          <div className="mt-3 flex flex-col items-center">
            <RankBadge wins={stats.wins} tierKey={duel?.tier.key} size={126} />
            <p className="mt-1.5 text-[15px] font-extrabold" style={{ color: meta.edge }}>
              {duel ? duel.tier.label : meta.name}
            </p>
            {/* 段位描述小字：手机端隐藏，给按钮让出安全间距（桌面端保留） */}
            <p className="mt-0.5 hidden text-[11px] text-slate-400 sm:block">{meta.label}</p>

            {/* 积分 + 段内进度 + 排名：让「还差多少升段」变成可见的数字 */}
            {duel ? (
              <div className="mt-2 w-full">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
                  <span className="tabular-nums">{duel.rating} 分</span>
                  <span className="tabular-nums">
                    {duel.rank ? `全站第 ${duel.rank}` : ''}
                  </span>
                </div>
                {duel.tier.key !== 'king' ? (
                  <div className="mt-1 h-[6px] w-full overflow-hidden rounded-full bg-slate-200/80">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.max(3, Math.min(100, duel.tier.progress))}%`,
                        background: `linear-gradient(90deg, ${meta.from}, ${meta.to})`,
                      }}
                    />
                  </div>
                ) : null}
                {duel.placement ? (
                  <p className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1 text-center text-[10.5px] font-semibold text-amber-700 ring-1 ring-amber-100">
                    定级赛还剩 {duel.placementLeft} 场 · 打完才能稳住段位
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* 铜板余额 */}
          <div className="mt-3.5 flex items-center justify-between rounded-2xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-100">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-600">
              <Coins className="h-4 w-4 text-amber-500" />
              铜板余额
            </span>
            <span className="text-[17px] font-extrabold tabular-nums text-slate-800">
              {formatCoins(balance)}
            </span>
          </div>

          {/* 赛季战绩 / 总场次 */}
          <div className="mt-2.5 space-y-2">
            <div className="flex items-center justify-between rounded-2xl bg-white/90 px-3 py-2 shadow-sm ring-1 ring-slate-100">
              <span className="text-[12px] text-slate-500">赛季战绩</span>
              <span className="text-[13px] font-bold tabular-nums text-slate-700">
                {stats.wins} 胜 {stats.losses} 负 {stats.draws} 平
              </span>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/90 px-3 py-2 shadow-sm ring-1 ring-slate-100">
              <span className="text-[12px] text-slate-500">总场次</span>
              <span className="text-[13px] font-bold tabular-nums text-slate-700">
                {stats.total}
              </span>
            </div>
          </div>

          {/* 战绩明细（点「战绩记录」展开，数据全部来自 stats） */}
          {showRecord ? (
            <div className="mt-2 rounded-2xl bg-white/95 p-3 shadow-sm ring-1 ring-slate-100">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-lg font-extrabold text-emerald-600">{stats.wins}</p>
                  <p className="text-[11px] text-slate-400">胜</p>
                </div>
                <div>
                  <p className="text-lg font-extrabold text-slate-500">{stats.draws}</p>
                  <p className="text-[11px] text-slate-400">平</p>
                </div>
                <div>
                  <p className="text-lg font-extrabold text-rose-500">{stats.losses}</p>
                  <p className="text-[11px] text-slate-400">负</p>
                </div>
              </div>
              <p className="mt-2 border-t border-slate-100 pt-2 text-center text-[11px] text-slate-400">
                总场次 {stats.total} · 胜率 {winRate}%
              </p>
            </div>
          ) : null}

          {/* 玩法规则（点「玩法规则」展开，文案与后端结算规则一致） */}
          {showRule ? (
            <p className="mt-2 rounded-2xl bg-white/95 p-3 text-[11.5px] leading-relaxed text-slate-500 shadow-sm ring-1 ring-slate-100">
              入场费 50 铜板：胜者赢 100 铜板，平局退还入场费，败者不退费；匹配 60 秒没找到对手将自动取消并退还
              50。双方作答同一组 10 道文言实词题，得分 = 答对数 + 答对数 × 正确率，四舍五入取整。
            </p>
          ) : null}

          {/* 底部两个小入口（默认展开，点一下可收起；箭头指示当前状态） */}
          <div className="mt-auto flex items-center gap-2 pt-3">
            <button
              type="button"
              onClick={() => setShowRecord(v => !v)}
              aria-expanded={showRecord}
              className="flex flex-1 items-center justify-center gap-1 rounded-full bg-white/80 py-1.5 text-[12px] font-semibold text-slate-500 shadow-sm ring-1 ring-slate-100 transition-colors hover:text-[#7c5cf0]"
            >
              <Trophy className="h-3.5 w-3.5" />
              战绩记录
              <ChevronUp className={`h-3.5 w-3.5 transition-transform ${showRecord ? '' : 'rotate-180'}`} />
            </button>
            <button
              type="button"
              onClick={() => setShowRule(v => !v)}
              aria-expanded={showRule}
              className="flex flex-1 items-center justify-center gap-1 rounded-full bg-white/80 py-1.5 text-[12px] font-semibold text-slate-500 shadow-sm ring-1 ring-slate-100 transition-colors hover:text-[#7c5cf0]"
            >
              <ScrollText className="h-3.5 w-3.5" />
              玩法规则
              <ChevronUp className={`h-3.5 w-3.5 transition-transform ${showRule ? '' : 'rotate-180'}`} />
            </button>
          </div>
        </aside>

        {/* ── 右侧：模式卡 + 主视觉大卡 ─────────────────────── */}
        <section className="order-2 flex flex-col">
          {/* 模式三卡 */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {MODE_CARDS.map(card => (
              <button
                key={card.key}
                type="button"
                onClick={() => {
                  if (card.action === 'friend') {
                    setRoomMode('join');
                    setRoomError('');
                    return;
                  }
                  if (card.action === 'soon') { show('敬请期待'); }
                }}
                className={`relative flex flex-col items-center justify-center rounded-2xl px-2 py-2.5 text-center shadow-sm transition-transform active:scale-[0.98] ${
                  card.soon
                    ? 'bg-white/45 text-slate-400 ring-1 ring-white/50'
                    : 'bg-white text-slate-800 ring-2 ring-[#7c5cf0] shadow-[0_8px_20px_rgba(124,92,240,0.22)]'
                }`}
              >
                <span className="text-[13px] font-extrabold leading-tight">{card.title}</span>
                <span className="mt-0.5 text-[10.5px] leading-tight text-slate-400">
                  {card.desc}
                </span>
                {card.soon ? (
                  <span className="mt-1 rounded-full bg-slate-200/80 px-1.5 py-[1px] text-[9.5px] font-bold text-slate-500">
                    敬请期待
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {/* 主视觉大卡（min-h 手机端 200px：内容实际需要 190.5px，压缩后整页不再把 CTA 顶到 BottomNav 下面） */}
          <div className="relative mt-3 flex min-h-[200px] flex-1 flex-col overflow-hidden rounded-[26px] shadow-[0_18px_44px_rgba(76,45,140,0.28)] ring-1 ring-white/40 sm:min-h-[330px]">
            <img
              src="/battle/arena.jpg"
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            {/* 压暗 + 顶部渐隐，保证叠字可读 */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/10 to-black/55" />

            <div className="relative flex flex-1 flex-col items-center justify-start px-4 pt-4">
              <p className="text-[11.5px] font-medium tracking-wide text-white/90 drop-shadow">
                海量新题目 · 来一较高下
              </p>

              {/* 艺术字：底层紫色描边 + 上层黄色渐变填充 */}
              <div className="mt-3 flex flex-col items-center">
                <span className="relative inline-block select-none">
                  <span
                    aria-hidden
                    className="block whitespace-nowrap text-[30px] font-black italic tracking-wide sm:text-[42px]"
                    style={{
                      WebkitTextStroke: '9px #4b2fa8',
                      WebkitTextFillColor: '#4b2fa8',
                      textShadow: '0 6px 0 rgba(48,22,120,0.55)',
                    }}
                  >
                    {ARENA_TITLE}
                  </span>
                  <span
                    className="absolute inset-0 block whitespace-nowrap text-[30px] font-black italic tracking-wide sm:text-[42px]"
                    style={{
                      backgroundImage:
                        'linear-gradient(180deg,#FFFBE8 0%,#FFD24D 58%,#FFA000 100%)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                    }}
                  >
                    {ARENA_TITLE}
                  </span>
                </span>

                <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-3 py-1 text-[11px] font-bold text-slate-600 shadow-sm">
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                  不限次数
                </span>
              </div>

              {notEnough ? (
                <p className="mt-2 rounded-full bg-rose-500/85 px-3 py-1 text-[11.5px] font-semibold text-white shadow">
                  余额不足 50 铜板，先去训练场赚点铜板吧
                </p>
              ) : null}

              {error ? (
                <p className="mt-2 rounded-full bg-rose-500/85 px-3 py-1 text-[11.5px] font-semibold text-white shadow">
                  {error}
                </p>
              ) : null}
            </div>

            {/*
              底部黄色大胶囊按钮。
              原来是 absolute bottom-4（悬浮在插画上），窄屏下会被 fixed 的 BottomNav 压住；
              改为参与布局的常规流底部块后，卡片高度包含按钮，配合外层 pb-28 的预留，
              任意手机视口下按钮都完整可见、不与 BottomNav 重叠、文字不被截断。
            */}
            <div className="relative flex justify-center px-4 pb-5 pt-1">
              <button
                type="button"
                onClick={onStart}
                disabled={busy || notEnough}
                className="min-w-[190px] whitespace-nowrap rounded-full bg-gradient-to-b from-[#FFD24D] to-[#FFB800] px-10 py-3 text-[17px] font-extrabold text-[#5B3A00] shadow-[0_10px_22px_rgba(255,168,0,0.45)] ring-2 ring-white/70 transition-transform active:scale-95 disabled:opacity-60"
              >
                {busy ? '匹配中…' : '开始匹配'}
              </button>
            </div>
          </div>

          {/* 实时战报：进行中 + 刚结束的对局，每 4 秒刷新（见 BattleLiveFeed） */}
          <BattleLiveFeed />
        </section>
      </div>

      {/* ── 好友房弹层 ─────────────────────────────────────── */}
      {roomMode ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 px-5 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) closeRoom(); }}
        >
          <div className="w-full max-w-sm overflow-hidden rounded-[26px] bg-white shadow-[0_28px_70px_rgba(30,20,70,0.35)]">
            <div className="bg-gradient-to-r from-[#7c5cf0] to-[#a78bfa] px-5 py-4">
              <p className="text-[15px] font-extrabold text-white">
                {roomMode === 'create' ? '房间已创建' : '加入好友的房间'}
              </p>
              <p className="mt-0.5 text-[11.5px] font-medium text-white/80">
                {roomMode === 'create'
                  ? '把邀请码发给同学，他输入后就能开打'
                  : '输入对方给你的 6 位邀请码'}
              </p>
              <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[10.5px] font-bold text-white/90">
                好友对战免费 · 不发铜板 · 不计段位
              </p>
            </div>

            <div className="px-5 py-4">
              {roomMode === 'create' ? (
                <>
                  <div className="flex items-center justify-center gap-2 rounded-2xl bg-slate-50 py-4 ring-1 ring-slate-100">
                    {roomCode.split('').map((ch, i) => (
                      <span
                        key={i}
                        className="flex h-11 w-9 items-center justify-center rounded-xl bg-white text-[22px] font-black tabular-nums text-slate-800 shadow-sm ring-1 ring-slate-200"
                      >
                        {ch}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={copyCode}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl bg-slate-100 py-2.5 text-[13px] font-bold text-slate-600 active:scale-[0.98]"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                    {copied ? '已复制' : '复制邀请码'}
                  </button>
                  <p className="mt-3 flex items-center justify-center gap-1.5 text-[11.5px] font-semibold text-slate-400">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                    等待对方加入…（10 分钟内有效）
                  </p>
                </>
              ) : (
                <input
                  value={joinCode}
                  onChange={(e) => {
                    setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
                    setRoomError('');
                  }}
                  placeholder="6 位邀请码"
                  autoFocus
                  className="w-full rounded-2xl bg-slate-50 px-4 py-3 text-center text-[22px] font-black tracking-[0.35em] uppercase text-slate-800 outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-[#7c5cf0]"
                />
              )}

              {roomError ? (
                <p className="mt-2.5 rounded-xl bg-rose-50 px-3 py-2 text-center text-[11.5px] font-semibold text-rose-600">
                  {roomError}
                </p>
              ) : null}

              <div className="mt-4 flex gap-2.5">
                {roomMode === 'join' ? (
                  <button
                    type="button"
                    onClick={handleJoinRoom}
                    disabled={roomBusy || joinCode.length !== 6}
                    className="flex-1 rounded-2xl bg-gradient-to-b from-[#FFD24D] to-[#FFB800] py-3 text-[14.5px] font-extrabold text-[#5B3A00] shadow-md active:scale-[0.98] disabled:opacity-50"
                  >
                    {roomBusy ? '加入中…' : '进入房间'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    if (roomMode === 'create') { closeRoom(); return; }
                    // 从「加入」切到「自己开一间」
                    void handleCreateRoom();
                  }}
                  className="flex-1 rounded-2xl bg-[#7c5cf0] py-3 text-[14.5px] font-extrabold text-white shadow-md active:scale-[0.98]"
                >
                  {roomMode === 'create' ? '关闭' : (roomBusy ? '创建中…' : '自己开一间')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* toast */}
      {toast ? (
        <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900/85 px-4 py-2 text-[13px] font-semibold text-white shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
