import { Router, Response } from 'express';
import multer from 'multer';
import { getDb } from '../db/database';
import { adminMiddleware, AuthRequest } from '../middleware/auth';
import { libraryOwnerId } from './lib/deckLibrary';
import { v4 as uuidv4 } from 'uuid';
import {
  FIELD_NAMES,
  DEFAULT_NOTETYPE_NAME,
  parseAiOutput,
  dedupeCards,
  toPlain,
  type ValidatedCard,
} from './lib/aiCardSchema';

const router = Router();
router.use(adminMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ── 文档解析 ─────────────────────────────────────────────────────────
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

const MAX_CHARS = 60000;

/**
 * 【2026-09-28 重写】文言文制卡专用提示词。
 *
 * 旧提示词是通用文档摘要器，产出的卡片与线上「古文翻译」结构不兼容
 * （无 **重点字**、只有 2 字段、分隔符脆弱）。新提示词直接对齐线上 12.6 万张
 * 古文翻译卡的真实结构，并强制 JSON 输出。
 *
 * 关键约束：
 *   · front 必须且只能有 1 处 **字** —— 出题时靠它组 keywordPools，
 *     阶段1「据句选意」的大字、阶段2「据义选句」的同字句池全靠它
 *   · back 只写"本句中该字的义项"，不写注释、出处、字头解释
 *     （线上脏数据 "==<div>葫芦提：糊涂<br></div>承担==" 就是这样来的，
 *       而且 back 会被当作选择题的正确答案/干扰项，污染整局）
 *   · plain 是整句白话翻译，供学习页第三栏
 */
const AI_SYSTEM_PROMPT = `你是一位资深文言文教研员，负责为高中语文学习者制作「一词多义」记忆卡片。

# 任务
从给定文档中提取适合间隔复习的文言实词/虚词卡片。只提取文档中**真实出现**的内容，禁止杜撰例句或释义。

# 输出格式（严格遵守）
只输出一个 JSON 数组，不要输出任何解释文字，不要用 markdown 代码围栏。

[
  {
    "front": "含有 **重点字** 标记的原句",
    "back": "该字在本句中的义项",
    "plain": "整句的白话翻译",
    "source": "出处，如《劝学》；不确定则留空字符串"
  }
]

# 字段规则
1. front（原句）
   - 必须是原文完整的一句（含标点），不要截断成短语
   - **必须且只能有 1 处** \`**\` 包裹重点字，例如：君子**生**非异也
   - 重点字只能是 1-2 个字，且必须是文档中真实出现、值得记忆的字
   - 不要给同一个字在一句话里标两处

2. back（义项）
   - 只写该字**在本句中**的义项，4-20 字最佳，绝不超过 40 字
   - 禁止夹带：注释编号、<div>/<br> 等 HTML、字头解释（不要写成「当：应当，应该」，直接写「应当，应该」）
   - 禁止把整句翻译写进 back，整句翻译属于 plain
   - 同一个字的不同义项要拆成多张卡（一词多义），这是被鼓励的

3. plain（白话文）
   - 把整句原句翻译成通顺现代汉语，不加引号、不重复原句

4. source（出处）
   - 原文有《篇名》就填，没有就填空字符串

# 数量
- 文档有多少值得记忆的字就做多少张，不要为了凑数硬造
- 宁可少而准，不要多而杂

# 无法制卡时
输出空数组：[]

现在开始，只输出 JSON 数组。`;

// ── 共用：解析上传文档 ───────────────────────────────────────────────
async function extractDocumentText(file: Express.Multer.File): Promise<string> {
  const mime = file.mimetype;
  const ext = ALLOWED_TYPES[mime];
  if (!ext) {
    const name = file.originalname.toLowerCase();
    const match = SUPPORTED_EXTENSIONS.find(e => name.endsWith(e));
    if (!match) {
      throw Object.assign(new Error('不支持的文件格式，仅支持 .txt、.pdf、.docx'), { status: 400 });
    }
  }

  const lower = file.originalname.toLowerCase();
  let text: string;
  if (mime === 'application/pdf' || ext === 'pdf' || lower.endsWith('.pdf')) {
    text = await parsePdf(file.buffer);
  } else if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx' || lower.endsWith('.docx')
  ) {
    text = await parseDocx(file.buffer);
  } else {
    text = await parseText(file.buffer);
  }

  text = text.trim();
  if (!text || text.length < 10) {
    throw Object.assign(new Error('文档内容为空或无法解析'), { status: 400 });
  }
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) + '\n\n[内容过长，已截断]';
  }
  return text;
}

// ── 共用：调用 DeepSeek 并解析成校验后的卡片 ──────────────────────────
async function aiExtractCards(text: string): Promise<{
  cards: ValidatedCard[];
  duplicateInBatch: number;
  legacyFormat: boolean;
  rawCount: number;
}> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('DEEPSEEK_API_KEY 未配置'), { status: 500 });
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
        { role: 'user', content: `请从以下文档内容中提取文言文记忆卡片：\n\n${text}` },
      ],
      temperature: 0.2,
      max_tokens: 8192,
      // 强制 JSON 输出，避免模型加解释性前后缀
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'Unknown error');
    throw Object.assign(new Error(`AI 服务调用失败: ${response.status} ${errText}`), { status: 502 });
  }

  const data: any = await response.json();
  const content: string = data.choices?.[0]?.message?.content || '';

  const parsed = parseAiOutput(content);
  const deduped = dedupeCards(parsed.cards);

  return {
    cards: deduped.cards,
    duplicateInBatch: deduped.duplicateInBatch,
    legacyFormat: parsed.legacyFormat,
    rawCount: parsed.rawCount,
  };
}

// ── 共用：拿到/创建目标笔记类型（3 字段：Front / Back / 白话文）─────────
function resolveNotetype(db: any, userId: number, notetypeName?: string): { id: number; name: string; created: boolean } {
  const targetName = (notetypeName && notetypeName.trim()) || DEFAULT_NOTETYPE_NAME;

  const nt = db.prepare('SELECT * FROM notetypes WHERE user_id = ? AND name = ?')
    .get(userId, targetName) as any;
  if (nt) {
    // 校验字段数：线上「古文翻译」是 3 字段；若是 2 字段的旧「AI导入」，补成 3 字段
    let fields: string[] = [];
    try { fields = JSON.parse(nt.field_names); } catch { fields = []; }
    if (!Array.isArray(fields) || fields.length < 3) {
      db.prepare('UPDATE notetypes SET field_names = ?, modified_at = unixepoch() WHERE id = ?')
        .run(JSON.stringify(FIELD_NAMES), nt.id);
    }
    return { id: nt.id, name: targetName, created: false };
  }

  const css = '.card { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 18px; line-height: 1.8; }';
  const templateQ = '{{Front}}';
  const templateA = '{{Front}}<hr id=answer>{{Back}}<br><span style="color:#888">{{白话文}}</span>';

  const result = db.prepare(`
    INSERT INTO notetypes (user_id, name, css, kind, field_names, template_q_format, template_a_format)
    VALUES (?, ?, ?, 'normal', ?, ?, ?)
  `).run(userId, targetName, css, JSON.stringify(FIELD_NAMES), templateQ, templateA);

  return { id: result.lastInsertRowid as number, name: targetName, created: true };
}

// ── 共用：查重（原句已存在于该用户所有卡中）───────────────────────────
function findExistingFronts(db: any, userId: number, fronts: string[]): Set<string> {
  const out = new Set<string>();
  if (fronts.length === 0) return out;

  // 精确命中：sort_field 在「古文翻译」里就是原句
  const plainSet = new Set(fronts.map(toPlain));
  const rows = db.prepare(`
    SELECT n.fields FROM notes n
    JOIN cards c ON c.note_id = n.id
    WHERE n.user_id = ?
    LIMIT 30000
  `).all(userId) as any[];

  for (const r of rows) {
    let fields: string[];
    try {
      fields = JSON.parse(r.fields);
      if (!Array.isArray(fields)) continue;
    } catch { continue; }
    const front = toPlain(fields[0] || '');
    if (front && plainSet.has(front)) out.add(front);
  }
  return out;
}

function summarize(cards: ValidatedCard[], duplicateInBatch: number, existing: Set<string>) {
  const rejected = cards.filter(c => c.status === 'rejected');
  const needsReview = cards.filter(c => c.status === 'needs-review');
  const dupInDb = cards.filter(
    c => c.status !== 'rejected' && existing.has(toPlain(c.front))
  );
  const ok = cards.filter(
    c => c.status === 'ok' && !existing.has(toPlain(c.front))
  );
  return {
    total: cards.length,
    ok: ok.length,
    needsReview: needsReview.length,
    rejected: rejected.length,
    duplicateInBatch,
    duplicateInLibrary: dupInDb.length,
    importable: ok.length + needsReview.length,
  };
}

// ══════════════════════════════════════════════════════════════════════
// POST /admin/ai-import/preview —— 只解析+校验，不写库（P1 三步向导第 2 步）
// ══════════════════════════════════════════════════════════════════════
router.post('/ai-import/preview', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: '未上传文件' });
      return;
    }
    // 【2026-10-12】统一落到牌组库所有者（见 lib/deckLibrary.ts）
    const userId = libraryOwnerId();

    const text = await extractDocumentText(req.file);
    const { cards, duplicateInBatch, legacyFormat, rawCount } = await aiExtractCards(text);

    if (cards.length === 0) {
      res.status(422).json({
        error: rawCount === 0
          ? 'AI 未能从文档中提取出有效卡片，请检查文档内容'
          : 'AI 返回格式异常，无法解析卡片数据',
      });
      return;
    }

    const db = getDb();
    const existing = findExistingFronts(db, userId, cards.map(c => c.front));

    const issues = cards.flatMap((c, idx) =>
      c.issues.map(i => ({ index: idx, level: i.level, code: i.code, message: i.message }))
    );

    res.json({
      success: true,
      legacyFormat,
      documentLength: text.length,
      stats: summarize(cards, duplicateInBatch, existing),
      issues,
      cards: cards.map(c => ({
        front: c.front,
        back: c.back,
        plain: c.plain,
        source: c.source,
        keyword: c.keyword,
        status: existing.has(toPlain(c.front)) ? 'duplicate' : c.status,
        issues: c.issues,
      })),
    });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'AI 解析失败' });
  }
});

// ══════════════════════════════════════════════════════════════════════
// POST /admin/ai-import/commit —— 把（可能被老师编辑过的）卡片入库
// ══════════════════════════════════════════════════════════════════════
router.post('/ai-import/commit', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { deckId, notetypeName, cards } = req.body;

    // 【2026-10-12】统一落到牌组库所有者，不再用前端传来的 adminId
    const userId = libraryOwnerId();
    if (!deckId) {
      res.status(400).json({ error: '请指定牌组' });
      return;
    }
    if (!Array.isArray(cards) || cards.length === 0) {
      res.status(400).json({ error: '没有可导入的卡片' });
      return;
    }
    if (cards.length > 500) {
      res.status(400).json({ error: `单次最多导入 500 张，当前 ${cards.length} 张` });
      return;
    }

    const deck = db.prepare('SELECT id, name FROM decks WHERE id = ? AND user_id = ?')
      .get(deckId, userId) as any;
    if (!deck) {
      res.status(404).json({ error: '牌组不存在或不属于该用户' });
      return;
    }

    // 二次校验：前端编辑后可能被改坏，后端必须再过一遍
    const { cards: validated, duplicateInBatch } = dedupeCards(cards.map((c: any) => {
      const r = require('./lib/aiCardSchema').validateCard(c);
      // 老师强制标为"忽略"的卡直接丢弃
      return c?.__skip ? { ...r, status: 'rejected' as const } : r;
    }));

    const importable = validated.filter(c => c.status !== 'rejected');
    if (importable.length === 0) {
      res.status(422).json({ error: '所有卡片都未通过校验，请检查重点字标记与释义长度' });
      return;
    }

    const existing = findExistingFronts(db, userId, importable.map(c => c.front));

    const nt = resolveNotetype(db, userId, notetypeName);
    const now = Math.floor(Date.now() / 1000);

    let created = 0, skippedDuplicate = 0, needsReview = 0;
    const rejectedDetail: { front: string; reasons: string[] }[] = validated
      .filter(c => c.status === 'rejected')
      .map(c => ({ front: c.front || '(空)', reasons: c.issues.filter(i => i.level === 'fatal').map(i => i.message) }));

    const batch = db.transaction(() => {
      for (const card of importable) {
        const plainFront = toPlain(card.front);
        if (existing.has(plainFront)) { skippedDuplicate++; continue; }

        const tags = card.status === 'needs-review' ? 'AI制卡 待复核' : 'AI制卡';
        // 与线上「古文翻译」字段顺序一致：Front / Back / 白话文
        // 白话文栏带出处时并入，避免多出第四个字段（学习页只读 0/1/2）
        const plainWithSource = card.source
          ? `${card.plain}${card.plain ? '　' : ''}——${card.source}`
          : card.plain;

        const fields = JSON.stringify([card.front, card.back, plainWithSource]);
        const noteResult = db.prepare(`
          INSERT INTO notes (user_id, guid, notetype_id, tags, fields, sort_field)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, uuidv4(), nt.id, tags, fields, card.front);
        const noteId = noteResult.lastInsertRowid;

        db.prepare(`
          INSERT INTO cards (user_id, note_id, deck_id, template_idx, queue, due, interval, ease_factor, reps, lapses, remaining_steps)
          VALUES (?, ?, ?, 0, 0, ?, 0, 2.5, 0, 0, 0)
        `).run(userId, noteId, deckId, now + created);

        existing.add(plainFront);
        created++;
        if (card.status === 'needs-review') needsReview++;
      }
    });
    batch();

    res.json({
      success: true,
      message: `AI 制卡完成：新增 ${created} 张${skippedDuplicate ? `，跳过重复 ${skippedDuplicate} 张` : ''}${needsReview ? `，其中 ${needsReview} 张待复核` : ''}`,
      stats: {
        created,
        skippedDuplicate,
        needsReview,
        duplicateInBatch,
        rejected: rejectedDetail.length,
        notetypeName: nt.name,
        notetypeCreated: nt.created,
      },
      rejected: rejectedDetail.slice(0, 50),
    });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'AI 制卡失败' });
  }
});

// ══════════════════════════════════════════════════════════════════════
// POST /admin/ai-import —— 兼容旧调用：解析 + 直接入库（一步到位）
// 新前端走 preview → commit 两步，本接口只做兜底，保留给外部脚本。
// ══════════════════════════════════════════════════════════════════════
router.post('/ai-import', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: '未上传文件' });
      return;
    }
    const { deckId, notetypeName } = req.body;
    // 【2026-10-12】统一落到牌组库所有者
    const userId = libraryOwnerId();
    if (!deckId) {
      res.status(400).json({ error: '请指定牌组' });
      return;
    }

    const db = getDb();
    const deck = db.prepare('SELECT id FROM decks WHERE id = ? AND user_id = ?').get(deckId, userId);
    if (!deck) {
      res.status(404).json({ error: '牌组不存在或不属于该用户' });
      return;
    }

    const text = await extractDocumentText(req.file);
    const { cards, duplicateInBatch, legacyFormat, rawCount } = await aiExtractCards(text);

    if (cards.length === 0) {
      res.status(422).json({
        error: rawCount === 0
          ? 'AI 未能从文档中提取出有效卡片，请检查文档内容'
          : 'AI 返回格式异常，无法解析卡片数据',
      });
      return;
    }

    const existing = findExistingFronts(db, userId, cards.map(c => c.front));
    const importable = cards.filter(c => c.status !== 'rejected');
    const nt = resolveNotetype(db, userId, notetypeName);
    const now = Math.floor(Date.now() / 1000);

    let created = 0, skippedDuplicate = 0;
    db.transaction(() => {
      for (const card of importable) {
        const plainFront = toPlain(card.front);
        if (existing.has(plainFront)) { skippedDuplicate++; continue; }
        const tags = card.status === 'needs-review' ? 'AI制卡 待复核' : 'AI制卡';
        const plainWithSource = card.source
          ? `${card.plain}${card.plain ? '　' : ''}——${card.source}`
          : card.plain;
        const fields = JSON.stringify([card.front, card.back, plainWithSource]);
        const noteResult = db.prepare(`
          INSERT INTO notes (user_id, guid, notetype_id, tags, fields, sort_field)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, uuidv4(), nt.id, tags, fields, card.front);
        db.prepare(`
          INSERT INTO cards (user_id, note_id, deck_id, template_idx, queue, due, interval, ease_factor, reps, lapses, remaining_steps)
          VALUES (?, ?, ?, 0, 0, ?, 0, 2.5, 0, 0, 0)
        `).run(userId, noteResult.lastInsertRowid, deckId, now + created);
        existing.add(plainFront);
        created++;
      }
    })();

    res.json({
      success: true,
      legacyFormat,
      message: `AI 制卡完成！新增 ${created} 张${skippedDuplicate ? `，跳过重复 ${skippedDuplicate} 张` : ''}`,
      stats: { ...summarize(cards, duplicateInBatch, existing), created, skippedDuplicate, documentLength: text.length },
    });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'AI 制卡失败' });
  }
});

export default router;
