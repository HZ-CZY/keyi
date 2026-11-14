import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { AuthRequest, adminMiddleware } from '../middleware/auth';
import { addCoins, getCoins, sumTrainingEarned, todayCn, arenaRemainingToday, ARENA_DAILY_COIN_CAP } from '../lib/coins';
import { ACC_MIN_SAMPLE, accuracyToday, dueProgressPct, qualifiedStreak } from '../lib/study-stats';

/**
 * 铜板经济系统路由（挂载于 /api/coins，外层已套 authMiddleware）。
 *  - GET  /                我的余额、今日训练所得、今日扣费合计
 *  - POST /training/entry  训练场入场扣 6 铜板（每开一轮训练扣一次）
 *  - POST /task/claim      校园小岛每日任务领奖（任务配置读 tasks 表，服务端校验条件与防重复）
 *  - POST /admin/reset-today 清零今日训练场所得（管理接口，内部再套 adminMiddleware）
 *
 * 【2026-09-12 安全修复】原 `POST /training/report` 已移除，原因见该位置注释。
 */
const router = Router();

/** GET /api/coins — 余额与今日铜板统计 */
router.get('/', (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const day = todayCn();
    const db = getDb();
    const spentRow = db
      .prepare('SELECT COALESCE(SUM(-delta), 0) AS s FROM coins_ledger WHERE user_id = ? AND delta < 0 AND day = ?')
      .get(userId, day) as { s: number } | undefined;
    res.json({
      balance: getCoins(userId),
      todayEarned: sumTrainingEarned(userId, day),
      todaySpent: spentRow ? Number(spentRow.s) || 0 : 0,
      arenaRemaining: arenaRemainingToday(userId),
      arenaCap: ARENA_DAILY_COIN_CAP,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 铜板流水来源 → 中文说明 */
const SOURCE_LABELS: Record<string, string> = {
  study_card: '学习答题',
  review_group: '复习奖励',
  arena_entry: '训练场入场',
  arena_correct: '训练场答对',
  arena_refund: '训练场退款',
  training_entry: '训练场入场',
  training_correct: '训练场答对',
  battle_entry: '决斗入场',
  battle_refund: '决斗退款',
  battle_win: '决斗胜利',
  checkin_daily: '每日打卡',
  checkin_backfill: '补打卡',
  village_build: '部落建造',
  village_upgrade: '部落升级',
  village_repair: '部落修复',
  village_demolish: '部落拆除',
  village_bonus: '部落奖励',
  village_mine: '部落矿场收取',
  village_battle: '部落战斗奖励',
  village_refund: '部落升级补偿',
  village_offline: '部落离线收益',
  village_raid_gain: '部落突袭收益',
  village_raid_loss: '部落突袭损失',
  shop_purchase: '商城购买',
  idea_accepted: '想法采纳奖励',
  leech_fix: '系统补偿',
};
function sourceLabel(src: string): string {
  if (SOURCE_LABELS[src]) return SOURCE_LABELS[src];
  if (src.startsWith('island_task:')) return '校园小岛任务';
  return src;
}

/** GET /api/coins/ledger — 我的铜板收支明细（分页，倒序） */
router.get('/ledger', (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const db = getDb();
    const totalRow = db
      .prepare('SELECT COUNT(*) AS c FROM coins_ledger WHERE user_id = ?')
      .get(userId) as { c: number };
    const rows = db
      .prepare(
        'SELECT id, delta, balance, source, day, created_at FROM coins_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?'
      )
      .all(userId, limit, offset) as any[];
    res.json({
      total: totalRow.c,
      items: rows.map((r) => ({
        id: r.id,
        delta: r.delta,
        balance: r.balance,
        source: r.source,
        sourceLabel: sourceLabel(r.source),
        day: r.day,
        createdAt: r.created_at,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/coins/training/entry — 训练场入场扣 6 铜板 */
router.post('/training/entry', (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const mode = typeof req.body?.mode === 'string' ? req.body.mode.slice(0, 20) : '';
    const balance = addCoins(userId, -6, 'training_entry', null);
    res.json({ balance, deducted: 6, mode });
  } catch (err: any) {
    res.status(400).json({ error: err?.message === '铜板不足' ? '铜板不足' : err?.message || '扣费失败' });
  }
});

/**
 * 【2026-09-12 安全修复】原 `POST /api/coins/training/report` 已在此处移除。
 *
 * 移除原因（P0 漏洞）：该端点接受客户端上报的 `correct`（0~20 整数）并直接
 * 调 addCoins 入账，服务端**不做任何答题真伪校验**，也没有每日上限。
 * 任意登录用户只需循环请求 `{"correct": 20}`，即可零成本无限刷铜板，
 * 污染 coins_ledger 账本与排行榜（注释里的「上限 20」只是单次上限，不是每日上限）。
 *
 * 判定为纯攻击面的依据：
 *   - 前端自 /arena 重构（P2 服务端化）后已无任何路由指向旧训练页
 *     （TrainingPageV2.tsx 无路由引用），即无任何合法调用方；
 *   - 竞技场已实现服务端权威结算：出题/判分落在 arena_sessions，
 *     结算走 arena_entry / arena_correct，奖励按服务端记录的 correct_count
 *     封顶题量发放，天然防刷。
 *
 * 若日后需要恢复「训练奖励」，请勿重新引入客户端上报数字的接口，而应改为：
 *   客户端只传 sessionId → 服务端从 arena_sessions 读取 correct_count → 入账。
 */

/** 单个任务奖励的硬上限（2026-11-06 起） */
const MAX_TASK_REWARD = 1000;

/** POST /api/coins/task/claim — 校园小岛每日任务领奖（body: { key }） */
router.post('/task/claim', (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    const day = todayCn();
    const db = getDb();

    // 任务配置从 tasks 表读取（可配置化；查不到或已禁用 → 任务不存在）
    const task = db.prepare('SELECT * FROM tasks WHERE key = ? AND enabled = 1').get(key) as
      | { key: string; type: string; target: number; reward: number; once: number }
      | undefined;
    if (!task) {
      res.status(400).json({ error: '任务不存在' });
      return;
    }
    const reward = Number(task.reward) || 0;
    const target = Number(task.target) || 0;
    /* 【2026-11-06 安全修复】单任务奖励上限。后台任务配置一度被改成 1e9 / 6.6e9 级别，
       领奖接口照单入账，形成天文数字余额。此处兜底：超限直接拒绝，不做截断，
       以免「配置写错但照发一部分」这种更隐蔽的问题。 */
    if (!Number.isFinite(reward) || reward < 0 || reward > MAX_TASK_REWARD) {
      res.status(400).json({ error: '任务奖励配置异常，已拒绝发放' });
      return;
    }

    /* 防重复：once=1 的里程碑任务（连续达标 3/7/14/30 天）**终身只能领一次**，
       流水判定不带日期；其余任务按「当日一次」判定。 */
    const dup = task.once
      ? db
          .prepare('SELECT 1 FROM coins_ledger WHERE user_id = ? AND source = ?')
          .get(userId, `island_task:${key}`)
      : db
          .prepare('SELECT 1 FROM coins_ledger WHERE user_id = ? AND source = ? AND day = ?')
          .get(userId, `island_task:${key}`, day);
    if (dup) {
      res.status(400).json({ error: task.once ? '该奖励已领取过' : '今日已领取过该任务奖励' });
      return;
    }

    // 条件校验（按任务 type 分派；revlog 的“今日”用北京时间口径，与 todayCn()
    // 返回的 YYYY-MM-DD 中国日对齐；target/reward 均来自 DB 配置）
    if (task.type === 'checkin') {
      // 今日打卡存在即通过（checkins.checked_date 存的就是中国日）
      const chk = db
        .prepare('SELECT 1 FROM checkins WHERE user_id = ? AND checked_date = ?')
        .get(userId, day);
      if (!chk) {
        res.status(400).json({ error: '任务尚未完成' });
        return;
      }
    } else if (task.type === 'due') {
      /* 当日「到期卡完成度」≥ target（%）。
         用完成度而不是复习张数：间隔重复讲究「按节奏把到期的复习完」，
         按张数发奖会诱导一天猛刷（提前复习打乱间隔，效果反而更差）。
         完成度是相对指标 —— 卡组大小不同的人都能公平达标，提前猛刷也无法提高它。 */
      if (dueProgressPct(userId) < target) {
        res.status(400).json({ error: '任务尚未完成' });
        return;
      }
    } else if (task.type === 'accuracy') {
      /* 当日复习正确率 ≥ target（%），且样本量 ≥ ACC_MIN_SAMPLE。
         最小样本是硬要求：否则「答 1 张全对」就是 100%。 */
      const a = accuracyToday(userId);
      if (a.total < ACC_MIN_SAMPLE || a.pct < target) {
        res.status(400).json({ error: '任务尚未完成' });
        return;
      }
    } else if (task.type === 'streak') {
      /* 连续「达标日」天数 ≥ target（达标 = 当日复习的不同卡片数 ≥ STREAK_MIN_CARDS）。 */
      if (qualifiedStreak(userId) < target) {
        res.status(400).json({ error: '任务尚未完成' });
        return;
      }
    } else {
      // review：今日 review_type=2 的 revlog ≥ target；learn：今日全部 revlog ≥ target
      const sql =
        task.type === 'review'
          ? "SELECT COUNT(DISTINCT card_id) AS c FROM revlog WHERE user_id = ? AND review_type = 2 AND date(reviewed_at, 'unixepoch', '+8 hours') = ?"
          : "SELECT COUNT(DISTINCT card_id) AS c FROM revlog WHERE user_id = ? AND date(reviewed_at, 'unixepoch', '+8 hours') = ?";
      const row = db.prepare(sql).get(userId, day) as { c: number } | undefined;
      if (!row || (Number(row.c) || 0) < target) {
        res.status(400).json({ error: '任务尚未完成' });
        return;
      }
    }

    // 通过校验 → 入账并记流水（source 形如 island_task:learn20，兼容旧账本）
    const balance = addCoins(userId, reward, `island_task:${key}`);
    res.json({ added: reward, balance });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '领取失败' });
  }
});

/** POST /api/coins/admin/reset-today — 清零今日训练场所得（管理接口） */
router.post('/admin/reset-today', adminMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const day = todayCn();

    const runReset = db.transaction((): { resetUsers: number; totalCoins: number } => {
      const rows = db
        .prepare(
          "SELECT user_id, SUM(delta) AS s FROM coins_ledger WHERE source = 'training_correct' AND day = ? GROUP BY user_id"
        )
        .all(day) as { user_id: number; s: number }[];
      let totalCoins = 0;
      for (const row of rows) {
        const userId = Number(row.user_id);
        const s = Number(row.s) || 0;
        if (!Number.isFinite(userId) || s <= 0) continue;
        const cur = getCoins(userId);
        const next = Math.max(0, cur - s);
        db.prepare('UPDATE users SET coins = ? WHERE id = ?').run(next, userId);
        // 反向流水冲减，保证账目可追溯；排行榜 net 口径下自动与 training_correct 对冲
        db.prepare(
          `INSERT INTO coins_ledger (user_id, delta, balance, source, ref_id, day, created_at)
           VALUES (?, ?, ?, 'admin_reset', NULL, ?, unixepoch())`
        ).run(userId, -s, next, day);
        totalCoins += s;
      }
      return { resetUsers: rows.length, totalCoins };
    });

    res.json(runReset());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/coins/admin/grant-history — 按历史数据一次性补发铜板（管理接口，幂等）。
 *
 * 规则（用户口径，2026-09-08 定义）：
 *  1. 历史每日打卡：checkins 累计天数 × 5
 *  2. 学习完成一张卡（新学走完，以「该卡新学记录中出现 interval>=1 的毕业记录」为里程碑）：× 1
 *  3. 复习：每完成一个「复习组」× 5。组大小 = 该用户 review_per_session（user_settings，缺省 20），
 *     复习组数 = floor(历史复习记录数 / 组大小)
 * 防重复：任何用户账本中已存在 source LIKE 'grant_history%' → 400（本接口只允许执行一次）。
 * 补发对象：全部真实用户（user_id <> 1 系统账号）。
 */
router.post('/admin/grant-history', adminMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const run = db.transaction(() => {
      const existing = db.prepare("SELECT 1 FROM coins_ledger WHERE source LIKE 'grant_history%' LIMIT 1").get();
      if (existing) return { error: '已执行过历史补发，禁止重复' };

      // 各口径核算（SQL 聚合）
      const checkinRows = db
        .prepare('SELECT user_id, COUNT(*) AS c FROM checkins WHERE user_id <> 1 GROUP BY user_id')
        .all() as { user_id: number; c: number }[];
      const studyRows = db
        .prepare(
          "SELECT user_id, COUNT(DISTINCT card_id) AS c FROM revlog WHERE user_id <> 1 AND review_type = 0 AND interval >= 1 GROUP BY user_id"
        )
        .all() as { user_id: number; c: number }[];
      const reviewRows = db
        .prepare('SELECT user_id, COUNT(*) AS c FROM revlog WHERE user_id <> 1 AND review_type = 2 GROUP BY user_id')
        .all() as { user_id: number; c: number }[];

      const today = todayCn();
      const getGroupSize = db.prepare(
        "SELECT value FROM user_settings WHERE user_id = ? AND key = 'review_per_session'"
      );
      const uidSet = new Set<number>([
        ...checkinRows.map((r) => r.user_id),
        ...studyRows.map((r) => r.user_id),
        ...reviewRows.map((r) => r.user_id),
      ]);

      // 快查余额（事务内多次准备无妨）
      const getBal = db.prepare('SELECT coins FROM users WHERE id = ?');
      const setBal = db.prepare('UPDATE users SET coins = ? WHERE id = ?');
      const insLedger = db.prepare(
        `INSERT INTO coins_ledger (user_id, delta, balance, source, ref_id, day, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, unixepoch())`
      );

      const mapOf = (rows: { user_id: number; c: number }[]) => {
        const m = new Map<number, number>();
        for (const r of rows) m.set(Number(r.user_id), Number(r.c) || 0);
        return m;
      };
      const chkMap = mapOf(checkinRows);
      const studyMap = mapOf(studyRows);
      const revMap = mapOf(reviewRows);

      const detail: { uid: number; checkin: number; study: number; reviewGroups: number; total: number }[] = [];
      let totalCoins = 0;
      let grantedUsers = 0;

      for (const uid of Array.from(uidSet).sort((a, b) => a - b)) {
        const ck = chkMap.get(uid) || 0;
        const st = studyMap.get(uid) || 0;
        const rv = revMap.get(uid) || 0;
        const groupSizeRow = getGroupSize.get(uid) as { value: string } | undefined;
        const groupSize = Math.max(1, parseInt(groupSizeRow?.value || '20', 10) || 20);
        const groups = Math.floor(rv / groupSize);

        const d1 = ck * 5;
        const d2 = st * 1;
        const d3 = groups * 5;
        const total = d1 + d2 + d3;
        if (total <= 0) continue;

        let bal = (getBal.get(uid) as { coins: number })?.coins ?? 0;
        const write = (delta: number, source: string) => {
          bal += delta;
          insLedger.run(uid, delta, bal, source, today);
        };
        if (d1 > 0) write(d1, 'grant_history_checkin');
        if (d2 > 0) write(d2, 'grant_history_study');
        if (d3 > 0) write(d3, 'grant_history_review');
        setBal.run(bal, uid);

        totalCoins += total;
        grantedUsers += 1;
        detail.push({ uid, checkin: ck, study: st, reviewGroups: groups, total });
      }

      return { grantedUsers, totalCoins, detail };
    });

    const result = run() as any;
    if (result?.error) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
