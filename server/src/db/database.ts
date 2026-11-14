import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'keyi.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_login_at INTEGER
    );

    -- Decks (牌组)
    CREATE TABLE IF NOT EXISTS decks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      parent_id INTEGER,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      modified_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES decks(id) ON DELETE SET NULL
    );

    -- Deck configurations (牌组配置)
    CREATE TABLE IF NOT EXISTS deck_config (
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

    -- Note types (笔记类型)
    CREATE TABLE IF NOT EXISTS notetypes (
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

    -- Notes (笔记)
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      guid TEXT NOT NULL,
      notetype_id INTEGER NOT NULL,
      tags TEXT NOT NULL DEFAULT '',
      fields TEXT NOT NULL DEFAULT '[]',
      sort_field TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      modified_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (notetype_id) REFERENCES notetypes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_notes_guid ON notes(user_id, guid);
    CREATE INDEX IF NOT EXISTS idx_notes_notetype ON notes(notetype_id);

    -- Cards (卡片)
    CREATE TABLE IF NOT EXISTS cards (
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
      modified_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(user_id, deck_id, queue, due);
    CREATE INDEX IF NOT EXISTS idx_cards_note ON cards(note_id);
    -- cards.deck_id 外键(CASCADE)：删牌组/下架时不至于全表扫 cards
    CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id);

    -- Review log (复习日志)
    CREATE TABLE IF NOT EXISTS revlog (
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
    CREATE INDEX IF NOT EXISTS idx_revlog_card ON revlog(card_id);
    CREATE INDEX IF NOT EXISTS idx_revlog_user_date ON revlog(user_id, reviewed_at);

    -- Settings table
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT OR IGNORE INTO settings (key, value) VALUES ('registration_enabled', '1');

    -- Changelog entries (更新日志)
    CREATE TABLE IF NOT EXISTS changelog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- User settings (per-user key-value preferences)
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Media files reference
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT DEFAULT 'application/octet-stream',
      data BLOB,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_media_user ON media(user_id);

    -- Practice session log
    CREATE TABLE IF NOT EXISTS practice_log (
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
    CREATE INDEX IF NOT EXISTS idx_practice_log_user ON practice_log(user_id, deck_id);

    -- Login logs (安全板块)
    CREATE TABLE IF NOT EXISTS login_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      device_info TEXT NOT NULL DEFAULT '',
      login_method TEXT NOT NULL DEFAULT 'password',
      success INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs(user_id, created_at DESC);
  `);

  // ── 设备追踪 (2026-09-15) ── cookie 里带 device_id，把「同一台设备」跨登录/跨账号串起来
  try {
    db.exec('ALTER TABLE login_logs ADD COLUMN device_id TEXT');
  } catch {
    // 列已存在
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
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
    CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen DESC);

    CREATE TABLE IF NOT EXISTS device_users (
      device_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      first_seen INTEGER NOT NULL DEFAULT (unixepoch()),
      last_seen INTEGER NOT NULL DEFAULT (unixepoch()),
      login_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (device_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_device_users_user ON device_users(user_id);
  `);

  // ── 账号登录设备限制 (2026-09-22) ── 老师可把账号限制为「只能在 iPhone / 电脑 等指定类别
  // 设备上登录」；enforced_at 之前的 JWT 一律失效（旧会话立刻踢下线）；改密码后限制自动解除。
  db.exec(`
    CREATE TABLE IF NOT EXISTS login_device_rules (
      user_id INTEGER PRIMARY KEY,
      allowed_kinds TEXT NOT NULL DEFAULT '',
      unlock_on_password_change INTEGER NOT NULL DEFAULT 1,
      enforced_at INTEGER NOT NULL DEFAULT (unixepoch()),
      note TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // ── 阅读板块：文言文内容库 (2026-09-28) ──
  // 由古诗文网抓取的文言文数据导入；公开只读，管理员可维护。
  db.exec(`
    CREATE TABLE IF NOT EXISTS readings (
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
    )
  `);
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_readings_dynasty ON readings(dynasty)'); } catch { /* ignore */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_readings_title ON readings(title)'); } catch { /* ignore */ }

  // Migration: feedback table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        contact TEXT DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
  } catch {
    // Table already exists
  }

  // Migration: feedback 回复通道（2026-10-15）
  // 单向一问一答：管理员在后台填一条答复，学生在「帮助与反馈」里能看到。
  // reply_read 用于「有新回复」的红点：管理员改了答复会重新置 0（内容变了就该再看一次）。
  try { db.exec("ALTER TABLE feedback ADD COLUMN reply TEXT DEFAULT ''"); } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE feedback ADD COLUMN replied_at INTEGER'); } catch { /* 已存在 */ }
  try { db.exec("ALTER TABLE feedback ADD COLUMN replied_by TEXT DEFAULT ''"); } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE feedback ADD COLUMN reply_read INTEGER NOT NULL DEFAULT 0'); } catch { /* 已存在 */ }

  /* ── 学习轮次 + 学习币领取记录（2026-10-19） ──────────────────────────
     需求：「重置后再学也要能拿铜板」。

     原来的去重键是 (user_id, card_id, 北京日) —— 同一张卡一天只发一次，
     重置卡组不会改变 card_id，所以重学同一批卡一分钱都拿不到。
     现在给每张卡记一个 study_round：重置卡组时整体 +1，去重键变成
     (user_id, card_id, round, 日)。于是：
       · 没重置：同一轮同一天 → 仍然只发一次（原有防刷语义不变）；
       · 重置过：进入新一轮 → 可以再发一次；
       · 反复重置刷币 → 由「每日 80 铜板上限」兜底，轮次本身不设限。

     为什么单独建表、不塞进 coins_ledger：
       ledger 的 ref_id 只存 card_id，加不了轮次；
       改造 ledger 结构会牵连对账、追回、历史统计，代价远大于一张小表。 */
  try {
    db.exec('ALTER TABLE cards ADD COLUMN study_round INTEGER NOT NULL DEFAULT 0');
  } catch { /* 已存在 */ }
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS study_coin_claims (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        card_id    INTEGER NOT NULL,
        round      INTEGER NOT NULL DEFAULT 0,
        day        TEXT    NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(user_id, card_id, round, day)
      );
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_study_claims_user_day ON study_coin_claims(user_id, day)');
    /* 清理按 day 单列扫（每 6 小时删 7 天前的），单独建一个 day 索引 */
    db.exec('CREATE INDEX IF NOT EXISTS idx_study_claims_day ON study_coin_claims(day)');
  } catch { /* 已存在 */ }

  /* ── 每日时政（2026-10-19） ────────────────────────────────────────────
     数据来自人民日报电子版当天头版，只存标题、**不存链接**（用户要求不能跳转）。
     按天存一份，前端按 day 取；(day, title) 唯一，重复抓取不会堆重复行。 */
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS daily_news (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        day        TEXT    NOT NULL,
        title      TEXT    NOT NULL,
        source     TEXT    NOT NULL DEFAULT '人民日报',
        sort       INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(day, title)
      );
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_daily_news_day ON daily_news(day, sort)');
  } catch { /* 已存在 */ }

  // Migration: add merged_into_id column to decks if not exists
  try {
    db.exec('ALTER TABLE decks ADD COLUMN merged_into_id INTEGER REFERENCES decks(id) ON DELETE SET NULL');
  } catch {
    // Column already exists — ignore
  }

  // Migration: add source_deck_id column to decks (tracks which admin deck a user deck came from)
  try {
    db.exec('ALTER TABLE decks ADD COLUMN source_deck_id INTEGER REFERENCES decks(id) ON DELETE SET NULL');
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_decks_source ON decks(source_deck_id)');
  } catch {
    // Index already exists — ignore
  }

  // Migration: notes.source_note_id 列（自引用 notes，合并牌组用）
  try {
    db.exec('ALTER TABLE notes ADD COLUMN source_note_id INTEGER REFERENCES notes(id)');
  } catch {
    // Column already exists — ignore
  }

  // Migration: notes(source_note_id) 索引 —— 2026-09-14 全站卡死事故的关键修复
  // 该列是自引用外键却没有索引；SQLite 执行 DELETE FROM notes 时为校验外键必须全表扫描 notes。
  // 实测 24ms/条：管理员"发送卡组给学生"会逐条删除并重建 869 条笔记 → 单次请求阻塞事件循环约 20s，
  // 连发 100+ 个学生 → 整个单进程 Node 全站卡死。加索引后 0ms/条。
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_notes_source_note ON notes(source_note_id)');
  } catch {
    // Index already exists — ignore
  }

  // Migration: add avatar_url column to users
  try {
    db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''");
  } catch {
    // Column already exists — ignore
  }

  // Migration: add published column to decks (shelf 上架状态, 1=上架可被用户自助添加)
  try {
    db.exec('ALTER TABLE decks ADD COLUMN published INTEGER NOT NULL DEFAULT 0');
  } catch {
    // Column already exists — ignore
  }

  // Announcements table
  db.exec(`
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  // User announcement dismissals
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_announcement_dismissals (
        user_id INTEGER NOT NULL,
        announcement_id INTEGER NOT NULL,
        dismissed_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (user_id, announcement_id)
      );
    `);
  // Daily check-ins (打卡) — supplements revlog for streak calculation
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS checkins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        checked_date TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(user_id, checked_date),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON checkins(user_id, checked_date DESC);
    `);
  } catch {
    // Table already exists
  }

  } catch {
    // Table already exists
  }

  // ── 决斗场（Battle）对局表 (2026-08-22) ─────────────────────────────
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS battles (
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
      )
    `);
  } catch {
    // Table already exists
  }

  // ── 铜板经济系统 (2026-08-22) ────────────────────────────────────

  // Migration: users.coins — 服务器账号余额（已有列时静默跳过）
  try {
    db.exec('ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0');
  } catch {
    // Column already exists — ignore
  }

  // 铜板账本：训练场获得、各来源扣发都记流水
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS coins_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        delta INTEGER NOT NULL,
        balance INTEGER NOT NULL,
        source TEXT NOT NULL,
        ref_id INTEGER,
        day TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_coins_ledger_user_day ON coins_ledger(user_id, day);
      CREATE INDEX IF NOT EXISTS idx_coins_ledger_source_day ON coins_ledger(source, day);
    `);
  } catch {
    // Table already exists — ignore
  }

  // Migration: battles 铜板字段（兼容已建表）
  try {
    db.exec('ALTER TABLE battles ADD COLUMN fee_paid1 INTEGER NOT NULL DEFAULT 0');
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec('ALTER TABLE battles ADD COLUMN fee_paid2 INTEGER NOT NULL DEFAULT 0');
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec('ALTER TABLE battles ADD COLUMN expired_at INTEGER');
  } catch {
    // Column already exists — ignore
  }

  // ── 头像审核 + 封号系统 (2026-09-09) ─────────────────────────────────────────────────────────────────────

  // users.banned_until — 0=未封禁；-1=永久封禁；其他=解封时间戳
  try {
    db.exec('ALTER TABLE users ADD COLUMN banned_until INTEGER NOT NULL DEFAULT 0');
  } catch {
    // Column already exists — ignore
  }

  // users.ban_reason — 封禁原因
  try {
    db.exec("ALTER TABLE users ADD COLUMN ban_reason TEXT DEFAULT ''");
  } catch {
    // Column already exists — ignore
  }

  // users.banned_at — 最近一次封禁时间
  try {
    db.exec('ALTER TABLE users ADD COLUMN banned_at INTEGER DEFAULT 0');
  } catch {
    // Column already exists — ignore
  }

  // users.pending_avatar_url — 审核中的新头像（审核通过前不对外生效）
  try {
    db.exec("ALTER TABLE users ADD COLUMN pending_avatar_url TEXT DEFAULT ''");
  } catch {
    // Column already exists — ignore
  }

  // users.is_teacher — 老师标记 (2026-09-22)：头像加金环 + 「老师」标签（所有出现头像的地方）
  // 只影响展示，不给任何后台权限（后台权限看 role='admin'）。
  try {
    db.exec('ALTER TABLE users ADD COLUMN is_teacher INTEGER NOT NULL DEFAULT 0');
  } catch {
    // Column already exists — ignore
  }

  // users.badge_label — 通用徽标文字 (2026-09-22)：非空时头像显示金环 + 该文字
  // （「老师」/「管理员」/以后还能加别的）。is_teacher 仅作历史字段保留，新逻辑一律读 badge_label。
  try {
    db.exec("ALTER TABLE users ADD COLUMN badge_label TEXT NOT NULL DEFAULT ''");
  } catch {
    // Column already exists — ignore
  }

  // ── 刻忆觉醒：服务端权威进度 (2026-10-01 安全修复) ──────────────────
  // 背景：原先 readPlayerProgress() 直接信玩家存档里的 b.l。存档是客户端
  // 通过 POST /save 交上来的，等于玩家自己申报等级 —— 手艺是"塞一座
  // {y:'goldmine', l:5}"，即可永久白拿 +20% 学习加成与满档离线上限。
  //
  // 现在把「服务端认定的进度」落成 users 上的两列：
  //   · village_th_level   —— 市政厅等级
  //   · village_mine_level —— 学识矿脉（goldmine）最高等级
  // 只在服务端能确认真实花费时前进（/withdraw 建造/升级成功），
  // 读取时与存档等级取 min（见 lib/village-save.ts 的 anchorLevel）。
  //
  // 默认值用 0 而不是 1：0 表示「本列还没被写过」，anchorLevel 会退化为
  // 完全采信存档 —— 这样老用户（升级前就玩到 TH3）不会因为新机制被回档到 TH1。
  // 一旦他下一次发生真实升级（或首次保存触发初始化），权威列就被写实，
  // 此后才真正开始双向锚定。
  for (const [col, def] of [
    ['village_th_level', 'INTEGER NOT NULL DEFAULT 0'],
    ['village_mine_level', 'INTEGER NOT NULL DEFAULT 0'],
  ] as const) {
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
    } catch {
      // Column already exists — ignore
    }
  }

  // 头像审核队列
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS avatar_reviews (
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
      CREATE INDEX IF NOT EXISTS idx_avatar_reviews_status ON avatar_reviews(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_avatar_reviews_user ON avatar_reviews(user_id, id DESC);
    `);
  } catch {
    // Table already exists
  }

  // 管理端审计日志
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER,
        action TEXT NOT NULL,
        target_user_id INTEGER,
        detail TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created ON admin_audit_logs(created_at DESC);
    `);
  } catch {
    // Table already exists
  }

  // ── 每日任务可配置化 (2026-09-09) ──────────────────────────────────────
  // 校园小岛每日任务由 tasks 表驱动（替代原先写死在 coins.ts 的常量），
  // key 与历史账本 coins_ledger.source='island_task:<key>' 保持兼容。
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
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
      );
    `);
  } catch {
    // Table already exists
  }

  // Seed 默认三条每日任务（仅当表空时插入；幂等，重复执行不会产生脏数据）
  try {
    const row = db.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number } | undefined;
    if (!row || (Number(row.c) || 0) === 0) {
      const ins = db.prepare(
        'INSERT INTO tasks (key, type, title, target, reward, sort) VALUES (?, ?, ?, ?, ?, ?)'
      );
      ins.run('learn20', 'learn', '今日学习 20 词', 20, 10, 1);
      ins.run('checkin', 'checkin', '完成今日打卡', 0, 10, 2);
      ins.run('review20', 'review', '复习 20 张卡片', 20, 15, 3);
    }
  } catch {
    // 表尚未就绪时静默跳过，下次启动自动补齐
  }

  // ── 竞技场深度统一：单人训练局档案 (P2 2026-09-10) ─────────────────────────
  // 一局 = 模式 × 对手 × 赌注；单人局（opponent_type='none'）全程服务端出题/判分/结算，
  // 后台可见每题细节。真人局顺写一条（battle_id 预留），P3 再接。
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS arena_sessions (
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
      CREATE INDEX IF NOT EXISTS idx_arena_sessions_user ON arena_sessions(user_id, created_at DESC);
    `);
  } catch {
    // Table already exists
  }

  // ── 888 铜板限时福利（一次性领取，按 user × type 去重） ─────────
  // 每个用户每种活动（type）仅可领取一次；重复请求由主键冲突 + INSERT OR IGNORE 兜底，
  // 配合 routes/welfare.ts 里的事务，保证「记表 + 发币」原子、绝不重复发币。
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS welfare_claims (
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        claimed_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, type)
      );
    `);
  } catch {
    // Table already exists
  }

  // ── 实词大赛（一站到底玩法）(2026-10-08) ─────────────────────────────
  // 每位玩家一行：历史最高答题数（best_score）。contest_runs 记录单局出题与作答进度，
  // 判断题在服务端完成（前端拿不到答案），答错/超时即结束并结算 best。
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS contest_scores (
        user_id INTEGER PRIMARY KEY,
        best_score INTEGER NOT NULL DEFAULT 0,
        plays INTEGER NOT NULL DEFAULT 0,
        best_at INTEGER,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS contest_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        question_data TEXT NOT NULL,
        answered_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_contest_runs_user ON contest_runs(user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS contest_prizes (
        user_id INTEGER PRIMARY KEY,
        rank INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        best_score INTEGER NOT NULL,
        settled_at INTEGER NOT NULL
      );
    `);
  } catch {
    // Table already exists
  }

  // ── 全局功能开关（feature flags）(2026-09-20) ─────────────────────────
  // 管理员可在后台一键启用 / 禁用任一主要模块；默认全部开启（enabled=1）。
  // INSERT OR IGNORE 保证幂等：首次启动预置全部模块，后续启动不覆盖已存在行。
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        key TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        label TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    const seed: [string, string][] = [
      ['arena', '竞技场'],
      ['battle', '决斗场'],
      ['practice', '单人训练'],
      ['together', '一起背'],
      ['village', '刻忆觉醒'],
      ['shop', '商城'],
      ['member', '会员'],
      ['reading', '阅读'],
      /* 【2026-10-15】原为 ['learning', '课程']（课程中心）。课程中心已彻底下线，
         换成「每日一句」/daily。注意：这里用的是 INSERT OR IGNORE，只补缺不覆盖 ——
         改完后必须手动把残留的 learning 行删掉，否则每次启动都会把它插回来。 */
      ['daily', '每日一句'],
      ['decks', '词库'],
      ['study', '学习'],
      ['review', '复习'],
      ['lookup', '查词'],
      ['tasks', '任务'],
      ['stats', '统计'],
      ['contest', '实词大赛'],
    ];
    const now = Math.floor(Date.now() / 1000);
    const upsert = db.prepare(
      'INSERT OR IGNORE INTO feature_flags (key, enabled, label, updated_at) VALUES (?, 1, ?, ?)'
    );
    const tx = db.transaction(() => {
      for (const [k, l] of seed) upsert.run(k, l, now);
    });
    tx();
  } catch {
    // Table already exists
  }
    // ── 商城（2026-09-30） ────────────────────────────────────────────────
    // 商品目录放表里（不放代码常量）：后台要能改价/上下架，改完立即生效、无需重新构建。
    // kind = 'unlock' 表示「一次性买断的功能解锁」，目前只有换首页背景。
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS shop_items (
        key         TEXT PRIMARY KEY,
        name        TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        price       INTEGER NOT NULL,
        kind        TEXT    NOT NULL DEFAULT 'unlock',
        enabled     INTEGER NOT NULL DEFAULT 1,
        sort        INTEGER NOT NULL DEFAULT 0,
        updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    }
    catch { /* exists */ }
    // 拥有关系。(user_id, item_key) 是主键 —— 天然防「重复购买/并发双花」，
    // 不需要先 SELECT 再 INSERT 那套容易出竞态的写法。
    // status='refunded' 表示已退款（功能收回），再次购买会把同一行改回 active。
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS shop_purchases (
        user_id     INTEGER NOT NULL,
        item_key    TEXT    NOT NULL,
        price_paid  INTEGER NOT NULL,
        status      TEXT    NOT NULL DEFAULT 'active',
        created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        refunded_at INTEGER,
        refunded_by INTEGER,
        PRIMARY KEY (user_id, item_key)
      );
      CREATE INDEX IF NOT EXISTS idx_sp_item ON shop_purchases(item_key, status);
    `);
    }
    catch { /* exists */ }
    // 学生上传的首页背景图。每人配额有限（见 routes/shop.ts），active=1 的那张才生效。
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS user_backgrounds (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        url        TEXT    NOT NULL,
        bytes      INTEGER NOT NULL DEFAULT 0,
        active     INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_ubg_user ON user_backgrounds(user_id, created_at DESC);
    `);
    }
    catch { /* exists */ }
    // 首个商品：虚拟商品「更换首页背景图片」，售价 211 铜板。
    // INSERT OR IGNORE：后台改过价之后重启不会被这一句覆盖回去。
    try {
        db.prepare(`INSERT OR IGNORE INTO shop_items (key, name, description, price, kind, enabled, sort)
       VALUES (?, ?, ?, ?, 'unlock', 1, 10)`).run('home_bg', '更换首页背景图片', '用你自己的图片替换首页背景（只对你自己生效，别人看不到）', 211);
    }
    catch { /* exists */ }
    // 对战道具：决斗嘲讽包（2026-10-19）。解锁后对局中可发送预设嘲讽语，
    // 文案全部在服务端（routes/battles.ts 的 TAUNTS），不接受客户端自由输入。
    try {
        db.prepare(`INSERT OR IGNORE INTO shop_items (key, name, description, price, kind, enabled, sort)
       VALUES (?, ?, ?, ?, 'unlock', 1, 15)`).run('battle_taunt', '决斗嘲讽包', '对局中可以向对手发送 6 种嘲讽语录，每局最多 3 次（间隔 8 秒）', 120);
    }
    catch { /* exists */ }
    // 消耗品：部落保护卡（3 天）。购买后直接延长 village_profiles.shield_until，
    // 匹配与开打两处本来就会排除护盾中的玩家，所以不需要额外判定。
    // kind='consumable'：允许重复购买、不写 shop_purchases（否则会被「已拥有」挡住）。
    try {
        db.prepare(`INSERT OR IGNORE INTO shop_items (key, name, description, price, kind, enabled, sort)
       VALUES (?, ?, ?, ?, 'consumable', 1, 16)`).run('village_shield_3d', '部落保护卡（3天）', '购买后 3 天内不会被其他玩家匹配为进攻目标（保护期间仍可攻打别人）；重复购买可叠加，最多 30 天', 300);
    }
    catch { /* exists */ }
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS battle_taunts (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        battle_id    INTEGER NOT NULL,
        from_user_id INTEGER NOT NULL,
        text_idx     INTEGER NOT NULL,
        created_at   INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_taunts_battle ON battle_taunts(battle_id, id DESC);
    `);
    }
    catch { /* exists */ }
    // ── 刻忆觉醒：云存档（2026-09-29） ───────────────────────────────────
    // 每用户每 key 一行（village / army / quality）。
    // version 用于乐观并发：客户端提交 baseVersion，服务端 UPDATE ... WHERE version=?，
    // 影响行数为 0 说明别的设备已改过，返回 409 + 最新数据，避免互相覆盖。
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS village_saves (
        user_id    INTEGER NOT NULL,
        save_key   TEXT    NOT NULL,
        data       TEXT,
        version    INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (user_id, save_key)
      )
    `);
    }
    catch { /* exists */ }
    // ── 刻忆觉醒：游戏事件流水（审计 / 风控 / 任务进度） ──────────────────
    // 只记录，不发币。发币金额一律由服务端按自己的规则决定。
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS village_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        type       TEXT    NOT NULL,
        payload    TEXT,
        stars      INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        day        TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ve_user_day ON village_events(user_id, day);
      CREATE INDEX IF NOT EXISTS idx_ve_user_type_day ON village_events(user_id, type, day);
    `);
    }
    catch { /* exists */ }
    // ── 刻忆觉醒：每日额度（防刷） ───────────────────────────────────────
    // last_seen_at 用服务端时间戳，是离线收益计算的唯一基准（不信客户端时钟）。
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS village_daily_quota (
        user_id             INTEGER NOT NULL,
        day                 TEXT    NOT NULL,
        offline_claims      INTEGER NOT NULL DEFAULT 0,
        offline_res_granted INTEGER NOT NULL DEFAULT 0,
        coins_granted       INTEGER NOT NULL DEFAULT 0,
        last_seen_at        INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day)
      )
    `);
    }
    catch { /* exists */ }
    // ── 刻忆觉醒：消费幂等（扣铜板防重复扣） ─────────────────────────────
    // 主键 (user_id, idem_key)：同一次消费动作重放时 INSERT OR IGNORE 影响 0 行，
    // 直接回显结果，不再扣费。金额由服务端按 kind + 存档校验，不信客户端数字。
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS village_spends (
        user_id    INTEGER NOT NULL,
        idem_key   TEXT    NOT NULL,
        kind       TEXT    NOT NULL,
        amount     INTEGER NOT NULL,
        ref        TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (user_id, idem_key)
      )
    `);
    }
    catch { /* exists */ }
    // ── 刻忆觉醒：战斗结算（服务端按星级发铜板用） ──────────────────────
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS village_battles (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        tier       INTEGER NOT NULL,
        seed       INTEGER NOT NULL,
        stars      INTEGER NOT NULL,
        coins      INTEGER NOT NULL DEFAULT 0,
        status     TEXT    NOT NULL DEFAULT 'settled',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        day        TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vb_user_day ON village_battles(user_id, day);
    `);
    }
    catch { /* exists */ }
    // ── 刻忆觉醒：拆除返还幂等（防「同一座建筑反复退款」刷铜板） ──────────
    // 主键 (user_id, inst_id)：inst_id 是客户端建筑实例 id。
    // 一座建筑只会被拆一次，所以对同一 inst_id 的第二次 INSERT OR IGNORE
    // 影响 0 行 —— 用唯一约束天然防并发双花，比「先 SELECT 再 INSERT」可靠。
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS village_refunds (
        user_id    INTEGER NOT NULL,
        inst_id    INTEGER NOT NULL,
        ref        TEXT    NOT NULL,
        amount     INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (user_id, inst_id)
      )
    `);
    }
    catch { /* exists */ }
    // ── 刻忆觉醒：PVP 对手索引（打真实玩家部落） ────────────────────────
    // 为什么单独建表：village_saves 只有 PK (user_id, save_key)，没有 save_key
    // 的单列索引。每次匹配都全表扫 + 逐行 JSON.parse 完整存档是灾难级开销。
    // 这里冗余一份匹配需要的字段，只在 POST /save 成功后增量维护，不做全表扫。
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS village_profiles (
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
      CREATE INDEX IF NOT EXISTS idx_vp_match
        ON village_profiles(th_level, shield_until, building_cnt);
    `);
    }
    catch { /* exists */ }
    // ── 刻忆觉醒：进攻快照 ───────────────────────────────────────────────
    // 异步快照：开打时冻结一份对手村庄副本，打的是这份副本。
    // 对手爱怎么改村庄怎么改 —— 不需要分布式锁、不需要踢下线、对手离线也能打。
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS village_raid_snapshots (
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
      CREATE INDEX IF NOT EXISTS idx_vrs_atk ON village_raid_snapshots(attacker_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_vrs_def ON village_raid_snapshots(defender_id, created_at DESC);
    `);
    }
    catch { /* exists */ }
    // 一个进攻方同时只允许一场 open 快照 —— 并发重入的第一道锁。
    // 部分索引（WHERE status='open'）让已结算的历史行不受约束。
    try {
        db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_vrs_one_open
        ON village_raid_snapshots(attacker_id) WHERE status = 'open';
    `);
    }
    catch { /* exists */ }
    // ── 刻忆觉醒：防守方圣水延迟结算队列 ──────────────────────────────────
    // 为什么不直接在结算时改防守方存档：存档走乐观并发（version），
    // 结算时改写会让防守方客户端下一次提交 baseVersion 落后 → 409 →
    // 服务端优先覆盖 → 玩家刚建的房子、刚收的气泡被吞掉。
    // 所以圣水损失排队，等防守方下次 GET /save 时再应用（那时他还没拿到 version）。
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS village_defense_queue (
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
      );
      CREATE INDEX IF NOT EXISTS idx_vdq_def ON village_defense_queue(defender_id, status);
    `);
    }
    catch { /* exists */ }
    /* 【2026-10-14】战报「已读」标记 —— 玩家上线要弹被攻打战报，
       必须有地方记住「这条战报他看过了」，否则每次进村都会重复弹。
       不复用 notified：那一列在 applyDefenseQueue 里表示「已随存档下发」，
       与本列「玩家已确认看过」是两回事。 */
    try {
        db.exec('ALTER TABLE village_defense_queue ADD COLUMN def_seen INTEGER NOT NULL DEFAULT 0');
    }
    catch { /* exists */ }
    /* ── 单会话表（2026-10-14 按需求：一个账号只能在一个浏览器页面里用）──────
       sid         本次登录会话的标识（JWT 里带着它）—— 换设备/换浏览器重新登录会换 sid
       tab_id      当前活跃的浏览器标签页标识（前端 sessionStorage 里的随机串）
       kicked_tabs 已被接管过的标签页（保留最近 8 个）：它们再发请求一律拒绝，
                   否则两个页面会互相抢，变成「谁最后点谁赢」的拉锯
       一行一用户，用 user_id 做主键 —— 判定只关心「当前是谁」，不需要历史。 */
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        user_id     INTEGER PRIMARY KEY,
        sid         TEXT    NOT NULL,
        tab_id      TEXT    NOT NULL DEFAULT '',
        kicked_tabs TEXT    NOT NULL DEFAULT '[]',
        ua          TEXT    NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        seen_at     INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
    }
    catch { /* exists */ }
    // ── 刻忆觉醒：同对手冷却 / 对刷检测 ──────────────────────────────────
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS village_raid_targets (
        attacker_id INTEGER NOT NULL,
        defender_id INTEGER NOT NULL,
        last_at     INTEGER NOT NULL,
        times_today INTEGER NOT NULL DEFAULT 1,
        day         TEXT    NOT NULL,
        PRIMARY KEY (attacker_id, defender_id)
      )
    `);
    }
    catch { /* exists */ }
    // ── PVP 需要的列（标准 try/catch 幂等迁移） ──────────────────────────
    for (const [col, def] of [
        ['defender_id', 'INTEGER'],
        ['snapshot_id', 'INTEGER'],
        ['mode', "TEXT NOT NULL DEFAULT 'npc'"],
        ['pct', 'INTEGER NOT NULL DEFAULT 0'],
        ['elixir', 'INTEGER NOT NULL DEFAULT 0'],
        ['suspect', 'INTEGER NOT NULL DEFAULT 0'],
        ['duration_ms', 'INTEGER NOT NULL DEFAULT 0'],
    ]) {
        try {
            db.exec(`ALTER TABLE village_battles ADD COLUMN ${col} ${def}`);
        }
        catch { /* exists */ }
    }
    try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_vb_def_day ON village_battles(defender_id, day)');
    }
    catch { /* exists */ }
    for (const [col, def] of [
        ['raid_coins_gained', 'INTEGER NOT NULL DEFAULT 0'],
        ['raid_coins_lost', 'INTEGER NOT NULL DEFAULT 0'],
        ['raid_count', 'INTEGER NOT NULL DEFAULT 0'],
    ]) {
        try {
            db.exec(`ALTER TABLE village_daily_quota ADD COLUMN ${col} ${def}`);
        }
        catch { /* exists */ }
    }
    // ── 刻忆觉醒：一次性数据迁移（2026-09-29 经济统一） ──────────────────
    migrateVillageEconomy(db);
}

/**
 * 一次性迁移：把老存档里的「游戏金币」清零，并为受影响的玩家补发启动铜板。
 *
 * 背景：统一经济后 `res.gold` 的语义从「游戏金币」变成「平台铜板镜像」。
 * 老档里这个字段可能存着上万的旧金币，直接沿用等于玩家凭空暴富。
 *
 * 幂等性：用独立的 key-value 标记表记「已跑过」，重启服务不会重复补发。
 * 同时只处理「还没被新版本写过的档」—— 迁移标记本身保证只跑一次。
 *
 * 注意：
 *   · 只动 village 这个 key 的 data.res.gold，不碰 buildings / stat / quests
 *   · 补发的铜板走 addCoins，会正常记流水（source=village_migrate），可对账
 *   · 补发金额刻意小（30），够起步建一两座建筑，不至于破坏新经济节奏
 */
function migrateVillageEconomy(db: Database.Database): void {
    const MIGRATION_KEY = 'village_economy_unified_v1';
    /* ⚠️ 2026-09-30：初始铜板由 30 改为 0。
       与「开局不给铜板」的定价策略配套 —— 1 级建筑 150 铜板，初始发 30 也建不了
       任何东西，反而制造「系统给的钱不够用」的挫败感，不如干脆不给。
       改回非 0 值时会重新给所有老档补发，所以这里保留补发逻辑不动。
       ⚠️ users.coins 的列默认值本来就是 0（见 ALTER TABLE），新号天然就是 0 铜板。 */
    const STARTER_COINS = 0;
    try {
        db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key        TEXT PRIMARY KEY,
        value      TEXT,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
        const done = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get(MIGRATION_KEY);
        if (done)
            return;
        const rows = db.prepare("SELECT user_id, data FROM village_saves WHERE save_key = 'village' AND data IS NOT NULL").all() as { user_id: number; data: string }[];
        let touched = 0;
        for (const r of rows) {
            let parsed;
            try {
                parsed = JSON.parse(r.data);
            }
            catch {
                continue;
            }
            if (!parsed || typeof parsed !== 'object')
                continue;
            // 只处理确实有旧金币的档：新档本来就是 0，动它没意义
            const oldGold = Number(parsed?.res?.gold) || 0;
            if (oldGold <= 0)
                continue;
            parsed.res.gold = 0; // 清零：铜板以服务端 users.coins 为准
            try {
                db.prepare("UPDATE village_saves SET data = ?, version = version + 1, updated_at = unixepoch() WHERE user_id = ? AND save_key = 'village'").run(JSON.stringify(parsed), r.user_id);
                // 补发启动铜板（用户可能余额为 0，起步不该卡死）
                const cur = Number((db.prepare('SELECT coins FROM users WHERE id = ?').get(r.user_id) as { coins?: number } | undefined)?.coins) || 0;
                if (cur < STARTER_COINS) {
                    db.prepare('UPDATE users SET coins = ? WHERE id = ?').run(STARTER_COINS, r.user_id);
                    db.prepare(`INSERT INTO coins_ledger (user_id, delta, balance, source, ref_id, day, created_at)
             VALUES (?, ?, ?, 'village_migrate', NULL, ?, unixepoch())`).run(r.user_id, STARTER_COINS - cur, STARTER_COINS, new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10));
                }
                touched++;
            }
            catch { /* 单条失败不影响其它玩家 */ }
        }
        db.prepare('INSERT OR REPLACE INTO schema_meta (key, value, updated_at) VALUES (?, ?, unixepoch())').run(MIGRATION_KEY, `touched=${touched}`);
        if (touched > 0) {
            console.log(`[migrate] 刻忆觉醒经济统一：已归一 ${touched} 份老存档（金币清零 + 补发 ${STARTER_COINS} 铜板）`);
        }
    }
    catch (e) {
        // 迁移失败不能阻止服务启动；下次重启会重试
        console.error('[migrate] village 经济迁移失败：', e);
    }
}

// Queue types matching Anki
export const QueueType = {
  NEW: 0,
  LEARNING: 1,
  REVIEW: 2,
  RELEARNING: 3,
} as const;

// Card types
export const CardType = {
  NEW: 0,
  LEARNING: 1,
  REVIEW: 2,
  RELEARNING: 3,
} as const;

// Review ratings
export const Rating = {
  AGAIN: 1,
  HARD: 2,
  GOOD: 3,
  EASY: 4,
} as const;

export type QueueTypeValue = typeof QueueType[keyof typeof QueueType];
export type CardTypeValue = typeof CardType[keyof typeof CardType];
export type RatingValue = typeof Rating[keyof typeof Rating];
