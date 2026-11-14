CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_login_at INTEGER
    , role TEXT NOT NULL DEFAULT "user", avatar_url TEXT DEFAULT '', coins INTEGER NOT NULL DEFAULT 0, banned_until INTEGER NOT NULL DEFAULT 0, ban_reason TEXT DEFAULT '', banned_at INTEGER DEFAULT 0, pending_avatar_url TEXT DEFAULT '', is_teacher INTEGER NOT NULL DEFAULT 0, badge_label TEXT NOT NULL DEFAULT '', village_th_level INTEGER NOT NULL DEFAULT 0, village_mine_level INTEGER NOT NULL DEFAULT 0, village_mine_coin_at INTEGER);
CREATE TABLE sqlite_sequence(name,seq);
CREATE TABLE decks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      parent_id INTEGER,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      modified_at INTEGER NOT NULL DEFAULT (unixepoch()), merged_into_id INTEGER REFERENCES decks(id) ON DELETE SET NULL, source_deck_id INTEGER REFERENCES decks(id) ON DELETE SET NULL, published INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES decks(id) ON DELETE SET NULL
    );
CREATE TABLE deck_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      deck_id INTEGER NOT NULL UNIQUE,
      learn_steps TEXT NOT NULL DEFAULT '[1,10]',
      relearn_steps TEXT NOT NULL DEFAULT '[10]',
      initial_ease REAL NOT NULL DEFAULT 2.5,
      easy_multiplier REAL NOT NULL DEFAULT 1.3,
      hard_multiplier REAL NOT NULL DEFAULT 1.2,
      interval_multiplier REAL NOT NULL DEFAULT 1.0,
      maximum_review_interval INTEGER NOT NULL DEFAULT 36500,
      minimum_lapse_interval INTEGER NOT NULL DEFAULT 1,
      graduating_interval_good INTEGER NOT NULL DEFAULT 1,
      graduating_interval_easy INTEGER NOT NULL DEFAULT 4,
      new_per_day INTEGER NOT NULL DEFAULT 20,
      reviews_per_day INTEGER NOT NULL DEFAULT 200,
      leech_threshold INTEGER NOT NULL DEFAULT 8,
      lapse_multiplier REAL NOT NULL DEFAULT 0.0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );
CREATE TABLE notetypes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      css TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'normal',
      field_names TEXT NOT NULL DEFAULT '["Front","Back"]',
      template_q_format TEXT NOT NULL DEFAULT '{{Front}}',
      template_a_format TEXT NOT NULL DEFAULT '{{FrontSide}}<hr>{{Back}}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      modified_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
CREATE TABLE notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      guid TEXT NOT NULL,
      notetype_id INTEGER NOT NULL,
      tags TEXT NOT NULL DEFAULT '',
      fields TEXT NOT NULL DEFAULT '[]',
      sort_field TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      modified_at INTEGER NOT NULL DEFAULT (unixepoch()), source_note_id INTEGER REFERENCES notes(id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (notetype_id) REFERENCES notetypes(id) ON DELETE CASCADE
    );
CREATE INDEX idx_notes_guid ON notes(user_id, guid);
CREATE INDEX idx_notes_notetype ON notes(notetype_id);
CREATE TABLE cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      note_id INTEGER NOT NULL,
      deck_id INTEGER NOT NULL,
      template_idx INTEGER NOT NULL DEFAULT 0,
      queue INTEGER NOT NULL DEFAULT 0,
      due INTEGER NOT NULL DEFAULT 0,
      interval INTEGER NOT NULL DEFAULT 0,
      ease_factor REAL NOT NULL DEFAULT 2.5,
      reps INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      remaining_steps INTEGER NOT NULL DEFAULT 0,
      original_deck_id INTEGER,
      flags INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      modified_at INTEGER NOT NULL DEFAULT (unixepoch()), study_round INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );
CREATE INDEX idx_cards_due ON cards(user_id, deck_id, queue, due);
CREATE INDEX idx_cards_note ON cards(note_id);
CREATE TABLE revlog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      card_id INTEGER NOT NULL,
      ease INTEGER NOT NULL,
      interval INTEGER NOT NULL,
      last_interval INTEGER NOT NULL,
      ease_factor REAL NOT NULL DEFAULT 2.5,
      time_ms INTEGER NOT NULL DEFAULT 0,
      review_type INTEGER NOT NULL DEFAULT 0,
      reviewed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
CREATE INDEX idx_revlog_card ON revlog(card_id);
CREATE INDEX idx_revlog_user_date ON revlog(user_id, reviewed_at);
CREATE TABLE media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT DEFAULT 'application/octet-stream',
      data BLOB,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
CREATE INDEX idx_media_user ON media(user_id);
CREATE TABLE practice_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      deck_id INTEGER NOT NULL,
      session_id TEXT NOT NULL DEFAULT '',
      total_questions INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      wrong_count INTEGER NOT NULL DEFAULT 0,
      score_pct INTEGER NOT NULL DEFAULT 0,
      time_seconds INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );
CREATE INDEX idx_practice_log_user ON practice_log(user_id, deck_id);
CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
CREATE TABLE user_settings (
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
CREATE TABLE changelog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
CREATE TABLE feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        contact TEXT DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()), reply TEXT DEFAULT '', replied_at INTEGER, replied_by TEXT DEFAULT '', reply_read INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      );
CREATE INDEX idx_decks_source ON decks(source_deck_id);
CREATE TABLE login_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      device_info TEXT NOT NULL DEFAULT '',
      login_method TEXT NOT NULL DEFAULT 'password',
      success INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()), device_id TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
CREATE INDEX idx_login_logs_user ON login_logs(user_id, created_at DESC);
CREATE TABLE announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
CREATE TABLE user_announcement_dismissals (
        user_id INTEGER NOT NULL,
        announcement_id INTEGER NOT NULL,
        dismissed_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (user_id, announcement_id)
      );
CREATE TABLE checkins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        checked_date TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(user_id, checked_date),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
CREATE INDEX idx_checkins_user_date ON checkins(user_id, checked_date DESC);
CREATE TABLE battles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player1_id INTEGER NOT NULL,
        player2_id INTEGER,
        player2_is_bot INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'waiting',
        question_data TEXT NOT NULL,
        bot_results TEXT NOT NULL DEFAULT '[]',
        bot_answer_ms INTEGER NOT NULL DEFAULT 4200,
        total_questions INTEGER NOT NULL DEFAULT 10,
        p1_answered INTEGER NOT NULL DEFAULT 0,
        p1_correct INTEGER NOT NULL DEFAULT 0,
        p2_answered INTEGER NOT NULL DEFAULT 0,
        p2_correct INTEGER NOT NULL DEFAULT 0,
        p1_finished INTEGER NOT NULL DEFAULT 0,
        p2_finished INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER,
        finished_at INTEGER,
        winner_id INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      , fee_paid1 INTEGER NOT NULL DEFAULT 0, fee_paid2 INTEGER NOT NULL DEFAULT 0, expired_at INTEGER, p1_finish_at INTEGER, p2_finish_at INTEGER, p1_answers TEXT, p2_answers TEXT, p1_q_start TEXT, p2_q_start TEXT);
CREATE TABLE coins_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        delta INTEGER NOT NULL,
        balance INTEGER NOT NULL,
        source TEXT NOT NULL,
        ref_id INTEGER,
        day TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
CREATE INDEX idx_coins_ledger_user_day ON coins_ledger(user_id, day);
CREATE INDEX idx_coins_ledger_source_day ON coins_ledger(source, day);
CREATE TABLE avatar_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        pending_url TEXT NOT NULL DEFAULT '',
        prev_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        reason TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        reviewed_at INTEGER,
        reviewer_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
CREATE INDEX idx_avatar_reviews_status ON avatar_reviews(status, created_at DESC);
CREATE INDEX idx_avatar_reviews_user ON avatar_reviews(user_id, id DESC);
CREATE TABLE admin_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER,
        action TEXT NOT NULL,
        target_user_id INTEGER,
        detail TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
CREATE INDEX idx_admin_audit_logs_created ON admin_audit_logs(created_at DESC);
CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,            -- 'learn' | 'review' | 'checkin'
        title TEXT NOT NULL,
        target INTEGER NOT NULL DEFAULT 0,   -- checkin 为 0
        reward INTEGER NOT NULL DEFAULT 0,
        sort INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      , once INTEGER NOT NULL DEFAULT 0);
CREATE TABLE arena_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        opponent_type TEXT NOT NULL DEFAULT 'none',
        mode TEXT NOT NULL,
        deck_id INTEGER DEFAULT 0,
        total_questions INTEGER NOT NULL,
        correct_count INTEGER NOT NULL DEFAULT 0,
        answered_count INTEGER NOT NULL DEFAULT 0,
        score INTEGER NOT NULL DEFAULT 0,
        duration_s INTEGER DEFAULT 0,
        entry_fee INTEGER NOT NULL DEFAULT 6,
        reward INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        result_key TEXT DEFAULT '',
        battle_id INTEGER DEFAULT NULL,
        question_data TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
CREATE INDEX idx_arena_sessions_user ON arena_sessions(user_id, created_at DESC);
CREATE TABLE welfare_claims (
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        claimed_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, type)
      );
CREATE TABLE feature_flags (
        key TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        label TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      , expire_at INTEGER);
CREATE INDEX idx_notes_source_note ON notes(source_note_id);
CREATE INDEX idx_cards_deck ON cards(deck_id);
CREATE TABLE devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL UNIQUE,
      device_info TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      first_seen INTEGER NOT NULL DEFAULT (unixepoch()),
      last_seen INTEGER NOT NULL DEFAULT (unixepoch()),
      login_count INTEGER NOT NULL DEFAULT 0,
      last_user_id INTEGER,
      last_ip TEXT NOT NULL DEFAULT ''
    );
CREATE INDEX idx_devices_last_seen ON devices(last_seen DESC);
CREATE TABLE device_users (
      device_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      first_seen INTEGER NOT NULL DEFAULT (unixepoch()),
      last_seen INTEGER NOT NULL DEFAULT (unixepoch()),
      login_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (device_id, user_id)
    );
CREATE INDEX idx_device_users_user ON device_users(user_id);
CREATE TABLE login_device_rules (
      user_id INTEGER PRIMARY KEY,
      allowed_kinds TEXT NOT NULL DEFAULT '',
      unlock_on_password_change INTEGER NOT NULL DEFAULT 1,
      enforced_at INTEGER NOT NULL DEFAULT (unixepoch()),
      note TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
CREATE TABLE readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  dynasty TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  translation TEXT NOT NULL DEFAULT '',
  annotation TEXT NOT NULL DEFAULT '',
  appreciation TEXT NOT NULL DEFAULT '',
  background TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_readings_dynasty ON readings(dynasty);
CREATE INDEX idx_readings_title ON readings(title);
CREATE TABLE village_saves (
        user_id    INTEGER NOT NULL,
        save_key   TEXT    NOT NULL,
        data       TEXT,
        version    INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (user_id, save_key)
      );
CREATE TABLE village_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        type       TEXT    NOT NULL,
        payload    TEXT,
        stars      INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        day        TEXT    NOT NULL
      );
CREATE INDEX idx_ve_user_day ON village_events(user_id, day);
CREATE INDEX idx_ve_user_type_day ON village_events(user_id, type, day);
CREATE TABLE village_daily_quota (
        user_id             INTEGER NOT NULL,
        day                 TEXT    NOT NULL,
        offline_claims      INTEGER NOT NULL DEFAULT 0,
        offline_res_granted INTEGER NOT NULL DEFAULT 0,
        coins_granted       INTEGER NOT NULL DEFAULT 0,
        last_seen_at        INTEGER NOT NULL DEFAULT 0, raid_coins_gained INTEGER NOT NULL DEFAULT 0, raid_coins_lost INTEGER NOT NULL DEFAULT 0, raid_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day)
      );
CREATE TABLE village_spends (
        user_id    INTEGER NOT NULL,
        idem_key   TEXT    NOT NULL,
        kind       TEXT    NOT NULL,
        amount     INTEGER NOT NULL,
        ref        TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (user_id, idem_key)
      );
CREATE TABLE village_battles (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        tier       INTEGER NOT NULL,
        seed       INTEGER NOT NULL,
        stars      INTEGER NOT NULL,
        coins      INTEGER NOT NULL DEFAULT 0,
        status     TEXT    NOT NULL DEFAULT 'settled',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        day        TEXT    NOT NULL
      , defender_id INTEGER, snapshot_id INTEGER, mode TEXT NOT NULL DEFAULT 'npc', pct INTEGER NOT NULL DEFAULT 0, elixir INTEGER NOT NULL DEFAULT 0, suspect INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_vb_user_day ON village_battles(user_id, day);
CREATE TABLE schema_meta (
        key        TEXT PRIMARY KEY,
        value      TEXT,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
CREATE TABLE village_refunds (
        user_id    INTEGER NOT NULL,
        inst_id    INTEGER NOT NULL,
        ref        TEXT    NOT NULL,
        amount     INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (user_id, inst_id)
      );
CREATE TABLE village_profiles (
        user_id        INTEGER PRIMARY KEY,
        th_level       INTEGER NOT NULL DEFAULT 1,
        building_cnt   INTEGER NOT NULL DEFAULT 0,
        wall_cnt       INTEGER NOT NULL DEFAULT 0,
        def_cnt        INTEGER NOT NULL DEFAULT 0,
        loot_coins     INTEGER NOT NULL DEFAULT 0,
        loot_elixir    INTEGER NOT NULL DEFAULT 0,
        shield_until   INTEGER NOT NULL DEFAULT 0,
        last_raided_at INTEGER NOT NULL DEFAULT 0,
        save_version   INTEGER NOT NULL DEFAULT 0,
        updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
      );
CREATE INDEX idx_vp_match
        ON village_profiles(th_level, shield_until, building_cnt);
CREATE TABLE village_raid_snapshots (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        attacker_id  INTEGER NOT NULL,
        defender_id  INTEGER NOT NULL,
        layout       TEXT    NOT NULL,
        th_level     INTEGER NOT NULL,
        loot_coins   INTEGER NOT NULL,
        loot_elixir  INTEGER NOT NULL,
        save_version INTEGER NOT NULL,
        status       TEXT    NOT NULL DEFAULT 'open',
        created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        expires_at   INTEGER NOT NULL,
        day          TEXT    NOT NULL
      );
CREATE INDEX idx_vrs_atk ON village_raid_snapshots(attacker_id, created_at DESC);
CREATE INDEX idx_vrs_def ON village_raid_snapshots(defender_id, created_at DESC);
CREATE UNIQUE INDEX idx_vrs_one_open
        ON village_raid_snapshots(attacker_id) WHERE status = 'open';
CREATE TABLE village_defense_queue (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        defender_id  INTEGER NOT NULL,
        raid_id      INTEGER NOT NULL,
        attacker_id  INTEGER NOT NULL,
        elixir_lost  INTEGER NOT NULL DEFAULT 0,
        payload      TEXT    NOT NULL,
        status       TEXT    NOT NULL DEFAULT 'pending',
        notified     INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        applied_at   INTEGER
      , def_seen INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_vdq_def ON village_defense_queue(defender_id, status);
CREATE TABLE village_raid_targets (
        attacker_id INTEGER NOT NULL,
        defender_id INTEGER NOT NULL,
        last_at     INTEGER NOT NULL,
        times_today INTEGER NOT NULL DEFAULT 1,
        day         TEXT    NOT NULL,
        PRIMARY KEY (attacker_id, defender_id)
      );
CREATE INDEX idx_vb_def_day ON village_battles(defender_id, day);
CREATE TABLE shop_items (
        key         TEXT PRIMARY KEY,
        name        TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        price       INTEGER NOT NULL,
        kind        TEXT    NOT NULL DEFAULT 'unlock',
        enabled     INTEGER NOT NULL DEFAULT 1,
        sort        INTEGER NOT NULL DEFAULT 0,
        updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
      );
CREATE TABLE shop_purchases (
        user_id     INTEGER NOT NULL,
        item_key    TEXT    NOT NULL,
        price_paid  INTEGER NOT NULL,
        status      TEXT    NOT NULL DEFAULT 'active',
        created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        refunded_at INTEGER,
        refunded_by INTEGER,
        PRIMARY KEY (user_id, item_key)
      );
CREATE INDEX idx_sp_item ON shop_purchases(item_key, status);
CREATE TABLE user_backgrounds (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        url        TEXT    NOT NULL,
        bytes      INTEGER NOT NULL DEFAULT 0,
        active     INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
CREATE INDEX idx_ubg_user ON user_backgrounds(user_id, created_at DESC);
CREATE TABLE contest_scores (
        user_id INTEGER PRIMARY KEY,
        best_score INTEGER NOT NULL DEFAULT 0,
        plays INTEGER NOT NULL DEFAULT 0,
        best_at INTEGER,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
CREATE TABLE contest_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        question_data TEXT NOT NULL,
        answered_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
CREATE INDEX idx_contest_runs_user ON contest_runs(user_id, created_at DESC);
CREATE TABLE contest_prizes (
        user_id INTEGER PRIMARY KEY,
        rank INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        best_score INTEGER NOT NULL,
        settled_at INTEGER NOT NULL
      );
CREATE TABLE user_sessions (
        user_id     INTEGER PRIMARY KEY,
        sid         TEXT    NOT NULL,
        tab_id      TEXT    NOT NULL DEFAULT '',
        kicked_tabs TEXT    NOT NULL DEFAULT '[]',
        ua          TEXT    NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        seen_at     INTEGER NOT NULL DEFAULT (unixepoch())
      );
CREATE TABLE study_coin_claims (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        card_id    INTEGER NOT NULL,
        round      INTEGER NOT NULL DEFAULT 0,
        day        TEXT    NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(user_id, card_id, round, day)
      );
CREATE INDEX idx_study_claims_user_day ON study_coin_claims(user_id, day);
CREATE INDEX idx_study_claims_day ON study_coin_claims(day);
CREATE TABLE daily_news (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        day        TEXT    NOT NULL,
        title      TEXT    NOT NULL,
        source     TEXT    NOT NULL DEFAULT '人民日报',
        sort       INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(day, title)
      );
CREATE INDEX idx_daily_news_day ON daily_news(day, sort);
CREATE TABLE battle_taunts (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        battle_id    INTEGER NOT NULL,
        from_user_id INTEGER NOT NULL,
        text_idx     INTEGER NOT NULL,
        created_at   INTEGER NOT NULL DEFAULT (unixepoch())
      );
CREATE INDEX idx_taunts_battle ON battle_taunts(battle_id, id DESC);
