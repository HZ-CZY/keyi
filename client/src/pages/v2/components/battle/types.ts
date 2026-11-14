/**
 * 决斗场前端共享类型（从 BattlePageV2 抽出的纯类型定义，字段与后端一致，未新增）。
 */

/** 五幕状态机：大厅 → 匹配中 → 对局 → 结算 / 匹配失败 */
export type Scene = 'lobby' | 'matching' | 'playing' | 'result' | 'failed';

/** GET /battles/:id 返回的某一方状态 */
export interface SideState {
  answered: number;
  correct: number;
  score: number;
  finished: boolean;
}

/**
 * GET /battles/:id 返回的对局状态。
 *
 * 注：后端 buildState() 目前只返回下面这些字段，不含 started_at / expired_at，
 * 所以 startedAt / expiredAt 声明为可选——一旦后端补上，前端倒计时会自动改用服务端时间。
 */
export interface BattleState {
  id: number;
  status: 'waiting' | 'playing' | 'finished' | 'expired' | 'cancelled';
  /** 好友房（私房）：免费、无铜板奖励、不计段位分（2026-11-12） */
  isPrivate?: boolean;
  totalQuestions: number;
  side: 'p1' | 'p2';
  opponentName: string;
  me: SideState;
  opponent: SideState;
  winnerId: number | null;
  /** 逐题得分明细（新赛制）：长度 = totalQuestions，未双方都答的题 points 为已确定部分 */
  rounds?: RoundInfo[];
  /** 对局开始时间（Unix 秒）——后端暂未返回 */
  startedAt?: number | null;
  /** 强制结算时间（Unix 秒）——后端暂未返回 */
  expiredAt?: number | null;
  /** 我方当前题的截止时刻（ms 时间戳）；null = 未开始计时或已答完（单题限时用） */
  questionDeadline?: number | null;
  /** 单题限时秒数 */
  questionSeconds?: number;
  /** 本局嘲讽记录（最新在前）：前端只把 from==='op' 的弹成气泡 */
  taunts?: Array<{ id: number; from: 'me' | 'op'; text: string; at: number }>;
  /** 我方本局已发嘲讽次数（算剩余次数用） */
  tauntUsed?: number;
}

/** GET /battles/:id/question/:index 返回的题目 */
export interface Question {
  index: number;
  stem: string;
  source: string;
  keyword: string;
  options: string[];
  alreadyAnswered: boolean;
  myChoice: number | null;
  correctIndex?: number;
  /** 本题截止时刻（ms）；单题限时用 */
  questionDeadline?: number | null;
  /** 单题限时秒数 */
  questionSeconds?: number;
}

/** 段位信息（GET /battles/stats 的 duel 字段，由服务端 lib/duel-rating.ts 计算） */
export interface DuelTierInfo {
  key: string;
  name: string;
  color: string;
  /** 段内小段（IV/III/II/I），王者为空串 */
  sub: string;
  /** 完整名，如「黄金 II」 */
  label: string;
  /** 段内进度 0-100 */
  progress: number;
  min: number;
  max: number;
}

export interface DuelProfile {
  rating: number;
  peakRating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winStreak: number;
  winRate: number;
  /** 定级赛未满 10 场 */
  placement: boolean;
  placementLeft: number;
  tier: DuelTierInfo;
  rank: number | null;
  total: number | null;
}

/** GET /battles/stats 返回的战绩 */
export interface Stats {
  total: number;
  wins: number;
  losses: number;
  draws: number;
  /** 段位系统（2026-11-06）：旧接口无此字段，前端需容错 */
  duel?: DuelProfile;
}

/** 单题逐题得分明细（后端 scoreBattle 输出，与 rounds 对应） */
export interface RoundInfo {
  /** 我方本题是否答对 */
  myCorrect: boolean;
  /** 对手本题是否答对 */
  opCorrect: boolean;
  /** 我方本题得分：先对 20 / 后对 10 / 错 0 */
  myPoints: number;
  /** 对手本题得分 */
  opPoints: number;
}
