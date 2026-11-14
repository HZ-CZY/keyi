import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { answerCard, getNextStatesPreview, CardState } from '../scheduler/ebbinghaus';
import { cnDateStr, CN_SQL_MODIFIER, cnTodayWindow , shiftDay } from '../lib/dates';
import { addCoins, getCoins, todayCn } from '../lib/coins';
/* 学识矿脉（刻忆觉醒的 goldmine 建筑）的学习加成 —— 服务端读玩家自己的存档算倍率，
   客户端改本地等级刷不出来（2026-09-30 从线上 dist 回填进源码） */
import { getStudyBonusMultiplier } from './village';
import { studyCoinsToday } from '../lib/study-stats';

/**
 * 卡片学习奖励的每日上限（铜板）。理由见 `/:id/answer` 发币处。
 * 取 80：全站日均复习约 50 张/人，正常学生够用；猛刷到 300 张也只拿 80，
 * 收益与「刷量」脱钩 —— 这是间隔重复平台的应有取向。
 */
const DAILY_STUDY_COIN_CAP = 80;

/**
 * 【2026-10-19】清理学习币领取记录。
 *
 * study_coin_claims 只用于「当天判重」——发币时查 (user, card, round, 今天)。
 * 全站每天最多写「人数 × 卡片数」行（约 3 千~13 万行），不清会一直涨。
 * 这里每 6 小时顺手删一次 7 天前的记录：判重只看当天，7 天足够，
 * 也留了一点余量给「跨天补答案」这种边缘情况。
 */
let _claimsCleanAt = 0;
function cleanupStudyClaims(db: any): void {
  const now = Date.now();
  if (now - _claimsCleanAt < 6 * 3600 * 1000) return;
  _claimsCleanAt = now;
  try {
    const cutoff = new Date(now - 7 * 86400 * 1000).toISOString().slice(0, 10);
    db.prepare('DELETE FROM study_coin_claims WHERE day < ?').run(cutoff);
  } catch { /* 清理失败不影响发币 */ }
}

/** ④ 攻克难点的门槛：这张卡至少反复答错过多少次，才算「难点卡」 */
const LEECH_MIN_LAPSES = 5;
/** ④ 攻克难点需要连续答对多少次 */
const LEECH_STREAK = 3;

const router = Router();
router.use(authMiddleware);

// Convert **text** → <b> and ==text== → highlighted span
function renderMarkup(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/==([^=]+)==/g, '<span class="mark-highlight">$1</span>');
}

// Extract the bold keyword (重点字) from card front text, e.g. "**爱**其子" or "今其智<b>**乃**</b>反不能也" → "爱" / "乃"
// Returns null when no bold keyword (cards without a focus character don't participate in keyword pools)
function extractKeywordFromFront(front: string): string | null {
  if (!front) return null;
  const m = front.match(/\*\*([^*]+)\*\*/);
  if (!m) return null;
  const kw = m[1].replace(/<[^>]+>/g, '').trim();
  return kw && kw.length >= 1 && kw.length <= 6 ? kw : null;
}

// Generate MCQ options for cards in MCQ phase (queue=0)
// distractorsPool: merged pool (original deck first, then current deck, then all cards)
function generateMcqOptions(card: any, fields: string[], distractorsPool: string[]): { options: { label: string; text: string; isCorrect: boolean }[]; correctAnswer: string } | null {
  if (card.notetype_name === '选择题') {
    const answerLetter = (fields[5] || '').trim().toUpperCase();
    const optIdx = { 'A': 1, 'B': 2, 'C': 3, 'D': 4 }[answerLetter];
    if (optIdx === undefined) return null;
    const labels = ['A', 'B', 'C', 'D'];
    const options = labels.map((label, i) => ({
      label,
      text: fields[i + 1] || '',
      isCorrect: label === answerLetter,
    }));
    return { options, correctAnswer: answerLetter };
  }

  const correctText = fields[1] || fields[0] || '';
  const correctLen = correctText.length;

  // Deduplicate and filter
  const unique = [...new Set(distractorsPool.filter(d => d && d !== correctText && d.length > 0 && d.length < 100))];
  // Score by length similarity, then shuffle top candidates
  const scored = unique.map(d => ({ text: d, score: Math.abs(d.length - correctLen) }));
  // Shuffle to break ties randomly
  for (let i = scored.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [scored[i], scored[j]] = [scored[j], scored[i]];
  }
  scored.sort((a, b) => a.score - b.score);
  // Pick 3 from top 8 randomly
  const topN = Math.min(scored.length, 8);
  const pool = scored.slice(0, topN);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const distractors = pool.slice(0, 3).map(d => d.text);

  while (distractors.length < 3) {
    distractors.push(`其他答案 ${distractors.length + 1}`);
  }

  const allTexts = [correctText, ...distractors];
  const labels = ['A', 'B', 'C', 'D'];
  for (let i = allTexts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allTexts[i], allTexts[j]] = [allTexts[j], allTexts[i]];
  }
  const correctLabel = labels[allTexts.indexOf(correctText)];
  const options = allTexts.map((text, i) => ({
    label: labels[i],
    text,
    isCorrect: labels[i] === correctLabel,
  }));
  return { options, correctAnswer: correctLabel };
}

// Get due cards for review
router.get('/due', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deckId = req.query.deck_id ? parseInt(req.query.deck_id as string) : null;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    let query = `
      SELECT c.*, n.fields, n.tags, n.notetype_id, nt.name as notetype_name,
             nt.css, nt.template_q_format, nt.template_a_format, nt.field_names
      FROM cards c
      JOIN notes n ON n.id = c.note_id
      JOIN notetypes nt ON nt.id = n.notetype_id
      WHERE c.user_id = ?
    `;
    const params: any[] = [req.userId];

    if (deckId) {
      query += ' AND c.deck_id = ?';
      params.push(deckId);
    }

    // 【2026-09-22 修「复习不了」】mode 参数：
    //   mode=review → 只取到期复习卡（queue 2/3），按到期时间排序（复习页必须用它，
    //                 否则新卡会把 limit 占满 → 复习页过滤 queue>=2 后为空）
    //   mode=new    → 只取新卡（queue=0）
    //   不传 → 保持老行为（新卡优先），兼容未更新的客户端缓存
    const mode = String(req.query.mode || '');
    if (mode === 'review') {
      query += ` AND c.queue IN (2, 3) AND c.due <= unixepoch()
                 ORDER BY c.due ASC, c.id ASC LIMIT ?`;
    } else if (mode === 'new') {
      query += ` AND c.queue = 0 ORDER BY c.id ASC LIMIT ?`;
    } else {
      query += ` AND (
        (c.queue = 0) OR
        (c.queue IN (1, 3) AND c.due <= unixepoch()) OR
        (c.queue = 2 AND c.due <= unixepoch())
      ) ORDER BY c.queue ASC, c.due ASC LIMIT ?`;
    }
    params.push(limit);

    const cards = db.prepare(query).all(...params);

    // Generate MCQ options pool
    // originalDeckPool: from the card's original small deck (primary)
    // currentDeckPool: from the current deck (fallback)
    // allCardsPool: from all user's cards (final fallback)
    const cardIds = (cards as any[]).map(c => c.id);

    const extractFields = (r: any): string => {
      try {
        const f = JSON.parse(r.fields);
        return Array.isArray(f) ? (f[1] || f[0] || '') : String(r.fields);
      } catch { return String(r.fields); }
    };
    const filterValid = (t: string) => t && t.length > 0 && t.length < 100;

    // Build pools per original_deck_id
    const originalDeckPools = new Map<number, string[]>();
    const currentDeckPools = new Map<number, string[]>();
    // Keyword pools: 重点字卡组 — group answer texts by bold keyword (e.g. **爱**) in the front field
    const keywordPools = new Map<string, string[]>();

    // For cards with NULL original_deck_id, resolve via source_note_id
    // Notes in merged decks point back to their source note in the original small deck
    const noteIdToOriginalDeck = new Map<number, number>();
    const cardsNeedingResolution = (cards as any[]).filter(c => !c.original_deck_id);
    if (cardsNeedingResolution.length > 0) {
      const noteIds = cardsNeedingResolution.map(c => c.note_id);
      const placeholders = noteIds.map(() => '?').join(',');
      const sourceRows = db.prepare(`
        SELECT un.id as note_id, sc.deck_id as source_deck_id
        FROM notes un
        JOIN notes an ON an.guid = un.guid AND an.user_id = 2
        JOIN cards sc ON sc.note_id = an.source_note_id AND sc.user_id = 2
        WHERE un.id IN (${placeholders}) AND an.source_note_id IS NOT NULL
      `).all(...noteIds) as any[];
      for (const row of sourceRows) {
        noteIdToOriginalDeck.set(row.note_id, row.source_deck_id);
      }
    }

    if (cardIds.length > 0) {
      // Resolve effective original_deck_id for each card
      const getEffectiveOriginalDeckId = (c: any): number | null => {
        if (c.original_deck_id) return c.original_deck_id;
        const resolvedDeckId = noteIdToOriginalDeck.get(c.note_id);
        return resolvedDeckId || null;
      };

      // Group cards by resolved original_deck_id and deck_id
      const originalDeckIds = [...new Set(
        (cards as any[]).map(c => getEffectiveOriginalDeckId(c)).filter(Boolean)
      )] as number[];
      const currentDeckIds = [...new Set((cards as any[]).map(c => c.deck_id))];

      // Fetch from original small decks
      for (const odId of originalDeckIds) {
        const rows = db.prepare(`
          SELECT n.fields FROM cards c
          JOIN notes n ON n.id = c.note_id
          WHERE c.deck_id = ? AND c.user_id = ?
          ORDER BY RANDOM() LIMIT 40
        `).all(odId, req.userId) as any[];
        originalDeckPools.set(odId, rows.map(extractFields).filter(filterValid));
      }

      // Fetch from current decks
      for (const cdId of currentDeckIds) {
        const rows = db.prepare(`
          SELECT n.fields FROM cards c
          JOIN notes n ON n.id = c.note_id
          WHERE c.deck_id = ? AND c.user_id = ?
          ORDER BY RANDOM() LIMIT 40
        `).all(cdId, req.userId) as any[];
        currentDeckPools.set(cdId, rows.map(extractFields).filter(filterValid));
      }

      // Fetch from all user's cards (final fallback)
      const allCardsRows = db.prepare(`
        SELECT n.fields FROM cards c
        JOIN notes n ON n.id = c.note_id
        WHERE c.user_id = ?
        ORDER BY RANDOM() LIMIT 80
      `).all(req.userId) as any[];
      var allCardsPool = allCardsRows.map(extractFields).filter(filterValid);

      // Build keyword pools: group answer texts by the bold keyword (重点字) in the front field.
      // Same-keyword cards make the best distractors (e.g. all cards containing **爱**),
      // so MCQ distractors prioritize the same focus-character group over deck/all-card pools.
      const kwRows = db.prepare(`
        SELECT n.fields FROM cards c
        JOIN notes n ON n.id = c.note_id
        WHERE c.user_id = ?
        ORDER BY RANDOM() LIMIT 500
      `).all(req.userId) as any[];
      for (const r of kwRows) {
        let f: string[];
        try {
          f = JSON.parse(r.fields);
          if (!Array.isArray(f)) f = String(r.fields).split('\x1f');
        } catch {
          f = String(r.fields).split('\x1f');
        }
        const kw = extractKeywordFromFront(f[0] || '');
        if (!kw) continue;
        const text = (f[1] || f[0] || '').trim();
        if (!filterValid(text)) continue;
        if (!keywordPools.has(kw)) keywordPools.set(kw, []);
        const arr = keywordPools.get(kw)!;
        if (arr.length < 30 && !arr.includes(text)) arr.push(text);
      }
    }

    // Get notes data for display
    const result = (cards as any[]).map(card => {
      let fields: string[];
      try {
        fields = JSON.parse(card.fields);
        if (!Array.isArray(fields)) fields = card.fields.split('\x1f');
      } catch {
        fields = String(card.fields).split('\x1f');
      }

      // Get field names for template rendering
      let fieldNames: string[] = [];
      try {
        if (card.field_names) {
          fieldNames = JSON.parse(card.field_names);
        }
      } catch { /* keep empty */ }

      return {
        id: card.id,
        noteId: card.note_id,
        deckId: card.deck_id,
        queue: card.queue,
        due: card.due,
        interval: card.interval,
        easeFactor: card.ease_factor,
        reps: card.reps,
        lapses: card.lapses,
        remainingSteps: card.remaining_steps,
        flags: card.flags,
        notetypeId: card.notetype_id,
        notetypeName: card.notetype_name,
        css: card.css,
        templateQFormat: card.template_q_format,
        templateAFormat: card.template_a_format,
        fields,
        fieldNames,
        tags: card.tags ? card.tags.split(/\s+/) : [],
        // Render question/answer
        question: renderTemplate(card.template_q_format, fields, fieldNames),
        answer: renderTemplate(card.template_a_format, fields, fieldNames),
        // MCQ options for new cards (queue=0, step 0)
        // Use card's original small deck first, then current deck, then all cards
        mcqOptions: card.queue === 0 && (card.remaining_steps || 0) === 0 ? (() => {
          const correctText = fields[1] || fields[0] || '';
          // Prioritize: same-keyword group (重点字卡组) first, then original small deck, then current deck, then all cards
          const cardKeyword = extractKeywordFromFront(fields[0] || '');
          const keywordPool = cardKeyword ? (keywordPools.get(cardKeyword) || []) : [];
          const effectiveOriginalDeckId = card.original_deck_id || noteIdToOriginalDeck.get(card.note_id) || null;
          const originalPool = effectiveOriginalDeckId ? (originalDeckPools.get(effectiveOriginalDeckId) || []) : [];
          const currentPool = currentDeckPools.get(card.deck_id) || [];
          const seen = new Set<string>([correctText]);
          const pickDistractors = (pool: string[], count: number): string[] => {
            const picked: string[] = [];
            const shuffled = [...pool].sort(() => Math.random() - 0.5);
            for (const text of shuffled) {
              if (picked.length >= count) break;
              if (!seen.has(text) && text.length > 0 && text.length < 100) {
                seen.add(text);
                picked.push(text);
              }
            }
            return picked;
          };
          let distractors = pickDistractors(keywordPool, 3);
          if (distractors.length < 3) {
            distractors = [...distractors, ...pickDistractors(originalPool, 3 - distractors.length)];
          }
          if (distractors.length < 3) {
            distractors = [...distractors, ...pickDistractors(currentPool, 3 - distractors.length)];
          }
          if (distractors.length < 3) {
            distractors = [...distractors, ...pickDistractors(allCardsPool || [], 3 - distractors.length)];
          }
          while (distractors.length < 3) {
            distractors.push(`其他答案 ${distractors.length + 1}`);
          }
          const allTexts = [correctText, ...distractors];
          // Shuffle and assign labels
          const labels = ['A', 'B', 'C', 'D'];
          for (let i = allTexts.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allTexts[i], allTexts[j]] = [allTexts[j], allTexts[i]];
          }
          const correctLabel = labels[allTexts.indexOf(correctText)];
          return {
            options: allTexts.map((text, i) => ({
              label: labels[i], text,
              isCorrect: labels[i] === correctLabel,
            })),
            correctAnswer: correctLabel,
          }
        })() : null,
        // Learning step info (0=MCQ, 1=看答案回想原句, 2=看原句回想答案)
        learningStep: card.queue === 0 ? (card.remaining_steps || 0) : -1,
        // Next states for button preview
        nextStates: getNextStatesPreview(card.queue, card.remaining_steps || 0, card.interval),
      };
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Answer a card (core review action)
router.post('/:id/answer', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const card = db.prepare(
      'SELECT * FROM cards WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.userId) as any;

    if (!card) {
      res.status(404).json({ error: '卡片不存在' });
      return;
    }

    const { rating, timeMs } = req.body;
    if (!rating || ![1, 2, 3, 4].includes(rating)) {
      res.status(400).json({ error: '无效评分（必须为1-4）' });
      return;
    }

    const cardState: CardState = {
      queue: card.queue,
      due: card.due,
      interval: card.interval,
      reps: card.reps,
      lapses: card.lapses,
      remaining_steps: card.remaining_steps || 0,
    };

    const { card: nextCard, log } = answerCard(cardState, rating, timeMs || 0);

    // Update card
    db.prepare(`
      UPDATE cards SET
        queue = ?, due = ?, interval = ?, ease_factor = ?,
        reps = ?, lapses = ?, remaining_steps = ?, modified_at = unixepoch()
      WHERE id = ?
    `).run(
      nextCard.queue, nextCard.due, nextCard.interval, 2.5,
      nextCard.reps, nextCard.lapses, nextCard.remaining_steps, card.id
    );

    // Write review log
    db.prepare(`
      INSERT INTO revlog (user_id, card_id, ease, interval, last_interval, ease_factor, time_ms, review_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.userId, card.id, rating, nextCard.interval, card.interval,
      2.5, timeMs || 0, card.queue
    );

    // ── 铜板实时发放（服务端统一发放，防刷） ──
    // a. 学习卡（queue=0）三阶段走完毕业 → +1
    // b. 复习卡（queue>=2）每满 10 张成组 → +5（按 revlog 计数与已发流水对账，幂等可自愈）
    // 两者都会乘以「学识矿脉」的学习加成（刻忆觉醒的 goldmine 建筑）。
    // 加成倍率由服务端读玩家自己的存档算出来，客户端改本地等级刷不出来。
    let coinsAwarded = 0;
    /* 本次是否因「日上限」而未发钱。飘字只显示 +N，撞到上限时 N=0，
       学生看到的是「答对了却没加钱」—— 必须显式回传让他知道原因。 */
    let coinsCapped = false;
    let studyBonus = 0;
    try {
      const userId = req.userId!;
      // 加成在本事务外读取即可：它是「读存档算倍率」，不参与本请求的写入
      studyBonus = getStudyBonusMultiplier(userId);
      const withBonus = (base: number) => Math.round(base * (1 + studyBonus));

      /* 【2026-10-14 按需求】统一为「每答对一张不同卡片 +1 铜板」（当天每卡最多一次）。
         取代原先两套规则：
           · study_card   —— 学新卡要「连对 3 次毕业」才 +1，学生答对 3 次只拿 1 个（实测发钱率仅 31%）；
           · review_group —— 复习卡「每 10 张 +5」，等于每张 0.5，且不足 10 张颗粒无收。
         学生多次反馈「学一组词才几十个铜板、建房子却要几百」，收支严重失衡，故改为按卡计费。
         新规则下学新卡第一次答对就当场到账（不必等毕业），复习卡同样是 1 铜板/张。

         ⚠️ 「当天每卡一次」是硬性前置，不是可选优化：
            /answer 不校验卡片到期时间（due），同一张卡可以被反复提交。
            少了这道闸，连点同一张卡就能反复拿钱 —— 那正是本轮刚修复的漏洞。
            计数只认 (user_id, card_id, 北京日)，与提交次数无关，也与「新学/复习」阶段无关。 */
      if (Number(rating) >= 3) {
        cleanupStudyClaims(db);
        /* 【2026-10-19】去重键升级为 (user, card, round, 北京日)。
           每答对一张卡先往 study_coin_claims 抢一个名额：
             · changes === 0 → 本轮今天已经发过，静默跳过；
             · changes === 1 → 拿到名额，正常发钱；
           先判日上限再抢名额，是为了「当天没发成」不占用凭据 ——
           否则撞上限的那张卡会被永久标记为"已领"，明天也发不出来。
           并发安全：唯一索引保证两个请求同时到达时只有一个能插进去。 */
        const day = todayCn();
        const round = Number(card.study_round) || 0;

        if (studyCoinsToday(userId) >= DAILY_STUDY_COIN_CAP) {
          /* 撞到日上限。这里必须**显式告诉学生**，否则他只会看到
             「答对了却没有 +1」，第一反应是系统坏了 —— 学生反馈里有 4 条
             正是这个（「学习了没加铜板」「复习了好多没有收入」「铜板获取有上限吗」）。 */
          coinsCapped = true;
        } else {
          const claim = db.prepare(
            'INSERT OR IGNORE INTO study_coin_claims (user_id, card_id, round, day) VALUES (?, ?, ?, ?)'
          ).run(userId, card.id, round, day);
          if (claim.changes > 0) {
            const gain = withBonus(1);
            addCoins(userId, gain, 'study_card', card.id);
            coinsAwarded += gain;
          }
        }
      }

      /* 【2026-10-14】④ 攻克难点：反复答错的卡（lapses >= 5）连续答对 3 次 → 每张 +5。
         奖励的是「把不会的变成会的」，不是「多刷几遍」—— 这是整套体系里教育意义最强的一条，
         也是唯一给「卡点突破」发钱的地方（其余奖励都只看「是否按节奏完成」）。
         终身一次（流水不带日期判定）：同一张卡一辈子只发一次，防止拿同一张卡反复刷。 */
      if (Number(rating) >= 3 && (Number(card.lapses) || 0) >= LEECH_MIN_LAPSES) {
        const recent = db
          .prepare('SELECT ease FROM revlog WHERE user_id = ? AND card_id = ? ORDER BY reviewed_at DESC, id DESC LIMIT ?')
          .all(userId, card.id, LEECH_STREAK) as { ease: number }[];
        const allRight =
          recent.length === LEECH_STREAK && recent.every((r) => Number(r.ease) >= 3);
        const leechPaid = db
          .prepare("SELECT 1 FROM coins_ledger WHERE user_id = ? AND source = 'leech_fix' AND ref_id = ?")
          .get(userId, card.id) as { 1?: number } | undefined;
        if (allRight && !leechPaid) {
          const gain = withBonus(5);
          addCoins(userId, gain, 'leech_fix', card.id);
          coinsAwarded += gain;
        }
      }
    } catch (coinErr) {
      // 铜板发放失败不影响答题主流程
      console.error('[coins] award failed:', coinErr);
    }

    res.json({
      cardId: card.id,
      nextState: {
        queue: nextCard.queue,
        due: nextCard.due,
        interval: nextCard.interval,
        remaining_steps: nextCard.remaining_steps,
      },
      log,
      // 本次答题发放的铜板总数 & 发放后的余额（前端用于飘字提示）
      coinsAwarded,
      // 今日学习奖励是否已撞到日上限（前端据此提示，避免学生以为系统坏了）
      coinsCapped,
      dailyStudyCap: DAILY_STUDY_COIN_CAP,
      // 学识矿脉加成倍率（0.14 = +14%）。前端可据此解释「为什么这次 +1 变成了 +1」
      studyBonus,
      balance: getCoins(req.userId!),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get all cards in a deck
router.get('/deck/:deckId', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const cards = db.prepare(`
      SELECT c.*, n.fields, n.tags
      FROM cards c
      JOIN notes n ON n.id = c.note_id
      WHERE c.deck_id = ? AND c.user_id = ?
      ORDER BY c.id
    `).all(req.params.deckId, req.userId);
    res.json(cards);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 重学：把当前用户在该卡组下所有卡片重置为「新卡片」状态，重新进入学习队列
// 仅影响 req.userId 自己的卡（user_id 过滤），不会动到其他用户，也不会动到卡组本身。
router.post('/deck/:deckId/reset', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deckId = parseInt(req.params.deckId);
    const info = db.prepare(`
      UPDATE cards SET
        queue = 0,
        due = unixepoch(),
        interval = 0,
        ease_factor = 2.5,
        reps = 0,
        lapses = 0,
        remaining_steps = 0,
        /* 【2026-10-19】进入新一轮：重置后重学，同一张卡可以重新拿一次学习币。
           去重键是 (user, card, round, 日)，见 study_coin_claims 表。
           防刷不靠轮次，靠每日 80 铜板上限。 */
        study_round = study_round + 1,
        modified_at = unixepoch()
      WHERE deck_id = ? AND user_id = ?
    `).run(deckId, req.userId);
    res.json({ reset: info.changes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get distractor pool for MCQ generation (returns answer texts from the deck)
router.get('/distractors/:deckId', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deckId = parseInt(req.params.deckId);
    const rows = db.prepare(`
      SELECT n.fields, n.notetype_id, nt.name as notetype_name
      FROM cards c
      JOIN notes n ON n.id = c.note_id
      JOIN notetypes nt ON nt.id = n.notetype_id
      WHERE c.deck_id = ? AND c.user_id = ?
      ORDER BY RANDOM() LIMIT 80
    `).all(deckId, req.userId) as any[];

    const pool = rows.map(r => {
      let fields: string[];
      try {
        fields = JSON.parse(r.fields);
        if (!Array.isArray(fields)) fields = r.fields.split('\x1f');
      } catch {
        fields = String(r.fields).split('\x1f');
      }
      return {
        text: fields[1] || fields[0] || '',
        // 原句（例句/正面）：供「据义选句」等句子类题型使用；保留原始 markup，由前端 renderMarkup 渲染
        front: fields[0] || '',
        notetype: r.notetype_name || '',
        keyword: extractKeywordFromFront(fields[0] || '') || '',
      };
    }).filter((item: any) => item.text && item.text.length > 0 && item.text.length < 100);

    res.json(pool);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get distractor pool from ALL user's cards (for MCQ fallback)
router.get('/all-distractors', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT n.fields, n.notetype_id, nt.name as notetype_name
      FROM cards c
      JOIN notes n ON n.id = c.note_id
      JOIN notetypes nt ON nt.id = n.notetype_id
      WHERE c.user_id = ?
      ORDER BY RANDOM() LIMIT 80
    `).all(req.userId) as any[];

    const pool = rows.map(r => {
      let fields: string[];
      try {
        fields = JSON.parse(r.fields);
        if (!Array.isArray(fields)) fields = r.fields.split('\x1f');
      } catch {
        fields = String(r.fields).split('\x1f');
      }
      return {
        text: fields[1] || fields[0] || '',
        // 原句（例句/正面）：供「据义选句」等句子类题型使用；保留原始 markup，由前端 renderMarkup 渲染
        front: fields[0] || '',
        notetype: r.notetype_name || '',
        keyword: extractKeywordFromFront(fields[0] || '') || '',
      };
    }).filter((item: any) => item.text && item.text.length > 0 && item.text.length < 100);

    res.json(pool);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get stats overview
router.get('/stats/overview', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();

    const totalCards = db.prepare(
      'SELECT COUNT(*) as count FROM cards WHERE user_id = ?'
    ).get(req.userId) as any;

    // 【2026-09-28 修复】到期口径统一为「北京时间自然日」，与调度器
    // getNextDayDue() 的语义对齐（卡片在次日凌晨 0 点解锁），不再用
    // "当前时刻 + 86400 秒" 这种滚动窗口 —— 二者在当天 12 点以后会错位一天。
    const { startOfDay, endOfDay } = cnTodayWindow();
    const tomorrowEnd = endOfDay + 86400;

    // 今日待复习：queue 1/2/3（学习卡/复习卡/重学卡）且到期时刻 ≤ 今日 23:59:59
    // 逾期卡片自然包含在内（due 更早，同样 ≤ 今日末）
    const dueToday = db.prepare(`
      SELECT COUNT(*) as count FROM cards WHERE user_id = ?
      AND queue IN (1, 2, 3) AND due < ?
    `).get(req.userId, endOfDay) as any;

    // 明天待复习：今日末 ~ 明日晚。仅统计 queue 1/2/3。
    // 新卡（queue=0）不入此列 —— 它们没有排期概念，由「新卡」单独体现，
    // 计入会让「明天复习」变成一个恒等于新卡总数的无意义数字。
    const dueTomorrow = db.prepare(`
      SELECT COUNT(*) as count FROM cards WHERE user_id = ?
      AND queue IN (1, 2, 3) AND due >= ? AND due < ?
    `).get(req.userId, endOfDay, tomorrowEnd) as any;

    const newCards = db.prepare(
      'SELECT COUNT(*) as count FROM cards WHERE user_id = ? AND queue = 0'
    ).get(req.userId) as any;

    // 【2026-09-28 修复】以下三个「今日」查询原先混用 UTC 与北京时间：
    //   todayReviews / todayNew 用 date('now')（UTC 切日），
    //   todayReview 用 date('now','+8 hours')（北京切日）。
    // 后果：北京时间 00:00~08:00 之间的复习被算进「昨天」—— 学生早读
    // 背完词打开统计页，「今日已复习」显示 0。现全部统一为北京时间。
    const todayReviews = db.prepare(`
      SELECT COUNT(*) as count FROM revlog
      WHERE user_id = ?
        AND date(reviewed_at, 'unixepoch', '${CN_SQL_MODIFIER}') = date('now', '${CN_SQL_MODIFIER}')
    `).get(req.userId) as any;

    // 今天新学/复习次数（review_type = 回答时的队列：0=新卡, 2=复习）
    const todayNew = db.prepare(`
      SELECT COUNT(*) as count FROM revlog
      WHERE user_id = ? AND review_type = 0
        AND date(reviewed_at, 'unixepoch', '${CN_SQL_MODIFIER}') = date('now', '${CN_SQL_MODIFIER}')
    `).get(req.userId) as any;

    const todayReview = db.prepare(`
      SELECT COUNT(*) as count FROM revlog
      WHERE user_id = ? AND review_type = 2 AND date(reviewed_at, 'unixepoch', '${CN_SQL_MODIFIER}') = date('now', '${CN_SQL_MODIFIER}')
    `).get(req.userId) as any;

    // 积分: 学习/复习 1 词 +1 分（revlog 每条），打卡每天 +10 分（checkins 每条）
    const pointsStudy = db.prepare(
      'SELECT COUNT(*) as count FROM revlog WHERE user_id = ?'
    ).get(req.userId) as any;
    const pointsCheckin = db.prepare(
      'SELECT COUNT(*) as count FROM checkins WHERE user_id = ?'
    ).get(req.userId) as any;

    const streak = calculateStreak(db, req.userId!);

    // 个人中心用：累计学习次数 / 累计打卡天数 / 已掌握卡片 / 最近打卡日期
    const totalReviews = db.prepare(
      'SELECT COUNT(*) as count FROM revlog WHERE user_id = ?'
    ).get(req.userId) as any;
    const totalCheckinDays = db.prepare(
      'SELECT COUNT(*) as count FROM checkins WHERE user_id = ?'
    ).get(req.userId) as any;
    const masteredCards = db.prepare(
      'SELECT COUNT(*) as count FROM cards WHERE user_id = ? AND interval >= 21'
    ).get(req.userId) as any;
    const recentCheckinRows = db.prepare(
      'SELECT checked_date FROM checkins WHERE user_id = ? ORDER BY checked_date DESC LIMIT 35'
    ).all(req.userId) as any[];


    res.json({
      totalCards: totalCards.count,
      dueToday: dueToday.count,
      dueTomorrow: dueTomorrow.count,
      newCards: newCards.count,
      todayReviews: todayReviews.count,
      todayNew: todayNew.count,
      todayReview: todayReview.count,
      points: pointsStudy.count + pointsCheckin.count * 10,
      streak,
      totalReviews: totalReviews.count,
      checkinDays: totalCheckinDays.count,
      masteredCards: masteredCards.count,
      recentCheckins: recentCheckinRows.map((r: any) => r.checked_date),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 统计图表数据（百词斩风格） ────────────────────────────────────
// 【2026-09-28 新增】为统计页三张图表提供聚合数据：
//   1) GET /stats/review-plan  未来 10 天复习计划分布
//   2) GET /stats/stages       记忆阶段现状 + 近 11 天堆叠趋势
// 全部基于 cards / revlog 实时聚合，不落冗余表，避免数据不一致。
//
// 记忆阶段划分（依 interval 天数，结合 reps 区分未启动与已掌握）：
//   初记 fresh    interval=0 或 reps=0  —— 尚未形成有效间隔
//   强化 hard     interval 1~5          —— 短间隔，记忆不稳
//   巩固 solid    interval 6~20         —— 中期间隔
//   熟识 familiar interval 21~59        —— 长期间隔
//   已斩 slain    interval >= 60        —— 完全掌握

const STAGE_CASE = `
  CASE
    WHEN interval = 0 OR reps = 0 THEN 'fresh'
    WHEN interval < 6              THEN 'hard'
    WHEN interval < 21             THEN 'solid'
    WHEN interval < 60             THEN 'familiar'
    ELSE 'slain'
  END
`;

const STAGE_KEYS = ['fresh', 'hard', 'solid', 'familiar', 'slain'] as const;

// 把 interval 数值映射到阶段 key（与 STAGE_CASE 保持一致）
function stageOf(interval: number, reps: number): typeof STAGE_KEYS[number] {
  if (interval === 0 || reps === 0) return 'fresh';
  if (interval < 6) return 'hard';
  if (interval < 21) return 'solid';
  if (interval < 60) return 'familiar';
  return 'slain';
}

router.get('/stats/review-plan', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const uid = req.userId;
    const now = Math.floor(Date.now() / 1000);
    const DAY = 86400;

    // 【2026-09-28 修复】原先按 (due - now)/86400 做滚动窗口分桶，存在两个硬伤：
    //   ① WHERE 里的 `due > now` 把全部逾期卡排除在结果集外，后面那段
    //      「负偏移归入今天」成了永不可达的死代码 → 逾期卡一张都不显示；
    //   ② 整数除法切的是「72 小时后」而非「自然日」，与调度器 getNextDayDue()
    //      的「次日 0 点解锁」语义冲突（用户看到明天 5 张，实际明早解锁远不止）。
    // 现改为按北京时间的自然日分桶：逾期 + 今天到期合并计入「今天」，其余按天归位。
    const { startOfDay, endOfDay } = cnTodayWindow();

    // 按自然日聚合：把 due 换算成北京日期串，再算与今天的「天差」。
    // 用 SQLite 的 julianday 做日期差，避免手写闰年/月长逻辑。
    const dueRows = db.prepare(`
      SELECT CAST(julianday(date(due, 'unixepoch', '${CN_SQL_MODIFIER}'))
                  - julianday(date('now', '${CN_SQL_MODIFIER}')) AS INTEGER) AS offset,
             COUNT(*) AS count
      FROM cards
      WHERE user_id = ? AND queue IN (1, 2, 3)
      GROUP BY offset
    `).all(uid) as { offset: number; count: number }[];

    const dueMap = new Map<number, number>();
    for (const r of dueRows) {
      if (r.offset < 0) {
        // 逾期（含今日之前所有到期未处理）→ 统一归入「今天」
        dueMap.set(0, (dueMap.get(0) || 0) + r.count);
      } else if (r.offset < 10) {
        dueMap.set(r.offset, (dueMap.get(r.offset) || 0) + r.count);
      }
    }

    // 逾期总数（严格早于今天 00:00 到期且仍未处理）
    const overdue = db.prepare(`
      SELECT COUNT(*) AS count FROM cards
      WHERE user_id = ? AND queue IN (1, 2, 3) AND due < ?
    `).get(uid, startOfDay) as { count: number };

    // 今日待复习（卡片总数，含逾期）—— 与 days[0].count 同源，保证气泡文案与柱状图一致
    const todayDue = db.prepare(`
      SELECT COUNT(*) AS count FROM cards
      WHERE user_id = ? AND queue IN (1, 2, 3) AND due < ?
    `).get(uid, endOfDay) as { count: number };

    const days = Array.from({ length: 10 }, (_, i) => ({
      label: i === 0 ? '今天' : i === 1 ? '明天' : i === 2 ? '后天' : `${i}天后`,
      offset: i,
      count: dueMap.get(i) || 0,
      isToday: i === 0,
    }));

    res.json({
      days,
      overdue: overdue.count,
      todayCount: todayDue.count,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats/stages', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const uid = req.userId;

    // ① 当前各阶段卡片数
    const nowRows = db.prepare(`
      SELECT ${STAGE_CASE} AS stage, COUNT(*) AS count
      FROM cards WHERE user_id = ?
      GROUP BY stage
    `).all(uid) as { stage: string; count: number }[];

    const nowMap: Record<string, number> = { fresh: 0, hard: 0, solid: 0, familiar: 0, slain: 0 };
    for (const r of nowRows) nowMap[r.stage] = r.count;

    // ② 近 11 天堆叠趋势（真实回溯，非按比例分摊）
    //
    // 思路：对每张卡，取「截至某天最后一刻」为止的最后一次复习记录，
    // 用该记录上的 interval 还原它在那天所处的阶段。
    //
    // 【2026-09-28 修复】原实现在「该卡当天无复习记录」时用 stageOf(cur_interval,
    // cur_reps) 兜底 —— 即把卡片**当前**状态填进历史每一天。对本用户 1639 张
    // 从未复习的新卡（interval=0、reps=0）来说，这会让它们在 11 个时点全部
    // 记成 fresh，把真实进展彻底稀释成一条水平线（实测 11 天只变动 1）。
    // 现改为：无条件取「该时点之前最后一次复习」的状态；该卡在该时点若还没
    // 被复习过，就是 fresh（interval=0）。这也是唯一自洽的定义。
    //
    // 另修正一个字段语义错位：原 curReps 累计的是「窗口内复习次数」，被传给了
    // 期望「累计复习次数」的 stageOf 第二个参数。现统一改名为 reviewedBefore
    // （该时点前是否复习过），语义与 STAGE_CASE 的 `reps = 0` 判断一致。
    const DAYS = 11;
    const CN_OFFSET = 8 * 3600; // 东八区

    const dayList: { date: string; endSec: number; label: string }[] = [];
    const todayCNDate = new Date(Date.now() + CN_OFFSET);
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(todayCNDate.getTime() - i * 86400000);
      const dateStr = d.toISOString().slice(0, 10);
      // 该日 23:59:59(CST) 对应的时间戳
      const endSec = Math.floor(new Date(dateStr + 'T23:59:59+08:00').getTime() / 1000);
      dayList.push({
        date: dateStr,
        endSec,
        label: i === 0 ? '今天' : i === 1 ? '昨天' : i === 2 ? '前天' : `${i}天前`,
      });
    }

    // 拉取窗口内的有效数据：窗口内创建的全部卡片 + 这些卡片在窗口内所有复习记录
    const cardRows = db.prepare(`
      SELECT id, interval AS cur_interval, reps AS cur_reps, created_at
      FROM cards
      WHERE user_id = ? AND created_at <= ?
    `).all(uid, dayList[DAYS - 1].endSec) as {
      id: number; cur_interval: number; cur_reps: number; created_at: number;
    }[];

    const logRows = db.prepare(`
      SELECT card_id, interval, reviewed_at
      FROM revlog
      WHERE user_id = ? AND reviewed_at <= ?
      ORDER BY reviewed_at ASC, id ASC
    `).all(uid, dayList[DAYS - 1].endSec) as {
      card_id: number; interval: number; reviewed_at: number;
    }[];

    // cardLogs: card_id -> [{interval, reviewed_at}] 升序
    const cardLogs = new Map<number, { interval: number; reviewed_at: number }[]>();
    for (const l of logRows) {
      if (!cardLogs.has(l.card_id)) cardLogs.set(l.card_id, []);
      cardLogs.get(l.card_id)!.push({ interval: l.interval, reviewed_at: l.reviewed_at });
    }

    // 对每张卡，算出它在 11 个时点各自的阶段
    // perDay: dayIndex -> { fresh, hard, ... }
    const perDay: Record<string, number>[] = dayList.map(() => ({
      fresh: 0, hard: 0, solid: 0, familiar: 0, slain: 0,
    }));

    for (const c of cardRows) {
      const logs = cardLogs.get(c.id) || [];
      let li = 0; // 日志游标
      let curInterval = 0;
      let reviewedBefore = 0; // 该时点之前已发生的复习次数
      for (let di = 0; di < dayList.length; di++) {
        const endSec = dayList[di].endSec;
        // 该卡当天还不存在，跳过（不计入累计）
        if (c.created_at > endSec) continue;
        // 推进游标到「该时点之前的最后一次复习」
        while (li < logs.length && logs[li].reviewed_at <= endSec) {
          curInterval = logs[li].interval;
          reviewedBefore += 1;
          li++;
        }
        // 该时点前从未复习过 → interval=0/reps=0 → fresh，与 STAGE_CASE 一致
        const stage = stageOf(curInterval, reviewedBefore);
        perDay[di][stage] += 1;
      }
    }

    const trend = dayList.map((d, i) => ({
      date: d.date,
      label: d.label,
      stages: perDay[i],
    }));

    const total = STAGE_KEYS.reduce((s, k) => s + nowMap[k], 0);
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

    res.json({
      now: nowMap,
      total,
      percent: {
        fresh: pct(nowMap.fresh),
        hard: pct(nowMap.hard),
        solid: pct(nowMap.solid),
        familiar: pct(nowMap.familiar),
        slain: pct(nowMap.slain),
      },
      trend,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: render card template with field name mapping
function renderTemplate(template: string, fields: string[], fieldNames: string[] = []): string {
  let result = template;

  // Build a map from field name (case-insensitive) to field value
  const fieldMap: Record<string, string> = {};
  for (let i = 0; i < fieldNames.length && i < fields.length; i++) {
    fieldMap[fieldNames[i].toLowerCase()] = fields[i] || '';
  }
  // Also allow numeric field references (e.g., {{1}})
  for (let i = 0; i < fields.length; i++) {
    fieldMap[String(i + 1)] = fields[i] || '';
  }

  const frontSide = fields[0] || '';

  // First pass: replace {{FieldName}} with actual values
  result = result.replace(/\{\{([^}]+)\}\}/g, (_match: string, fieldName: string) => {
    if (fieldName.toLowerCase() === 'frontside') {
      // Placeholder - will be replaced in second pass
      return '___FRONTSIDE___';
    }
    const key = fieldName.toLowerCase().trim();
    if (key in fieldMap) {
      return fieldMap[key];
    }
    // Try to match by index (1-based)
    const idx = parseInt(fieldName);
    if (!isNaN(idx) && idx >= 1 && idx <= fields.length) {
      return fields[idx - 1] || '';
    }
    return '';
  });

  // Second pass: replace FrontSide placeholder with the question content
  result = result.replace(/___FRONTSIDE___/g, frontSide);

  // Third pass: convert markers to HTML
  // **text** → bold
  result = result.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  // ==text== → highlight
  result = result.replace(/==([^=]+)==/g, '<span class="mark-highlight">$1</span>');

  return result;
}

/**
 * 连签计算：revlog 的有效学习日 ∪ checkins 的主动打卡，从今天（或昨天）往前连续回溯。
 * 【2026-11-07 重写】前一天线上出现全班连签归零，根因是本函数的 SQL 被改坏
 * （UNION 两侧列数不一致 / 外层包裹丢失），而 catch 把异常吞掉直接 return 0，
 * 于是一个人都不报错、全班一起归零。现在：
 *   · SQL 结构固定为「外层 SELECT review_date FROM ( A UNION B )」；
 *   · 出错写日志，不再静默；
 *   · 逐日回溯用 shiftDay 做纯日期字符串运算，不看服务器时区。
 */
function calculateStreak(db: any, userId: number): number {
  try {
    const rows = db.prepare(`
        SELECT review_date FROM (
          SELECT review_date FROM (
            SELECT day AS review_date, AVG(time_ms) AS med_ms, MAX(n) AS n
              FROM (
                SELECT day, time_ms, n,
                       ROW_NUMBER() OVER (PARTITION BY day ORDER BY time_ms) AS rn
                  FROM (SELECT date(reviewed_at,'unixepoch','${CN_SQL_MODIFIER}') AS day,
                               time_ms,
                               COUNT(*) OVER (PARTITION BY date(reviewed_at,'unixepoch','${CN_SQL_MODIFIER}')) AS n
                          FROM revlog WHERE user_id = ?)
              )
             WHERE rn IN ((n + 1) / 2, (n + 2) / 2)
             GROUP BY day
            /* ① 中位耗时 < 700ms → 刷时长；② 满 30 条且 < 1500ms → 也算刷 */
            HAVING med_ms >= 700 AND NOT (MAX(n) >= 30 AND med_ms < 1500)
          )
          UNION
          SELECT checked_date AS review_date FROM checkins WHERE user_id = ?
        )
      ORDER BY review_date DESC LIMIT 365
    `).all(userId, userId) as any[];

    if (rows.length === 0) return 0;
    const today = cnDateStr();
    const dates = new Set(rows.map((r: any) => r.review_date));
    let cursor = dates.has(today) ? today : shiftDay(today, -1);
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      if (!dates.has(cursor)) break;
      streak++;
      cursor = shiftDay(cursor, -1);
    }
    return streak;
  } catch (e) {
    console.error('[streak] 计算失败 userId=', userId, e);
    return 0;
  }
}


/* 【2026-10-19 总榜口径回调】每人每天最多计 DAILY_SCORE_CAP 次答对。
   ------------------------------------------------------------------
   背景：10-14 堵刷币漏洞时，总榜从「答对次数」改成了「答对的不同卡片数」，
   本意是防刷，但副作用是所有人卡在 869（大家学的是同一个 869 张的牌组），
   前三名分数完全一样，榜失去区分度；学生也以为自己的历史分被清零了。

   现在改回「次数」，但加每日封顶：
     · 正常学生一天 50~150 次，200 的线基本碰不到，勤奋多少就涨多少；
     · 刷子一天几百上千次，超出的部分直接截断 ——
       邹嘉顺 31 天答了 18896 次（日均 609），封顶后是 4456，
       而稳定学 55 天的李若翎是 5126，排到了第一，这正是想要的结果；
     · 封顶按「北京日」算，跨天不累计，避免月底一次性补刷。
   ------------------------------------------------------------------ */
const DAILY_SCORE_CAP = 200;

/* 【2026-11-07 排行榜清洗】训练场分的单日封顶，与学习分同一口径。
   训练场正常一天几十到一两百分，200 的线同样碰不到。 */
const TRAIN_DAILY_CAP = 200;

// ── 学习排行榜（仿百词斩首页）──
// GET /api/cards/leaderboard?range=today|total
// 积分 = 答对次数（按天封顶 200） + 训练场收益（training_correct 按天封顶 200；不含 admin_reset）
// 返回 TOP20（今日积分 / 累计积分）+ 当前用户排名；user_id=1 系统账号不计入
router.get('/leaderboard', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const range = req.query.range === 'total' ? 'total' : 'today';
    const today = cnDateStr();

    /* 先把「用户 × 北京日」的答对次数汇总（daily），再对每天截断到 DAILY_SCORE_CAP
       后求和（scored）。今日榜只是把 daily 的取数窗口换成当天。 */
    const dailyCte =
      'WITH daily AS ( ' +
        "SELECT user_id, date(reviewed_at, 'unixepoch', '" + CN_SQL_MODIFIER + "') AS d, COUNT(*) AS c " +
        'FROM revlog WHERE ease >= 3 ' +
        (range === 'today'
          ? "AND date(reviewed_at, 'unixepoch', '" + CN_SQL_MODIFIER + "') = date('now', '" + CN_SQL_MODIFIER + "') "
          : '') +
        'GROUP BY user_id, d ' +
      '), scored AS ( ' +
        'SELECT user_id, SUM(CASE WHEN c > ' + DAILY_SCORE_CAP + ' THEN ' + DAILY_SCORE_CAP + ' ELSE c END) AS s ' +
        'FROM daily GROUP BY user_id ' +
      ') ';

    /* 【2026-11-07 榜单清洗】训练场分只认 training_correct。
       ------------------------------------------------------------------
       admin_reset 是人工改余额的记账凭证，不是学生练出来的分。
       11-05 岛任务事故后给邹嘉顺回填过一笔 +66.67 亿的 admin_reset，
       榜单把他算成 6,666,736,730 分，李翼等学生一直在投诉「几十亿谁能比」。
       现在：① 剔除 admin_reset；② 与学习分同口径，按北京日封顶 TRAIN_DAILY_CAP。
       ------------------------------------------------------------------ */
    const trainSub =
      'COALESCE((SELECT SUM(CASE WHEN tc > ' + TRAIN_DAILY_CAP + ' THEN ' + TRAIN_DAILY_CAP + ' ELSE tc END) FROM (' +
        'SELECT cl.day AS d, SUM(cl.delta) AS tc FROM coins_ledger cl ' +
        "WHERE cl.user_id = u.id AND cl.source = 'training_correct' " +
        (range === 'today' ? "AND cl.day = '" + today + "' " : '') +
        'GROUP BY cl.day)), 0)';

    // 每位用户最近一次学习的词书名（用于排行榜副标题）
    const deckStmt = db.prepare(
      'SELECT d.name FROM revlog r JOIN cards c ON c.id = r.card_id JOIN decks d ON d.id = c.deck_id ' +
      'WHERE r.user_id = ? ORDER BY r.reviewed_at DESC LIMIT 1'
    );

    /* 一次取全站用户（150 来人）到内存里排序 ——
       比原来「TOP20 / 我的分 / 我的排名」跑三条 SQL 各扫一遍 revlog 快得多，
       而且排名规则（并列同名次）与原实现完全一致。 */
    const rows = db.prepare(
      dailyCte +
      'SELECT u.id, u.username, u.avatar_url, COALESCE(u.is_teacher, 0) AS is_teacher, ' +
        "COALESCE(u.badge_label, '') AS badge_label, " +
        'COALESCE(sc.s, 0) AS study, ' + trainSub + ' AS train ' +
      'FROM users u LEFT JOIN scored sc ON sc.user_id = u.id WHERE u.id <> 1'
    ).all() as any[];

    for (const r of rows) r.score = Number(r.study) + Number(r.train);
    rows.sort((a, b) => b.score - a.score || a.id - b.id);

    // TOP20（有积分才上榜）
    const list = rows
      .filter((r) => r.score > 0)
      .slice(0, 20)
      .map((row, i) => ({
        rank: i + 1,
        id: row.id,
        username: row.username,
        avatar_url: row.avatar_url || '',
        is_teacher: !!row.is_teacher,
        badge_label: row.badge_label || '',
        count: row.score,
        deck_name: (deckStmt.get(row.id) as any)?.name || '',
      }));

    // 当前用户积分与排名（不在 TOP20 也能看到自己的名次）
    const mine = rows.find((r) => r.id === req.userId);
    const myScore = mine ? mine.score : 0;
    const myRank = rows.filter((r) => r.score > myScore).length + 1;
    const myDeckName = (deckStmt.get(req.userId) as any)?.name || '';

    res.json({
      range,
      list,
      me: { rank: myRank, count: myScore, deck_name: myDeckName },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
