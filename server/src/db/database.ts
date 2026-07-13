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

  // Migration: add avatar_url column to users
  try {
    db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''");
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
  } catch {
    // Table already exists
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
