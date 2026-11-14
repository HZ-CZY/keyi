import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { todayCn } from '../lib/coins';
import { ACC_MIN_SAMPLE, accuracyToday, dueProgressPct, qualifiedStreak, hasReviewCards } from '../lib/study-stats';

/**
 * 校园小岛每日任务 · 用户端路由（挂载于 /api/tasks，index.ts 挂载处套 authMiddleware；
 * 本文件内 /today 亦显式加 authMiddleware，与项目路由级鉴权风格一致）。
 *  - GET /today  今日任务列表（含每项进度/完成/领取状态，任务配置全部读自 tasks 表）
 */
const router = Router();

interface TaskRow {
  id: number;
  key: string;
  /** 'learn' | 'review' | 'checkin' | 'due' | 'accuracy' | 'streak' */
  type: string;
  title: string;
  target: number;
  reward: number;
  sort: number;
  enabled: number;
  /** 1 = 终身只能领一次（里程碑），0 = 每天一次 */
  once: number;
}

interface TaskView {
  id: number;
  key: string;
  type: string;
  title: string;
  target: number;
  reward: number;
  sort: number;
  progress: number;
  done: boolean;
  claimed: boolean;
  /** due 任务专用：学生没有复习卡时，这条对他「不适用」而非「未完成」 */
  notApplicable?: boolean;
}

/** GET /api/tasks/today — 今日任务列表（仅 enabled=1，按 sort 升序） */
router.get('/today', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const db = getDb();
    const day = todayCn();

    const tasks = db
      .prepare('SELECT * FROM tasks WHERE enabled = 1 ORDER BY sort ASC, id ASC')
      .all() as TaskRow[];

    // 今日口径统计（北京日，与 todayCn() 对齐）
    const checkedIn = !!db
      .prepare('SELECT 1 FROM checkins WHERE user_id = ? AND checked_date = ?')
      .get(userId, day);
    const learnRow = db
      .prepare("SELECT COUNT(DISTINCT card_id) AS c FROM revlog WHERE user_id = ? AND date(reviewed_at, 'unixepoch', '+8 hours') = ?")
      .get(userId, day) as { c: number } | undefined;
    const reviewRow = db
      .prepare(
        "SELECT COUNT(DISTINCT card_id) AS c FROM revlog WHERE user_id = ? AND review_type = 2 AND date(reviewed_at, 'unixepoch', '+8 hours') = ?"
      )
      .get(userId, day) as { c: number } | undefined;
    const learnCount = Number(learnRow?.c) || 0;
    const reviewCount = Number(reviewRow?.c) || 0;

    const hasClaimed = db.prepare(
      'SELECT 1 FROM coins_ledger WHERE user_id = ? AND source = ? AND day = ?'
    );
    const hasClaimedOnce = db.prepare(
      'SELECT 1 FROM coins_ledger WHERE user_id = ? AND source = ?'
    );

    /* 三项由「间隔重复」原理决定的指标，整个请求只算一次；任一失败都不影响其余任务展示。 */
    let duePct = 0;
    let accTotal = 0;
    let accPct = 0;
    let streakDays = 0;
    /** 学生是否有进入复习流程的卡（due 任务是否「不适用」的判据） */
    let hasReview = false;
    try {
      duePct = dueProgressPct(userId);
      hasReview = hasReviewCards(userId);
      const a = accuracyToday(userId);
      accTotal = a.total;
      accPct = a.pct;
      streakDays = qualifiedStreak(userId);
    } catch {
      /* 指标算不出来就按 0 展示，不阻塞任务列表 */
    }

    const result: TaskView[] = tasks.map((t) => {
      const target = Number(t.target) || 0;
      let progress = 0;
      if (t.type === 'checkin') {
        progress = checkedIn ? 1 : 0;
      } else if (t.type === 'due') {
        progress = duePct;
      } else if (t.type === 'accuracy') {
        progress = accPct;
      } else if (t.type === 'streak') {
        progress = streakDays;
      } else if (t.type === 'review') {
        progress = reviewCount;
      } else {
        // learn（默认分支：全部 revlog）
        progress = learnCount;
      }

      /* 正确率任务额外要求**最小样本量**（≥ ACC_MIN_SAMPLE 张）：否则「答 1 张全对」
         就是 100%，条形与奖励都会失真。
         ⚠️ 这个条件必须与服务端 /task/claim 的判定完全一致 ——
            2026-10-15 学生反馈「任务显示可以领取但是领取不了」，
            根因就是前端算了 enoughSample 却没用进 done，两端口径不一致。 */
      const enoughSample = t.type !== 'accuracy' || accTotal >= ACC_MIN_SAMPLE;
      const done = t.type === 'checkin' ? checkedIn : target > 0 && progress >= target && enoughSample;
      const claimed = t.once
        ? !!hasClaimedOnce.get(userId, `island_task:${t.key}`)
        : !!hasClaimed.get(userId, `island_task:${t.key}`, day);

      return {
        id: t.id,
        key: t.key,
        type: t.type,
        title: t.title,
        target,
        reward: Number(t.reward) || 0,
        sort: Number(t.sort) || 0,
        progress,
        done,
        claimed,
        /* 没有复习卡 →「完成今日到期的复习」对他不适用（没有可完成的对象）。
           不这样做的话，前端只会显示「0/80% 去完成」，学生点进去却无事可做，
           既困惑又像是系统坏了。 */
        notApplicable: t.type === 'due' && !hasReview,
      };
    });

    /* 【2026-10-15 按反馈】长期成就（streak）单独分组返回，不再混进每日任务。
       学生反馈「持续复习 30 天为什么算是每日任务」「这怎么完成」——
       30 天里程碑出现在「今日待办」里，看着就像今天必须做完的事，既劝退又误导。
       注意：`tasks` 字段语义仍是「每日任务」，其它调用方（首页红点、一起背任务小车）
       读 `d.tasks` 的行为不变，不会因少了 streak 而报错。 */
    const daily = result.filter((t) => t.type !== 'streak');
    const achievements = result.filter((t) => t.type === 'streak');
    res.json({ date: day, tasks: daily, achievements });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '获取任务失败' });
  }
});

export default router;
