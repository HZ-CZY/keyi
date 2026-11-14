import { Router, Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { execFile, spawn } from 'child_process';
import fs from 'fs';
import { getDb } from '../db/database';
import { AuthRequest, authMiddleware } from '../middleware/auth';

/**
 * AI 实验台 · 欧拉讲题版（v2）
 * ─────────────────────────────────────────────────────────
 * 只给陈子洋本人用（前端 OwnerOnlyRoute + 本路由 ownerOnly 双保险）。
 *
 * 后端定位：用 DeepTutor 里激活的那套模型（读它的 model_catalog.json），
 * 我们自己产出「结构化讲稿 + 会动的板书指令」，前端负责渲染成欧拉那种
 * 左侧动态图形、右侧逐步讲解的形态。
 *
 * 接口：
 *   GET  /api/tutor/ping     健康检查
 *   POST /api/tutor/ocr      图片 → LaTeX
 *   POST /api/tutor/explain  题目 → { title, think[], steps[], keyMethod, pitfall, answer }
 *
 * 板书指令（board）支持动画语义：
 *   axis / point / circle / line / vector / arc / note / path   —— 静态元素，入场自动播放
 *   orbit  —— 点绕圆周运动
 *   spin   —— 向量绕某点旋转
 *   move   —— 点移动到新位置
 * 前端按顺序播放，天然就是「动态板书」。
 */

const router = Router();
const OWNER = '陈子洋';
let lastBadRaw = '';

/* ── 模型配置：优先跟随 DeepTutor，读不到再回落到本机 agnes 池 ── */
const DT_CATALOG = '/var/lib/docker/volumes/deeptutor-data/_data/user/settings/model_catalog.json';

type ModelCfg = { base: string; key: string; talk: string; ocr: string };

/* 解题段优先用 pro（只为算得对），讲稿段按 TALK_MODELS 池自动降级 */
const SOLVE_MODEL = 'deepseek-v4-pro-0813';

const TALK_PINNED = true;
/* OCR 专用视觉模型：tokenhub 上实测可读图、输出标准 $...$ LaTeX。
   旧的 agnes-2.5-pro 在 tokenhub 上不存在（400004），拍照识别会直接 500。
   主模型失败时依次回落，避免整条拍照链路挂掉。 */
const OCR_MODELS = ['glm-5v-turbo', 'hy-vision-2.0-instruct'];

/* 讲稿模型池：单个模型的免费额度会突然耗尽（402/401008 "free trial quota
   exhausted"），一挂就是整条讲题链路停摆。按实测可用性与延迟排好队，
   命中额度错误就自动降一级，10 分钟后再试回主模型。
   实测都能稳定产出 JSON 讲稿：deepseek-v4-flash-202605≈4s、hy3≈3.8s、
   glm-5.3-flash≈8s；glm-5.2 / kimi-k3 实测超时或 400，不放入池。 */
const TALK_MODELS = [
  'deepseek/deepseek-flash',
  'deepseek-v4-flash-202605',
  'hy3',
  'glm-5.3-flash',
];
/* 解题段同样准备回落：pro 只是算得最稳，不是唯一能算的 */
const SOLVE_MODELS = [SOLVE_MODEL, 'deepseek-v4-flash-202605', 'hy3'];

let talkModelIdx = 0;
let talkModelRetryAt = 0;
function activeTalkModel(): string { return TALK_MODELS[talkModelIdx] || TALK_MODELS[0]; }
function isQuotaError(e: any): boolean {
  return /402|401008|quota|exhausted|billing|postpaid|额度/i.test(String(e?.message || e || ''));
}
function demoteTalkModel(): void {
  if (talkModelIdx < TALK_MODELS.length - 1) {
    talkModelIdx += 1;
    talkModelRetryAt = Date.now() + 10 * 60_000;
    console.warn('[tutor] 讲稿模型降级 -> ' + activeTalkModel());
  }
}

let cfgCache: { v: ModelCfg; at: number } | null = null;

function poolToken(name: string): string {
  try {
    const raw = JSON.parse(fs.readFileSync('/root/.hermes/auth.json', 'utf8'));
    const list: any[] = raw?.credential_pool?.[name] || [];
    return list.find((c: any) => c?.access_token && c.last_status !== 'error')?.access_token || list[0]?.access_token || '';
  } catch {
    return '';
  }
}

function agnesPoolToken(): string {
  try {
    const raw = JSON.parse(fs.readFileSync('/root/.hermes/auth.json', 'utf8'));
    const list: any[] = raw?.credential_pool?.['custom:agnes'] || [];
    const usable = list.filter((c) => c?.access_token && c?.last_status !== 'error');
    const pick = usable.find((c) => c.id === 'e09295') || usable[0] || list[0];
    return pick?.access_token || '';
  } catch {
    return '';
  }
}

/** 从 DeepTutor 的目录里取「当前激活的 LLM」 */
function loadModel(): ModelCfg {
  if (cfgCache && Date.now() - cfgCache.at < 60_000) return cfgCache.v;

  /* 讲题走腾讯 tokenhub 的 DeepSeek-V4-Pro：实测在圆上动点、三角函数最值、点到直线距离
     三类题上全对且平均 11s；agnes-2.5-pro 正确率相当但更慢，agnes-3.0-flash 会算错。 */
  /* talk 只写讲稿（要压格式），用 flash；pro 会把 token 全烧在 reasoning 上、正文为空。
     solve 用 pro：不压格式，纯推导，实测 correctness 最高。 */
  const fallback: ModelCfg = {
    base: 'https://tokenhub.tencentmaas.com/v1',
    key: poolToken('tencent-tokenhub'),
    talk: 'deepseek/deepseek-flash',
    ocr: OCR_MODELS[0],
  };

  /* 讲题链路已固定为上方的 tokenhub 配置；DeepTutor 的目录只用来补 OCR 的 base/key */
  if (TALK_PINNED) {
    cfgCache = { v: fallback, at: Date.now() };
    return fallback;
  }

  try {
    const cat = JSON.parse(fs.readFileSync(DT_CATALOG, 'utf8'));
    const llm = cat?.services?.llm;
    const pid = llm?.active_profile_id;
    const mid = llm?.active_model_id;
    const profile = (llm?.profiles || []).find((p: any) => p?.id === pid);
    const conn = (cat?.connections || []).find((c: any) => c?.id === profile?.connection_id);
    const model = (profile?.models || []).find((m: any) => m?.id === mid) || (profile?.models || [])[0];

    const base = String(conn?.base_url || profile?.base_url || '').replace(/\/+$/, '');
    const key = String(conn?.api_key || profile?.api_key || '').replace(/\*+$/, '');
    const talk = String(model?.model || model?.id || '');

    if (base && key && talk) {
      /* DeepTutor 里配的若是 flash 这类小模型，讲题强制升到 pro（只换模型名，不动 base/key） */
      const talkLlm = /agnes/i.test(base) && !/pro|reason/i.test(talk) ? 'agnes-2.5-pro' : talk;
      const cfg: ModelCfg = {
        base: base.endsWith('/v1') ? base : base + '/v1',
        key,
        talk: talkLlm,
        // 视觉转录用同一家的快模型，失败再退回配置里的 talk
        ocr: /agnes/i.test(base) ? 'agnes-2.5-pro' : talk,
      };
      cfgCache = { v: cfg, at: Date.now() };
      return cfg;
    }
  } catch {
    /* DeepTutor 没跑或目录还没生成，直接用回落值 */
  }

  cfgCache = { v: fallback, at: Date.now() };
  return fallback;
}

/* ── HTTP（走 curl：Node 直连 Cloudflare 会被拦成 403 HTML） ────── */
function postJson(url: string, body: unknown, timeoutMs: number): Promise<{ status: number; text: string }> {
  /* JSON.stringify 不转义 \f \b \u000c 这类字符，一路传到模型侧就变成乱码，先清干净 */
  const data = JSON.stringify(body).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, (c) =>
    '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
  );
  return new Promise((resolve, reject) => {
    execFile(
      'curl',
      [
        '-s',
        '--max-time', String(Math.max(5, Math.round(timeoutMs / 1000))),
        '-w', '\n__HTTP__%{http_code}',
        url,
        '-H', 'Content-Type: application/json',
        '-H', 'Authorization: Bearer ' + loadModel().key,
        '--data-binary', '@-',
      ],
      { maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        if (err) return reject(new Error('调用模型失败：' + err.message));
        const m = /\n__HTTP__(\d{3})$/.exec(stdout || '');
        resolve({
          status: m ? Number(m[1]) : 0,
          text: m ? stdout.slice(0, m.index) : String(stdout || ''),
        });
      }
    ).stdin?.end(data);
  });
}

/* ── 限流冷却 ─────────────────────────────────────────────── */
let rateLimitedUntil = 0;

async function callLLM(body: any, timeoutMs = 120_000): Promise<any> {
  const wait = rateLimitedUntil - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 60_000)));

  for (let attempt = 0; attempt < 3; attempt++) {
    const { status, text } = await postJson(loadModel().base + '/chat/completions', body, timeoutMs);

    if (status === 429 || (status >= 500 && status < 600)) {
      if (status === 429) rateLimitedUntil = Date.now() + 60_000;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, status === 429 ? 15_000 : 6_000));
        continue;
      }
      throw new Error(status === 429 ? '模型限流，请一分钟后再试' : '模型排队满，请稍后重试');
    }
    if (status !== 200) throw new Error(`模型返回 ${status}: ${text.slice(0, 160)}`);

    const j = JSON.parse(text);
    if (j.error) throw new Error(j.error.message || '模型报错');
    return j;
  }
  throw new Error('模型限流');
}

/* ── 图片预处理 ───────────────────────────────────────────── */
async function prepareImage(buf: Buffer): Promise<string> {
  const out = await sharp(buf)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return 'data:image/jpeg;base64,' + out.toString('base64');
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

/* ── 只允许陈子洋 ─────────────────────────────────────────── */
function ownerOnly(req: AuthRequest, res: Response, next: () => void): void {
  const uid = req.userId;
  if (!uid) {
    res.status(401).json({ error: '未登录' });
    return;
  }
  const row = getDb().prepare('SELECT username FROM users WHERE id = ?').get(uid) as
    | { username?: string }
    | undefined;
  if (row?.username !== OWNER) {
    res.status(403).json({ error: '该功能未开放' });
    return;
  }
  next();
}

/** 截断但保证不切断 $...$、{...}，否则前端渲染出半截 LaTeX */
function safeSlice(s: string, n: number): string {
  const str = String(s || '');
  if (str.length <= n) return str;
  let t = str.slice(0, n);
  if (((t.match(/\$/g) || []).length) % 2 === 1) {
    const i = t.lastIndexOf('$');
    if (i > 0) t = t.slice(0, i);
  }
  const open = (t.match(/\{/g) || []).length;
  const close = (t.match(/\}/g) || []).length;
  if (open > close) {
    const i = t.lastIndexOf('{');
    if (i > 0) t = t.slice(0, i);
  }
  if (/\\[a-zA-Z]*$/.test(t)) {
    const i = t.lastIndexOf('\\');
    if (i > 0) t = t.slice(0, i);
  }
  // 末尾还挂着没闭合的 \left( \big( 之类，直接砍掉
  const dangling = /\\(left|right|big|Big|bigg|Bigg)[lr]?\s*[([{]?\s*$/.exec(t);
  if (dangling && dangling.index > 0) t = t.slice(0, dangling.index);
  t = t.replace(/[\s（(，,、]+$/, '');
  return t.trim();
}

/* ── 只要题干：图片里常带解析，学生要的是「题目」本身 ────────── */
function extractQuestion(text: string): string {
  let t = String(text || '').replace(/\*\*/g, '').trim();
  if (!t) return '';

  // 遇到这些标记，后面的都是解析，不是题目
  const cut = /(先想一想|解题思路|思路点拨|思路分析|【解析】|【分析】|分析[:：]|解析[:：]|解答[:：]|解[:：]|关键方法|第一步)/;
  const m = cut.exec(t);
  if (m && m.index > 8) t = t.slice(0, m.index);

  // 去掉结尾零散的符号
  t = t.replace(/[\s\-—:：]+$/, '').trim();
  return t.length >= 8 ? t : String(text || '').replace(/\*\*/g, '').trim();
}

/* ── 识别完整性校验：OCR 丢项是「模型编答案」的根因 ──────────── */
function checkLatex(s: string): { ok: boolean; warns: string[] } {
  const warns: string[] = [];
  const t = s || '';
  if (t.trim().length < 8) warns.push('识别内容过短');

  const open = (t.match(/[（(\[]/g) || []).length;
  const close = (t.match(/[）)\]]/g) || []).length;
  if (open !== close) warns.push(`括号不配对（左 ${open} / 右 ${close}）`);

  if (/\\sqrt\s*(?=[\s,.;，。；]|$)/.test(t)) warns.push('根号后缺少内容');
  if (/[（(][a-zA-Z]\s*[-+]\s*[）)]/.test(t)) warns.push('有括号内缺项');
  if (!/[0-9]/.test(t) || !/[a-zA-Z\u4e00-\u9fa5]/.test(t)) warns.push('不像完整题目');

  return { ok: warns.length === 0, warns };
}

const OCR_PROMPT = `把这张图片里的数学题目完整转录出来。

要求：
1. 数学表达式用 LaTeX，行内 $...$，独立公式 $$...$$。
2. 根号写 \\sqrt{}，平方写 ^{2}，向量写 \\overrightarrow{AB}，点乘写 \\cdot。
3. 中文原样保留，不要改写、不要补全、不要解题。
4. 图中有解题步骤也按顺序转录。
5. 看不清写 [?]，不要猜。
6. 只输出转录结果，不要任何解释。`;

router.post('/ocr', authMiddleware, ownerOnly, upload.single('image'), async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as any).file;
    if (!file?.buffer) return res.status(400).json({ error: '没有收到图片' });

    const t0 = Date.now();
    const dataUrl = await prepareImage(file.buffer);
    const ocrBody = {
      max_tokens: 1200,
      temperature: 0.1,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    };
    let j: any = null;
    let usedModel = OCR_MODELS[0];
    let lastErr: any = null;
    for (const m of OCR_MODELS) {
      try {
        j = await callLLM({ ...ocrBody, model: m }, 90_000);
        usedModel = m;
        break;
      } catch (e: any) {
        lastErr = e;
      }
    }
    if (!j) throw lastErr || new Error('识别失败');

    const raw: string = j?.choices?.[0]?.message?.content || '';
    /* 部分模型会裹 <answer> 或代码围栏，先剥掉再交给 LaTeX 校验 */
    const latex = raw
      .replace(/^```[a-zA-Z]*\n?/, '')
      .replace(/\n?```$/, '')
      .replace(/<\/?answer>/gi, '')
      .trim();
    const chk = checkLatex(latex);

    res.json({
      latex,
      question: extractQuestion(latex),
      ok: chk.ok,
      warns: chk.warns,
      ms: Date.now() - t0,
      model: usedModel,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || '识别失败' });
  }
});

/* ── 讲稿 + 动态板书 ──────────────────────────────────────── */
const TALK_SYSTEM = `你是高中数学老师，正在给高二学生讲一道题。讲解会配一块「会动的板书」，学生看到的是左边图形逐步生长、右边文字逐条出现。

直接输出 JSON，第一个字符必须是 {，最后一个字符必须是 }。不要分析、不要标题、不要代码围栏。
不要在 JSON 之前做任何推理或复述题目；解法已经给好了，你只负责把它翻译成板书 JSON。
steps 至少 3 步、通常 4 步：把「设量/建系」「化归算式」「求最值/解方程」「回代与结论」拆开讲，每步一件事，别把两件事合成一步。

{
  "title": "题目一句话概括，≤16 字",
  "think": ["引导思考的第 1 个问题（不给答案）", "第 2 个问题"],
  "steps": [
    {
      "title": "这一步干什么，≤12 字",
      "text": "讲解，可含 $LaTeX$，150~260 字；关键算式必须单独一行写全",
      "board": [ 板书指令 ... ],
      "highlight": "这一步的要点，≤20 字，可以留空"
    }
  ],
  "keyMethod": "这类题的通法，≤45 字",
  "pitfall": { "wrong": "常见错解，≤30 字", "right": "正确做法，≤45 字" },
  "answer": "最终答案（只放结果，如 2\\\\sqrt{3}-2）"
}

board 指令（每个对象一条）：
{"op":"axis","xmin":-1,"xmax":4,"ymin":-1,"ymax":4}                      画坐标系
{"op":"point","name":"A","x":1,"y":1.73}                                 画点
{"op":"circle","cx":1,"cy":1.73,"r":1}                                   画圆
{"op":"line","from":[0,0],"to":[2,1],"label":"OC","dash":true}            画线段（dash 为虚线）
{"op":"vector","from":"O","to":"A","label":"OA"}                          画向量箭头
{"op":"vector","from":"C","to":"C+1@120","label":"CP","labelAt":[1.05,2.55]}  端点可写「点名±半径@角度」，角度逆时针
{"op":"arc","cx":1,"cy":1.73,"r":0.4,"from":0,"to":90,"label":"θ"}        画角弧
{"op":"note","text":"$|AP|=\\\\sqrt{5-2\\\\sqrt{3}}$","x":2.4,"y":0.6,"tone":"key"}  文字标注（tone: normal/key/warn）
{"op":"orbit","name":"P","cx":1,"cy":1.73,"r":1,"from":0,"to":360}        让点 P 绕圆转一圈
{"op":"spin","target":"CP","center":[1,1.73],"from":0,"to":-45}           让向量 CP 绕圆心转 45 度
{"op":"move","name":"P","to":[1.7,0.9]}                                  把点 P 移到新位置
{"op":"label","x":1.4,"y":2.1,"text":"C","tone":"normal"}                画板空白处写一个短标签（点名/刻度）
{"op":"polygon","points":["O","A","B"],"fill":"#2563d9"}                 把已画的点连成多边形（三角形/四边形），自动描边生长
{"op":"polygon","points":[[0,0],[2,0],[2,1]],"fill":"none"}              也可以直接给坐标
{"op":"func","expr":"x*x/2 - 1","xmin":-2,"xmax":3}                      画函数曲线（只支持 x 的四则运算与幂，用 x*x 别写 x^2）
{"op":"angle","at":"A","from":"A-0.6@0","to":"A-0.6@90","label":"90°"}   标角（直角就给 0 和 90，前端自动画方角）

动画规则（很重要，直接决定学生看到的效果）：
- 画圆用 circle（前端自动描线），画向量用 vector（箭头自动生长）。
- **只要题目里有圆上动点，至少给一次 orbit，让点转起来**，学生会立刻看懂「动」在哪里。
- **求最值的题，最后一步必须用 move 把动点挪到取最值的位置**，让答案看得见。
- **动点全程只用一个名字**（题面叫 P 就叫 P），不要中途换名，也不要在 orbit 之外再画一个同名的静态 point。
- 每一步只补「这一步新出现的」元素；前面画过的圆、向量、点不要重复给。
- **题目里点到名字的三角形 / 四边形，用 polygon 把顶点连起来**，别只画三条散的线。
- 求面积、证平行/垂直的题，angle 标出直角或夹角；导数、最值题有曲线就用 func 把 f(x) 画出来，再在图上 point 出极值点。
- 板书上的字母用 point 自带的 name 就行，只有「悬空的一个记号」（如圆心已有点但还想在别处写个字母）才用 label。
- 讲夹角、方向变化时用 arc 或 spin，别只写文字。
- 一个坐标系只画一次 axis，后面步骤不要再重复。
- 每一步只给「这一步新出现的」图形，不要重复上一步已有的元素。
- **凡是画了 line / vector 并在文字里提到它的，第一步就要先把两端点 point 出来**；不许引用没画过的点。
- 圆上动点题第一步就把 axis + 圆心 point + circle + 定点 point 一次性给齐，别拖到后面。
- 只要画了 orbit，同一步之内给一条 vector（from 圆心 to 动点名），这才看得出「向量的方向在变」。
- 纯文字的代数题（不等式、数列、导数）board 给 []，不要为了有图硬塞 note。
- 纯代数题（解方程、化简、数列）board 给空数组 []，不要硬画坐标系。
- 坐标数值用小数两位即可；数值要和文字里说的对得上。**点的 x、y 绝不能写反**（$A(\sqrt{3},1)$ 是 x=1.73、y=1）。
- 圆心、定点这些已知量的坐标直接从题面读，不要自己重算。

- 一律先算精确值（保留根号），**不要过早取近似**；文字里非要写近似值时保留两位小数并标「≈」。

算数规则（违反会讲错题）：
- 含根号的完全平方：$(a-\sqrt{b})^2=a^2-2a\sqrt{b}+b$，最后一项是 b 不是 b^2。
- 每一步写出代入数字后的算式，不要跳步；**先写原始式，再写代入，再写结果**。
- 向量数量积用坐标算：$\vec{CP}\cdot\vec{OA}=x_1x_2+y_1y_2$，先分别写出两个向量的坐标。
- 三角函数最值：$a\sin\theta+b\cos\theta$ 的最大值是 $\sqrt{a^2+b^2}$，最小值是 $-\sqrt{a^2+b^2}$，别漏负号、别把 a²+b² 开错。
- 定值判断：若某个量的长度不是定值，不许把它当常数提出来。
- answer 只放最终结果，用**精确形式**（含根号/分数），不要近似值、不要连等式、不要把中间量当答案。
- 前后必须一致：answer 必须与最后一步的结论完全相同；不要写「此处修正」「更正」这类自我推翻的话。
- 每一步的结论必须能被下一步直接使用，不许出现「前面算错了」的中间态。

版面自检（板书内容本身也要对）：
- note / label 里写的等式必须与文字讲解一致，且数值正确（$|OA|=2$ 就不能写 $\sqrt2$）。
- 点坐标的 x、y 先从题面抄准，再画。`;

/* 第一段：不带任何格式约束，让模型先把题想清楚并自我验算。
   之前一步到位出 JSON，模型会为了凑格式牺牲正确性——根号题上必错。 */
const DERIVE_SYSTEM = `你是高中数学解题高手。现在不做讲解、不出 JSON，只把这道题彻底解对。

要求：
1. 先读懂题，明确每个已知量的精确值（含根号就保留根号，不要取近似）。
2. 写出完整推导，每一步都要有算式，不许跳步。
3. 关键中间量单独列出来核对一遍，例如两个向量的坐标、模长、数量积展开式。
4. 算完做一次反向验算：把答案代回原式或极值条件，确认成立。
5. 最后一行固定写成：FINAL: <最终答案，精确形式，只写结果>

限制（很重要）：整个推导正文控制在 500 字以内，只保留必要算式和结论，不要展开讲解、不要画表格、不要重复检验过程。
不要写教学话术，不要写「同学们」，就是纯推导。`;

/** 从文本里抓所有可能的表达式片段 */
function exprFragments(txt: string): string[] {
  const out: string[] = [];
  const n = txt.length;
  const ok = (c: string) =>
    (c >= '0' && c <= '9') || c === '.' || c === '+' || c === '-' || c === '*' || c === '/' ||
    c === '(' || c === ')' || c === ' ' || c === '\\';
  let i = 0;
  while (i < n) {
    const c = txt[i];
    const startable =
      (c >= '0' && c <= '9') || c === '.' || c === '(' || c === '\\' ||
      ((c === '-' || c === '+') && i + 1 < n && ((txt[i + 1] >= '0' && txt[i + 1] <= '9') || txt[i + 1] === '('));
    if (!startable) { i++; continue; }
    let j = i;
    while (j < n && ok(txt[j])) j++;
    const frag = txt.slice(i, j).trim();
    if (/\d/.test(frag)) out.push(frag);
    i = Math.max(j, i + 1);
  }
  return out;
}

/** LaTeX 表达式求值（支持 \sqrt \frac \pi 与四则运算） */
function evalLatexNum(expr: string): number | null {
  let e = String(expr || '').replace(/\\left|\\right/g, '').trim().replace(/^[=＝]\s*/, '');
  for (let guard = 0; guard < 8 && e.includes('\\sqrt'); guard++) {
    e = e.replace(/\\sqrt\s*\{([^{}]*)\}/g, (_m, inner: string) => {
      const v = evalLatexNum(inner);
      return v === null ? 'NaN' : '(' + String(Math.sqrt(Math.abs(v))) + ')';
    });
  }
  e = e.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_m, a: string, b: string) => {
    const va = evalLatexNum(a);
    const vb = evalLatexNum(b);
    return va === null || vb === null ? 'NaN' : '(' + String(va / vb) + ')';
  });
  e = e.replace(/\\cdot|\\times/g, '*').replace(/\\pi/g, String(Math.PI));
  e = e.replace(/[{}]/g, '');
  for (let k = 0; k < 4; k++) {
    e = e.replace(/(\d)\s*\(/g, '$1*(').replace(/\)\s*(\d)/g, ')*$1').replace(/\)\s*\(/g, ')*(');
  }
  if (!/^[0-9+\-*/().\s]+$/.test(e)) return null;
  try {
    const v = Function('"use strict";return (' + e + ')')();
    return typeof v === 'number' && isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** 板书文字规范化：√ ² · 之类换成 LaTeX，前端 KaTeX 才认 */
function fixNoteText(t: string): string {
  return String(t || '')
    .replace(/√\s*\{?([0-9A-Za-z.]+)\}?/g, '\\sqrt{$1}')
    .replace(/√/g, '\\sqrt{}')
    .replace(/²/g, '^{2}')
    .replace(/³/g, '^{3}')
    .replace(/·/g, '\\cdot ')
    .replace(/×/g, '\\times ')
    .replace(/≈/g, '\\approx ')
    .replace(/π/g, '\\pi ')
    .replace(/θ/g, '\\theta ')
    .replace(/（/g, '(')
    .replace(/）/g, ')');
}

/** 校验：answer 与最后一步是否数值一致 */
function answerMismatch(answer: string, lastText: string): string {
  const head = String(answer || '').split('=').pop() || '';
  const a = evalLatexNum(head);
  if (a === null) return '';

  const frags = exprFragments(String(lastText || ''));
  const vals = frags.map((f) => evalLatexNum(f)).filter((v): v is number => v !== null);
  if (!vals.length) return '';
  if (vals.some((v) => Math.abs(v - a) < 1e-6)) return '';

  return `【结果不一致】你给的 answer 是 ${head.trim()}，但最后一步算出的是另一个数。请统一，answer 只放最终值。`;
}

/** JSON 兜底修复：去尾逗号、补全未闭合括号 */
/** 把模型常见的「伪 JSON」清理成可解析文本 */
function cleanJsonText(raw: string): string {
  let t = String(raw || '');
  t = t.replace(/^\s*```[a-zA-Z]*\s*/g, '').replace(/```\s*$/g, '');
  t = t.replace(/^[\s\S]*?(?=\{)/, ''); // 砍掉第一个 { 之前的所有内容
  // 去掉 // 与 /* */ 注释（不动字符串里的）
  t = t.replace(/\/\*[\s\S]*?\*\//g, '');
  t = t.replace(/(^|[^:"\\])\/\/[^\n]*/g, '$1');
  // 中文引号 → 英文（只在疑似结构位置）
  t = t.replace(/[\u201c\u201d]/g, '"');
  // 未转义的控制字符
  t = t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  return t;
}

function repairJson(raw0: string): any {
  const raw = cleanJsonText(raw0);
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  let t = a >= 0 && b > a ? raw.slice(a, b + 1) : raw;

  const tryParse = (x: string): any => {
    try { return JSON.parse(x); } catch { return null; }
  };

  let v = tryParse(t);
  if (v) return v;

  t = t.replace(/,\s*([}\]])/g, '$1');
  v = tryParse(t);
  if (v) return v;

  for (let cut = 0; cut < 400 && cut < t.length; cut++) {
    let head = t.slice(0, t.length - 1 - cut);
    const q = (head.match(/"/g) || []).length;
    if (q % 2 === 1) head = head.slice(0, head.lastIndexOf('"'));
    head = head.replace(/[,:\s]+$/, '');
    const openB = (head.match(/\{/g) || []).length - (head.match(/\}/g) || []).length;
    const openA = (head.match(/\[/g) || []).length - (head.match(/\]/g) || []).length;
    v = tryParse(head + ']'.repeat(Math.max(0, openA)) + '}'.repeat(Math.max(0, openB)));
    if (v && Array.isArray(v.steps) && v.steps.length) return v;
  }

  /* 最后一招：逐个对象抠出来重组 —— 只保留能单独解析的 step */
  const grabSteps: any[] = [];
  const stepRe = /\{\s*"title"\s*:[\s\S]*?"board"\s*:\s*\[[\s\S]*?\]/g;
  for (const m of t.matchAll(stepRe)) {
    const o = tryParse(m[0].replace(/,\s*([}\]])/g, '$1') + '}');
    if (o && typeof o === 'object') grabSteps.push(o);
  }
  if (grabSteps.length) {
    const title = (t.match(/"title"\s*:\s*"([^"]{2,40})"/) || [])[1] || '这道题这样想';
    const ans = (t.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)"/) || [])[1] || '';
    return { title, think: [], steps: grabSteps, keyMethod: '', pitfall: {}, answer: ans };
  }
  return null;
}

/** 板书指令白名单 + 规范化 */
const BOARD_OPS = new Set([
  'axis', 'point', 'circle', 'line', 'vector', 'arc', 'note', 'path', 'orbit', 'spin', 'move',
  'label', 'polygon', 'func', 'angle',
]);

/** 板书上的标签只放短符号：$\overrightarrow{OA}$ → OA，$	heta$ → θ */
function cleanLabel(v: any): string {
  const t = String(v ?? '').trim();
  if (!t || t.length > 14) return '';
  const v1 = t.replace(/^\$|\$/g, '').replace(/\\[lr]?vec\s*\{?([A-Za-z])\}?/g, '$1');
  const m = v1.match(/^\\?overrightarrow\s*\{\s*([A-Za-z]{1,3})\s*\}$/);
  if (m) return m[1];
  const m2 = v1.match(/^\\?overline\s*\{\s*([A-Za-z]{1,3})\s*\}$/);
  if (m2) return m2[1];
  if (/^[A-Za-z0-9$_^{}\\+\-\s]{1,10}$/.test(v1) && v1.includes('\\')) {
    // 其它 LaTeX 命令（\theta 等）转成常见符号，转不了就丢掉
    const map: Record<string, string> = {
      '\\theta': 'θ', '\\alpha': 'α', '\\beta': 'β', '\\pi': 'π', '\\varphi': 'φ',
    };
    const key = v1.replace(/^\$|\$/g, '').trim();
    return map[key] || '';
  }
  return v1;
}

/**
 * 图形区的 note 只放短标注（点名/刻度/一句关键式），长推导一律留在右侧文字栏。
 * 之前模型会把完整等式塞进 note，图上一叠就糊成一片。
 */
function trimNotes(list: any[]): any[] {
  return (list || []).map((o: any) => {
    if (!o || (o.op !== 'note' && o.op !== 'label')) return o;
    const t = String(o.text || '');
    /* 图形区只放短标注：纯公式不超过 16 字符、纯文字不超过 12 字符，其余一律删掉，
       长推导留在右侧文字栏（图形区渲染长式会互相压叠、且会露出 LaTeX 源码）。 */
    const hasMath = /[\\^_{}$]/.test(t);
    const limit = hasMath ? 16 : 12;
    if (t.length > limit) return null;
    return { ...o, text: t };
  }).filter(Boolean);
}

function normalizeBoard(list: any): any[] {
  if (!Array.isArray(list)) return [];
  const out: any[] = [];
  for (const op of list.slice(0, 14)) {
    if (!op || typeof op !== 'object' || !BOARD_OPS.has(op.op)) continue;
    const o: any = { ...op };
    if (o.op === 'note') o.text = tidyMath(fixNoteText(o.text));
    if (o.label) {
      const lb = cleanLabel(o.label);
      if (lb) o.label = lb; else delete o.label;
    }
    // 坐标容错：字符串转数字
    for (const k of ['x', 'y', 'cx', 'cy', 'r', 'xmin', 'xmax', 'ymin', 'ymax', 'from', 'to']) {
      if (typeof o[k] === 'string' && k !== 'from' && k !== 'to') {
        const n = Number(o[k]);
        if (Number.isFinite(n)) o[k] = n;
      }
    }
    if (Array.isArray(o.from)) o.from = o.from.map((x: any) => Number(x) || 0);
    if (Array.isArray(o.to)) o.to = o.to.map((x: any) => Number(x) || 0);
    if (Array.isArray(o.center)) o.center = o.center.map((x: any) => Number(x) || 0);
    out.push(o);
  }
  return out;
}

function guessAnswer(parsed: any): string {
  const direct = String(parsed?.answer ?? '').trim();
  if (direct) return direct;
  const steps = Array.isArray(parsed?.steps) ? parsed.steps : [];
  const last = steps[steps.length - 1] || {};
  const notes = (Array.isArray(last.board) ? last.board : [])
    .filter((o: any) => o?.op === 'note' && o?.text)
    .map((o: any) => String(o.text).replace(/\$/g, '').trim())
    .filter(Boolean);
  if (notes.length) return notes.join('；');
  const txt = String(last.text || last.highlight || '');
  const dollars = [...txt.matchAll(/\$([^$]{1,80})\$/g)];
  if (dollars.length) {
    const hit = dollars.find((m) => /为|是|等于|得/.test(txt.slice(Math.max(0, (m.index || 0) - 6), m.index)));
    return String((hit || dollars[dollars.length - 1])[1]).trim();
  }
  return '';
}

/**
 * 模型经常把 LaTeX 双写成 "\\frac"（JSON 里本就是转义），到了前端就渲染成源码。
 * 统一把多余的重复反斜杠收成一个。
 */
function tidyMath(v: any): string {
  return String(v ?? '')
    .replace(/\\\\/g, '\\')
    .replace(/\$\$/g, '$')
    .trim();
}

type StageFn = (s: { key: string; label: string; completed: boolean }) => void;

/**
 * 讲稿调用：软超时 45s。超时或格式崩了，就用更小的预算、不带 response_format 重来一次，
 * 再不行就抛出 —— 让学生最多等 90s，而不是干等到 150s 还失败。
 */
async function callTalk(msgs: any[]): Promise<string> {
  /* 主模型冷却到期后试着升回去，别永久停在备用模型上 */
  if (talkModelRetryAt && Date.now() > talkModelRetryAt) { talkModelIdx = 0; talkModelRetryAt = 0; }
  const variants = [
    { max_tokens: 7000, rf: true, timeout: 45_000, temperature: 0.2 },
    { max_tokens: 5000, rf: false, timeout: 60_000, temperature: 0.1 },
  ];
  let last = '';
  /* 外层按模型池走：某个模型额度耗尽（402）就降级换下一个，而不是让
     整条讲题链路报「模型返回 402」停摆。 */
  for (let guard = 0; guard < TALK_MODELS.length; guard++) {
    const model = activeTalkModel();
    let quotaHit = false;
    for (const v of variants) {
      const body: any = {
        model,
        max_tokens: v.max_tokens,
        temperature: v.temperature,
        messages: msgs,
      };
      if (v.rf) body.response_format = { type: 'json_object' };
      let r: any;
      try {
        r = await Promise.race([
          callLLM(body, v.timeout + 5_000),
          new Promise<null>((res) => setTimeout(() => res(null), v.timeout)),
        ]);
      } catch (e: any) {
        last = String(e?.message || e);
        if (isQuotaError(e)) { quotaHit = true; break; }
        continue;
      }
      if (!r) { last = 'timeout'; continue; }
      const txt = String(r?.choices?.[0]?.message?.content || '');
      if (txt.trim()) {
        last = txt;
        if (repairJson(txt)) return txt;
      }
    }
    if (!quotaHit) break;                 // 非额度问题（格式/超时），别乱换模型
    if (talkModelIdx >= TALK_MODELS.length - 1) break;
    demoteTalkModel();
  }
  return last;
}

/**
 * 讲稿生成核心 —— /explain 与 /explain-stream 共用。
 * onStage 只在真实节点触发（请求发出、模型返回、重试、校验、板书成形），
 * 不掺任何定时伪造的进度；Web 宿主据此驱动欧拉内核的准备清单。
 */
async function buildPlan(question: string, grade: string, onStage?: StageFn): Promise<any> {
  const stage = (key: string, label: string, completed = false) => {
    try { onStage?.({ key, label, completed }); } catch { /* 客户端断开不影响生成 */ }
  };
  lastBadRaw = '';
  stage('reading', '题意已梳理', true);
  stage('thinking', '我在梳理解题思路', false);
  const t0 = Date.now();
    /* ── 第一段：先算对（不约束格式） ── */
    let solution = '';
    let finalAnswer = '';
    try {
      let dr: any = null;
      let solveErr: any = null;
      for (const sm of SOLVE_MODELS) {
        try {
          dr = await callLLM(
            {
              model: sm,
              max_tokens: 4200,
              temperature: 0.15,
              messages: [
                { role: 'system', content: DERIVE_SYSTEM },
                { role: 'user', content: `学生年级：${grade}\n题目：\n${question}` },
              ],
            },
            180_000
          );
          break;
        } catch (e: any) { solveErr = e; }
      }
      if (!dr) throw solveErr || new Error('解题模型均不可用');
      solution = String(dr?.choices?.[0]?.message?.content || '').trim();
      const m = solution.match(/FINAL\s*[:：]\s*(.+)/);
      if (m) finalAnswer = m[1].trim().replace(/[。.;；]+$/, '');
      stage('thinking', '解题思路已梳理', true);
    } catch {
      /* 第一段失败不致命，第二段退回单段模式 */
      solution = '';
    }

    const solvedHint = solution
      ? `\n\n【已经验算过的完整解法（务必沿用其中的数值与结论，不要重新算）】\n${solution.slice(-6000)}` +
        (finalAnswer ? `\n【已确定的最终答案】${finalAnswer}` : '')
      : '';

    const baseMsgs = [
      { role: 'system', content: TALK_SYSTEM },
      { role: 'user', content: `学生年级：${grade}\n题目：\n${question}${solvedHint}` },
    ];

    stage('writing', '正在组织讲解', false);
    let rawTalk = await callTalk(baseMsgs);
    let parsed = repairJson(rawTalk);

    /* 还是没解析出来，带「上次格式坏了」的提示再要一次（只一次，避免学生干等） */
    if (!parsed) {
      stage('writing', '格式不合规，正在重写', false);
      lastBadRaw = rawTalk.slice(0, 6000);
      rawTalk = await callTalk([
        ...baseMsgs,
        {
          role: 'user',
          content: '上次只输出 JSON 对象本身：第一个字符 {，最后一个字符 }，不要代码围栏、不要注释、不要任何解释文字。',
        },
      ]);
      parsed = repairJson(rawTalk);
    }
    stage('writing', '讲解已写好', true);
    let retried = false;

    const check = (p: any): string => {
      if (!p) return '';
      const last = p?.steps?.[p.steps.length - 1] || {};
      const lastText = String(last.text || '');
      const lastAll = (p?.steps || []).map((x: any) => String(x?.text || '')).join(' ');
      /* 1) 自我推翻的措辞，说明推导过程里出现过算错再改 */
      if (/此处修正|更正|前面算错|重新计算|应为|实际上应该是|搞错/.test(lastAll)) {
        return '【过程有自我修正】上次讲解中途改了结论。请从头重新推导，一次算对，不要出现「修正/更正/应为」这类话。';
      }
      /* 2) 最后一步必须能推出 answer */
      const mis = answerMismatch(guessAnswer(p), lastText);
      if (mis) return mis;
      /* 3) answer 必须等于第一段已验算出的最终值 */
      if (finalAnswer) {
        const a1 = evalLatexNum(String(guessAnswer(p)).split('=').pop() || '');
        const a2 = evalLatexNum(finalAnswer.split('=').pop() || '');
        if (a1 !== null && a2 !== null && Math.abs(a1 - a2) > 1e-6) {
          return `【答案与验算不符】你在讲解里给的答案是 ${guessAnswer(p)}，但前面完整推导算出的是 ${finalAnswer}。请以 ${finalAnswer} 为准重新组织讲解步骤，并让最后一步的算式自然推出这个结果。`;
        }
      }
      return '';
    };

    const firstIssue = check(parsed);
    if (firstIssue) {
      stage('writing', '正在复核答案一致性', false);
      retried = true;
      const raw2 = await callTalk([
        ...baseMsgs,
        { role: 'assistant', content: rawTalk.slice(0, 5000) },
        { role: 'user', content: firstIssue + ' 请重新完整输出一遍 JSON。' },
      ]);
      const p2 = repairJson(raw2);
      if (p2) {
        parsed = p2;
        rawTalk = raw2;
      }
    }

    if (!parsed) {
      const raw0 = rawTalk || lastBadRaw;
      try {
        fs.writeFileSync('/tmp/tutor-bad-json.txt', `== ${new Date().toISOString()}\n${raw0}\n`);
      } catch {}
      throw Object.assign(
        new Error('模型这次没按格式输出，已自动重试一次仍失败，请再点一次「开始讲解」'),
        { status: 502, raw: raw0.slice(0, 300) },
      );
    }

    stage('board', '正在准备板书', false);

    /* 兜底 0：文字里点名的关键点，板书里没画就补上（模型最容易漏 O / 圆心 / 定点） */
    (() => {
      const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
      if (!steps.length) return;
      const drawn = new Set<string>();
      let circle: any = null;
      for (const st of steps) {
        for (const o of st?.board || []) {
          if (o?.op === 'point' && o.name) drawn.add(String(o.name));
          if (!circle && o?.op === 'circle') circle = o;
        }
      }
      /* 圆心：圆有，但 C 没画 */
      if (circle && !drawn.has('C') && /\bC\b|圆心\s*C|圆心是\s*C/.test(question)) {
        const st0 = steps[0];
        st0.board = [{ op: 'point', name: 'C', x: Number(circle.cx), y: Number(circle.cy) }, ...(st0.board || [])];
        drawn.add('C');
      }
      /* 原点 O */
      if (!drawn.has('O') && /坐标原点|原点\s*O|\bO\s*是\s*坐标/.test(question)) {
        const st0 = steps[0];
        st0.board = [{ op: 'point', name: 'O', x: 0, y: 0 }, ...(st0.board || [])];
        drawn.add('O');
      }
      /* 定点 A(b,c)：从题面直接读坐标，A(x,y) */
      const mA = question.match(/A\s*[(（]\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*[)）]/);
      if (mA && !drawn.has('A')) {
        const st0 = steps[0];
        st0.board = [
          ...(st0.board || []),
          { op: 'point', name: 'A', x: Number(mA[1]), y: Number(mA[2]) },
        ];
        drawn.add('A');
      }
    })();

    /* 兜底 A：图形引用了没画过的点，自动补 point，否则前端解析不到端点就整条不画 */
    (() => {
      const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
      const pts: Record<string, [number, number]> = {};
      for (const st of steps) {
        for (const o of st?.board || []) {
          if (o?.op === 'point' && o.name) pts[String(o.name)] = [Number(o.x) || 0, Number(o.y) || 0];
        }
      }
      const circle = (() => {
        for (const st of steps) for (const o of st?.board || []) {
          if (o?.op === 'circle' && Number(o.r) > 0) return o;
        }
        return null;
      })();
      const anchor = (name: string): [number, number] | null =>
        pts[name] || (circle && (name === 'C' || name === 'O') && name === 'C'
          ? [Number(circle.cx) || 0, Number(circle.cy) || 0]
          : null);
      let guard = 0;
      for (const st of steps) {
        const added: any[] = [];
        for (const o of st?.board || []) {
          if (!['line', 'vector'].includes(o?.op) || guard > 6) continue;
          for (const end of [o.from, o.to]) {
            if (typeof end !== 'string' || !end) continue;
            if (pts[end] || end.includes('@') || end.includes('+') || end.includes('-')) continue;
            const c = anchor(end);
            if (!c || pts[end]) continue;
            pts[end] = c;
            added.push({ op: 'point', name: end, x: c[0], y: c[1] });
            guard++;
          }
        }
        if (added.length) st.board = [...added, ...(st.board || [])];
      }
    })();

    /* 兜底：圆上动点题模型忘了给 orbit，就补一个，保证图形一定动起来 */
    (() => {
      const all = (Array.isArray(parsed.steps) ? parsed.steps : []).flatMap((s: any) => s?.board || []);
      const hasOrbit = all.some((o: any) => o?.op === 'orbit');
      const circle = all.find((o: any) => o?.op === 'circle' && Number(o.r) > 0);
      if (hasOrbit || !circle) return;
      if (!/圆/.test(question)) return;
      const lastIdx = (parsed.steps?.length || 1) - 1;
      const lastStep = parsed.steps?.[lastIdx];
      if (!lastStep) return;
      lastStep.board = Array.isArray(lastStep.board) ? lastStep.board : [];
      lastStep.board.push({
        op: 'orbit',
        name: 'P',
        cx: Number(circle.cx) || 0,
        cy: Number(circle.cy) || 0,
        r: Number(circle.r) || 1,
        from: 0,
        to: 360,
      });
    })();

    const steps = (Array.isArray(parsed.steps) ? parsed.steps : []).slice(0, 6).map((s: any, i: number) => ({
      index: i + 1,
      title: safeSlice(String(s?.title || `第 ${i + 1} 步`), 30),
      text: safeSlice(String(s?.text || ''), 700),
      highlight: safeSlice(String(s?.highlight || ''), 40),
      board: trimNotes(normalizeBoard(s?.board)),
    }));

    return {
      title: safeSlice(String(parsed.title || ''), 40),
      think: (Array.isArray(parsed.think) ? parsed.think : []).slice(0, 3).map((x: any) => String(x).slice(0, 60)),
      steps,
      keyMethod: safeSlice(String(parsed.keyMethod || ''), 120),
      pitfall: {
        wrong: safeSlice(String(parsed?.pitfall?.wrong || ''), 80),
        right: safeSlice(String(parsed?.pitfall?.right || ''), 140),
      },
      answer: tidyMath(safeSlice(guessAnswer(parsed), 120)),
      ms: Date.now() - t0,
      model: activeTalkModel(),
      retried,
      issue: check(parsed) ? '模型两次结果不一致，建议人工复核' : '',
    };
}

/* 传统一次性接口：老调用方保持不变 */
router.post('/explain', authMiddleware, ownerOnly, async (req: AuthRequest, res: Response) => {
  const question = String(req.body?.question || '').trim();
  const grade = String(req.body?.grade || '高二').trim();
  if (!question) return res.status(400).json({ error: '题目为空' });
  if (question.length > 2000) return res.status(400).json({ error: '题目太长' });
  try {
    res.json(await buildPlan(question, grade));
  } catch (e: any) {
    res.status(Number((e as any)?.status) || 500).json({
      error: e?.message || '讲解失败',
      raw: (e as any)?.raw,
    });
  }
});

/**
 * 流式讲题：按真实生成节点推 stage，最后推完整讲稿。
 * Web 宿主把 stage 交给 api.setOpeningPreparationProgress —— 欧拉 APK 里
 * 是由原生宿主推送 preparation 命令，这里换成后端 SSE，没有前端假计时。
 */
router.post('/explain-stream', authMiddleware, ownerOnly, async (req: AuthRequest, res: Response) => {
  const question = String(req.body?.question || '').trim();
  const grade = String(req.body?.grade || '高二').trim();
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  (res as any).flushHeaders?.();

  const send = (event: string, data: any) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  let closed = false;
  req.on('close', () => { closed = true; });
  const hb = setInterval(() => {
    if (!res.writableEnded) res.write(': keepalive\n\n');
  }, 15000);

  send('stage', { key: 'received', label: '题目已收到', completed: true });
  if (!question || question.length > 2000) {
    send('error', { message: question ? '题目太长' : '题目为空' });
    clearInterval(hb);
    res.end();
    return;
  }
  try {
    const plan = await buildPlan(question, grade, (s) => { if (!closed) send('stage', s); });
    send('plan', plan);
    send('done', { ms: plan?.ms });
  } catch (e: any) {
    send('error', { message: e?.message || '讲解失败' });
  } finally {
    clearInterval(hb);
    if (!res.writableEnded) res.end();
  }
});

router.get('/ping', authMiddleware, ownerOnly, (_req: AuthRequest, res: Response) => {
  const cfg = loadModel();
  const cool = Math.max(0, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
  res.json({
    ok: !!cfg.key,
    owner: OWNER,
    source: fs.existsSync(DT_CATALOG) ? 'DeepTutor' : 'agnes-pool',
    models: { ocr: OCR_MODELS[0], talk: cfg.talk },
    base: cfg.base,
    cooldownSec: cool,
  });
});

/* ── 语音合成：/api/tutor/tts ──────────────────────────────────────
   学生端（iPad Safari）用原生 speechSynthesis 有两个坑：
     · 音色机械，讲数学像念课文；
     · 合成是否可用不可控（iPad 上可用，但桌面 Chrome/部分安卓直接
       synthesis-failed），一旦失败就没法当动画时钟。
   所以语音放服务端：edge-tts（微软神经网络音色）原生返回**字级**边界，
   前端 audio.currentTime 就是天然时钟 —— 语音念到哪个字，板书就写到哪。

   返回：SSE，首帧 meta（音色/语速/边界表），随后若干 audio 帧（base64 mp3），
   末帧 end。前端边收边拼成 Blob 播放，无需落盘。 */

const TTS_VOICE = 'zh-CN-XiaoxiaoNeural';
const TTS_RATE = '+10%';        // 讲题略快一点，学生跟得上又不拖沓
let ttsProbe: { ok: boolean; at: number } | null = null;

function pyBin(): string {
  for (const p of ['/usr/bin/python3', '/usr/local/bin/python3']) {
    try { if (fs.existsSync(p)) return p; } catch { /* 继续找 */ }
  }
  return 'python3';
}

/* 只在首次请求时确认 python 侧 edge-tts 能跑，失败后 10 分钟内不再重试，
   避免每句话都白等一次子进程启动。 */
async function ttsAvailable(): Promise<boolean> {
  if (ttsProbe && Date.now() - ttsProbe.at < 600_000) return ttsProbe.ok;
  const ok = await new Promise<boolean>((resolve) => {
    execFile(pyBin(), ['-c', 'import edge_tts'], { timeout: 8000 }, (e) => resolve(!e));
  });
  ttsProbe = { ok, at: Date.now() };
  return ok;
}

/* 念稿版文本：LaTeX 直接念是噪音，整段公式念成「式子」。 */
function toSpeakText(raw: string): string {
  return String(raw || '')
    .replace(/\$\$[\s\S]*?\$\$/g, '，式子，')
    .replace(/\$[^$]*\$/g, ' 式子 ')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}^_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

router.post('/tts', authMiddleware, ownerOnly, async (req: AuthRequest, res: Response) => {
  const text = toSpeakText(String(req.body?.text || '')).slice(0, 600);
  if (!text) {
    res.status(400).json({ error: '缺少 text' });
    return;
  }
  if (!(await ttsAvailable())) {
    res.status(503).json({ error: 'tts_unavailable' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const script = `
import asyncio, sys, base64, json, edge_tts
async def main():
    text = sys.stdin.read()
    tts = edge_tts.Communicate(text, "${TTS_VOICE}", rate="${TTS_RATE}", boundary="WordBoundary")
    marks = []
    n = 0
    buf = bytearray()
    async for c in tts.stream():
        if c["type"] == "WordBoundary":
            marks.append({"text": c.get("text", ""), "ms": round(c["offset"] / 10000)})
        elif c["type"] == "audio":
            buf += c["data"]
            n += len(c["data"])
            if len(buf) >= 6000:
                sys.stdout.write("A " + base64.b64encode(bytes(buf)).decode() + "\\n")
                sys.stdout.flush()
                buf = bytearray()
    if buf:
        sys.stdout.write("A " + base64.b64encode(bytes(buf)).decode() + "\\n")
    sys.stdout.write("M " + json.dumps({"marks": marks, "bytes": n}) + "\\n")
    sys.stdout.flush()
asyncio.run(main())
`;

  const py = spawn(pyBin(), ['-u', '-c', script]);
  let marks: unknown[] = [];
  let bytes = 0;
  let buf = '';
  let closed = false;
  const kill = setTimeout(() => { try { py.kill('SIGKILL'); } catch { /* 忽略 */ } }, 30_000);

  py.stdout.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8');
    let cut: number;
    while ((cut = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, cut).trim();
      buf = buf.slice(cut + 1);
      if (line.startsWith('A ')) send('audio', { b64: line.slice(2) });
      else if (line.startsWith('M ')) {
        try {
          const j = JSON.parse(line.slice(2));
          marks = j.marks || [];
          bytes = j.bytes || 0;
        } catch { /* 忽略 */ }
      }
    }
  });
  py.stderr.on('data', () => { /* 静默：edge-tts 会在 stderr 打无关日志 */ });
  py.on('error', () => { if (!closed) { closed = true; send('error', { message: 'tts_spawn_failed' }); res.end(); } });
  py.on('close', () => {
    clearTimeout(kill);
    if (closed) return;
    closed = true;
    send('meta', { voice: TTS_VOICE, rate: TTS_RATE, marks, bytes });
    send('end', { ok: bytes > 0 });
    res.end();
  });
  py.stdin.write(text);
  py.stdin.end();
});

router.post('/ttsdbg', authMiddleware, ownerOnly, async (req: AuthRequest, res: Response) => {
  const text = String(req.body?.text || '测试');
  const script = `
import asyncio, sys, json, edge_tts
async def main():
    text = sys.stdin.read()
    tts = edge_tts.Communicate(text, "${TTS_VOICE}", rate="${TTS_RATE}", boundary="WordBoundary")
    marks=[];n=0
    async for c in tts.stream():
        if c["type"]=="WordBoundary": marks.append(c["text"])
        elif c["type"]=="audio": n+=len(c["data"])
    sys.stdout.write(json.dumps({"n":n,"m":len(marks),"v":"${TTS_VOICE}"}))
asyncio.run(main())
`;
  const py = spawn(pyBin(), ['-u', '-c', script]);
  let out = '';
  py.stdout.on('data', (d) => { out += d.toString(); });
  py.stderr.on('data', (d) => { out += '[E]' + d.toString().slice(0, 300); });
  py.on('close', () => res.json({ raw: out.slice(0, 600), bin: pyBin() }));
  py.stdin.write(text);
  py.stdin.end();
});

export default router;
