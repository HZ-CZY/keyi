/**
 * Ebbinghaus Forgetting Curve Scheduler — Two-phase learning
 *
 * Phase 1 — MCQ (Multiple Choice):
 *   New cards start here. Quick assessment via correct/incorrect.
 *   3 consecutive correct → promotes to Review phase.
 *   On incorrect → streak resets to 0.
 *
 * Phase 2 — Review:
 *   Three rating options with different Ebbinghaus intervals:
 *     认识 (Know / 3):  Advance to next Ebbinghaus step
 *     模糊 (Fuzzy / 2): Repeat current step
 *     不认识 (DontKnow / 1): Demote back to MCQ phase (streak=0)
 *
 *   Within Review, if a card was demoted from review (queue=3, relearning):
 *     Track consecutive "认识" ratings. After 3 → promote to review (queue=2).
 *
 * Ebbinghaus intervals: 1, 2, 4, 7, 15, 30, 60, 120, 180, 365 days
 */

const EBBINGHAUS_INTERVALS = [1, 2, 4, 7, 15, 30, 60, 120, 180, 365];
const MAX_STEP = EBBINGHAUS_INTERVALS.length - 1;
const PROMOTE_STREAK = 3;   // consecutive correct to promote

const NOW = () => Math.floor(Date.now() / 1000);
const DAY = 86400;

// 计算N天后的凌晨0点时间戳（第二天出现）
function getNextDayDue(days: number): number {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 0, 0, 0);
  return Math.floor(midnight.getTime() / 1000);
}

export interface CardState {
  queue: number;         // 0=MCQ, 2=review, 3=relearning
  due: number;
  interval: number;      // interval in days
  reps: number;
  lapses: number;
  remaining_steps: number; // MCQ streak (phase 0/3) OR Ebbinghaus step (phase 2)
}

export interface NextCardState {
  queue: number;
  due: number;
  interval: number;
  reps: number;
  lapses: number;
  remaining_steps: number;
  leeched: boolean;
}

export interface ReviewLog {
  cardId: number;
  rating: number;        // 1=incorrect/dontknow, 2=fuzzy, 3=correct/know
  interval: number;
  lastInterval: number;
  reviewType: number;
  timeMs: number;
}

export interface NextStatesPreview {
  again: { queue: number; interval: number; label: string };
  hard: { queue: number; interval: number; label: string };
  good: { queue: number; interval: number; label: string };
}

/**
 * Main scheduling function
 */
export function answerCard(
  card: CardState,
  rating: number,        // 1=incorrect/dontknow, 2=fuzzy, 3=correct/know
  timeMs: number = 0
): { card: NextCardState; log: Omit<ReviewLog, 'cardId'> } {
  const now = NOW();

  if (card.queue === 0) {
    // ── MCQ Phase ──
    return handleMcqPhase(card, rating, now);
  } else if (card.queue === 3) {
    // ── Relearning within Review ──
    return handleRelearnPhase(card, rating, now);
  } else {
    // ── Review Phase (queue=2) ──
    return handleReviewPhase(card, rating, now);
  }
}

function handleMcqPhase(card: CardState, rating: number, now: number): { card: NextCardState; log: Omit<ReviewLog, 'cardId'> } {
  const streak = card.remaining_steps || 0;

  if (rating === 3) {
    // Correct! Increment streak
    const newStreak = streak + 1;

    if (newStreak >= PROMOTE_STREAK) {
      // Promote to Review phase, step 0
      const nextState: NextCardState = {
        queue: 2,
        due: getNextDayDue(1),  // first review tomorrow
        interval: EBBINGHAUS_INTERVALS[0],
        reps: card.reps + 1,
        lapses: card.lapses,
        remaining_steps: 0,  // step 0
        leeched: false,
      };
      return {
        card: nextState,
        log: { rating, interval: nextState.interval, lastInterval: card.interval, reviewType: 0, timeMs: 0 },
      };
    } else {
      // Stay in MCQ phase, advance streak
      const nextState: NextCardState = {
        queue: 0,
        due: now,  // due immediately so it shows up again
        interval: 0,
        reps: card.reps + 1,
        lapses: card.lapses,
        remaining_steps: newStreak,
        leeched: false,
      };
      return {
        card: nextState,
        log: { rating, interval: 0, lastInterval: card.interval, reviewType: 0, timeMs: 0 },
      };
    }
  } else {
    // Incorrect — reset streak, stay in MCQ
    const nextState: NextCardState = {
      queue: 0,
      due: now,  // due immediately
      interval: 0,
      reps: card.reps + 1,
      lapses: card.lapses + 1,
      remaining_steps: 0,
      leeched: card.lapses + 1 >= 8,
    };
    return {
      card: nextState,
      log: { rating, interval: 0, lastInterval: card.interval, reviewType: 0, timeMs: 0 },
    };
  }
}

function handleReviewPhase(card: CardState, rating: number, now: number): { card: NextCardState; log: Omit<ReviewLog, 'cardId'> } {
  const step = card.remaining_steps || 0;
  const clampedStep = Math.min(step, MAX_STEP);
  let nextState: NextCardState;

  switch (rating) {
    case 1: // 不认识 — demote to MCQ phase
      nextState = {
        queue: 0,
        due: now,
        interval: 0,
        reps: card.reps + 1,
        lapses: card.lapses + 1,
        remaining_steps: 0,  // streak=0, back to MCQ
        leeched: card.lapses + 1 >= 8,
      };
      break;

    case 2: // 模糊 — repeat current step
      nextState = {
        queue: 2,
        due: getNextDayDue(EBBINGHAUS_INTERVALS[clampedStep]),
        interval: EBBINGHAUS_INTERVALS[clampedStep],
        reps: card.reps + 1,
        lapses: card.lapses,
        remaining_steps: clampedStep,
        leeched: false,
      };
      break;

    case 3: // 认识 — advance to next step
    default:
      const nextStep = Math.min(clampedStep + 1, MAX_STEP);
      nextState = {
        queue: 2,
        due: getNextDayDue(EBBINGHAUS_INTERVALS[nextStep]),
        interval: EBBINGHAUS_INTERVALS[nextStep],
        reps: card.reps + 1,
        lapses: card.lapses,
        remaining_steps: nextStep,
        leeched: false,
      };
      break;
  }

  return {
    card: nextState,
    log: { rating, interval: nextState.interval, lastInterval: card.interval, reviewType: 2, timeMs: 0 },
  };
}

function handleRelearnPhase(card: CardState, rating: number, now: number): { card: NextCardState; log: Omit<ReviewLog, 'cardId'> } {
  const streak = card.remaining_steps || 0;

  if (rating === 3) {
    // 认识 — increment streak
    const newStreak = streak + 1;

    if (newStreak >= PROMOTE_STREAK) {
      // Promote back to review
      const step = Math.max(0, Math.min(Math.round(card.interval > 0 ? Math.log2(card.interval) : 0), MAX_STEP));
      const nextState: NextCardState = {
        queue: 2,
        due: getNextDayDue(EBBINGHAUS_INTERVALS[step]),
        interval: EBBINGHAUS_INTERVALS[step],
        reps: card.reps + 1,
        lapses: card.lapses,
        remaining_steps: step,
        leeched: false,
      };
      return {
        card: nextState,
        log: { rating, interval: nextState.interval, lastInterval: card.interval, reviewType: 3, timeMs: 0 },
      };
    } else {
      // Stay in relearning
      const nextState: NextCardState = {
        queue: 3,
        due: now,
        interval: card.interval,
        reps: card.reps + 1,
        lapses: card.lapses,
        remaining_steps: newStreak,
        leeched: false,
      };
      return {
        card: nextState,
        log: { rating, interval: card.interval, lastInterval: card.interval, reviewType: 3, timeMs: 0 },
      };
    }
  } else {
    // 模糊 or 不认识 — reset streak, stay in relearning
    const nextState: NextCardState = {
      queue: 3,
      due: now,
      interval: card.interval,
      reps: card.reps + 1,
      lapses: card.lapses + (rating === 1 ? 1 : 0),
      remaining_steps: 0,
      leeched: false,
    };
    return {
      card: nextState,
      log: { rating, interval: card.interval, lastInterval: card.interval, reviewType: 3, timeMs: 0 },
    };
  }
}

/**
 * Get next state previews for the UI buttons
 */
export function getNextStatesPreview(queue: number, remainingSteps: number, interval: number): NextStatesPreview {
  if (queue === 0) {
    const streak = remainingSteps || 0;
    const remaining = PROMOTE_STREAK - streak;
    return {
      again: { queue: 0, interval: 0, label: `错误 (还需${Math.max(remaining, 1)}次正确)` },
      hard: { queue: 0, interval: 0, label: `错误 (还需${Math.max(remaining, 1)}次正确)` },
      good: { queue: streak + 1 >= PROMOTE_STREAK ? 2 : 0, interval: 1, label: '正确' },
    };
  } else if (queue === 2) {
    const step = Math.min(remainingSteps || 0, MAX_STEP);
    const nextStep = Math.min(step + 1, MAX_STEP);
    return {
      again: { queue: 0, interval: 0, label: '不认识 → 重新学习' },
      hard: { queue: 2, interval: EBBINGHAUS_INTERVALS[step], label: `${EBBINGHAUS_INTERVALS[step]}天后` },
      good: { queue: 2, interval: EBBINGHAUS_INTERVALS[nextStep], label: `${EBBINGHAUS_INTERVALS[nextStep]}天后` },
    };
  } else {
    // Relearning (queue=3)
    const streak = remainingSteps || 0;
    const remaining = PROMOTE_STREAK - streak;
    return {
      again: { queue: 3, interval: 0, label: `不认识 (还需${Math.max(remaining, 1)}次)` },
      hard: { queue: 3, interval: 0, label: `模糊 (还需${Math.max(remaining, 1)}次)` },
      good: { queue: streak + 1 >= PROMOTE_STREAK ? 2 : 3, interval: 1, label: '认识' },
    };
  }
}

export function getIntervalDays(step: number): number {
  return EBBINGHAUS_INTERVALS[Math.min(step, MAX_STEP)];
}

export function getCurvePoints(): number[] {
  return [...EBBINGHAUS_INTERVALS];
}

export function getRetentionRate(day: number, step: number): number {
  const interval = EBBINGHAUS_INTERVALS[Math.min(step, MAX_STEP)];
  if (interval <= 0) return 1;
  return Math.exp(-day / interval);
}

export { EBBINGHAUS_INTERVALS, PROMOTE_STREAK };
