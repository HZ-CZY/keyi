import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

const TRANSLATION_NOTETYPE_NAME = '古文翻译';

// Check if a deck name contains ancient Chinese keywords
function isClassicalChineseDeck(deckName: string): boolean {
  const keywords = ['文言文', '古文', '古诗', '实词', '虚词', '诗词', '古诗词'];
  return keywords.some(k => deckName.includes(k));
}

// Get or create the 古文翻译 notetype for a user
function getOrCreateTranslationNotetype(db: any, userId: number): number {
  const existing = db.prepare(
    'SELECT id FROM notetypes WHERE user_id = ? AND name = ?'
  ).get(userId, TRANSLATION_NOTETYPE_NAME) as any;
  
  if (existing) return existing.id;

  const fieldNames = ['Front', 'Back', '白话文'];
  const templateQ = '{{Front}}';
  const templateA = '{{FrontSide}}<hr>{{Back}}<hr><div class="translation-section"><b>📖 白话文翻译：</b><br>{{白话文}}</div>';
  const css = '.card { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 18px; line-height: 1.8; } .translation-section { margin-top: 16px; padding: 12px 16px; background: #f0f7ff; border-left: 4px solid #3b82f6; border-radius: 8px; color: #1e40af; font-size: 16px; } .translation-section b { color: #1e40af; }';

  const result = db.prepare(
    `INSERT INTO notetypes (user_id, name, css, kind, field_names, template_q_format, template_a_format)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, TRANSLATION_NOTETYPE_NAME, css, 'normal', JSON.stringify(fieldNames), templateQ, templateA);

  return result.lastInsertRowid as number;
}

// Strip HTML tags
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

// Batch translate notes in a deck via DeepSeek API
async function translateDeckNotes(db: any, deckId: number, userId: number): Promise<{ translated: number; failed: number }> {
  // Check if the deck is a classical Chinese deck
  const deck = db.prepare('SELECT name FROM decks WHERE id = ? AND user_id = ?').get(deckId, userId) as any;
  if (!deck) return { translated: 0, failed: 0 };

  // Get DeepSeek API key from Hermes config
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return { translated: 0, failed: 0 };

  // Get notes in this deck that don't have a translation yet
  const notes = db.prepare(`
    SELECT n.id, n.fields, n.notetype_id
    FROM notes n
    JOIN cards c ON c.note_id = n.id
    WHERE c.deck_id = ? AND c.user_id = ?
    GROUP BY n.id
    ORDER BY n.id
  `).all(deckId, userId) as any[];

  const toTranslate = notes.filter((n: any) => {
    const fields = JSON.parse(n.fields);
    return !fields[2] || fields[2].trim() === '';
  });

  if (toTranslate.length === 0) return { translated: 0, failed: 0 };

  const targetNotetypeId = getOrCreateTranslationNotetype(db, userId);
  const BATCH_SIZE = 15;
  let translated = 0;
  let failed = 0;

  for (let i = 0; i < toTranslate.length; i += BATCH_SIZE) {
    const batch = toTranslate.slice(i, i + BATCH_SIZE);
    const sentences = batch.map((n: any) => stripHtml(JSON.parse(n.fields)[0]));

    const prompt = sentences.map((s: string, idx: number) => `${idx + 1}. ${s}`).join('\n');

    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: '你是一位古文翻译专家。请将以下古文句子逐句翻译成现代白话文。保持原意，语言通顺自然。\n' +
                '请按以下格式输出（保持序号对应）：\n' +
                '1. 翻译结果1\n2. 翻译结果2\n...\n' +
                '只输出翻译结果，不要添加额外说明。如果某句无法翻译或不是完整句子，返回空行。'
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 4096,
        }),
      });

      if (!response.ok) continue;

      const data: any = await response.json();
      const content = data.choices[0].message.content;

      // Parse results
      const results: string[] = [];
      for (const line of content.split('\n')) {
        const match = line.match(/^\d+\.\s*(.*)/);
        if (match) results.push(match[1].trim());
      }

      const updateStmt = db.prepare(
        'UPDATE notes SET fields = ?, notetype_id = ?, modified_at = unixepoch() WHERE id = ?'
      );

      const doUpdate = db.transaction(() => {
        for (let j = 0; j < batch.length; j++) {
          const note = batch[j];
          const origFields = JSON.parse(note.fields);
          const translation = results[j] || '';
          const newFields = [origFields[0], origFields[1] || '', translation];
          updateStmt.run(JSON.stringify(newFields), targetNotetypeId, note.id);
          translated++;
        }
      });

      doUpdate();
    } catch {
      failed += batch.length;
    }

    // Rate limiting delay
    await new Promise(r => setTimeout(r, 200));
  }

  return { translated, failed };
}

// POST /api/translate/deck/:deckId - Trigger translation for a deck
router.post('/deck/:deckId', async (req: AuthRequest, res: Response) => {
  try {
    const deckId = parseInt(req.params.deckId);
    const db = getDb();

    // Verify deck exists and belongs to user
    const deck = db.prepare('SELECT id, name FROM decks WHERE id = ? AND user_id = ?').get(deckId, req.userId) as any;
    if (!deck) {
      res.status(404).json({ error: '牌组不存在' });
      return;
    }

    // Count pending notes
    const pending = db.prepare(`
      SELECT COUNT(*) as count FROM notes n
      JOIN cards c ON c.note_id = n.id
      WHERE c.deck_id = ? AND c.user_id = ?
      GROUP BY n.id
    `).get(deckId, req.userId) as any;

    // Start translation asynchronously (don't block response)
    translateDeckNotes(db, deckId, req.userId!)
      .then(result => {
        console.log(`[Translate] Deck #${deckId} "${deck.name}": ${result.translated} translated, ${result.failed} failed`);
      })
      .catch(err => {
        console.error(`[Translate] Deck #${deckId} error:`, err.message);
      });

    res.json({
      success: true,
      message: `已开始翻译牌组「${deck.name}」的古文卡片，翻译将在后台进行。`,
      translationStarted: true,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/translate/status/:deckId - Check translation status
router.get('/status/:deckId', (req: AuthRequest, res: Response) => {
  try {
    const deckId = parseInt(req.params.deckId);
    const db = getDb();

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM notes n
      JOIN cards c ON c.note_id = n.id
      WHERE c.deck_id = ? AND c.user_id = ?
      GROUP BY n.id
    `).get(deckId, req.userId) as any || { count: 0 };

    const translated = db.prepare(`
      SELECT COUNT(*) as count FROM notes n
      JOIN cards c ON c.note_id = n.id
      WHERE c.deck_id = ? AND c.user_id = ? AND json_extract(n.fields, '$[2]') IS NOT NULL AND json_extract(n.fields, '$[2]') != ''
      GROUP BY n.id
    `).get(deckId, req.userId) as any || { count: 0 };

    const pending = db.prepare(`
      SELECT COUNT(*) as count FROM notes n
      JOIN cards c ON c.note_id = n.id
      WHERE c.deck_id = ? AND c.user_id = ? AND (json_extract(n.fields, '$[2]') IS NULL OR json_extract(n.fields, '$[2]') = '')
      GROUP BY n.id
    `).get(deckId, req.userId) as any || { count: 0 };

    res.json({
      total: total.count || 0,
      translated: translated.count || 0,
      pending: pending.count || 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
