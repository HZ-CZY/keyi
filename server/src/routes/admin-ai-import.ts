import { Router, Response } from 'express';
import multer from 'multer';
import { getDb } from '../db/database';
import { adminMiddleware, AuthRequest } from '../middleware/auth';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
router.use(adminMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Document parsers
async function parseText(buffer: Buffer): Promise<string> {
  return buffer.toString('utf-8');
}

async function parsePdf(buffer: Buffer): Promise<string> {
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);
  return data.text;
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

const ALLOWED_TYPES: Record<string, string> = {
  'text/plain': 'txt',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const SUPPORTED_EXTENSIONS = ['.txt', '.pdf', '.docx'];

// AI system prompt for card extraction
const AI_SYSTEM_PROMPT = `你是一个智能制卡助手。你的任务是从文档内容中提取关键知识点，生成适合间隔复习（Anki风格）的问答卡片。

规则：
1. 每张卡片包含一个「正面」（问题/概念/关键词）和一个「背面」（答案/解释/定义）
2. 卡片内容要精炼、准确、有学习价值
3. 对于复杂概念，可以拆分成多张卡片
4. 保持语言与原文一致（中文就中文，英文就英文）
5. 不要遗漏重要信息点
6. 对于列表类内容（如步骤、特征），也要转化为问答形式

输出格式（严格按此格式，每行一条）：
正面内容 ||| 背面内容

如果内容无法提取任何有意义的卡片，输出：NO_CARDS_FOUND`;

// POST /admin/ai-import — upload document and auto-create cards via AI
router.post('/ai-import', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: '未上传文件' });
      return;
    }

    const { userId, deckId, notetypeName } = req.body;
    if (!userId || !deckId) {
      res.status(400).json({ error: '请指定用户和牌组' });
      return;
    }

    // Determine file type
    const mime = req.file.mimetype;
    const ext = ALLOWED_TYPES[mime];
    if (!ext) {
      const name = req.file.originalname.toLowerCase();
      const match = SUPPORTED_EXTENSIONS.find(e => name.endsWith(e));
      if (!match) {
        res.status(400).json({ error: '不支持的文件格式，仅支持 .txt、.pdf、.docx' });
        return;
      }
    }

    // Parse document
    let text: string;
    if (mime === 'application/pdf' || ext === 'pdf' || req.file.originalname.toLowerCase().endsWith('.pdf')) {
      text = await parsePdf(req.file.buffer);
    } else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx' || req.file.originalname.toLowerCase().endsWith('.docx')) {
      text = await parseDocx(req.file.buffer);
    } else {
      text = await parseText(req.file.buffer);
    }

    text = text.trim();
    if (!text || text.length < 10) {
      res.status(400).json({ error: '文档内容为空或无法解析' });
      return;
    }

    // Truncate if too long (DeepSeek context window)
    const MAX_CHARS = 60000;
    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS) + '\n\n[内容过长，已截断]';
    }

    // Send to DeepSeek
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'DEEPSEEK_API_KEY 未配置' });
      return;
    }

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: `请从以下文档内容中提取卡片：\n\n${text}` }
        ],
        temperature: 0.3,
        max_tokens: 8192,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      res.status(502).json({ error: `AI 服务调用失败: ${response.status} ${errText}` });
      return;
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    if (content.includes('NO_CARDS_FOUND') || content.trim().length === 0) {
      res.status(422).json({ error: 'AI 未能从文档中提取出有效卡片，请检查文档内容' });
      return;
    }

    // Parse card pairs
    const cardPairs: { front: string; back: string }[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const sep = trimmed.indexOf(' ||| ');
      if (sep > 0) {
        const front = trimmed.slice(0, sep).trim();
        const back = trimmed.slice(sep + 5).trim();
        if (front && back) {
          cardPairs.push({ front, back });
        }
      }
    }

    if (cardPairs.length === 0) {
      res.status(422).json({ error: 'AI 返回格式异常，无法解析卡片数据' });
      return;
    }

    // Determine notetype: use existing "AI导入" or create one
    const db = getDb();
    const targetName = notetypeName || 'AI导入';
    let nt = db.prepare('SELECT * FROM notetypes WHERE user_id = ? AND name = ?').get(userId, targetName) as any;
    let notetypeId: number;

    if (nt) {
      notetypeId = nt.id;
    } else {
      // Check if we need a 2-field or 3-field notetype
      const fieldNames = ['正面', '背面'];
      const templateQ = '{{正面}}';
      const templateA = '{{正面}}<hr id=answer>{{背面}}';
      const css = '.card { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 18px; line-height: 1.8; }';

      const result = db.prepare(`
        INSERT INTO notetypes (user_id, name, css, kind, field_names, template_q_format, template_a_format)
        VALUES (?, ?, ?, 'normal', ?, ?, ?)
      `).run(userId, targetName, css, JSON.stringify(fieldNames), templateQ, templateA);
      notetypeId = result.lastInsertRowid as number;
    }

    // Create notes and cards in a transaction
    const now = Math.floor(Date.now() / 1000);
    let created = 0;

    const createBatch = db.transaction(() => {
      for (const pair of cardPairs) {
        const guid = uuidv4();
        const fields = JSON.stringify([pair.front, pair.back]);
        const sortField = pair.front;

        const noteResult = db.prepare(`
          INSERT INTO notes (user_id, guid, notetype_id, tags, fields, sort_field)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, guid, notetypeId, 'AI制卡', fields, sortField);

        const noteId = noteResult.lastInsertRowid;

        db.prepare(`
          INSERT INTO cards (user_id, note_id, deck_id, template_idx, queue, due, interval, ease_factor, reps, lapses, remaining_steps)
          VALUES (?, ?, ?, 0, 0, ?, 0, 2.5, 0, 0, 0)
        `).run(userId, noteId, deckId, now + created);

        created++;
      }
    });

    createBatch();

    res.json({
      success: true,
      message: `AI 制卡完成！从文档中提取了 ${cardPairs.length} 张卡片并导入到牌组。`,
      stats: {
        total: cardPairs.length,
        created,
        notetypeName: targetName,
        documentLength: text.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'AI 制卡失败' });
  }
});

export default router;
