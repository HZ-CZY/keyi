import { Router, Response } from 'express';
import { adminMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(adminMiddleware);

const DEEPSEEK_API = 'https://api.deepseek.com/v1/chat/completions';

const SYSTEM_PROMPT = `你是一个名为「刻忆助手」的AI学习平台管理员助手。你隶属于「刻忆」（Keyi）——一个间隔重复学习平台，提供AI智能制卡、古文翻译、卡片复习、练习题等功能。

你的回答规则：
1. 你友好、专业、乐于助人，使用中文回答
2. 你了解刻忆平台的所有功能，包括管理后台操作
3. 你的知识截止于当前日期
4. 回答应简洁明了，避免过长
5. 如果用户询问平台功能或使用方法，请给出具体操作指引
6. 如果涉及管理员操作（创建用户、发送牌组、管理卡片等），请给出安全建议`;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// POST /api/admin/ai-chat — Send a message to the AI assistant
router.post('/ai-chat', async (req: AuthRequest, res: Response) => {
  try {
    const { message, history } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: '消息不能为空' });
      return;
    }

    if (message.length > 2000) {
      res.status(400).json({ error: '消息过长，请控制在2000字以内' });
      return;
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'AI 服务未配置（缺少 API 密钥）' });
      return;
    }

    // Build messages array: system prompt + conversation history + new message
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];

    // Add conversation history (limit to last 20 messages to avoid token overflow)
    if (Array.isArray(history)) {
      const recentHistory = history.slice(-20);
      for (const msg of recentHistory) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({ role: msg.role, content: msg.content.slice(0, 2000) });
        }
      }
    }

    // Add current message
    messages.push({ role: 'user', content: message.trim() });

    const response = await fetch(DEEPSEEK_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0.7,
        max_tokens: 2048,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      console.error(`[AI Chat] DeepSeek API error: ${response.status} ${errText}`);
      res.status(502).json({ error: 'AI 服务暂时不可用，请稍后再试' });
      return;
    }

    const data: any = await response.json();
    const reply = data.choices?.[0]?.message?.content || '抱歉，我没有理解你的问题，请重新描述一下？';

    res.json({ reply });

  } catch (err: any) {
    console.error('[AI Chat] Error:', err.message);
    res.status(500).json({ error: 'AI 对话服务出错，请稍后再试' });
  }
});

export default router;
