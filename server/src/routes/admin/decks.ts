import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../db/database';
import { adminMiddleware, AuthRequest } from '../../middleware/auth';
import { libraryOwnerId } from '../lib/deckLibrary';

const router = Router();

// List admin's decks
router.get('/decks', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const decks = db.prepare(`
      SELECT d.*,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) as card_count,
        (SELECT json_group_array(json_object('id', sd.id, 'name', sd.name, 'card_count', (SELECT COUNT(*) FROM cards c WHERE c.deck_id = sd.id)))
         FROM decks sd WHERE sd.merged_into_id = d.id AND sd.user_id = d.user_id
        ) as source_decks_json
      FROM decks d
      WHERE d.user_id = ?
      ORDER BY d.name
    `).all(libraryOwnerId());

    // Parse the JSON for source_decks
    const result = decks.map((d: any) => ({
      ...d,
      source_decks: d.source_decks_json ? JSON.parse(d.source_decks_json) : [],
      source_decks_json: undefined,
    }));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get source decks for a merged deck
router.get('/decks/:id/source-decks', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deckId = parseInt(req.params.id);
    const sourceDecks = db.prepare(`
      SELECT d.*,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) as card_count
      FROM decks d
      WHERE d.merged_into_id = ? AND d.user_id = ?
      ORDER BY d.name
    `).all(deckId, libraryOwnerId());
    res.json(sourceDecks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Dissolve a merged deck — restore source decks as independent, delete the merged deck
router.post('/decks/:id/dissolve', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deckId = parseInt(req.params.id);

    // Verify deck exists and belongs to admin
    const deck = db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?')
      .get(deckId, libraryOwnerId()) as any;
    if (!deck) {
      res.status(404).json({ error: '牌组不存在' });
      return;
    }

    // Find source decks
    const sourceDecks = db.prepare(
      'SELECT id, name FROM decks WHERE merged_into_id = ? AND user_id = ?'
    ).all(deckId, libraryOwnerId()) as any[];

    if (sourceDecks.length === 0) {
      res.status(400).json({ error: '该牌组没有关联的源牌组，无法解散' });
      return;
    }

    // Transaction: unmark source decks then delete the merged deck
    const dissolve = db.transaction(() => {
      const unlink = db.prepare(
        'UPDATE decks SET merged_into_id = NULL, modified_at = unixepoch() WHERE merged_into_id = ? AND user_id = ?'
      );
      unlink.run(deckId, libraryOwnerId());

      db.prepare('DELETE FROM decks WHERE id = ? AND user_id = ?')
        .run(deckId, libraryOwnerId());
    });
    dissolve();

    res.json({
      success: true,
      message: `已解散合并牌组「${deck.name}」，${sourceDecks.length} 个源牌组已恢复独立`,
      restoredDeckNames: sourceDecks.map((d: any) => d.name),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Deck Push (Send / Update) ─────────────────────────────────────────

// Send a deck to a user — creates new or updates existing by source_deck_id
// 导出供 decks.ts 书架接口复用（用户自助添加）
export function sendDeckToUser(
  db: any,
  deckId: number,
  adminUserId: number,
  targetUserId: number
) {
  try {
    const db = getDb();

    // Verify the source deck belongs to admin
    const sourceDeck = db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?')
      .get(deckId, adminUserId) as any;
    if (!sourceDeck) {
      throw new Error('牌组不存在');
    }

    // Verify target user exists
    const targetUser = db.prepare('SELECT id, username FROM users WHERE id = ?')
      .get(targetUserId) as any;
    if (!targetUser) {
      throw new Error('目标用户不存在');
    }

    // Auto-resync if this is a merged deck (has source decks)
    const sourceDecks = db.prepare(
      'SELECT id FROM decks WHERE merged_into_id = ? AND user_id = ?'
    ).all(deckId, adminUserId) as any[];
    if (sourceDecks.length > 0) {
      resyncMergedDeck(db, deckId, adminUserId);
    }

    // Find existing user deck: match by source_deck_id first, fallback to name
    let existingDeck = db.prepare(
      'SELECT id, name FROM decks WHERE user_id = ? AND source_deck_id = ?'
    ).get(targetUserId, deckId) as any;

    if (!existingDeck) {
      existingDeck = db.prepare(
        'SELECT id, name FROM decks WHERE user_id = ? AND name = ?'
      ).get(targetUserId, sourceDeck.name) as any;
    }

    let targetDeckId: number;
    let isUpdate = false;

    // ── Phase 1: Prepare the target deck ──
    const prepareDeck = db.transaction(() => {
      if (existingDeck) {
        // ── UPDATE existing deck ──
        isUpdate = true;
        targetDeckId = existingDeck.id;
        // Update deck meta + ensure source_deck_id is set
        db.prepare(`UPDATE decks SET name = ?, description = ?, source_deck_id = ?,
          modified_at = unixepoch() WHERE id = ? AND user_id = ?`)
          .run(sourceDeck.name, sourceDeck.description, deckId, targetDeckId, targetUserId);
        // Delete & recreate deck config
        db.prepare('DELETE FROM deck_config WHERE deck_id = ? AND user_id = ?')
          .run(targetDeckId, targetUserId);
      } else {
        // ── CREATE new deck ──
        const deckResult = db.prepare(
          'INSERT INTO decks (user_id, parent_id, name, description, source_deck_id) VALUES (?, ?, ?, ?, ?)'
        ).run(targetUserId, null, sourceDeck.name, sourceDeck.description, deckId);
        targetDeckId = deckResult.lastInsertRowid as number;
      }

      // Copy deck config (always fresh)
      const srcConfig = db.prepare('SELECT * FROM deck_config WHERE deck_id = ? AND user_id = ?')
        .get(deckId, adminUserId) as any;
      if (srcConfig) {
        db.prepare(`
          INSERT INTO deck_config (user_id, deck_id, learn_steps, relearn_steps, initial_ease, easy_multiplier,
            hard_multiplier, interval_multiplier, maximum_review_interval, minimum_lapse_interval,
            graduating_interval_good, graduating_interval_easy, new_per_day, reviews_per_day,
            leech_threshold, lapse_multiplier)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          targetUserId, targetDeckId, srcConfig.learn_steps, srcConfig.relearn_steps,
          srcConfig.initial_ease, srcConfig.easy_multiplier, srcConfig.hard_multiplier,
          srcConfig.interval_multiplier, srcConfig.maximum_review_interval,
          srcConfig.minimum_lapse_interval, srcConfig.graduating_interval_good,
          srcConfig.graduating_interval_easy, srcConfig.new_per_day, srcConfig.reviews_per_day,
          srcConfig.leech_threshold, srcConfig.lapse_multiplier
        );
      }
    });
    prepareDeck();

    // ── Phase 2: Map notetypes ──
    const usedNotetypes = db.prepare(`
      SELECT DISTINCT n.notetype_id FROM notes n
      JOIN cards c ON c.note_id = n.id
      WHERE c.deck_id = ? AND c.user_id = ?
    `).all(deckId, adminUserId) as any[];

    const notetypeMap = new Map<number, number>();
    for (const row of usedNotetypes) {
      const srcNt = db.prepare('SELECT * FROM notetypes WHERE id = ?').get(row.notetype_id) as any;
      if (!srcNt) continue;

      // Reuse existing notetype by name, or create new
      const existingNt = db.prepare('SELECT id FROM notetypes WHERE user_id = ? AND name = ?')
        .get(targetUserId, srcNt.name) as any;
      if (existingNt) {
        notetypeMap.set(srcNt.id, existingNt.id);
      } else {
        const ntResult = db.prepare(`
          INSERT INTO notetypes (user_id, name, css, kind, field_names, template_q_format, template_a_format)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(targetUserId, srcNt.name, srcNt.css, srcNt.kind, srcNt.field_names,
          srcNt.template_q_format, srcNt.template_a_format);
        notetypeMap.set(srcNt.id, ntResult.lastInsertRowid as number);
      }
    }

    // ── Phase 3: Smart sync notes & cards (preserve user progress, remove stale) ──
    const syncContent = db.transaction(() => {
      // Get all source (admin) notes for this deck
      const sourceNotes = db.prepare(`
        SELECT DISTINCT n.id, n.guid, n.notetype_id, n.tags, n.fields, n.sort_field
        FROM notes n
        JOIN cards c ON c.note_id = n.id
        WHERE c.deck_id = ? AND c.user_id = ?
      `).all(deckId, adminUserId) as any[];

      // Build set of source GUIDs for stale-removal later
      const sourceGuids = new Set(sourceNotes.map((n: any) => n.guid));

      let notesCreated = 0, notesUpdated = 0, cardsCreated = 0, cardsSkipped = 0;
      let notesDeleted = 0, cardsDeleted = 0;
      const now = Math.floor(Date.now() / 1000);

      if (isUpdate) {
        // Get existing user's notes for this deck, partitioned by GUID match
        const existingUserNotes = db.prepare(`
          SELECT n.id, n.guid FROM notes n
          JOIN cards c ON c.note_id = n.id
          WHERE c.deck_id = ? AND c.user_id = ?
        `).all(targetDeckId, targetUserId) as any[];

        // Remove stale notes (GUID not in admin source anymore)
        for (const row of existingUserNotes) {
          if (!sourceGuids.has(row.guid)) {
            db.prepare('DELETE FROM cards WHERE note_id = ? AND user_id = ?').run(row.id, targetUserId);
            db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(row.id, targetUserId);
            notesDeleted++;
            cardsDeleted++;
          }
        }

        // Also collect remaining user notes GUID → note_id for matching
        const remainingUserNotes = db.prepare(`
          SELECT n.id, n.guid FROM notes n
          JOIN cards c ON c.note_id = n.id
          WHERE c.deck_id = ? AND c.user_id = ?
        `).all(targetDeckId, targetUserId) as any[];
        const userNotesByGuid = new Map<string, number>();
        for (const row of remainingUserNotes) {
          if (!userNotesByGuid.has(row.guid)) {
            userNotesByGuid.set(row.guid, row.id);
          }
        }

        // Process each source note: update if match exists, otherwise insert
        for (const srcNote of sourceNotes) {
          const newNotetypeId = notetypeMap.get(srcNote.notetype_id);
          if (!newNotetypeId) continue;

          if (userNotesByGuid.has(srcNote.guid)) {
            // ── UPDATE existing note — preserve user progress ──
            const userNoteId = userNotesByGuid.get(srcNote.guid)!;
            db.prepare(`UPDATE notes SET notetype_id = ?, tags = ?, fields = ?, sort_field = ?,
              modified_at = ? WHERE id = ? AND user_id = ?`)
              .run(newNotetypeId, srcNote.tags, srcNote.fields, srcNote.sort_field, now, userNoteId, targetUserId);
            notesUpdated++;
          } else {
            // ── INSERT new note + card ──
            const noteResult = db.prepare(`
              INSERT INTO notes (user_id, guid, notetype_id, tags, fields, sort_field)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(targetUserId, srcNote.guid, newNotetypeId, srcNote.tags, srcNote.fields, srcNote.sort_field);
            const newNoteId = noteResult.lastInsertRowid as number;
            notesCreated++;

            const srcCards = db.prepare(`
              SELECT template_idx FROM cards WHERE note_id = ? AND user_id = ?
            `).all(srcNote.id, adminUserId) as any[];
            for (const sc of srcCards) {
              db.prepare(`
                INSERT INTO cards (user_id, note_id, deck_id, template_idx, queue, due, interval, ease_factor, reps, lapses, remaining_steps, original_deck_id, flags)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
              `).run(targetUserId, newNoteId, targetDeckId, sc.template_idx,
                0, now + cardsCreated, 0, 2.5, 0, 0, 0, 0);
              cardsCreated++;
            }
          }
        }
      } else {
        // ── New deck: just copy everything ──
        for (const srcNote of sourceNotes) {
          const newNotetypeId = notetypeMap.get(srcNote.notetype_id);
          if (!newNotetypeId) continue;

          const noteResult = db.prepare(`
            INSERT INTO notes (user_id, guid, notetype_id, tags, fields, sort_field)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(targetUserId, srcNote.guid, newNotetypeId, srcNote.tags, srcNote.fields, srcNote.sort_field);
          const newNoteId = noteResult.lastInsertRowid as number;
          notesCreated++;

          const srcCards = db.prepare(`
            SELECT template_idx FROM cards WHERE note_id = ? AND user_id = ?
          `).all(srcNote.id, adminUserId) as any[];
          for (const sc of srcCards) {
            db.prepare(`
              INSERT INTO cards (user_id, note_id, deck_id, template_idx, queue, due, interval, ease_factor, reps, lapses, remaining_steps, original_deck_id, flags)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
            `).run(targetUserId, newNoteId, targetDeckId, sc.template_idx,
              0, now + cardsCreated, 0, 2.5, 0, 0, 0, 0);
            cardsCreated++;
          }
        }
      }

      return { notesCreated, notesUpdated, cardsCreated, cardsSkipped, notesDeleted, cardsDeleted };
    });

    const result = syncContent();

    const statsText = isUpdate
      ? `更新 ${result.notesUpdated} 条笔记，新增 ${result.notesCreated} 条，清除 ${result.notesDeleted} 条旧笔记，${result.cardsCreated} 张新卡片`
      : `${result.notesCreated} 条笔记，${result.cardsCreated} 张卡片`;

    const actionLabel = isUpdate ? '已更新' : '已发送';

    return {
      isUpdate,
      stats: result,
      sourceDeckName: sourceDeck.name,
      targetUsername: targetUser.username,
      message: `已将牌组「${sourceDeck.name}」${actionLabel}给 ${targetUser.username}（${statsText}）`,
    };
  } catch (err: any) {
    throw err;
  }
}

// POST /decks/:deckId/send — 管理员推送牌组给单个用户（书架模式兼容保留）
router.post('/decks/:deckId/send', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deckId = parseInt(req.params.deckId);
    const { targetUserId } = req.body;
    if (!targetUserId) {
      res.status(400).json({ error: '请指定目标用户' });
      return;
    }
    const result = sendDeckToUser(db, deckId, libraryOwnerId(), targetUserId);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});



// ── Shelf 上架/下架 (2026-08-21) ─────────────────────────────────────
// PUT /admin/decks/:deckId/publish — 上架(published=1) / 下架(published=0)
// 下架时同时删除所有用户端副本（用户自助添加的牌组），admin 源牌组保留
router.put('/decks/:deckId/publish', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deckId = parseInt(req.params.deckId);
    const published = req.body.published ? 1 : 0;

    const deck = db.prepare('SELECT id, name FROM decks WHERE id = ? AND user_id = ?')
      .get(deckId, libraryOwnerId()) as any;
    if (!deck) {
      res.status(404).json({ error: '牌组不存在' });
      return;
    }

    if (published === 1) {
      db.prepare('UPDATE decks SET published = 1 WHERE id = ?').run(deckId);
      res.json({ success: true, published: 1 });
      return;
    }

    // 下架：删除所有用户端副本（按 source_deck_id 匹配）
    const copies = db.prepare(
      'SELECT id, user_id FROM decks WHERE source_deck_id = ? AND user_id != ?'
    ).all(deckId, libraryOwnerId()) as any[];

    const removeCopies = db.transaction(() => {
      for (const c of copies) {
        const noteRows = db.prepare('SELECT DISTINCT note_id FROM cards WHERE deck_id = ?').all(c.id) as any[];
        db.prepare('DELETE FROM cards WHERE deck_id = ?').run(c.id);
        for (const r of noteRows) {
          const ref = db.prepare('SELECT COUNT(*) AS c FROM cards WHERE note_id = ?').get(r.note_id) as any;
          if (ref.c === 0) {
            db.prepare('DELETE FROM notes WHERE id = ?').run(r.note_id);
          }
        }
        db.prepare('DELETE FROM deck_config WHERE deck_id = ?').run(c.id);
        db.prepare('DELETE FROM decks WHERE id = ?').run(c.id);
      }
      db.prepare('UPDATE decks SET published = 0 WHERE id = ?').run(deckId);
    });
    removeCopies();

    res.json({ success: true, published: 0, removedCopies: copies.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Merge Decks ──────────────────────────────────────────────────────

// Merge multiple admin decks into one big deck (copies notes & cards)
router.post('/decks/merge', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { sourceDeckIds, newDeckName, description } = req.body;

    if (!sourceDeckIds || !Array.isArray(sourceDeckIds) || sourceDeckIds.length < 2) {
      res.status(400).json({ error: '请选择至少两个牌组进行合并' });
      return;
    }
    if (!newDeckName || !newDeckName.trim()) {
      res.status(400).json({ error: '请为新牌组命名' });
      return;
    }

    // Verify all source decks belong to admin
    const placeholders = sourceDeckIds.map(() => '?').join(',');
    const ownDecks = db.prepare(
      `SELECT id, name FROM decks WHERE id IN (${placeholders}) AND user_id = ?`
    ).all(...sourceDeckIds, libraryOwnerId()) as any[];

    if (ownDecks.length !== sourceDeckIds.length) {
      res.status(400).json({ error: '部分牌组不存在或不属于你' });
      return;
    }

    // ── 嵌套合并（2026-09-28 老师需求）─────────────────────────────
    // 旧逻辑：只要一个牌组「已经被合并进别的大牌组」或「本身是个大牌组」就拒绝，
    //        导致大牌组永远不能再往上并一层。
    // 新逻辑：两种情况区分对待 ——
    //   · 仅「合并进别的大牌组」→ 现在允许（老师要求：小卡组并进大卡组后
    //     仍可以继续并进其他大卡组）。复制阶段由 collectEffectiveSourceDeckIds
    //     向下展开到叶子牌组取全内容，提交后由 remapNestedSourcesToNewMergedDeck
    //     把这些下层源牌组改挂到新大牌组；旧大牌组若被搬空会自动删除。
    //   · 「本身就是大牌组」→ 仍然禁止直接把大牌组当叶子并进去，
    //     必须先把它的源牌组恢复独立（解散）后再合并。否则两个大牌组会
    //     出现内容重叠，重新 resync 时卡片会翻倍。
    const asSource = db.prepare(
      `SELECT id, name FROM decks
       WHERE id IN (${placeholders}) AND user_id = ? AND merged_into_id IS NOT NULL`
    ).all(...sourceDeckIds, libraryOwnerId()) as any[];

    const bigDecks = db.prepare(
      `SELECT id, name FROM decks
       WHERE id IN (${placeholders}) AND user_id = ? AND EXISTS (
         SELECT 1 FROM decks sd WHERE sd.merged_into_id = decks.id AND sd.user_id = decks.user_id
       )`
    ).all(...sourceDeckIds, libraryOwnerId()) as any[];

    if (bigDecks.length > 0) {
      res.status(400).json({
        error: `大牌组「${bigDecks.map((d: any) => d.name).join('、')}」不能直接参与合并。`
          + `请先解散该大牌组（源牌组会恢复独立），或改选它的源牌组进行合并。`,
        code: 'NESTED_DECK_IS_MERGE_TARGET',
        blockers: bigDecks.map((d: any) => ({ id: d.id, name: d.name })),
      });
      return;
    }

    // 嵌套来源：这些牌组本身已经被合并进别的大牌组，合并时连同它们的源一起搬过来
    const nestedSourceIds = asSource.map((d: any) => d.id);

    // Check no duplicate name
    const existing = db.prepare(
      'SELECT id FROM decks WHERE user_id = ? AND name = ?'
    ).get(libraryOwnerId(), newDeckName.trim());
    if (existing) {
      res.status(400).json({ error: `牌组「${newDeckName}」已存在` });
      return;
    }

    const mergeAll = db.transaction(() => {
      // 0. 收集本次真正要复制的「叶子牌组」——
      //    直接选中的牌组，若本身是被合并进别处的源牌组，则向下展开到它的源牌组。
      //    这样「小卡组A → 大卡组B → 大卡组C」也能正确取到全部内容（含 A 的卡片）。
      const effectiveSourceIds = collectEffectiveSourceDeckIds(db, sourceDeckIds, libraryOwnerId());
      const srcPh = effectiveSourceIds.map(() => '?').join(',');

      // 1. Create the new merged deck
      const deckResult = db.prepare(
        'INSERT INTO decks (user_id, parent_id, name, description) VALUES (?, ?, ?, ?)'
      ).run(libraryOwnerId(), null, newDeckName.trim(), description || '');
      const newDeckId = deckResult.lastInsertRowid as number;

      // 2. Create default deck config
      db.prepare(
        'INSERT INTO deck_config (user_id, deck_id) VALUES (?, ?)'
      ).run(libraryOwnerId(), newDeckId);

      // 3. Collect all notetypes used across source decks
      const usedNotetypes = db.prepare(`
        SELECT DISTINCT n.notetype_id FROM notes n
        JOIN cards c ON c.note_id = n.id
        WHERE c.deck_id IN (${srcPh}) AND c.user_id = ?
      `).all(...effectiveSourceIds, libraryOwnerId()) as any[];

      // Map old notetype IDs → new or existing notetype IDs
      const notetypeMap = new Map<number, number>();
      for (const row of usedNotetypes) {
        const srcNt = db.prepare('SELECT * FROM notetypes WHERE id = ?').get(row.notetype_id) as any;
        if (!srcNt) continue;

        const existingNt = db.prepare(
          'SELECT id FROM notetypes WHERE user_id = ? AND name = ?'
        ).get(libraryOwnerId(), srcNt.name) as any;

        if (existingNt) {
          notetypeMap.set(srcNt.id, existingNt.id);
        } else {
          const ntResult = db.prepare(`
            INSERT INTO notetypes (user_id, name, css, kind, field_names, template_q_format, template_a_format)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(libraryOwnerId(), srcNt.name, srcNt.css, srcNt.kind, srcNt.field_names,
            srcNt.template_q_format, srcNt.template_a_format);
          notetypeMap.set(srcNt.id, ntResult.lastInsertRowid as number);
        }
      }

      // 4. Copy all notes & cards from all source decks
      const sourceCards = db.prepare(`
        SELECT c.*, n.guid, n.notetype_id, n.tags, n.fields, n.sort_field
        FROM cards c
        JOIN notes n ON n.id = c.note_id
        WHERE c.deck_id IN (${srcPh}) AND c.user_id = ?
      `).all(...effectiveSourceIds, libraryOwnerId()) as any[];

      const noteMap = new Map<number, number>();
      let notesCopied = 0, cardsCopied = 0;

      for (const card of sourceCards) {
        // Copy note if not yet copied (dedup by original note_id)
        if (!noteMap.has(card.note_id)) {
          const newNotetypeId = notetypeMap.get(card.notetype_id);
          if (!newNotetypeId) continue;

          const newGuid = uuidv4();
          const noteResult = db.prepare(`
            INSERT INTO notes (user_id, guid, notetype_id, tags, fields, sort_field, source_note_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(libraryOwnerId(), newGuid, newNotetypeId, card.tags, card.fields, card.sort_field, card.note_id);
          noteMap.set(card.note_id, noteResult.lastInsertRowid as number);
          notesCopied++;
        }

        const newNoteId = noteMap.get(card.note_id);
        if (!newNoteId) continue;

        // Copy card — reset to queue=0 (new)
        const now = Math.floor(Date.now() / 1000);
        db.prepare(`
          INSERT INTO cards (user_id, note_id, deck_id, template_idx, queue, due, interval, ease_factor, reps, lapses, remaining_steps, original_deck_id, flags)
          VALUES (?, ?, ?, ?, 0, ?, 0, 2.5, 0, 0, 0, NULL, 0)
        `).run(libraryOwnerId(), newNoteId, newDeckId, card.template_idx, now + cardsCopied);
        cardsCopied++;
      }

      return {
        newDeckId,
        notesCopied,
        cardsCopied,
        sourceCount: sourceDeckIds.length,
        effectiveSourceIds,
        nestedSourceIds,
      };
    });

    const result = mergeAll();

    // Mark all source decks as merged into the new deck (separate transaction — mergeAll already committed)
    const markMerged = db.transaction(() => {
      const stmt = db.prepare('UPDATE decks SET merged_into_id = ?, modified_at = unixepoch() WHERE id = ? AND user_id = ?');
      for (const sid of sourceDeckIds) {
        stmt.run(result.newDeckId, sid, libraryOwnerId());
      }
    });
    markMerged();

    // ── 嵌套修复：把「原本还挂着源牌组」的被选牌组，其源牌组整体搬迁到新大牌组 ──
    // 例：C = merge(B, X)，而此前 B = merge(A)；复制阶段已按叶子展开取到 A。
    //     此处把 A 的 merged_into_id 由 B 改指 C，保证「重新同步」在 C 上
    //     依然能找到完整源集合，不会因为只看得见 B 而丢掉 A。
    // B 若因此变成空壳大牌组则直接删除。
    const nestedMoved = remapNestedSourcesToNewMergedDeck(
      db, result.newDeckId, result.nestedSourceIds, libraryOwnerId()
    );

    const newDeck = db.prepare('SELECT * FROM decks WHERE id = ?').get(result.newDeckId);
    res.json({
      success: true,
      deck: newDeck,
      sourceDeckIds,
      nestedMoved,
      message: `已将 ${result.sourceCount} 个牌组合并为「${newDeckName}」（${result.notesCopied} 条笔记，${result.cardsCopied} 张卡片）`
        + (nestedMoved.length > 0 ? `，并收纳了 ${nestedMoved.length} 个下层源牌组` : ''),
      stats: { notesCopied: result.notesCopied, cardsCopied: result.cardsCopied },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Re-sync merged deck from source decks ─────────────────────────────
//
// When admin edits source (individual) decks, run this to propagate changes
// to the merged deck. Uses source_note_id to match existing notes so that
// GUIDs stay stable — user push will then pick up the updates correctly.
router.post('/decks/:deckId/resync', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deckId = parseInt(req.params.deckId);

    // Verify the deck exists, belongs to admin
    const mergedDeck = db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?')
      .get(deckId, libraryOwnerId()) as any;
    if (!mergedDeck) {
      res.status(404).json({ error: '牌组不存在' });
      return;
    }

    // Check it has source decks
    const sourceDecks = db.prepare(
      'SELECT id, name FROM decks WHERE merged_into_id = ? AND user_id = ?'
    ).all(deckId, libraryOwnerId()) as any[];
    if (sourceDecks.length === 0) {
      res.status(400).json({ error: '该牌组没有关联的源牌组，无法同步' });
      return;
    }

    resyncMergedDeck(db, deckId, libraryOwnerId());
    res.json({ success: true, message: `已从 ${sourceDecks.length} 个源牌组重新同步` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 同步主牌组到所有学生副本 ──────────────────────────────────
// 按 guid 补齐副本中缺失的笔记/卡片：只增不删，不重置学生进度。
// 为什么需要：主牌组补内容后，学生手里的副本是独立拷贝，不会自动跟进。
/**
 * 【2026-10-21】从牌组中拆出选中卡片，生成一个独立的新牌组。
 * 为什么需要：主牌组越并越大（例如把「而」并进 150 实词），
 * 事后想单独拎出来只能写 SQL。这里给管理端一个可复用的入口。
 *
 * body: { name: string, noteIds: number[] }
 * 只移动「属于该牌组」的卡片，笔记本身不动（同一 note 可能还有别的模板卡）。
 */
router.post('/decks/:deckId/extract', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deckId = Number(req.params.deckId);
    const name = String(req.body?.name || '').trim();
    const rawNoteIds: any[] = Array.isArray(req.body?.noteIds) ? (req.body.noteIds as any[]) : [];
    const noteIds: number[] = Array.from(
      new Set(
        rawNoteIds
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && n > 0)
      )
    );

    if (!name) { res.status(400).json({ error: '请填写新牌组名称' }); return; }
    if (name.length > 40) { res.status(400).json({ error: '名称过长（最多 40 字）' }); return; }
    if (!noteIds.length) { res.status(400).json({ error: '请至少选择一张卡片' }); return; }

    const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(deckId) as any;
    if (!deck) { res.status(404).json({ error: '牌组不存在' }); return; }

    const ph = noteIds.map(() => '?').join(',');
    const total = Number(
      (db.prepare(
        `SELECT COUNT(*) c FROM cards WHERE deck_id = ? AND user_id = ? AND note_id IN (${ph})`
      ).get(deckId, deck.user_id, ...noteIds) as any)?.c || 0
    );
    if (!total) { res.status(400).json({ error: '选中的卡片不在该牌组内' }); return; }

    const run = db.transaction(() => {
      const info = db.prepare(
        `INSERT INTO decks (user_id, parent_id, name, description, created_at, modified_at, published)
         VALUES (?, ?, ?, '', unixepoch(), unixepoch(), 0)`
      ).run(deck.user_id, deck.parent_id ?? null, name);
      const newDeckId = Number(info.lastInsertRowid);
      const moved = db.prepare(
        `UPDATE cards SET deck_id = ?, modified_at = unixepoch()
          WHERE deck_id = ? AND user_id = ? AND note_id IN (${ph})`
      ).run(newDeckId, deckId, deck.user_id, ...noteIds);
      db.prepare('UPDATE decks SET modified_at = unixepoch() WHERE id = ?').run(deckId);
      return { newDeckId, moved: moved.changes };
    });

    const r = run();
    res.json({ success: true, newDeckId: r.newDeckId, movedCards: r.moved, deckName: name });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/decks/:deckId/sync-copies', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deckId = parseInt(req.params.deckId);
    const master = db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?')
      .get(deckId, libraryOwnerId()) as any;
    if (!master) {
      res.status(404).json({ error: '牌组不存在' });
      return;
    }
    const stats = syncDeckToCopies(db, deckId, libraryOwnerId());
    res.json({
      success: true,
      message: `已同步到 ${stats.copies} 个副本（新增 ${stats.notes} 条笔记、${stats.cards} 张卡片）`,
      stats,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function syncDeckToCopies(db: any, masterId: number, adminId: number) {
  const masterCards = db.prepare(`
    SELECT n.guid, n.notetype_id, n.tags, n.fields, n.sort_field, c.template_idx
    FROM cards c JOIN notes n ON n.id = c.note_id
    WHERE c.deck_id = ? AND c.user_id = ?
  `).all(masterId, adminId) as any[];
  if (!masterCards.length) return { copies: 0, notes: 0, cards: 0 };

  const srcNotetype = db.prepare('SELECT * FROM notetypes WHERE id = ?')
    .get(masterCards[0].notetype_id) as any;
  if (!srcNotetype) return { copies: 0, notes: 0, cards: 0 };

  const copies = db.prepare(
    'SELECT id, user_id FROM decks WHERE source_deck_id = ? AND id != ?'
  ).all(masterId, masterId) as any[];

  let touched = 0, notesAdded = 0, cardsAdded = 0;

  db.transaction(() => {
    for (const copy of copies) {
      const existing = new Set(
        db.prepare('SELECT n.guid FROM cards c JOIN notes n ON n.id = c.note_id WHERE c.deck_id = ?')
          .all(copy.id).map((r: any) => r.guid)
      );
      const missing = masterCards.filter((m: any) => !existing.has(m.guid));
      if (!missing.length) continue;

      let nt = db.prepare('SELECT id FROM notetypes WHERE user_id = ? AND name = ?')
        .get(copy.user_id, srcNotetype.name) as any;
      if (!nt) {
        const r = db.prepare(`INSERT INTO notetypes (user_id, name, css, kind, field_names, template_q_format, template_a_format)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(copy.user_id, srcNotetype.name, srcNotetype.css, srcNotetype.kind,
            srcNotetype.field_names, srcNotetype.template_q_format, srcNotetype.template_a_format);
        nt = { id: r.lastInsertRowid };
      }

      const now = Math.floor(Date.now() / 1000);
      for (const m of missing) {
        const nr = db.prepare('INSERT INTO notes (user_id, guid, notetype_id, tags, fields, sort_field) VALUES (?, ?, ?, ?, ?, ?)')
          .run(copy.user_id, m.guid, nt.id, m.tags, m.fields, m.sort_field);
        db.prepare(`INSERT INTO cards
          (user_id, note_id, deck_id, template_idx, queue, due, interval, ease_factor, reps, lapses,
           remaining_steps, original_deck_id, flags, created_at, modified_at, study_round)
          VALUES (?, ?, ?, ?, 0, ?, 0, 2.5, 0, 0, 0, NULL, 0, ?, ?, 0)`)
          .run(copy.user_id, nr.lastInsertRowid, copy.id, m.template_idx, now, now, now);
        notesAdded++;
        cardsAdded++;
      }
      touched++;
    }
  })();

  return { copies: touched, notes: notesAdded, cards: cardsAdded };
}

// ── Admin Card Management ────────────────────────────────────────────

// Get notetypes for a specific user
router.get('/users/:userId/notetypes', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    // 【2026-10-12】制卡中心是共享牌组库，笔记类型必须取「牌组库所有者」的，
    // 否则新管理员拿到的会是自己名下那套（线上是空的），建卡时 notetype 对不上。
    const userId = libraryOwnerId();
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) {
      res.status(404).json({ error: '牌组库所有者不存在' });
      return;
    }
    const notetypes = db.prepare('SELECT * FROM notetypes WHERE user_id = ? ORDER BY name').all(userId);
    res.json(notetypes);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get all notes+cards for a specific user & deck
router.get('/users/:userId/decks/:deckId/notes', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deckId = parseInt(req.params.deckId);

    // 【2026-10-12】改为「按牌组找它的真实所有者」，而不是信 URL 里的 userId。
    // 之前浏览器地址栏/userId 传的是当前登录管理员，换人后牌组归属对不上，
    // 右栏就会显示「该牌组暂无卡片」。现在无论谁登录，读的都是同一份数据。
    const deck = db.prepare('SELECT id, name, user_id FROM decks WHERE id = ?').get(deckId) as any;
    if (!deck) {
      res.status(404).json({ error: '牌组不存在' });
      return;
    }
    const userId = deck.user_id;
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      res.status(404).json({ error: '牌组所有者不存在' });
      return;
    }

    // Get all notes in this deck with their cards and notetype info
    const rows = db.prepare(`
      SELECT n.id as note_id, n.fields, n.tags, n.notetype_id, n.sort_field,
             nt.name as notetype_name, nt.field_names,
             c.id as card_id, c.template_idx, c.queue, c.reps, c.interval
      FROM notes n
      JOIN notetypes nt ON nt.id = n.notetype_id
      LEFT JOIN cards c ON c.note_id = n.id AND c.deck_id = ? AND c.user_id = ?
      WHERE n.user_id = ?
        AND n.id IN (SELECT note_id FROM cards WHERE deck_id = ? AND user_id = ?)
      ORDER BY n.sort_field
    `).all(deckId, userId, userId, deckId, userId) as any[];

    // Collapse by note
    const noteMap = new Map<number, any>();
    for (const row of rows) {
      if (!noteMap.has(row.note_id)) {
        let fields: string[];
        let fieldNames: string[];
        try { fields = JSON.parse(row.fields); } catch { fields = []; }
        try { fieldNames = JSON.parse(row.field_names); } catch { fieldNames = []; }

        noteMap.set(row.note_id, {
          id: row.note_id,
          notetypeId: row.notetype_id,
          notetypeName: row.notetype_name,
          fieldNames,
          fields,
          tags: row.tags || '',
          cards: [],
        });
      }
      if (row.card_id) {
        noteMap.get(row.note_id).cards.push({
          id: row.card_id,
          templateIdx: row.template_idx,
          queue: row.queue,
          reps: row.reps,
          interval: row.interval,
        });
      }
    }

    res.json({
      username: user.username,
      deckName: deck.name,
      notes: Array.from(noteMap.values()),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin create a note (for any user)
router.post('/notes', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { notetypeId, deckId, fields, tags } = req.body;
    if (!notetypeId || !deckId || !fields || fields.length === 0) {
      res.status(400).json({ error: '笔记类型ID、牌组ID和字段不能为空' });
      return;
    }

    // 【2026-10-12】新建卡片一律落到「牌组库所有者」名下，不再用前端传来的
    // adminId —— 否则不同管理员建的卡会分散在不同的 user_id 上。
    const userId = libraryOwnerId();

    const { v4: uuidv4 } = require('uuid');
    const guid = uuidv4();
    const fieldsJson = JSON.stringify(fields);
    const sortField = fields[0] || '';

    const result = db.prepare(`
      INSERT INTO notes (user_id, guid, notetype_id, tags, fields, sort_field)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, guid, notetypeId, tags || '', fieldsJson, sortField);

    const noteId = result.lastInsertRowid;

    // Generate card
    const now = Math.floor(Date.now() / 1000);
    const cardResult = db.prepare(`
      INSERT INTO cards (user_id, note_id, deck_id, template_idx, queue, due, interval, ease_factor, reps, lapses, remaining_steps)
      VALUES (?, ?, ?, 0, 0, ?, 0, 2.5, 0, 0, 0)
    `).run(userId, noteId, deckId, now);

    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
    res.status(201).json({ note, cardId: cardResult.lastInsertRowid });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin update a note's fields/tags
router.put('/notes/:id', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { fields, tags } = req.body;
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id) as any;
    if (!note) {
      res.status(404).json({ error: '笔记不存在' });
      return;
    }
    db.prepare(`
      UPDATE notes SET
        fields = COALESCE(?, fields),
        tags = COALESCE(?, tags),
        sort_field = COALESCE(?, sort_field),
        modified_at = unixepoch()
      WHERE id = ?
    `).run(
      fields ? JSON.stringify(fields) : null,
      tags !== undefined ? tags : null,
      fields && fields.length > 0 ? fields[0] : null,
      req.params.id
    );
    const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin delete a note
router.delete('/notes/:id', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const note = db.prepare('SELECT id FROM notes WHERE id = ?').get(req.params.id);
    if (!note) {
      res.status(404).json({ error: '笔记不存在' });
      return;
    }
    db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Force-send deck (replace if exists) ──────────────────────────────

router.post('/decks/:deckId/force-send', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deckId = parseInt(req.params.deckId);
    const { targetUserId } = req.body;

    if (!targetUserId) {
      res.status(400).json({ error: '请指定目标用户' });
      return;
    }

    // Verify the deck belongs to admin
    const sourceDeck = db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?')
      .get(deckId, libraryOwnerId()) as any;
    if (!sourceDeck) {
      res.status(404).json({ error: '牌组不存在' });
      return;
    }

    // Verify target user exists
    const targetUser = db.prepare('SELECT id, username FROM users WHERE id = ?')
      .get(targetUserId) as any;
    if (!targetUser) {
      res.status(404).json({ error: '目标用户不存在' });
      return;
    }

    // Delete existing deck with same name for this user
    const existingDeck = db.prepare('SELECT id FROM decks WHERE user_id = ? AND name = ?')
      .get(targetUserId, sourceDeck.name) as any;
    if (existingDeck) {
      db.prepare('DELETE FROM cards WHERE deck_id = ? AND user_id = ?').run(existingDeck.id, targetUserId);
      db.prepare('DELETE FROM deck_config WHERE deck_id = ? AND user_id = ?').run(existingDeck.id, targetUserId);
      db.prepare('DELETE FROM decks WHERE id = ? AND user_id = ?').run(existingDeck.id, targetUserId);
    }

    // Copy the deck using existing send logic (same as sendDeck but without skip)
    const result = copyDeckToUser(db, deckId, libraryOwnerId(), targetUserId, sourceDeck);
    res.json({
      success: true,
      message: `已更新牌组「${sourceDeck.name}」到 ${targetUser.username}（${result.notesCopied} 条笔记，${result.cardsCopied} 张卡片）${existingDeck ? '（覆盖旧牌组）' : ''}`,
      stats: result,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: copy deck logic extracted from sendDeck
function copyDeckToUser(db: any, deckId: number, adminUserId: number, targetUserId: number, sourceDeck: any): { notesCopied: number; cardsCopied: number } {
  let notesCopied = 0, cardsCopied = 0;
  let newDeckId: number;

  const copyAll = db.transaction(() => {
    // Copy deck
    const deckResult = db.prepare('INSERT INTO decks (user_id, parent_id, name, description) VALUES (?, ?, ?, ?)')
      .run(targetUserId, null, sourceDeck.name, sourceDeck.description);
    newDeckId = deckResult.lastInsertRowid;

    // Copy deck config
    const srcConfig = db.prepare('SELECT * FROM deck_config WHERE deck_id = ? AND user_id = ?')
      .get(deckId, adminUserId) as any;
    if (srcConfig) {
      db.prepare(`INSERT INTO deck_config (user_id, deck_id, learn_steps, relearn_steps, initial_ease, easy_multiplier,
        hard_multiplier, interval_multiplier, maximum_review_interval, minimum_lapse_interval,
        graduating_interval_good, graduating_interval_easy, new_per_day, reviews_per_day,
        leech_threshold, lapse_multiplier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(targetUserId, newDeckId, srcConfig.learn_steps, srcConfig.relearn_steps,
          srcConfig.initial_ease, srcConfig.easy_multiplier, srcConfig.hard_multiplier,
          srcConfig.interval_multiplier, srcConfig.maximum_review_interval,
          srcConfig.minimum_lapse_interval, srcConfig.graduating_interval_good,
          srcConfig.graduating_interval_easy, srcConfig.new_per_day, srcConfig.reviews_per_day,
          srcConfig.leech_threshold, srcConfig.lapse_multiplier);
    }

    // Copy notetypes
    const usedNotetypes = db.prepare(`
      SELECT DISTINCT n.notetype_id FROM notes n
      JOIN cards c ON c.note_id = n.id
      WHERE c.deck_id = ? AND c.user_id = ?
    `).all(deckId, adminUserId) as any[];
    const notetypeMap = new Map();
    for (const row of usedNotetypes) {
      const srcNt = db.prepare('SELECT * FROM notetypes WHERE id = ?').get(row.notetype_id) as any;
      if (!srcNt) continue;
      const existingNt = db.prepare('SELECT id FROM notetypes WHERE user_id = ? AND name = ?')
        .get(targetUserId, srcNt.name) as any;
      if (existingNt) {
        notetypeMap.set(srcNt.id, existingNt.id);
      } else {
        const ntResult = db.prepare(`INSERT INTO notetypes (user_id, name, css, kind, field_names, template_q_format, template_a_format)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(targetUserId, srcNt.name, srcNt.css, srcNt.kind, srcNt.field_names, srcNt.template_q_format, srcNt.template_a_format);
        notetypeMap.set(srcNt.id, ntResult.lastInsertRowid);
      }
    }

    // Copy notes and cards
    const sourceCards = db.prepare(`
      SELECT c.*, n.guid, n.notetype_id, n.tags, n.fields, n.sort_field
      FROM cards c
      JOIN notes n ON n.id = c.note_id
      WHERE c.deck_id = ? AND c.user_id = ?
    `).all(deckId, adminUserId) as any[];
    const noteMap = new Map();
    for (const card of sourceCards) {
      if (!noteMap.has(card.note_id)) {
        const newNotetypeId = notetypeMap.get(card.notetype_id);
        if (!newNotetypeId) continue;
        // 复用源笔记 guid：避免下次"发送卡组"整组删除重建导致学生进度清零(2026-09-14 事故)
        const newGuid = card.guid;
        const noteResult = db.prepare(`INSERT INTO notes (user_id, guid, notetype_id, tags, fields, sort_field)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .run(targetUserId, newGuid, newNotetypeId, card.tags, card.fields, card.sort_field);
        noteMap.set(card.note_id, noteResult.lastInsertRowid);
        notesCopied++;
      }
      const newNoteId = noteMap.get(card.note_id);
      if (!newNoteId) continue;
      const now = Math.floor(Date.now() / 1000);
      db.prepare(`INSERT INTO cards (user_id, note_id, deck_id, template_idx, queue, due, interval, ease_factor, reps, lapses, remaining_steps, original_deck_id, flags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
        .run(targetUserId, newNoteId, newDeckId, card.template_idx, 0, now + cardsCopied, 0, 2.5, 0, 0, 0, 0);
      cardsCopied++;
    }
  });
  copyAll();
  return { notesCopied, cardsCopied };
}

// ── 嵌套合并辅助 ─────────────────────────────────────────────────────
//
// 【2026-09-28 老师需求】小卡组合并进大卡组后，仍要能继续合并进其他大卡组。
//
// 数据模型提醒：大牌组并没有 parent_id 关系，只靠两层字段描述 —
//   · decks.merged_into_id  指向"我上交给谁"（源牌组 → 大牌组）
//   · notes.source_note_id  指向"我这条笔记复制的原稿"（大牌组 → 源牌组）
// 因此嵌套时会出现 A → B → C 的链条（B 既是 A 的目标，又是 C 的源）。
// 下面两个函数负责在链条上正确地「展开」与「搬迁」。

/** 找出一个牌组的所有源牌组 id（只查一层） */
function directSourceDeckIds(db: any, deckId: number, userId: number): number[] {
  const rows = db.prepare(
    'SELECT id FROM decks WHERE merged_into_id = ? AND user_id = ?'
  ).all(deckId, userId) as any[];
  return rows.map(r => r.id);
}

/**
 * 把选中的牌组展开成「叶子牌组」集合。
 * 若被选中的牌组本身是别处大牌组的源牌组（merged_into_id 非空），
 * 说明它的内容其实来自它自己的源牌组 —— 递归向下展开，
 * 这样 A → B → C 时，合并 C 才能真正拿到 A 里的卡片。
 * 带 visited 防环，防止脏数据造成死循环。
 */
function collectEffectiveSourceDeckIds(db: any, deckIds: number[], userId: number): number[] {
  const out = new Set<number>();
  const visited = new Set<number>();

  const walk = (id: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    const children = directSourceDeckIds(db, id, userId);
    if (children.length === 0) {
      out.add(id);
      return;
    }
    for (const c of children) walk(c);
  };

  for (const id of deckIds) walk(id);
  return [...out];
}

/**
 * 把被选中的「下层大牌组」的源牌组整体改挂到新大牌组上。
 *
 * @param nestedSourceIds 本次被选中、且本身是别处大牌组源牌组的 deck id
 * @returns 实际被搬迁的源牌组信息（用于提示老师）
 *
 * 搬迁完成后，若某个旧大牌组已经一个源牌组都不剩（说明它的全部内容
 * 都并到了新牌组），就直接删除这个空壳，避免列表里残留一个点进去没用的牌组。
 */
function remapNestedSourcesToNewMergedDeck(
  db: any,
  newMergedDeckId: number,
  nestedSourceIds: number[],
  userId: number
): { oldMergedDeckId: number; oldMergedDeckName: string; movedDeckNames: string[]; removedEmptyDeck: boolean }[] {
  if (nestedSourceIds.length === 0) return [];

  const moved: any[] = [];

  const tx = db.transaction(() => {
    for (const oldId of nestedSourceIds) {
      const grandChildIds = directSourceDeckIds(db, oldId, userId);
      if (grandChildIds.length === 0) continue;

      const oldDeck = db.prepare('SELECT id, name FROM decks WHERE id = ? AND user_id = ?')
        .get(oldId, userId) as any;
      const names = (db.prepare(
        `SELECT name FROM decks WHERE id IN (${grandChildIds.map(() => '?').join(',')}) AND user_id = ?`
      ).all(...grandChildIds, userId) as any[]).map(r => r.name);

      // 搬迁：这层源牌组现在直接挂到新大牌组下
      db.prepare(
        'UPDATE decks SET merged_into_id = ?, modified_at = unixepoch() WHERE merged_into_id = ? AND user_id = ?'
      ).run(newMergedDeckId, oldId, userId);

      // 旧大牌组若已无源牌组且自身无卡片 → 空壳，删掉
      const remainingSources = directSourceDeckIds(db, oldId, userId).length;
      const ownCards = (db.prepare(
        'SELECT COUNT(*) AS c FROM cards WHERE deck_id = ? AND user_id = ?'
      ).get(oldId, userId) as any).c;
      let removedEmptyDeck = false;
      if (remainingSources === 0 && ownCards === 0) {
        db.prepare('DELETE FROM deck_config WHERE deck_id = ? AND user_id = ?').run(oldId, userId);
        db.prepare('DELETE FROM decks WHERE id = ? AND user_id = ?').run(oldId, userId);
        removedEmptyDeck = true;
      }

      moved.push({
        oldMergedDeckId: oldId,
        oldMergedDeckName: oldDeck?.name || String(oldId),
        movedDeckNames: names,
        removedEmptyDeck,
      });
    }
  });
  tx();

  return moved;
}

// ── 修改大牌组（改名 / 改描述）────────────────────────────────────────
//
// 【2026-09-28 老师需求】老师希望能直接改大牌组的名字和说明。
// 以前只能解散重建，但解散会丢掉大牌组的 id，已经推送给学生的副本
// 靠 source_deck_id 关联，重新建会变成"新牌组"，学生端进度对不上。
// 所以这里提供原地修改：只动 name / description，内容一行不碰。
router.put('/decks/:deckId', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deckId = parseInt(req.params.deckId);
    const { name, description } = req.body;

    const deck = db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?')
      .get(deckId, libraryOwnerId()) as any;
    if (!deck) {
      res.status(404).json({ error: '牌组不存在' });
      return;
    }

    if (name !== undefined && !String(name).trim()) {
      res.status(400).json({ error: '牌组名称不能为空' });
      return;
    }

    // 改名查重（排除自己）
    if (name !== undefined && String(name).trim() !== deck.name) {
      const dup = db.prepare(
        'SELECT id FROM decks WHERE user_id = ? AND name = ? AND id != ?'
      ).get(libraryOwnerId(), String(name).trim(), deckId) as any;
      if (dup) {
        res.status(400).json({ error: `牌组「${String(name).trim()}」已存在` });
        return;
      }
    }

    db.prepare(`
      UPDATE decks SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        modified_at = unixepoch()
      WHERE id = ? AND user_id = ?
    `).run(
      name !== undefined ? String(name).trim() : null,
      description !== undefined ? String(description) : null,
      deckId,
      libraryOwnerId()
    );

    const updated = db.prepare('SELECT * FROM decks WHERE id = ?').get(deckId) as any;
    const isMerged = (directSourceDeckIds(db, deckId, libraryOwnerId()).length > 0);

    res.json({
      success: true,
      deck: updated,
      isMergedDeck: isMerged,
      // 大牌组改名不会自动传播到已推送的学生副本（学生端靠 source_deck_id 关联，
      // 需要重新"发送卡组"才会更新名称）——这里明确提示老师。
      message: isMerged
        ? `已更新大牌组「${updated.name}」。注意：已推送给学生的副本需重新发送才会同步新名称。`
        : `已更新牌组「${updated.name}」`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Shared resync helper — syncs merged deck from its source decks ──
function resyncMergedDeck(db: any, deckId: number, userId: number): void {
  // Find source decks
  const sourceDecks = db.prepare(
    'SELECT id, name FROM decks WHERE merged_into_id = ? AND user_id = ?'
  ).all(deckId, userId) as any[];
  if (sourceDecks.length === 0) return;

  // 嵌套合并支持：源牌组里若还有「本身是大牌组」的（A → B → C 链条），
  // 递归向下展开成叶子牌组，否则会漏掉更深一层的卡片。
  const sourceDeckIds = collectEffectiveSourceDeckIds(
    db, sourceDecks.map((d: any) => d.id), userId
  );
  if (sourceDeckIds.length === 0) return;

  const placeholders = sourceDeckIds.map(() => '?').join(',');

  // Map notetypes
  const usedNotetypes = db.prepare(`
    SELECT DISTINCT n.notetype_id FROM notes n
    JOIN cards c ON c.note_id = n.id
    WHERE c.deck_id IN (${placeholders}) AND c.user_id = ?
  `).all(...sourceDeckIds, userId) as any[];
  const notetypeMap = new Map<number, number>();
  for (const row of usedNotetypes) {
    const srcNt = db.prepare('SELECT * FROM notetypes WHERE id = ?').get(row.notetype_id) as any;
    if (!srcNt) continue;
    const existingNt = db.prepare('SELECT id FROM notetypes WHERE user_id = ? AND name = ?').get(userId, srcNt.name) as any;
    if (existingNt) {
      notetypeMap.set(srcNt.id, existingNt.id);
    } else {
      const ntResult = db.prepare(`
        INSERT INTO notetypes (user_id, name, css, kind, field_names, template_q_format, template_a_format)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(userId, srcNt.name, srcNt.css, srcNt.kind, srcNt.field_names,
        srcNt.template_q_format, srcNt.template_a_format);
      notetypeMap.set(srcNt.id, ntResult.lastInsertRowid as number);
    }
  }

  // Sync notes & cards
  db.transaction(() => {
    const sourceNotes = db.prepare(`
      SELECT n.id, n.guid, n.notetype_id, n.tags, n.fields, n.sort_field
      FROM notes n JOIN cards c ON c.note_id = n.id
      WHERE c.deck_id IN (${placeholders}) AND c.user_id = ?
    `).all(...sourceDeckIds, userId) as any[];
    const sourceNoteById = new Map<number, any>();
    for (const sn of sourceNotes) sourceNoteById.set(sn.id, sn);

    const mergedNotes = db.prepare(`
      SELECT n.id, n.guid, n.source_note_id, n.notetype_id, n.tags, n.fields, n.sort_field
      FROM notes n JOIN cards c ON c.note_id = n.id
      WHERE c.deck_id = ? AND c.user_id = ?
    `).all(deckId, userId) as any[];
    const mergedNoteBySourceId = new Map<number, any>();
    const orphanMergedNotes: any[] = [];
    for (const mn of mergedNotes) {
      if (mn.source_note_id) {
        mergedNoteBySourceId.set(mn.source_note_id, mn);
      } else {
        orphanMergedNotes.push(mn); // NULL source_note_id — handle before main loop
      }
    }

    const now = Math.floor(Date.now() / 1000);

    // Handle legacy orphan notes (NULL source_note_id) — match by content or remove
    for (const mn of orphanMergedNotes) {
      const match = sourceNotes.find((sn: any) =>
        sn.notetype_id === mn.notetype_id && sn.sort_field === mn.sort_field && sn.fields === mn.fields
      );
      if (match) {
        db.prepare('UPDATE notes SET source_note_id = ?, modified_at = ? WHERE id = ? AND user_id = ?')
          .run(match.id, now, mn.id, userId);
        mergedNoteBySourceId.set(match.id, mn);
      } else {
        db.prepare('DELETE FROM cards WHERE note_id = ? AND user_id = ?').run(mn.id, userId);
        db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(mn.id, userId);
      }
    }

    let cardsCreated = 0;

    for (const srcNote of sourceNotes) {
      const newNotetypeId = notetypeMap.get(srcNote.notetype_id);
      if (!newNotetypeId) continue;

      if (mergedNoteBySourceId.has(srcNote.id)) {
        // UPDATE existing merged note
        const mergedNote = mergedNoteBySourceId.get(srcNote.id);
        db.prepare(`UPDATE notes SET notetype_id = ?, tags = ?, fields = ?, sort_field = ?,
          modified_at = ? WHERE id = ? AND user_id = ?`)
          .run(newNotetypeId, srcNote.tags, srcNote.fields, srcNote.sort_field, now, mergedNote.id, userId);
      } else {
        // INSERT new note + card
        const { v4: uuidv4 } = require('uuid');
        const noteResult = db.prepare(`
          INSERT INTO notes (user_id, guid, notetype_id, tags, fields, sort_field, source_note_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(userId, uuidv4(), newNotetypeId, srcNote.tags, srcNote.fields, srcNote.sort_field, srcNote.id);
        const newNoteId = noteResult.lastInsertRowid as number;
        const srcCards = db.prepare(`SELECT template_idx FROM cards WHERE note_id = ? AND user_id = ?`)
          .all(srcNote.id, userId) as any[];
        for (const sc of srcCards) {
          db.prepare(`INSERT INTO cards (user_id, note_id, deck_id, template_idx, queue, due, interval,
            ease_factor, reps, lapses, remaining_steps, original_deck_id, flags)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
            .run(userId, newNoteId, deckId, sc.template_idx, 0, now + cardsCreated, 0, 2.5, 0, 0, 0, 0);
          cardsCreated++;
        }
      }
    }

    // Remove stale merged notes
    for (const mn of mergedNotes) {
      if (mn.source_note_id && !sourceNoteById.has(mn.source_note_id)) {
        db.prepare('DELETE FROM cards WHERE note_id = ? AND user_id = ?').run(mn.id, userId);
        db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(mn.id, userId);
      }
    }
  })();
}

export default router;
