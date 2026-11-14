#!/usr/bin/env node

/**
 * 古文→白话文 批量翻译脚本
 *
 * 读取 deck_id=5 (admin的高中120文言文实词) 的所有笔记
 * 用 DeepSeek API 批量翻译 Front 字段的古文句子为白话文
 * 然后更新 notes 的 notetype_id 为 9（古文翻译），并在 fields[2] 存储翻译结果
 *
 * 用法: node scripts/translate-all.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Get DeepSeek API key from Hermes .env
function getApiKey() {
  try {
    const envPath = resolve(process.env.HOME, '.hermes', '.env');
    const env = readFileSync(envPath, 'utf-8');
    const match = env.match(/DEEPSEEK_API_KEY=(.+)/);
    if (match) return match[1].trim();
  } catch {}
  return process.env.DEEPSEEK_API_KEY;
}

// Get database connection
function getDb() {
  const dbPath = resolve(__dirname, '..', 'data', 'anki-web.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  return db;
}

// Call DeepSeek API to batch translate
async function batchTranslate(sentences, apiKey) {
  const prompt = sentences.map((s, i) => `${i + 1}. ${s}`).join('\n');

  const body = {
    model: 'deepseek-chat',
    messages: [
      {
        role: 'system',
        content: '你是一位古文翻译专家。请将以下古文句子逐句翻译成现代白话文。保持原意，语言通顺自然。\n' +
          '请按以下格式输出（保持序号对应）：\n' +
          '1. 翻译结果1\n' +
          '2. 翻译结果2\n' +
          '...\n' +
          '只输出翻译结果，不要添加额外说明。如果某句无法翻译或不是完整句子，返回空行。'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.3,
    max_tokens: 4096,
  };

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;

  // Parse numbered results back into array
  const results = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^\d+\.\s*(.*)/);
    if (match) {
      results.push(match[1].trim());
    }
  }
  return results;
}

// Strip HTML tags
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').trim();
}

async function main() {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('ERROR: DEEPSEEK_API_KEY not found');
    process.exit(1);
  }

  const db = getDb();

  // 1. Read all notes from deck_id=5 (admin's 文言文 deck)
  const notes = db.prepare(`
    SELECT n.id, n.fields, n.notetype_id
    FROM notes n
    JOIN cards c ON c.note_id = n.id
    WHERE c.deck_id = 5 AND c.user_id = 2
    GROUP BY n.id
    ORDER BY n.id
  `).all();

  console.log(`Found ${notes.length} notes to translate\n`);

  // 2. Batch translate
  const BATCH_SIZE = 15;
  let translated = 0;
  let failed = 0;
  let totalBatches = Math.ceil(notes.length / BATCH_SIZE);

  for (let i = 0; i < notes.length; i += BATCH_SIZE) {
    const batch = notes.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    // Check if already have translation (field[2])
    const toTranslate = batch.filter((n) => {
      const fields = JSON.parse(n.fields);
      return !fields[2] || fields[2].trim() === '';
    });

    if (toTranslate.length === 0) {
      // Already translated - just update notetype if needed
      const updateStmt = db.prepare('UPDATE notes SET notetype_id = ?, modified_at = unixepoch() WHERE id = ? AND notetype_id != ?');
      for (const n of batch) {
        updateStmt.run(9, n.id, 9);
      }
      translated += batch.length;
      console.log(`[${batchNum}/${totalBatches}] Skipped (already translated)`);
      continue;
    }

    const sentences = toTranslate.map(n => stripHtml(JSON.parse(n.fields)[0]));

    console.log(`[${batchNum}/${totalBatches}] Translating ${sentences.length} sentences...`);

    try {
      const translations = await batchTranslate(sentences, apiKey);

      const updateStmt = db.prepare(`
        UPDATE notes SET
          fields = ?,
          notetype_id = 9,
          modified_at = unixepoch()
        WHERE id = ?
      `);

      const updateTransaction = db.transaction(() => {
        for (let j = 0; j < toTranslate.length; j++) {
          const note = toTranslate[j];
          const origFields = JSON.parse(note.fields);
          const translation = translations[j] || '';

          // fields: [Front, Back, Translation]
          const newFields = [origFields[0], origFields[1] || '', translation];

          updateStmt.run(JSON.stringify(newFields), note.id);
          translated++;
        }
      });

      updateTransaction();

      if (translations.length < sentences.length) {
        console.log(`  Warning: got ${translations.length} translations, expected ${sentences.length}`);
      }
    } catch (err) {
      failed += toTranslate.length;
      console.error(`  FAILED: ${err.message}`);
      // Wait before retry
      await new Promise(r => setTimeout(r, 3000));
    }

    // Small delay between batches for rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n===== DONE =====`);
  console.log(`Successfully translated: ${translated}`);
  console.log(`Failed: ${failed}`);

  db.close();
}

main().catch(err => {
  console.error('Script error:', err);
  process.exit(1);
});
