import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getDb } from '../db/database';
import { addCoins, getCoins } from '../lib/coins';

/**
 * 888 铜板限时福利路由（一次性领取）。
 *
 * 设计要点：
 *  - welfare_claims 表以 (user_id, type) 为主键，保证每个用户每种活动仅领一次；
 *  - 发币必须走 addCoins（统一账本 coins_ledger），绝不直接 UPDATE users.coins；
 *  - claim 用 better-sqlite3 事务把「记表 + 发币」包成原子操作，防止并发/重复请求导致重复发币。
 */

const router = Router();
router.use(authMiddleware);

/** 本次活动标识（区分不同福利活动，本次固定为 '888'） */
const WELFARE_TYPE = '888';
/** 本次活动发放铜板数 */
const WELFARE_AMOUNT = 888;
/** 账本来源标识，方便对账 */
const WELFARE_SOURCE = 'welfare_888';

/**
 * GET /api/welfare/status
 * 返回该用户本次活动是否已领取，以及活动面额。
 */
router.get('/status', (req: AuthRequest, res) => {
  try {
    const db = getDb();
    const userId = req.userId!;
    const row = db
      .prepare('SELECT 1 FROM welfare_claims WHERE user_id = ? AND type = ?')
      .get(userId, WELFARE_TYPE);
    res.json({ claimed: !!row, amount: WELFARE_AMOUNT });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/welfare/claim
 * 幂等领取。若已领取 → 返回 { claimed:true, balance, already:true } 且不再发币；
 * 否则在事务内「记入福利表 + addCoins 发币」，返回 { claimed:true, balance, amount }。
 */
router.post('/claim', (req: AuthRequest, res) => {
  try {
    const db = getDb();
    const userId = req.userId!;

    // 1) 先查是否已领（正常路径拦截重复点击）
    const existing = db
      .prepare('SELECT 1 FROM welfare_claims WHERE user_id = ? AND type = ?')
      .get(userId, WELFARE_TYPE);
    if (existing) {
      return res.json({ claimed: true, balance: getCoins(userId), already: true });
    }

    // 2) 事务：记表 + 发币 原子提交；并发下若主键冲突（changes=0）视为已领，不重复发币
    const result = db.transaction(() => {
      const info = db
        .prepare(
          'INSERT OR IGNORE INTO welfare_claims (user_id, type, claimed_at) VALUES (?, ?, unixepoch())'
        )
        .run(userId, WELFARE_TYPE);
      if (info.changes === 0) {
        // 并发导致主键冲突（理论上已被上面的 existing 拦截），安全返回已领
        return false;
      }
      const balance = addCoins(userId, WELFARE_AMOUNT, WELFARE_SOURCE, null);
      return balance;
    })();

    if (result === false) {
      return res.json({ claimed: true, balance: getCoins(userId), already: true });
    }

    res.json({ claimed: true, balance: result as number, amount: WELFARE_AMOUNT });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
