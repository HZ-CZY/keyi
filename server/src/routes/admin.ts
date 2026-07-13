import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database';
import { adminMiddleware, AuthRequest } from '../middleware/auth';
import { getOnlineCount, getOnlineUserIds, recordHeartbeat, getOnlineUserDetails } from '../online-tracker';

const router = Router();
router.use(adminMiddleware);

// Get all users
router.get('/users', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const users = db.prepare(`
      SELECT u.id, u.username, u.role, u.created_at, u.last_login_at,
        (SELECT COUNT(*) FROM cards c WHERE c.user_id = u.id) as card_count,
        (SELECT COUNT(*) FROM decks d WHERE d.user_id = u.id) as deck_count
      FROM users u
      ORDER BY u.created_at DESC
    `).all();
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create a user (admin)
router.post('/users', (req: AuthRequest, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: '需要用户名和密码' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: '密码至少需要6个字符' });
      return;
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      res.status(409).json({ error: '用户名已存在' });
      return;
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const result = db.prepare(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'user')"
    ).run(username, passwordHash);

    const userId = result.lastInsertRowid as number;

    // Create default deck
    db.prepare(
      'INSERT INTO decks (user_id, name, description) VALUES (?, ?, ?)'
    ).run(userId, '默认', '默认牌组');

    // Create default notetype
    db.prepare(
      `INSERT INTO notetypes (user_id, name, css, kind, field_names, template_q_format, template_a_format) VALUES (?, 'Basic', ?, 'normal', '["Front","Back"]', '{{Front}}', '{{FrontSide}}<hr>{{Back}}')`
    ).run(userId, '.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }');

    // Create MCQ notetype
    db.prepare(
      `INSERT INTO notetypes (user_id, name, css, kind, field_names, template_q_format, template_a_format) VALUES (?, '选择题', ?, 'normal', '["题目","选项A","选项B","选项C","选项D","答案","解析"]', '<div class=mcq>{{题目}}</div><div class=options><p><span class=opt>A.</span> {{选项A}}</p><p><span class=opt>B.</span> {{选项B}}</p><p><span class=opt>C.</span> {{选项C}}</p><p><span class=opt>D.</span> {{选项D}}</p></div>', '<div class=mcq>{{题目}}</div><div class=options><p><span class=opt>A.</span> {{选项A}}</p><p><span class=opt>B.</span> {{选项B}}</p><p><span class=opt>C.</span> {{选项C}}</p><p><span class=opt>D.</span> {{选项D}}</p></div><hr><div class=answer>正确答案：{{答案}}</div><div class=explanation>{{解析}}</div>')`
    ).run(userId, '.card{font-family:arial;font-size:18px;line-height:1.6}.mcq{font-size:20px;font-weight:bold;margin-bottom:16px}.options p{margin:8px 0;padding:10px 14px;border:1px solid #e5e7eb;border-radius:10px}.opt{display:inline-block;width:24px;font-weight:bold;color:#6366f1}.answer{font-size:18px;color:#16a34a;font-weight:bold;margin-top:12px}.explanation{margin-top:8px;color:#6b7280;font-size:15px}');

    res.status(201).json({ id: userId, username, role: 'user' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a user
router.delete('/users/:id', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const targetId = parseInt(req.params.id);

    // Can't delete yourself
    if (targetId === req.userId) {
      res.status(400).json({ error: '不能删除自己的账号' });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
    if (!existing) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Reset user password
router.put('/users/:id/password', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { password } = req.body;
    if (!password || password.length < 6) {
      res.status(400).json({ error: '密码至少需要6个字符' });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!existing) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin update username for a user
router.put('/users/:id/username', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { username } = req.body;
    if (!username || username.trim().length < 1) {
      res.status(400).json({ error: '用户名不能为空' });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!existing) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    // Check if username already taken by another user
    const conflict = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username.trim(), parseInt(req.params.id));
    if (conflict) {
      res.status(409).json({ error: '用户名已被使用' });
      return;
    }

    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username.trim(), req.params.id);
    res.json({ success: true, username: username.trim() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get user decks with card stats
router.get('/users/:id/decks', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const targetId = parseInt(req.params.id);

    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetId) as any;
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    const decks = db.prepare(`
      SELECT d.*,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.user_id = d.user_id) as card_count,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.user_id = d.user_id AND c.reps > 0) as reviewed_count,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.user_id = d.user_id
          AND ((c.queue IN (1,3) AND c.due <= unixepoch()) OR (c.queue = 2 AND c.due <= unixepoch()))) as due_count
      FROM decks d
      WHERE d.user_id = ?
      ORDER BY d.name
    `).all(targetId);

    res.json({ username: user.username, decks });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get user learning stats
router.get('/users/:id/stats', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const targetId = parseInt(req.params.id);

    const user = db.prepare('SELECT id, username, created_at, last_login_at FROM users WHERE id = ?').get(targetId) as any;
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    const totalCards = db.prepare('SELECT COUNT(*) as c FROM cards WHERE user_id = ?').get(targetId) as any;
    const dueToday = db.prepare(`
      SELECT COUNT(*) as c FROM cards WHERE user_id = ?
      AND ((queue IN (1,3) AND due <= unixepoch()) OR (queue = 2 AND due <= unixepoch()))
    `).get(targetId) as any;
    const newCards = db.prepare('SELECT COUNT(*) as c FROM cards WHERE user_id = ? AND queue = 0').get(targetId) as any;
    const reviewedCards = db.prepare('SELECT COUNT(*) as c FROM cards WHERE user_id = ? AND reps > 0').get(targetId) as any;
    const todayReviews = db.prepare(`
      SELECT COUNT(*) as c FROM revlog WHERE user_id = ? AND date(reviewed_at, 'unixepoch') = date('now')
    `).get(targetId) as any;

    // Deck count
    const deckCount = db.prepare('SELECT COUNT(*) as c FROM decks WHERE user_id = ?').get(targetId) as any;

    // Calculate streak
    const rows = db.prepare(`
      SELECT DISTINCT date(reviewed_at, 'unixepoch') as review_date
      FROM revlog WHERE user_id = ? ORDER BY review_date DESC LIMIT 365
    `).all(targetId) as any[];

    let streak = 0;
    if (rows.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      let checkDate = new Date(today);
      const dates = new Set(rows.map(r => r.review_date));
      if (!dates.has(today)) {
        checkDate.setDate(checkDate.getDate() - 1);
      }
      for (let i = 0; i < 365; i++) {
        const dateStr = checkDate.toISOString().split('T')[0];
        if (dates.has(dateStr)) { streak++; checkDate.setDate(checkDate.getDate() - 1); }
        else break;
      }
    }

    // Practice history
    const practiceStats = db.prepare(`
      SELECT COUNT(*) as sessions, COALESCE(SUM(total_questions),0) as total, COALESCE(SUM(correct_count),0) as correct
      FROM practice_log WHERE user_id = ?
    `).get(targetId) as any;

    res.json({
      username: user.username,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      totalCards: totalCards.c,
      dueToday: dueToday.c,
      newCards: newCards.c,
      reviewedCards: reviewedCards.c,
      todayReviews: todayReviews.c,
      deckCount: deckCount.c,
      streak,
      practiceAccuracy: practiceStats.total > 0 ? Math.round((practiceStats.correct / practiceStats.total) * 100) : 0,
      practiceSessions: practiceStats.sessions,
      practiceTotal: practiceStats.total,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get registration setting
router.get('/settings/registration', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('registration_enabled') as any;
    res.json({ enabled: setting ? setting.value === '1' : true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle registration
router.put('/settings/registration', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled 必须是布尔值' });
      return;
    }
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('registration_enabled', enabled ? '1' : '0');
    res.json({ success: true, enabled });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

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
    `).all(req.userId);

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
    `).all(deckId, req.userId);
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
      .get(deckId, req.userId) as any;
    if (!deck) {
      res.status(404).json({ error: '牌组不存在' });
      return;
    }

    // Find source decks
    const sourceDecks = db.prepare(
      'SELECT id, name FROM decks WHERE merged_into_id = ? AND user_id = ?'
    ).all(deckId, req.userId) as any[];

    if (sourceDecks.length === 0) {
      res.status(400).json({ error: '该牌组没有关联的源牌组，无法解散' });
      return;
    }

    // Transaction: unmark source decks then delete the merged deck
    const dissolve = db.transaction(() => {
      const unlink = db.prepare(
        'UPDATE decks SET merged_into_id = NULL, modified_at = unixepoch() WHERE merged_into_id = ? AND user_id = ?'
      );
      unlink.run(deckId, req.userId);

      db.prepare('DELETE FROM decks WHERE id = ? AND user_id = ?')
        .run(deckId, req.userId);
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
router.post('/decks/:deckId/send', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const deckId = parseInt(req.params.deckId);
    const { targetUserId } = req.body;

    if (!targetUserId) {
      res.status(400).json({ error: '请指定目标用户' });
      return;
    }

    // Verify the source deck belongs to admin
    const sourceDeck = db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?')
      .get(deckId, req.userId) as any;
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

    // Auto-resync if this is a merged deck (has source decks)
    const sourceDecks = db.prepare(
      'SELECT id FROM decks WHERE merged_into_id = ? AND user_id = ?'
    ).all(deckId, req.userId) as any[];
    if (sourceDecks.length > 0) {
      resyncMergedDeck(db, deckId, req.userId!);
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
        .get(deckId, req.userId) as any;
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
    `).all(deckId, req.userId) as any[];

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
      `).all(deckId, req.userId) as any[];

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
            `).all(srcNote.id, req.userId) as any[];
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
          `).run(targetUserId, uuidv4(), newNotetypeId, srcNote.tags, srcNote.fields, srcNote.sort_field);
          const newNoteId = noteResult.lastInsertRowid as number;
          notesCreated++;

          const srcCards = db.prepare(`
            SELECT template_idx FROM cards WHERE note_id = ? AND user_id = ?
          `).all(srcNote.id, req.userId) as any[];
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

    res.json({
      success: true,
      isUpdate,
      message: `已将牌组「${sourceDeck.name}」${actionLabel}给 ${targetUser.username}（${statsText}）`,
      stats: result,
    });
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
    ).all(...sourceDeckIds, req.userId) as any[];

    if (ownDecks.length !== sourceDeckIds.length) {
      res.status(400).json({ error: '部分牌组不存在或不属于你' });
      return;
    }

    // Check no duplicate name
    const existing = db.prepare(
      'SELECT id FROM decks WHERE user_id = ? AND name = ?'
    ).get(req.userId, newDeckName.trim());
    if (existing) {
      res.status(400).json({ error: `牌组「${newDeckName}」已存在` });
      return;
    }

    const mergeAll = db.transaction(() => {
      // 1. Create the new merged deck
      const deckResult = db.prepare(
        'INSERT INTO decks (user_id, parent_id, name, description) VALUES (?, ?, ?, ?)'
      ).run(req.userId, null, newDeckName.trim(), description || '');
      const newDeckId = deckResult.lastInsertRowid as number;

      // 2. Create default deck config
      db.prepare(
        'INSERT INTO deck_config (user_id, deck_id) VALUES (?, ?)'
      ).run(req.userId, newDeckId);

      // 3. Collect all notetypes used across source decks
      const usedNotetypes = db.prepare(`
        SELECT DISTINCT n.notetype_id FROM notes n
        JOIN cards c ON c.note_id = n.id
        WHERE c.deck_id IN (${placeholders}) AND c.user_id = ?
      `).all(...sourceDeckIds, req.userId) as any[];

      // Map old notetype IDs → new or existing notetype IDs
      const notetypeMap = new Map<number, number>();
      for (const row of usedNotetypes) {
        const srcNt = db.prepare('SELECT * FROM notetypes WHERE id = ?').get(row.notetype_id) as any;
        if (!srcNt) continue;

        const existingNt = db.prepare(
          'SELECT id FROM notetypes WHERE user_id = ? AND name = ?'
        ).get(req.userId, srcNt.name) as any;

        if (existingNt) {
          notetypeMap.set(srcNt.id, existingNt.id);
        } else {
          const ntResult = db.prepare(`
            INSERT INTO notetypes (user_id, name, css, kind, field_names, template_q_format, template_a_format)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(req.userId, srcNt.name, srcNt.css, srcNt.kind, srcNt.field_names,
            srcNt.template_q_format, srcNt.template_a_format);
          notetypeMap.set(srcNt.id, ntResult.lastInsertRowid as number);
        }
      }

      // 4. Copy all notes & cards from all source decks
      const sourceCards = db.prepare(`
        SELECT c.*, n.guid, n.notetype_id, n.tags, n.fields, n.sort_field
        FROM cards c
        JOIN notes n ON n.id = c.note_id
        WHERE c.deck_id IN (${placeholders}) AND c.user_id = ?
      `).all(...sourceDeckIds, req.userId) as any[];

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
          `).run(req.userId, newGuid, newNotetypeId, card.tags, card.fields, card.sort_field, card.note_id);
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
        `).run(req.userId, newNoteId, newDeckId, card.template_idx, now + cardsCopied);
        cardsCopied++;
      }

      return { newDeckId, notesCopied, cardsCopied, sourceCount: sourceDeckIds.length };
    });

    const result = mergeAll();

    // Mark all source decks as merged into the new deck (separate transaction — mergeAll already committed)
    const markMerged = db.transaction(() => {
      const stmt = db.prepare('UPDATE decks SET merged_into_id = ?, modified_at = unixepoch() WHERE id = ? AND user_id = ?');
      for (const sid of sourceDeckIds) {
        stmt.run(result.newDeckId, sid, req.userId);
      }
    });
    markMerged();

    const newDeck = db.prepare('SELECT * FROM decks WHERE id = ?').get(result.newDeckId);
    res.json({
      success: true,
      deck: newDeck,
      sourceDeckIds,
      message: `已将 ${result.sourceCount} 个牌组合并为「${newDeckName}」（${result.notesCopied} 条笔记，${result.cardsCopied} 张卡片）`,
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
      .get(deckId, req.userId) as any;
    if (!mergedDeck) {
      res.status(404).json({ error: '牌组不存在' });
      return;
    }

    // Check it has source decks
    const sourceDecks = db.prepare(
      'SELECT id, name FROM decks WHERE merged_into_id = ? AND user_id = ?'
    ).all(deckId, req.userId) as any[];
    if (sourceDecks.length === 0) {
      res.status(400).json({ error: '该牌组没有关联的源牌组，无法同步' });
      return;
    }

    resyncMergedDeck(db, deckId, req.userId!);
    res.json({ success: true, message: `已从 ${sourceDecks.length} 个源牌组重新同步` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin Card Management ────────────────────────────────────────────

// Get notetypes for a specific user
router.get('/users/:userId/notetypes', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = parseInt(req.params.userId);
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
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
    const userId = parseInt(req.params.userId);
    const deckId = parseInt(req.params.deckId);

    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }
    const deck = db.prepare('SELECT id, name FROM decks WHERE id = ? AND user_id = ?').get(deckId, userId) as any;
    if (!deck) {
      res.status(404).json({ error: '牌组不存在' });
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
    const { userId, notetypeId, deckId, fields, tags } = req.body;
    if (!userId || !notetypeId || !deckId || !fields || fields.length === 0) {
      res.status(400).json({ error: '用户ID、笔记类型ID、牌组ID和字段不能为空' });
      return;
    }

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

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

// ── Clear User Data ──────────────────────────────────────────────────

// Clear all decks, cards, notes for a specific user
router.delete('/users/:id/clear', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const targetId = parseInt(req.params.id);
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetId) as any;
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }
    if (targetId === req.userId) {
      res.status(400).json({ error: '不能清除自己的数据' });
      return;
    }

    db.transaction(() => {
      db.prepare('DELETE FROM revlog WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM cards WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM notes WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM deck_config WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM decks WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM notetypes WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM practice_log WHERE user_id = ?').run(targetId);
    })();

    res.json({ success: true, message: `已清除用户「${user.username}」的所有数据` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Clear all non-admin users' data
router.post('/clear-all', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const nonAdminUsers = db.prepare('SELECT id, username FROM users WHERE role = ?').all('user') as any[];

    if (nonAdminUsers.length === 0) {
      res.json({ success: true, message: '没有普通用户需要清除' });
      return;
    }

    const userIds = nonAdminUsers.map(u => u.id);
    const placeholders = userIds.map(() => '?').join(',');

    db.transaction(() => {
      db.prepare(`DELETE FROM revlog WHERE user_id IN (${placeholders})`).run(...userIds);
      db.prepare(`DELETE FROM cards WHERE user_id IN (${placeholders})`).run(...userIds);
      db.prepare(`DELETE FROM notes WHERE user_id IN (${placeholders})`).run(...userIds);
      db.prepare(`DELETE FROM deck_config WHERE user_id IN (${placeholders})`).run(...userIds);
      db.prepare(`DELETE FROM decks WHERE user_id IN (${placeholders})`).run(...userIds);
      db.prepare(`DELETE FROM notetypes WHERE user_id IN (${placeholders})`).run(...userIds);
      db.prepare(`DELETE FROM practice_log WHERE user_id IN (${placeholders})`).run(...userIds);
    })();

    res.json({ success: true, message: `已清除全部 ${nonAdminUsers.length} 个用户的数据` });
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
      .get(deckId, req.userId) as any;
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
    const result = copyDeckToUser(db, deckId, req.userId!, targetUserId, sourceDeck);
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
        const newGuid = uuidv4();
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

// ── Admin Dashboard Stats ────────────────────────────────────────────

// Heartbeat — admin calls this to stay marked online
router.post('/heartbeat', (req: AuthRequest, res: Response) => {
  recordHeartbeat(req.userId!);
  res.json({ success: true });
});

interface DayCount {
  date: string;
  count: number;
}

router.get('/dashboard', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();

    // User stats
    const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users WHERE role = ?').get('user') as any).c;
    const totalAdmins = (db.prepare('SELECT COUNT(*) as c FROM users WHERE role = ?').get('admin') as any).c;

    // Content stats
    const totalDecks = (db.prepare('SELECT COUNT(*) as c FROM decks').get() as any).c;
    const totalCards = (db.prepare('SELECT COUNT(*) as c FROM cards').get() as any).c;
    const totalNotes = (db.prepare('SELECT COUNT(*) as c FROM notes').get() as any).c;

    // Card status breakdown
    const newCards = (db.prepare("SELECT COUNT(*) as c FROM cards WHERE queue = 0").get() as any).c;
    const learningCards = (db.prepare("SELECT COUNT(*) as c FROM cards WHERE queue = 1").get() as any).c;
    const reviewCards = (db.prepare("SELECT COUNT(*) as c FROM cards WHERE queue = 2").get() as any).c;
    const relearnCards = (db.prepare("SELECT COUNT(*) as c FROM cards WHERE queue = 3").get() as any).c;

    // Daily registrations (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const registrations = db.prepare(`
      SELECT date(created_at, 'unixepoch') as date, COUNT(*) as count
      FROM users
      WHERE created_at >= unixepoch('now', '-6 days')
      GROUP BY date(created_at, 'unixepoch')
      ORDER BY date ASC
    `).all() as DayCount[];

    // Fill in missing days
    const dailyRegistrations: DayCount[] = [];
    const regMap = new Map(registrations.map(r => [r.date, r.count]));
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      dailyRegistrations.push({ date: dateStr, count: regMap.get(dateStr) || 0 });
    }

    // Active users in last 7 days (users who reviewed cards)
    const activeUsers = (db.prepare(`
      SELECT COUNT(DISTINCT user_id) as c
      FROM revlog
      WHERE reviewed_at >= unixepoch('now', '-6 days')
    `).get() as any).c;

    // Recent registrations (last 10 users)
    const recentUsers = db.prepare(`
      SELECT id, username, created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 10
    `).all() as any[];

    // Total reviews today
    const reviewsToday = (db.prepare(`
      SELECT COUNT(*) as c FROM revlog
      WHERE date(reviewed_at, 'unixepoch') = date('now')
    `).get() as any).c;

    // Online user list with usernames
    const onlineUserIds = getOnlineUserIds();
    let onlineUserList: { id: number; username: string }[] = [];
    if (onlineUserIds.length > 0) {
      const placeholders = onlineUserIds.map(() => '?').join(',');
      onlineUserList = db.prepare(`
        SELECT id, username FROM users WHERE id IN (${placeholders})
      `).all(...onlineUserIds) as any[];
    }

    res.json({
      totalUsers,
      totalAdmins,
      totalDecks,
      totalCards,
      totalNotes,
      onlineUsers: getOnlineCount(),
      onlineUserList,
      cardBreakdown: {
        new: newCards,
        learning: learningCards,
        review: reviewCards,
        relearn: relearnCards,
      },
      dailyRegistrations,
      activeUsers,
      recentUsers,
      reviewsToday,
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

  const placeholders = sourceDecks.map(() => '?').join(',');
  const sourceDeckIds = sourceDecks.map((d: any) => d.id);

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

// ── Helper: relative time string ───────────────────────────────────────
function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() / 1000) - timestamp);
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return Math.floor(seconds / 60) + '分钟前';
  if (seconds < 86400) return Math.floor(seconds / 3600) + '小时前';
  return Math.floor(seconds / 86400) + '天前';
}

// ── Security routes ────────────────────────────────────────────────────

// GET /admin/security/login-logs
router.get('/security/login-logs', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = req.query.user_id ? parseInt(req.query.user_id as string) : null;
    const page = req.query.page ? parseInt(req.query.page as string) : 1;
    const limit = Math.min(req.query.limit ? parseInt(req.query.limit as string) : 100, 100);
    const offset = (page - 1) * limit;

    if (userId && isNaN(userId)) {
      res.status(400).json({ error: '无效的用户ID' });
      return;
    }
    if (page < 1) {
      res.status(400).json({ error: '页码必须 >= 1' });
      return;
    }

    let logs: any[];
    let totalCount: number;

    if (userId) {
      logs = db.prepare(`
        SELECT ll.user_id, u.username, ll.ip, ll.user_agent, ll.device_info,
               ll.login_method, ll.success, ll.created_at
        FROM login_logs ll
        LEFT JOIN users u ON u.id = ll.user_id
        WHERE ll.user_id = ?
        ORDER BY ll.created_at DESC
        LIMIT ? OFFSET ?
      `).all(userId, limit, offset);

      const countRow = db.prepare(
        'SELECT COUNT(*) as total FROM login_logs WHERE user_id = ?'
      ).get(userId) as any;
      totalCount = countRow.total;
    } else {
      logs = db.prepare(`
        SELECT ll.user_id, u.username, ll.ip, ll.user_agent, ll.device_info,
               ll.login_method, ll.success, ll.created_at
        FROM login_logs ll
        LEFT JOIN users u ON u.id = ll.user_id
        ORDER BY ll.created_at DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset);

      const countRow = db.prepare('SELECT COUNT(*) as total FROM login_logs').get() as any;
      totalCount = countRow.total;
    }

    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/security/online-users
router.get('/security/online-users', (req: AuthRequest, res: Response) => {
  try {
    const details = getOnlineUserDetails();
    const result = details.map((d) => ({
      userId: d.userId,
      username: d.username,
      ip: d.ip,
      userAgent: d.userAgent,
      deviceInfo: d.deviceInfo,
      lastActive: timeAgo(d.lastActive / 1000),
    }));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/security/user-login-history/:userId
router.get('/security/user-login-history/:userId', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) {
      res.status(400).json({ error: '无效的用户ID' });
      return;
    }

    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    const logs = db.prepare(`
      SELECT ll.user_id, u.username, ll.ip, ll.user_agent, ll.device_info,
             ll.login_method, ll.success, ll.created_at
      FROM login_logs ll
      LEFT JOIN users u ON u.id = ll.user_id
      WHERE ll.user_id = ?
      ORDER BY ll.created_at DESC
      LIMIT 15
    `).all(userId) as any[];

    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
