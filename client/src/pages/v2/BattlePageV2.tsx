import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ImmersiveBackdrop } from './components/ImmersiveQuiz';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import BottomNav from './components/BottomNav';
import BattleLobby from './components/battle/BattleLobby';
import BattleMatching from './components/battle/BattleMatching';
import BattleFailed from './components/battle/BattleFailed';
import ArenaTopBar from './components/battle/ArenaTopBar';
import BattleArena from './components/battle/BattleArena';
import BattleResult from './components/battle/BattleResult';
import BattleFeed from './components/battle/BattleFeed';
import type { LiveEvent } from './components/battle/BattleFeed';
import BattleTaunt, { TauntBubble } from './components/battle/BattleTaunt';
import { BATTLE_DURATION_MS } from './components/battle/useCountdown';
import type { Scene, BattleState, Question, Stats } from './components/battle/types';

/** 染色后停留多久进入下一题 */
const REVEAL_MS = 900;
/** 对局中刷新对手进度的间隔 */
const POLL_MS = 2000;
/** 题数兜底（正常由后端 totalQuestions 下发，本常量仅用于 battle 尚为空时的初始渲染） */
const DEFAULT_TOTAL_QUESTIONS = 5;

export default function BattlePageV2() {
  const [scene, setScene] = useState<Scene>('lobby');
  const [battleId, setBattleId] = useState<number | null>(null);
  const [battle, setBattle] = useState<BattleState | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [qIndex, setQIndex] = useState(0);
  // picked 语义：当前「选中待提交」的选项（真正提交后才由 revealedIndex 染色对错）
  const [picked, setPicked] = useState<number | null>(null);
  const [revealedIndex, setRevealedIndex] = useState<number | null>(null);
  const [stats, setStats] = useState<Stats>({ total: 0, wins: 0, losses: 0, draws: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 当前铜板余额（大厅展示用）
  const [balance, setBalance] = useState<number>(0);

  /* ── 实时战报（2026-10-19）──────────────────────────────────
     事件来源有两处：
       ① 我方提交成功 → 立刻根据 correctIndex 与服务端返回的分数差生成一条；
       ② 轮询到对手有新作答（opponent.answered 增加）→ 从 rounds 里 diff 出来。
     全部只作展示，判分与胜负仍完全由后端决定。 */
  const [liveFeed, setLiveFeed] = useState<LiveEvent[]>([]);
  /** 已播报过的事件键（me:2 / op:2 / lead:a:b），防止每 2 秒轮询重复插入 */
  const feedSeenRef = useRef<Set<string>>(new Set());
  /** 上一次的领先方，用于生成「反超 / 追平」事件 */
  const leadRef = useRef<'me' | 'op' | 'tie' | null>(null);

  /* ── 嘲讽（2026-10-19，商城 battle_taunt 解锁）────────────────
     文案、每局上限、冷却全部由服务端下发；前端只做展示、倒计时与气泡。
     发送成功后本地开始冷却，真实频率仍以服务端 429 为准。 */
  const [tauntCfg, setTauntCfg] = useState<{
    owned: boolean;
    items: { idx: number; text: string }[];
    maxPerBattle: number;
    cooldownSeconds: number;
  } | null>(null);
  const [tauntUsed, setTauntUsed] = useState(0);
  const [tauntCooldownUntil, setTauntCooldownUntil] = useState(0);
  const [tauntSending, setTauntSending] = useState(false);
  const [tauntError, setTauntError] = useState('');
  const [tauntBubble, setTauntBubble] = useState<{ name: string; text: string; key: number } | null>(null);
  /** 已展示过的嘲讽 id，轮询重复返回时不重复弹 */
  const tauntSeenRef = useRef<Set<number>>(new Set());
  const bubbleTimerRef = useRef<number | null>(null);
  const opponentNameRef = useRef('对手');

  // 用 ref 保存 timer，保证卸载时能全部清理
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qIndexRef = useRef(0);
  const answeredRef = useRef(false);
  const aliveRef = useRef(true);
  // busy 的 ref 镜像：避免 setTimeout/闭包里读到过期的 busy 值
  const busyRef = useRef(false);
  // 本轮答案染色（reveal）进行中标记：避免轮询在染色动画期间提前翻下一题
  const revealingRef = useRef(false);
  // scene 的 ref 镜像：定时器回调里判断「是否仍在匹配中」
  const sceneRef = useRef<Scene>('lobby');
  // battleId 的 ref 镜像：卸载清理时知道当前挂在哪个 waiting 局
  const battleIdRef = useRef<number | null>(null);

  /* ── 以下为 UI 层新增状态（不参与任何业务逻辑） ────────────── */

  const navigate = useNavigate();
  const { user } = useAuth();
  const myName = user?.username || '我';
  const avatarUrl = user?.avatar_url || null;

  // 提交中：两段式交互里，点「提交」到后端返回之间禁用重复点击
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  // 「匹配成功」全屏覆盖层 + 3 秒倒计时（纯 UI 延迟，不影响后端计时/结算）
  const [matchCountdown, setMatchCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 本次匹配仅触发一次覆盖层（防重复弹），新一轮 startMatch 时复位
  const matchStartedRef = useRef(false);

  // 对局倒计时的绝对截止时间戳（ms）：
  // 后端 buildState() 目前不返回 started_at / expired_at，这里退化为「进入 playing 时 +300 秒」，
  // 仅作展示；真正的判负 / 结算一律以后端强制结算为准，前端不自行判负。
  const deadlineRef = useRef<number | null>(null);
  const prevSceneRef = useRef<Scene>('lobby');

  const setBusySafe = useCallback((v: boolean) => {
    busyRef.current = v;
    if (aliveRef.current) setBusy(v);
  }, []);

  /** 追加战报：最新的排最前，最多保留 8 条（同 key 只保留一条，防两条路径同时触发） */
  const pushFeed = useCallback((items: LiveEvent[]) => {
    if (!items.length) return;
    setLiveFeed((prev) => {
      const seen = new Set(prev.map((e) => e.key));
      const add = items.filter((e) => !seen.has(e.key));
      if (!add.length) return prev;
      return [...add, ...prev].slice(0, 8);
    });
  }, []);

  /**
   * 从一份对局状态 diff 出新的逐题战报。
   *
   * rounds 是「整局 5 个位置」的固定数组，未答的题也是 false，
   * 所以不能只看 rounds 判对错 —— 必须用 answered 数量界定「哪些题真的答过了」。
   * 老局没有逐题记录（rounds 为空）时直接跳过逐题播报，避免把「未答」误报成「答错」。
   */
  const ingestFeed = useCallback((s: BattleState) => {
    const rounds = s.rounds || [];
    const fresh: LiveEvent[] = [];
    const now = Date.now();

    if (rounds.length > 0) {
      for (let i = 0; i < s.me.answered; i++) {
        const key = `me:${i}`;
        if (feedSeenRef.current.has(key)) continue;
        const r = rounds[i];
        if (!r) continue;
        feedSeenRef.current.add(key);
        fresh.push({
          key,
          tone: r.myCorrect ? 'good' : 'bad',
          text: r.myCorrect ? `你 · 第${i + 1}题 答对 +${r.myPoints}` : `你 · 第${i + 1}题 答错`,
          at: now,
        });
      }
      for (let i = 0; i < s.opponent.answered; i++) {
        const key = `op:${i}`;
        if (feedSeenRef.current.has(key)) continue;
        const r = rounds[i];
        if (!r) continue;
        feedSeenRef.current.add(key);
        fresh.push({
          key,
          tone: r.opCorrect ? 'bad' : 'good',
          text: r.opCorrect ? `对手 · 第${i + 1}题 答对 +${r.opPoints}` : `对手 · 第${i + 1}题 答错`,
          at: now,
        });
      }
    }

    // 领先方变化（含追平）：比分按「我方:对手」显示
    const lead: 'me' | 'op' | 'tie' =
      s.me.score > s.opponent.score ? 'me' : s.me.score < s.opponent.score ? 'op' : 'tie';
    if (leadRef.current !== null && lead !== leadRef.current) {
      const key = `lead:${s.me.score}:${s.opponent.score}`;
      if (!feedSeenRef.current.has(key)) {
        feedSeenRef.current.add(key);
        fresh.push({
          key,
          tone: lead === 'me' ? 'good' : lead === 'op' ? 'bad' : 'neutral',
          text:
            lead === 'tie'
              ? `追平 ${s.me.score}:${s.opponent.score}`
              : lead === 'me'
              ? `你反超 ${s.me.score}:${s.opponent.score}`
              : `对手反超 ${s.opponent.score}:${s.me.score}`,
          at: now,
        });
      }
    }
    leadRef.current = lead;
    pushFeed(fresh);
  }, [pushFeed]);

  /** 新一局开始 / 回大厅：清空战报与去重状态 */
  const resetFeed = useCallback(() => {
    setLiveFeed([]);
    feedSeenRef.current = new Set();
    leadRef.current = null;
  }, []);

  /** 对方嘲讽气泡：3.5 秒自动消失 */
  const showTauntBubble = useCallback((text: string) => {
    setTauntBubble({ name: opponentNameRef.current, text, key: Date.now() });
    if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = window.setTimeout(() => {
      if (aliveRef.current) setTauntBubble(null);
    }, 3500);
  }, []);

  /**
   * 从 state 里 diff 出新嘲讽。
   * 只把「对方发的」弹气泡 + 写战报；自己发的在发送成功时已经本地记过，
   * 这里仅用 tauntUsed 同步次数，避免刷新/换设备后次数不准。
   */
  const ingestTaunts = useCallback((s: BattleState) => {
    const list = s.taunts || [];
    let latestOp: string | null = null;
    // 从旧到新遍历：同一批里最后一条（最新）覆盖气泡
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      if (tauntSeenRef.current.has(t.id)) continue;
      tauntSeenRef.current.add(t.id);
      if (t.from === 'op') {
        latestOp = t.text;
        pushFeed([{ key: `taunt:${t.id}`, tone: 'neutral', text: `对手嘲讽：「${t.text}」`, at: t.at * 1000 }]);
      }
    }
    if (latestOp) showTauntBubble(latestOp);
    if (typeof s.tauntUsed === 'number') setTauntUsed(s.tauntUsed);
  }, [pushFeed, showTauntBubble]);

  /** 发嘲讽：成功后进入本地冷却；失败把服务端的原话显示在面板里 */
  const sendTaunt = useCallback(
    async (idx: number) => {
      if (!battleId || tauntSending) return false;
      setTauntSending(true);
      setTauntError('');
      try {
        const res = await api.battles.taunt(battleId, idx);
        if (!aliveRef.current) return false;
        const max = tauntCfg?.maxPerBattle ?? 3;
        if (typeof res.remaining === 'number') setTauntUsed(Math.max(0, max - res.remaining));
        else setTauntUsed((u) => u + 1);
        setTauntCooldownUntil(Date.now() + (tauntCfg?.cooldownSeconds ?? 8) * 1000);
        tauntSeenRef.current.add(res.id);
        pushFeed([
          { key: `taunt:${res.id}`, tone: 'neutral', text: `你嘲讽：「${res.text}」`, at: Date.now() },
        ]);
        return true;
      } catch (e: any) {
        if (aliveRef.current) setTauntError(e?.message || '发送失败');
        return false;
      } finally {
        if (aliveRef.current) setTauntSending(false);
      }
    },
    [battleId, tauntSending, tauntCfg, pushFeed]
  );

  /** 新一局 / 回大厅：嘲讽相关状态一并复位 */
  const resetTaunt = useCallback(() => {
    tauntSeenRef.current = new Set();
    setTauntUsed(0);
    setTauntCooldownUntil(0);
    setTauntSending(false);
    setTauntError('');
    setTauntBubble(null);
  }, []);

  /* 嘲讽配置：登录后拉一次（是否解锁 + 文案 + 上限） */
  useEffect(() => {
    if (!user) {
      setTauntCfg(null);
      return;
    }
    let alive = true;
    api.battles
      .tauntConfig()
      .then((c) => {
        if (alive) setTauntCfg(c);
      })
      .catch(() => {
        /* 未解锁或接口异常：按钮不显示，不影响对局 */
      });
    return () => {
      alive = false;
    };
  }, [user]);

  // 对手名字进 ref（气泡文案用，避免让 showBubble 依赖整个 battle 对象）
  useEffect(() => {
    opponentNameRef.current = battle?.opponentName || '对手';
  }, [battle?.opponentName]);

  useEffect(() => () => {
    if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
      if (revealRef.current) clearTimeout(revealRef.current);
      if (matchTimeoutRef.current) clearTimeout(matchTimeoutRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      pollRef.current = null;
      revealRef.current = null;
      matchTimeoutRef.current = null;
      countdownRef.current = null;
      // 匹配中直接离开页面（切路由/刷新/关闭）→ 通知后端取消 waiting 局拿回入场费；
      // 请求发不出去也没关系，服务端 30s 清扫兜底（超 60s 自动过期退款）
      if (sceneRef.current === 'matching' && battleIdRef.current != null) {
        api.battles.cancel(battleIdRef.current).catch(() => {});
      }
    };
  }, []);

  // 同步 scene 到 ref（供 65 秒兜底定时器判断）
  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  // 同步 battleId 到 ref（供卸载清理时取消 waiting 局用）
  useEffect(() => {
    battleIdRef.current = battleId;
  }, [battleId]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const stopReveal = useCallback(() => {
    if (revealRef.current) {
      clearTimeout(revealRef.current);
      revealRef.current = null;
    }
  }, []);

  const clearMatchTimeout = useCallback(() => {
    if (matchTimeoutRef.current) {
      clearTimeout(matchTimeoutRef.current);
      matchTimeoutRef.current = null;
    }
  }, []);

  /** 拉取战绩 */
  const loadStats = useCallback(async () => {
    try {
      const s = await api.battles.stats();
      if (aliveRef.current) setStats(s);
    } catch {
      /* 战绩拉取失败不阻塞主流程 */
    }
  }, []);

  /** 拉取铜板余额 */
  const loadCoins = useCallback(async () => {
    try {
      const c = await api.coins.get();
      if (aliveRef.current) setBalance(c.balance);
    } catch {
      /* 余额拉取失败保持 0 */
    }
  }, []);

  useEffect(() => {
    loadStats();
    loadCoins();
  }, [loadStats, loadCoins]);

  /** 拉第 index 题 */
  const loadQuestion = useCallback(async (id: number, index: number) => {
    try {
      const q = await api.battles.question(id, index);
      if (!aliveRef.current) return;
      setQuestion(q);
      setQIndex(index);
      qIndexRef.current = index;
      // 已答过的题（例如刷新页面恢复）：直接显示正确项
      if (q.alreadyAnswered) {
        setPicked(null);
        setRevealedIndex(typeof q.correctIndex === 'number' ? q.correctIndex : null);
      } else {
        setPicked(null);
        setRevealedIndex(null);
      }
      answeredRef.current = false;
    } catch (e: any) {
      if (aliveRef.current) setError(e.message || '题目加载失败');
    }
  }, []);

  /** 进入对局：装载状态 + 起轮询 + 拉当前题 */
  const enterBattle = useCallback(
    (state: BattleState) => {
      setBattle(state);
      if (!aliveRef.current) return;
      setScene('playing');
      stopPolling();
      clearMatchTimeout();
      const id = state.id;
      setBattleId(id);
      // 进场前已有的嘲讽先标记为「已看」：否则刷新页面会把旧消息重新弹一遍
      for (const t of state.taunts || []) tauntSeenRef.current.add(t.id);
      if (typeof state.tauntUsed === 'number') setTauntUsed(state.tauntUsed);

      // 已答完但对手未完 → 只轮询，不拉题
      if (state.me.finished) {
        setQuestion(null);
        answeredRef.current = true;
      } else if (state.opponent.answered >= state.me.answered) {
        // 逐题门控：对手已答到与我方相同进度，可拉当前题
        loadQuestion(id, state.me.answered);
      } else {
        // 对手进度落后：先停留在等待态，待轮询在对手追上后拉题
        setQuestion(null);
      }

      pollRef.current = setInterval(async () => {
        try {
          const s = await api.battles.state(id);
          if (!aliveRef.current) return;
          setBattle(s);
          ingestFeed(s);
          ingestTaunts(s);
          if (s.status === 'finished') {
            stopPolling();
            setBattle(s);
            setScene('result');
            loadStats();
            loadCoins();
            return;
          }
          // 逐题门控：我方已答完当前题、尚未拉下一题，且对手进度已追上 → 拉取下一题
          if (
            s.me.answered < s.totalQuestions &&
            !s.me.finished &&
            qIndexRef.current < s.me.answered &&
            s.opponent.answered >= s.me.answered &&
            !revealingRef.current
          ) {
            loadQuestion(id, s.me.answered);
          }
        } catch {
          /* 轮询失败保持现状，下次继续 */
        }
      }, POLL_MS);
    },
    [clearMatchTimeout, loadQuestion, loadStats, loadCoins, stopPolling, ingestFeed, ingestTaunts]
  );

  /** 开始匹配（入场 50 铜板；无对手 60 秒后端过期退款） */
  const startMatch = useCallback(async () => {
    if (busyRef.current) return;
    setBusySafe(true);
    setError('');
    // 新一轮匹配：复位「匹配成功」覆盖层触发标记（每局仅触发一次），并清掉残留倒计时
    matchStartedRef.current = false;
    resetFeed();
    resetTaunt();
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    if (aliveRef.current) setMatchCountdown(null);
    try {
      const res = await api.battles.match();
      if (!aliveRef.current) return;
      setBattleId(res.battleId);
      if (res.status === 'playing') {
        const s = await api.battles.state(res.battleId);
        if (!aliveRef.current) return;
        beginMatchCountdown(s);
      } else {
        setScene('matching');
        setBattle(null);
        // 兜底：最多等 65 秒，之后即使后端未返回也要展示匹配失败
        clearMatchTimeout();
        matchTimeoutRef.current = setTimeout(() => {
          if (aliveRef.current && sceneRef.current === 'matching') {
            setScene('failed');
          }
        }, 65000);
        // 每 2 秒看一次是否已被真人接走 / 已过期
        stopPolling();
        pollRef.current = setInterval(async () => {
          try {
            const s = await api.battles.state(res.battleId);
            if (!aliveRef.current) return;
            if (s.status === 'playing') {
              stopPolling();
              clearMatchTimeout();
              beginMatchCountdown(s);
            } else if (s.status === 'expired') {
              stopPolling();
              clearMatchTimeout();
              setBattle(s);
              setScene('failed');
              loadCoins();
            }
          } catch {
            /* 忽略单次失败 */
          }
        }, POLL_MS);
      }
    } catch (e: any) {
      if (aliveRef.current) {
        setError(e.message || '匹配失败');
        setScene('lobby');
      }
    } finally {
      setBusySafe(false);
    }
  }, [clearMatchTimeout, enterBattle, loadCoins, setBusySafe, stopPolling, resetFeed, resetTaunt]);

  /** 提交答案 */
  const submitAnswer = useCallback(
    async (choice: number) => {
      if (!battle || !battleId || answeredRef.current) return;
      answeredRef.current = true;
      revealingRef.current = true;
      setPicked(choice);
      try {
        const res = await api.battles.answer(battleId, qIndex, choice);
        if (!aliveRef.current) return;
        setRevealedIndex(res.correctIndex);
        const next: BattleState = {
          ...battle,
          status: res.status,
          me: res.me,
          opponent: res.opponent,
          winnerId: res.winnerId,
        };
        setBattle(next);

        /* 我方本题的即时战报：不等 2 秒轮询，提交成功立刻播报。
           得分差用「服务端返回的新总分 - 旧总分」，不在前端复算 20/10 规则，
           避免先答/后答判定与后端不一致。 */
        const myKey = `me:${qIndex}`;
        if (!feedSeenRef.current.has(myKey)) {
          feedSeenRef.current.add(myKey);
          const correctNow = res.correctIndex === choice;
          const gained = Math.max(0, Number(res.me?.score ?? 0) - Number(battle.me.score ?? 0));
          pushFeed([
            {
              key: myKey,
              tone: correctNow ? 'good' : 'bad',
              text: correctNow
                ? `你 · 第${qIndex + 1}题 答对 +${gained}`
                : `你 · 第${qIndex + 1}题 答错`,
              at: Date.now(),
            },
          ]);
        }
        // 比分会立刻变化，这里补一次领先方判定（逐题明细要等轮询才有）
        ingestFeed(next);

        if (res.status === 'finished') {
          stopPolling();
          stopReveal();
          revealRef.current = setTimeout(() => {
            if (!aliveRef.current) return;
            setScene('result');
            loadStats();
            loadCoins();
          }, REVEAL_MS);
          return;
        }

        // 染色 REVEAL_MS 后进入下一题（逐题门控）
        stopReveal();
        revealRef.current = setTimeout(() => {
          if (!aliveRef.current) return;
          revealingRef.current = false;
          const answered = res.me.answered;
          if (answered >= next.totalQuestions) {
            // 我方已答完全部 → 等对手（由 finished / 强结触发结算页）
            setQuestion(null);
            return;
          }
          // 单题等待：必须等对手也答完同一题（opponent.answered >= 我方已答数）才进下一题
          if (res.opponent.answered >= answered) {
            loadQuestion(battleId, answered);
          } else {
            // 进入「等待对方作答第 k+1 题」状态，题目区清空，由轮询在对手追上后拉题
            setQuestion(null);
          }
        }, REVEAL_MS);
      } catch (e: any) {
        answeredRef.current = false;
        if (aliveRef.current) setError(e.message || '提交答案失败');
      }
    },
    [battle, battleId, loadQuestion, loadStats, loadCoins, qIndex, stopPolling, stopReveal, pushFeed, ingestFeed]
  );

  /** 回到大厅 */
  const backToLobby = useCallback(() => {
    stopPolling();
    stopReveal();
    clearMatchTimeout();
    setScene('lobby');
    setBattle(null);
    setQuestion(null);
    setPicked(null);
    setRevealedIndex(null);
    setBattleId(null);
    answeredRef.current = false;
    submittingRef.current = false;
    setSubmitting(false);
    resetFeed();
    resetTaunt();
    loadStats();
    loadCoins();
  }, [clearMatchTimeout, loadStats, loadCoins, stopPolling, stopReveal, resetFeed, resetTaunt]);

  /** 再来一局：回大厅并立刻重新匹配 */
  const playAgain = useCallback(() => {
    stopPolling();
    stopReveal();
    clearMatchTimeout();
    setScene('lobby');
    setBattle(null);
    setQuestion(null);
    setPicked(null);
    setRevealedIndex(null);
    setBattleId(null);
    answeredRef.current = false;
    submittingRef.current = false;
    setSubmitting(false);
    setBusySafe(false);
    loadStats();
    loadCoins();
    // 延迟一帧再触发匹配，确保上面的状态复位已提交
    setTimeout(() => {
      if (aliveRef.current) startMatch();
    }, 0);
  }, [clearMatchTimeout, loadStats, loadCoins, setBusySafe, startMatch, stopPolling, stopReveal]);

  /**
   * 匹配中取消（修复铜板 bug）：通知后端把 waiting 局标记 cancelled 并立即退还 50 入场费。
   *  - 若取消瞬间已被真人接走（后端返回 playing）→ 直接进对局，不退款（对局已在正常流程）
   *  - 请求失败（断网等）→ 照样回大厅，服务端 30s 清扫兜底（超 60s 自动过期退款）
   */
  const handleCancelMatch = useCallback(async () => {
    const id = battleIdRef.current;
    clearMatchTimeout();
    stopPolling();
    try {
      if (id != null) {
        const r = await api.battles.cancel(id);
        if (aliveRef.current && r?.status === 'playing') {
          const s = await api.battles.state(id);
          if (aliveRef.current) enterBattle(s);
          return;
        }
      }
    } catch {
      /* 网络异常：服务端清扫会兜底退款 */
    }
    if (aliveRef.current) backToLobby();
  }, [backToLobby, clearMatchTimeout, enterBattle, stopPolling]);

  /**
   * 匹配成功 → 全屏「匹配成功」大字 + 3 秒倒计时 → 进入答题。
   * 仅作为 UI 延迟，不影响后端计时/结算；首题仍由 enterBattle 按逐题门控加载。
   * matchStartedRef 保证本次匹配只触发一次；倒计时归 0 才真正 enterBattle。
   */
  const beginMatchCountdown = useCallback(
    (state: BattleState) => {
      if (matchStartedRef.current) return;
      matchStartedRef.current = true;
      setMatchCountdown(3);
      let n = 3;
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        n -= 1;
        if (n <= 0) {
          if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          if (aliveRef.current) setMatchCountdown(null);
          // 3 秒后正式进入答题（加载首题、进入对局）
          enterBattle(state);
        } else if (aliveRef.current) {
          setMatchCountdown(n);
        }
      }, 1000);
    },
    [enterBattle]
  );

  /* 【2026-11-06 好友房】房间已经开打，直接进入对局；
     仍然走 3-2-1 覆盖层，避免两边节奏不一致（一方刚点进来另一方已经在答题）。 */
  const handleRoomReady = useCallback(
    async (id: number) => {
      matchStartedRef.current = false;
      resetFeed();
      resetTaunt();
      setBattleId(id);
      try {
        const s = await api.battles.state(id);
        if (!aliveRef.current) return;
        beginMatchCountdown(s);
      } catch (e: any) {
        setError(e?.message || '进入房间失败');
        setScene('lobby');
      }
    },
    [beginMatchCountdown, resetFeed, resetTaunt]
  );

  /* ── UI 交互包装（只改交互节奏，不改计分 / 接口调用） ──────── */

  /** 第一段：点选项只做「选中」 */
  const handlePick = useCallback((i: number) => {
    if (submittingRef.current) return;
    setPicked(i);
  }, []);

  /** 第二段：点「提交」才真正调用 submitAnswer */
  const handleSubmit = useCallback(() => {
    if (picked === null || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    void Promise.resolve(submitAnswer(picked)).finally(() => {
      submittingRef.current = false;
      if (aliveRef.current) setSubmitting(false);
    });
  }, [picked, submitAnswer]);

  /** 大厅返回：回首页 */
  const handleBackHome = useCallback(() => {
    navigate('/');
  }, [navigate]);

  /* ── 渲染 ───────────────────────────────────────────────── */

  const total = battle?.totalQuestions ?? DEFAULT_TOTAL_QUESTIONS;
  const waitingOpponent = !!battle && battle.me.finished && !battle.opponent.finished;
  const opponentRemain = battle ? Math.max(0, total - battle.opponent.answered) : 0;
  // 逐题等待态：我方已答若干题、对手落后，需等对手答完同一题再进下一题
  const roundWaiting =
    scene === 'playing' &&
    !!battle &&
    question === null &&
    !battle.me.finished &&
    battle.opponent.answered < battle.me.answered;
  const roundNumber = battle ? battle.me.answered + 1 : 1;

  /*
   * 倒计时的截止点：在 scene 切换的那一帧就地算出，避免先用 effect 造成 00:00 闪一下。
   * 优先用服务端时间（一旦后端补上 expiredAt / startedAt 即自动生效），
   * 否则退化为「进入 playing 时 +300 秒」，仅作展示。
   */
  if (prevSceneRef.current !== scene) {
    prevSceneRef.current = scene;
    if (scene === 'playing') {
      let ms: number | null = null;
      if (battle && typeof battle.expiredAt === 'number' && battle.expiredAt > 0) {
        ms = battle.expiredAt * 1000;
      } else if (battle && typeof battle.startedAt === 'number' && battle.startedAt > 0) {
        ms = battle.startedAt * 1000 + BATTLE_DURATION_MS;
      }
      deadlineRef.current = ms ?? Date.now() + BATTLE_DURATION_MS;
    } else {
      deadlineRef.current = null;
    }
  }
  const deadline = deadlineRef.current;

  return (
    <ImmersiveBackdrop>
      {/*
        各幕背景层：只在 BattlePage 内部覆盖，不修改 ImmersiveBackdrop 的默认行为。
        matching 幕自带蓝红斜切背景，故此处跳过。
      */}
      {scene !== 'matching' ? (
        <div className="fixed inset-0 z-0 bg-gradient-to-br from-[#d7c9fb] via-[#b9a6f7] to-[#8e7cf2]" />
      ) : null}

      <div className="keyi-arena-battle relative z-10 min-h-screen w-full">
        {/* 大厅 */}
        {scene === 'lobby' ? (
          <>
            <BattleLobby
              balance={balance}
              stats={stats}
              busy={busy}
              error={error}
              onStart={startMatch}
              onBack={handleBackHome}
              onRoomReady={handleRoomReady}
            />
            <BottomNav solid />
          </>
        ) : null}

        {/* 匹配中 */}
        {scene === 'matching' ? (
          <BattleMatching
            username={myName}
            avatarUrl={avatarUrl}
            badgeLabel={(user as any)?.badge_label || ''}
            wins={stats.wins}
            tierLabel={stats.duel?.tier.label || ''}
            onCancel={() => void handleCancelMatch()}
          />
        ) : null}

        {/* 匹配失败（60 秒未找到对手，已退款） */}
        {scene === 'failed' ? (
          <>
            <BattleFailed error={error} onBack={backToLobby} />
            <BottomNav solid />
          </>
        ) : null}

        {/* 对局 */}
        {scene === 'playing' && battle ? (
          <>
            <ArenaTopBar
              qIndex={qIndex}
              total={total}
              deadline={deadline}
              meScore={battle.me.score}
              meFinished={battle.me.finished}
              myName={myName}
              avatarUrl={avatarUrl}
              badgeLabel={(user as any)?.badge_label || ''}
              opponentName={battle.opponentName}
              opponentScore={battle.opponent.score}
            />
            <BattleFeed events={liveFeed} />
            <BattleArena
              question={question}
              total={total}
              picked={picked}
              revealedIndex={revealedIndex}
              submitting={submitting}
              waitingOpponent={waitingOpponent}
              opponentRemain={opponentRemain}
              roundWaiting={roundWaiting}
              roundNumber={roundNumber}
              error={error}
              onPick={handlePick}
              onSubmit={handleSubmit}
              deadline={battle?.questionDeadline ?? question?.questionDeadline ?? null}
              limitSeconds={battle?.questionSeconds ?? 25}
            />
            {/* 嘲讽入口：仅解锁商城「决斗嘲讽包」后出现 */}
            <BattleTaunt
              owned={!!tauntCfg?.owned}
              items={tauntCfg?.items || []}
              remaining={Math.max(0, (tauntCfg?.maxPerBattle ?? 3) - tauntUsed)}
              cooldownUntil={tauntCooldownUntil}
              sending={tauntSending}
              error={tauntError}
              onSend={sendTaunt}
            />
          </>
        ) : null}

        {/* 结算 */}
        {scene === 'result' && battle ? (
          <>
            <BattleResult
              battle={battle}
              total={total}
              myName={myName}
              avatarUrl={avatarUrl}
              badgeLabel={(user as any)?.badge_label || ''}
              onPlayAgain={playAgain}
              onBack={backToLobby}
            />
            <BottomNav solid />
          </>
        ) : null}
      </div>

      {/* 对方嘲讽气泡：固定屏幕上方，3.5 秒自动消失 */}
      <TauntBubble
        show={scene === 'playing' && !!tauntBubble}
        name={tauntBubble?.name || ''}
        text={tauntBubble?.text || ''}
      />

      {/* 匹配成功全屏覆盖层：3 秒倒计时（3→2→1）后进入答题；z 最高、拦截答题交互 */}
      {matchCountdown !== null && (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm"
          style={{ pointerEvents: 'auto' }}
        >
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="text-center select-none"
          >
            <div
              className="font-extrabold text-white tracking-wide drop-shadow-[0_4px_20px_rgba(0,0,0,0.55)]"
              style={{ fontSize: 'clamp(3rem, 12vw, 8rem)', lineHeight: 1.1 }}
            >
              匹配成功
            </div>
            <div
              className="mt-6 font-bold text-white/95 tabular-nums drop-shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
              style={{ fontSize: 'clamp(4rem, 18vw, 11rem)', lineHeight: 1 }}
            >
              {matchCountdown}
            </div>
          </motion.div>
        </div>
      )}
    </ImmersiveBackdrop>
  );
}
