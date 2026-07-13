/**
 * APKG File Import Parser
 *
 * Parses Anki .apkg files (ZIP archives containing SQLite database + media files)
 * and imports cards, notes, decks, and media into the web database.
 *
 * Format reference:
 * - collection.anki21(b): SQLite database with tables matching Anki schema
 * - media: JSON mapping of media filenames to file references
 * - Media files numbered 0, 1, 2, ... stored at root level
 */
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

interface ApkgData {
  decks: ImportDeck[];
  notetypes: ImportNotetype[];
  notes: ImportNote[];
  cards: ImportCard[];
  mediaFiles: ImportMedia[];
  revlog: ImportRevlog[];
}

interface ImportDeck {
  id: number;
  name: string;
  description: string;
  configId?: number;
  deckConfig?: ImportDeckConfig;
  parentId?: number;
}

interface ImportDeckConfig {
  learnSteps: number[];
  relearnSteps: number[];
  initialEase: number;
  easyMultiplier: number;
  hardMultiplier: number;
  intervalMultiplier: number;
  maximumReviewInterval: number;
  minimumLapseInterval: number;
  graduatingIntervalGood: number;
  graduatingIntervalEasy: number;
  newPerDay: number;
  reviewsPerDay: number;
  leechThreshold: number;
  lapseMultiplier: number;
}

interface ImportNotetype {
  id: number;
  name: string;
  css: string;
  kind: string;
  fieldNames: string[];
  templateQFormat: string;
  templateAFormat: string;
}

interface ImportNote {
  id: number;
  guid: string;
  notetypeId: number;
  tags: string;
  fields: string[];
  sortField: string;
}

interface ImportCard {
  id: number;
  noteId: number;
  deckId: number;
  templateIdx: number;
  queue: number;
  due: number;
  interval: number;
  easeFactor: number;
  reps: number;
  lapses: number;
  remainingSteps: number;
  originalDeckId: number;
  flags: number;
}

interface ImportMedia {
  filename: string;
  originalName: string;
  data: Buffer;
}

interface ImportRevlog {
  cardId: number;
  ease: number;
  interval: number;
  lastInterval: number;
  factor: number;
  time: number;
  type: number;
}

/**
 * Parse an APKG file buffer and extract all data
 */
export function parseApkg(buffer: Buffer): ApkgData {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  // Find the SQLite database
  let collectionDbBuffer: Buffer | null = null;
  let mediaJson: Record<string, string> = {};

  for (const entry of entries) {
    if (entry.entryName === 'collection.anki21' || entry.entryName === 'collection.anki21b' || entry.entryName === 'collection.anki2') {
      collectionDbBuffer = entry.getData();
    } else if (entry.entryName === 'media') {
      try {
        mediaJson = JSON.parse(entry.getData().toString('utf-8'));
      } catch {
        mediaJson = {};
      }
    }
  }

  if (!collectionDbBuffer) {
    throw new Error('无效的 APKG 文件：未找到 collection 数据库');
  }

  // better-sqlite3 only accepts file paths, not Buffers.
  // Write the embedded DB to a temp file, open it, then clean up.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anki-import-'));
  const dbPath = path.join(tmpDir, 'collection.anki21');

  try {
    fs.writeFileSync(dbPath, collectionDbBuffer);
    const tempDb = new Database(dbPath, { readonly: true });

    try {
      const data = extractApkgData(tempDb);
      data.mediaFiles = extractMediaFiles(zip, mediaJson);
      return data;
    } finally {
      tempDb.close();
    }
  } finally {
    // Clean up temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

function extractApkgData(db: Database.Database): ApkgData {
  // Detect schema version and available columns
  const hasQueueCol = columnExists(db, 'cards', 'queue');
  const hasLeftCol = columnExists(db, 'cards', 'left');
  const hasOdidCol = columnExists(db, 'cards', 'odid');

  // Extract deck configurations
  const deckConfigs = new Map<number, ImportDeckConfig>();
  try {
    const configRows = db.prepare('SELECT id, config FROM deck_config').all() as any[];
    for (const row of configRows) {
      try {
        const config = JSON.parse(row.config);
        deckConfigs.set(row.id, {
          learnSteps: config.learnSteps || [1, 10],
          relearnSteps: config.relearnSteps || [10],
          initialEase: config.initialEase || 2.5,
          easyMultiplier: config.easyMultiplier || 1.3,
          hardMultiplier: config.hardMultiplier || 1.2,
          intervalMultiplier: config.intervalMultiplier || 1.0,
          maximumReviewInterval: config.maximumReviewInterval || 36500,
          minimumLapseInterval: config.minimumLapseInterval || 1,
          graduatingIntervalGood: config.graduatingIntervalGood || 1,
          graduatingIntervalEasy: config.graduatingIntervalEasy || 4,
          newPerDay: config.newPerDay || 20,
          reviewsPerDay: config.reviewsPerDay || 200,
          leechThreshold: config.leechThreshold || 8,
          lapseMultiplier: config.lapseMultiplier || 0.0,
        });
      } catch {
        // Skip malformed configs
      }
    }
  } catch {
    // Pre-v14 schema doesn't have deck_config table
  }

  // Extract decks from col table
  const decks: ImportDeck[] = [];
  try {
    const colRow = db.prepare('SELECT decks, dconf FROM col LIMIT 1').get() as any;
    if (colRow) {
      const decksJson = JSON.parse(colRow.decks);
      const dconfJson = JSON.parse(colRow.dconf);

      for (const [idStr, deckData] of Object.entries(decksJson)) {
        const id = parseInt(idStr);
        const d = deckData as any;
        const configId = d.conf;
        decks.push({
          id,
          name: d.name || 'Unnamed Deck',
          description: d.desc || '',
          configId,
          deckConfig: deckConfigs.get(configId) || dconfJson[configId]
            ? parseLegacyDConf(dconfJson[configId])
            : undefined,
          parentId: undefined,
        });
      }
    }
  } catch {
    // Fallback
  }

  // Extract notetypes
  const notetypes: ImportNotetype[] = [];
  try {
    const colRow = db.prepare('SELECT models FROM col LIMIT 1').get() as any;
    if (colRow) {
      const modelsJson = JSON.parse(colRow.models);
      for (const [idStr, modelData] of Object.entries(modelsJson)) {
        const id = parseInt(idStr);
        const m = modelData as any;
        const nt: ImportNotetype = {
          id,
          name: m.name || 'Basic',
          css: m.css || '',
          kind: m.type === 1 ? 'cloze' : 'normal',
          fieldNames: (m.flds || []).map((f: any) => f.name),
          templateQFormat: (m.tmpls?.[0]?.qfmt) || '{{Front}}',
          templateAFormat: (m.tmpls?.[0]?.afmt) || '{{FrontSide}}<hr>{{Back}}',
        };
        notetypes.push(nt);
      }
    }
  } catch {
    // Fallback
  }

  // Extract notes
  const notes: ImportNote[] = [];
  try {
    const noteRows = db.prepare('SELECT id, guid, mid, tags, flds, sfld FROM notes').all() as any[];
    for (const row of noteRows) {
      notes.push({
        id: row.id,
        guid: row.guid || uuidv4(),
        notetypeId: row.mid,
        tags: row.tags || '',
        fields: (row.flds || '').split('\x1f'),
        sortField: row.sfld || '',
      });
    }
  } catch {
    // Fallback
  }

  // Extract cards
  const cards: ImportCard[] = [];
  try {
    let cardQuery: string;
    if (hasQueueCol) {
      cardQuery = 'SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, ' +
        (hasLeftCol ? 'left' : '0 as left') + ', ' +
        (hasOdidCol ? 'odid' : '0 as odid') + ', flags FROM cards';
    } else {
      cardQuery = 'SELECT id, nid, did, ord, type, due, ivl, factor, reps, lapses, flags FROM cards';
    }

    const cardRows = db.prepare(cardQuery).all() as any[];
    for (const row of cardRows) {
      cards.push({
        id: row.id,
        noteId: row.nid,
        deckId: row.did,
        templateIdx: row.ord || 0,
        // If queue column exists, use it; otherwise use type as queue
        queue: hasQueueCol ? (row.queue !== undefined ? row.queue : (row.type || 0)) : (row.type || 0),
        due: row.due || 0,
        interval: Math.max(0, row.ivl || 0),
        easeFactor: (row.factor || 2500) / 1000,
        reps: row.reps || 0,
        lapses: row.lapses || 0,
        remainingSteps: row.left || 0,
        originalDeckId: (row.odid || 0),
        flags: row.flags || 0,
      });
    }
  } catch {
    // Fallback
  }

  // Extract revlog
  const revlog: ImportRevlog[] = [];
  try {
    const revlogRows = db.prepare(
      'SELECT cid, ease, ivl, lastIvl, factor, time, type FROM revlog'
    ).all() as any[];
    for (const row of revlogRows) {
      revlog.push({
        cardId: row.cid,
        ease: row.ease,
        interval: row.ivl,
        lastInterval: row.lastIvl,
        factor: row.factor,
        time: row.time,
        type: row.type,
      });
    }
  } catch {
    // Fallback
  }

  return { decks, notetypes, notes, cards, mediaFiles: [], revlog };
}

function columnExists(db: Database.Database, table: string, col: string): boolean {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    return rows.some((r: any) => r.name === col);
  } catch {
    return false;
  }
}

function extractMediaFiles(zip: AdmZip, mediaJson: Record<string, string>): ImportMedia[] {
  const mediaFiles: ImportMedia[] = [];
  const entries = zip.getEntries();

  for (const entry of entries) {
    const name = entry.entryName;
    // Skip known meta files
    if (name === 'collection.anki21' || name === 'collection.anki21b' || name === 'collection.anki2' || name === 'media') {
      continue;
    }
    if (entry.isDirectory) continue;

    // Find the original name from media.json
    let originalName = name;
    for (const [origName, fileIdx] of Object.entries(mediaJson)) {
      if (String(fileIdx) === name) {
        originalName = origName;
        break;
      }
    }

    mediaFiles.push({
      filename: name,
      originalName,
      data: entry.getData(),
    });
  }

  return mediaFiles;
}

function parseLegacyDConf(dconf: any): ImportDeckConfig | undefined {
  if (!dconf) return undefined;
  return {
    learnSteps: Array.isArray(dconf.delays) ? dconf.delays.map((d: number) => d * 60) : [60, 600],
    relearnSteps: [600],
    initialEase: dconf.initialFactor ? dconf.initialFactor / 1000 : 2.5,
    easyMultiplier: dconf.ease4 || 1.3,
    hardMultiplier: dconf.ease2 || 1.2,
    intervalMultiplier: dconf.ivlFct || 1.0,
    maximumReviewInterval: dconf.maxIvl || 36500,
    minimumLapseInterval: 1,
    graduatingIntervalGood: dconf.gradInt || 1,
    graduatingIntervalEasy: dconf.gradInt ? dconf.gradInt * 2 : 4,
    newPerDay: dconf.new?.perDay || 20,
    reviewsPerDay: dconf.rev?.perDay || 200,
    leechThreshold: dconf.leech?.threshold || 8,
    lapseMultiplier: dconf.lapse?.mult || 0.0,
  };
}

/**
 * Simple format for importing text/CSV notes
 */
export function parseCsvNotes(
  csvContent: string,
  fieldNames: string[]
): { fields: string[]; tags: string }[] {
  const lines = csvContent.trim().split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];

  // Check if first line is header
  let dataLines = lines;
  const firstFields = lines[0].split(',').map(f => f.trim().replace(/^"|"$/g, ''));
  const isHeader = firstFields.some(f => fieldNames.some(n => n.toLowerCase() === f.toLowerCase()));
  if (isHeader) dataLines = lines.slice(1);

  return dataLines.map(line => {
    const fields = line.split(',').map(f => f.trim().replace(/^"|"$/g, ''));
    return {
      fields: fields.slice(0, fieldNames.length),
      tags: '',
    };
  });
}
