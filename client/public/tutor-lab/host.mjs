/**
 * /tutor-lab · Web 宿主（顶层文档，无 iframe）
 * ───────────────────────────────────────────────────────────────
 * 替代 APK 里 assets/board-host/bridge.js 的原生宿主：
 *   · 准备进度：后端 SSE 的真实节点 → api.setOpeningPreparationProgress
 *               （欧拉内核自己创建题目骨架 + 右栏清单，不是定时器假装的）
 *   · 题目识别：/api/tutor/ocr
 *   · 讲稿生成：/api/tutor/explain-stream（流式阶段 + 完整 plan）
 *   · 板书渲染：planToBoardScene → api.renderDoc（左题目/图 + 右分步讲解）
 */

import { planToBoardScene, setSceneWidth, splitMath } from '/quizboard/board-scene.web.mjs';

/* 内核 play 默认 autoplay=true：R.run 立刻按内部时钟把 at=0 的效果全部刷完，
   这就是「板书一次性全出」的第二个原因（第一个是渲染时没隐藏）。
   置 true 后 R.run 走 autoplay:false + awaitSpeechMarks，效果只由
   handleSpeechPlaybackEvent({type:'mark', event:'MarkReached'}) 放行 ——
   reachSpeechMark 会直接对该 mark 的全部 effect 调 applyPlayEffect，
   不看 clock 排期。正好对上 TTS 的真实时间段。 */
window.__quizboardUsesSpeechMarks = true;

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = () => localStorage.getItem('token') || '';
/* 站点登录态有两路：localStorage 里的 token（Authorization 头）和 httpOnly
   cookie keyi_token（浏览器自动带，authMiddleware 会自己解析）。
   没有 localStorage token 时**绝不能**发空的 "Bearer "：后端会优先解析这个
   空头并 401，反而把 cookie 兜底那条路堵死。 */
const authHeaders = () => {
  const t = token();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

let api = null;
let currentQuestion = '';
let currentPlan = null;
let rows = [];
let inFlight = false;
let toastTimer = 0;

/* ── 清单：与欧拉原生 preparation 的 steps 一一对应 ─────────────── */
const ORDER = ['received', 'reading', 'thinking', 'board'];
const LABELS = {
  received: { doing: '题目收到啦', done: '题目已收到' },
  reading: { doing: '我在仔细读题', done: '题意已梳理' },
  thinking: { doing: '我在梳理解题思路', done: '解题思路已梳理' },
  board: { doing: '正在准备板书', done: '讲解已就绪' },
};

function skeletonHeight() {
  return Math.min(300, Math.max(180, Math.round(window.innerHeight * 0.3)));
}

function pushProgress(visible = true) {
  if (!api) return;
  api.setOpeningPreparationProgress({
    visible,
    skeletonHeight: visible ? skeletonHeight() : 0,
    hint: visible ? '先想一想：这道题可以往哪个方向拆？' : null,
    steps: rows.map((r) => ({ key: r.key, label: r.label, completed: r.completed })),
  });
}

/* ── 加载态文档：内核自己的 reader-text-loading 出题目骨架 ─────────
   APK 的 layoutOpeningPreparationScene 只给了空 problem.stem section，
   不写 preparation:'loading' 就没有那三条灰线。这里补上骨架文档，
   让「左栏骨架/题目渐现 + 右栏准备清单」都由欧拉内核原生渲染。 */
function sceneBase() {
  const board = $('board');
  const W = setSceneWidth(board?.clientWidth || window.innerWidth);
  const inner = Math.max(560, W - 40 - 56 * 2);
  const ref = Math.round(inner * 0.49);
  return {
    id: 'tutor-loading', type: 'board_doc', version: 1,
    width: W, height: Math.max(900, window.innerHeight),
    elements: [], connectors: [],
    layout: {
      type: 'split_workspace', positioned: false,
      stem: 'reference_lane', orientation: 'columns',
      gap: 40, width: W,
      safeArea: { top: 56, right: 56, bottom: 56, left: 56 },
      boardDraw: { enabled: true },
      columns: [
        { id: 'left', lane: 'reference', width: ref, prefers: ['problem_source', 'top_to_bottom'] },
        { id: 'right', lane: 'solution', width: inner - ref, prefers: ['solution_main', 'top_to_bottom'] },
      ],
    },
  };
}

/** question 为空 → 三条骨架；有题目 → 直接渐现题目（含 MathJax 公式） */
function loadingDoc(question = '') {
  const block = {
    id: 'opening-reference', type: 'section', kind: 'problem.stem',
    visual_id: 'problem-stem', layout: { column: 'left', pane: 'reference' },
    parts: question ? splitMath(String(question).replace(/\s*\n+\s*/g, ' ')) : [],
  };
  if (!question) {
    block.preparation = 'loading';
    block.preparation_label = '正在识别题目…';
  }
  return { ...sceneBase(), blocks: [block] };
}

async function showLoading(question = '') {
  if (!api) return;
  await api.renderDoc(loadingDoc(question));
  pushProgress(true);   // renderDoc 重建 DOM 后，重新把清单挂回右栏
}

/** 后端真实节点 → 内核准备清单；条目按阶段逐条长出来，完成一条才露下一条 */
function applyStage(s) {
  const idx = ORDER.indexOf(s?.key);
  if (idx < 0 || !api) return;
  const count = Math.min(ORDER.length, idx + 1 + (s.completed ? 1 : 0));
  rows = ORDER.slice(0, count).map((key, i) => {
    const done = i < idx || (i === idx && !!s.completed);
    let label = done ? LABELS[key].done : LABELS[key].doing;
    if (i === idx && !done && typeof s.label === 'string' && s.label.trim()) label = s.label.trim();
    return { key, label, completed: done };
  });
  pushProgress(true);
}

function toast(msg, isError = false) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = isError ? 'show error' : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3200);
}

/* ── 会话状态 ───────────────────────────────────────────────────── */
async function startSession(question = '') {
  currentQuestion = question;
  currentPlan = null;
  inFlight = true;
  document.body.classList.add('in-session');
  $('session-title').textContent = question ? question.replace(/\s+/g, ' ').slice(0, 30) : '正在准备讲解';
  rows = [{ key: 'received', label: LABELS.received.doing, completed: false }];
  // 直接输入 → 题目立即渐现；拍照 → 先出三条骨架，OCR 回来再换真题目
  await showLoading(question);
}

function endSession() {
  inFlight = false;
  document.body.classList.remove('in-session');
  try { api?.clear?.(); } catch { /* 忽略 */ }
  try { api?.setOpeningPreparationProgress?.({ visible: false, steps: [], skeletonHeight: 0 }); } catch { /* 忽略 */ }
}

/* ── 后端：OCR / SSE 讲题 ───────────────────────────────────────── */
async function ocr(file) {
  const fd = new FormData();
  fd.append('image', file);
  const r = await fetch('/api/tutor/ocr', {
    method: 'POST',
    headers: authHeaders(),
    body: fd,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || '题目识别失败');
  const q = String(j?.question || j?.latex || '').trim();
  if (!q) throw new Error('没认出题目，重拍一张或直接把题目打出来');
  return q;
}

/** SSE：fetch + ReadableStream，按帧解 event/data；阶段一到达就推给内核 */
async function explainStream(question) {
  const r = await fetch('/api/tutor/explain-stream', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, grade: '高二' }),
  });
  if (!r.ok || !r.body) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j?.error || `讲题服务异常（${r.status}）`);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let plan = null;
  let error = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      let event = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      let obj;
      try { obj = JSON.parse(data); } catch { continue; }
      if (event === 'stage') applyStage(obj);
      else if (event === 'plan') plan = obj;
      else if (event === 'error') error = String(obj?.message || '讲解失败');
    }
  }
  if (error) throw new Error(error);
  if (!plan) throw new Error('讲稿为空，请重试');
  return plan;
}

/* ── 逐段播放 ───────────────────────────────────────────────────
   欧拉内核**只认 speech_mark**：play-schedule 的 scheduleEffectTimes 对没有
   speech_mark 的效果直接返回 null，at_ms 是死字段（实测 t=1.2s 就把全部板书
   一次性画完）。所以按 TTS 的规矩来：

     1. play 里每个 effect 挂 speech_mark: 'm<stage>'；
     2. 服务端 /api/tutor/tts 合成整段讲解，返回**字级时间戳**；
     3. 音频播放时把 audio.currentTime 折成 audio_ms 喂 clock 事件，
        内核在各 mark 的偏移时刻放行该段 show → 念到哪，写到哪。

   走服务端而不是 speechSynthesis 的原因：桌面 Chrome / 部分安卓直接
   synthesis-failed（实测），一失败就没有时钟；edge-tts 是神经网络音色，
   讲数学不像念课文，且时间戳是引擎给的真值，不需要按字数猜。 */

const MARK_GAP_MS = 180;   // 段间呼吸
/* 段的排期 = 前几段实测音频时长 + 呼吸。第一段时长要等音频 metadata，
   第二段的 mark 偏移会跟着往后调 —— 所以开始时先给一个保守估计，
   拿到真实时长后立刻重发 mark_timings（内核按最新表放行）。 */

/* 念稿版文本：LaTeX 直接念是噪音（会念成「反斜杠 frac」），整段念「式子」。 */
function speakable(t) {
  return String(t || '')
    .replace(/\$\$[\s\S]*?\$\$/g, '，式子，')
    .replace(/\$[^$]*\$/g, ' 式子 ')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}^_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 按「讲稿 + 文档」切段，每段一个 speech_mark。
    不依赖 stage_index —— 实测内核/场景层对同一段的多个块并不总打标，
    只有打到的那个块会进 play，其余直接铺在起始画面里。所以这里自己切：
      · 有 stage_index 的块按它归段（兼容老路径）；
      · 讲稿某一步的文字若在某个块里出现过，就把那块归到那一步。 */
const paraText = (b) => (b.paragraphs || [])
  .map((p) => (p.parts || []).map((x) => x.text || (x.formula ? x.formula : '')).join(''))
  .join('');
const blockText = (b) => {
  if (b.type === 'stage_heading') return (b.parts || []).map((x) => x.text || '').join('');
  if (b.type === 'callout') return [b.title || '', ...(b.content || []).map((c) => (c.parts || []).map((x) => x.text || '').join(''))].join(' ');
  if (b.type === 'derivation') return (b.rows || []).map((r2) => r2.lhs?.text || '').join(' ');
  return paraText(b);
};
const norm = (t) => String(t || '').replace(/[\s$\\{}^_]/g, '');

/** 把讲稿按段数切成 n 份（按字数比例），保证语音是完整讲稿、动画按块走。 */
function splitTalk(talk, weights) {
  const chars = Array.from(String(talk || ''));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const out = [];
  let at = 0;
  for (let i = 0; i < weights.length; i++) {
    const take = i === weights.length - 1
      ? chars.length - at
      : Math.max(1, Math.round(chars.length * weights[i] / total));
    out.push(chars.slice(at, at + take).join(''));
    at += take;
  }
  return out;
}

/* ── 逐段播放：按「右栏块」切段 ─────────────────────────────────
   逆向结论（whiteboard.mjs / play.mjs / board_embed.mjs）：
     · show 效果本质只是 classList.remove('qb-play-hidden')；隐藏态必须在
       **渲染时**由 showBoardDoc(doc,{initialPlay:play}) 按 effect 的
       block.id 加（ur 集合），事后补 class 会被内核重渲染冲掉；
     · play 只认 speech_mark；`mark` 事件直接放行该 mark 的全部 effect，
       不依赖 clock / scheduledAt / 内部 autoplay 时钟；
     · 所以：一段 = 一个 speech_mark = 一组块；音频走到哪一段，
       就发一个 mark，内核把那几块从隐藏态点亮。
   以 stage_heading 分段；开头的「先想一想」并入第 1 段，尾部「关键方法」
   /「答案」并入最后一段，避免答案一开始就露在屏幕上。 */
function buildPlay(doc, steps) {
  const blocks = (doc.blocks || []).filter((b) =>
    b && b.id && b.type !== 'figure' && !b.visual_id &&
    b.kind !== 'problem.stem' && b.layout?.pane === 'solution');
  if (!blocks.length) return null;

  const groups = [];
  let cur = null;
  for (const b of blocks) {
    if (b.type === 'stage_heading' || !cur) { cur = []; groups.push(cur); }
    cur.push(b);
  }
  if (!groups.length) return null;
  /* 模型有时只给 1 个 stage_heading（甚至没有），整份板书就只切出 1 段，
     动画等于没有。保底：段数 < 3 时按块顺序均分成最多 3 段。 */
  if (groups.length < 3 && blocks.length >= 2) {
    const k = Math.min(3, blocks.length);
    const per = Math.ceil(blocks.length / k);
    groups.length = 0;
    for (let i = 0; i < blocks.length; i += per) groups.push(blocks.slice(i, i + per));
  }

  const groupText = (g) => g.map((b) => blockText(b)).join(' ');
  const talk = (steps || [])
    .map((st) => speakable(`${st?.title || ''} ${st?.text || ''}`))
    .filter(Boolean).join(' ')
    || groups.map((g) => speakable(groupText(g))).join(' ');
  /* 讲稿等分成 n 份：按块文本字数切会把某一段撑到 20 多秒，
     学生盯着空白等太久；等分后每段语音量均匀，节奏稳定。 */
  const weights = groups.map(() => 1);
  const talks = splitTalk(talk, weights);

  const effects = [];
  const segs = [];
  groups.forEach((g, i) => {
    const mark = `m${i + 1}`;
    g.forEach((b, j) => {
      effects.push({
        effect_id: `shw_${i + 1}_${j + 1}`,
        kind: 'show',
        speech_mark: mark,
        duration_ms: 120,
        block_id: b.id,
        target: b.id,
        block: b,
      });
    });
    segs.push({ mark, stage: i + 1, text: groupText(g), spoken: talks[i] || ' ', blocks: g });
  });
  return {
    play: {
      id: `tutor_${Date.now()}`,
      speech: { spoken: talk, subtitle: '' },
      effects,
    },
    segs,
  };
}

/* ── 语音：/api/tutor/tts → { blob, marks[] } ─────────────────── */
async function fetchSpeech(text) {
  const clean = speakable(text);
  if (!clean) return null;
  const r = await fetch('/api/tutor/tts', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: clean }),
  });
  if (!r.ok || !r.body) return null;
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  const parts = [];
  let meta = null;
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      let ev = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) ev = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      let obj;
      try { obj = JSON.parse(data); } catch { continue; }
      if (ev === 'audio' && obj.b64) {
        const bin = atob(obj.b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        parts.push(u8);
      } else if (ev === 'meta') meta = obj;
    }
  }
  if (!parts.length) return null;
  const marks = meta?.marks || [];
  return { blob: new Blob(parts, { type: 'audio/mpeg' }), marks };
}


/* ── 播放：音频时间轴 → mark 事件 ────────────────────────────────
   逆向 play.mjs / board_embed.mjs 得到的真实协议：
     · R.run 在 __quizboardUsesSpeechMarks=true 时 autoplay:false，
       不再用内部时钟把 at=0 的效果一次性刷完；
     · Qe() 收到 {type:'mark', event:'MarkReached'} → R.reachSpeechMark()
       → 对该 mark 的**全部** effect 直接调 ze()/applyPlayEffect，
       不经过 Oe() 的 scheduledAt/clock 排期；
     · clock 只用于同步时间轴（图形 reveal 用），不承担放行。
   所以时间轴 = 服务端 edge-tts 的真实音频时长按字数比例切段，
   念到哪一段就发哪一个 mark，内核把那段的板书从隐藏态点亮。 */

const ZI_MS = 230;         // 中文 ~4.3 字/秒（婷婷实测 3.65~4.25）
const SEG_MIN_MS = 2200;   // 一段至少留这么久，别一闪而过

function ziCount(t) {
  const m = String(t || '').match(/[\u4e00-\u9fa5]|[A-Za-z0-9]+/g);
  return m ? m.length : 0;
}
function estSegMs(text) {
  return Math.max(SEG_MIN_MS, Math.round(ziCount(speakable(text)) * ZI_MS));
}

let lessonToken = 0;

/* ── 逐段揭示 ────────────────────────────────────────────────────
   起始画面由 showBoardDoc(doc,{initialPlay:play}) 渲染：内核把 play 里
   所有 show 目标的块加上 .qb-play-hidden（opacity:0，占位保留，版式不塌）。
   之后每收到一个 mark，内核就把对应那几块的 hidden 摘掉 —— 念到哪写到哪。
   之前一直失败的两个原因：① renderDoc 不带 initialPlay，块根本没隐藏，
   show 是空操作；② 没置 __quizboardUsesSpeechMarks，autoplay 内部时钟
   在 setMarkTimings 之前就把 at=0 的效果全刷完了。 */
async function playLesson(anim, api, doc, playId) {
  const syn = window.speechSynthesis;
  if (syn) { try { syn.cancel(); } catch { /* 忽略 */ } }
  const n = anim.segs.length;
  const token = ++lessonToken;
  window.__tutorTalk = { get stage() { return window.__tutorAnim.stageIndex || 0; }, log: [], firstReject: null };

  /* 语音：整段一次合成（逐段合成每段都要等一次往返，中间会卡）。 */
  const full = anim.segs.map((x) => x.spoken).join(' ');
  const speech = await Promise.race([fetchSpeech(full), new Promise((r) => setTimeout(() => r(null), 12000))]);
  if (token !== lessonToken) return;
  const probe = new Audio();
  probe.preload = 'auto';
  probe.setAttribute('playsinline', '');
  const audioDur = speech
    ? await new Promise((resolve) => {
      probe.onloadedmetadata = () => resolve(Number(probe.duration) || 0);
      probe.onerror = () => resolve(0);
      probe.src = URL.createObjectURL(speech.blob);
      setTimeout(() => resolve(0), 1500);
    })
    : 0;
  if (token !== lessonToken) return;

  /* 时间轴：按字数比例铺满真实语音时长；没语音就按字速估。
     一旦算出正数就**不再变** —— 内核 setMarkTimings 之后不接受新表。 */
  let starts = new Array(n).fill(0);
  let total = 0;
  /* 时间轴 = 服务端 edge-tts 返回的**真实音频时长**，按段数均分。
     试过按字数比例和按 WordBoundary 插值：前者会把第一段拖到 20 多秒
     （块文本字数和讲稿字数不是一回事），后者前几段挤在一起。均分最稳，
     且每段都对应等量讲稿（splitTalk 已等分），念到哪写到哪。 */
  if (audioDur > 0) {
    /* 讲稿长度模型侧波动很大（实测 20s ~ 120s），铺满 120 秒会让学生
       盯着空白等半分钟。板书节奏最多 45 秒写完；语音继续放，不加速、
       不截断，学生听完讲解时板书已完整。短讲稿仍与语音完全同步。 */
    const spanMs = Math.min(audioDur * 1000, 45000);
    for (let i = 0; i < n; i++) starts[i] = Math.round((i / n) * spanMs);
    total = Math.round(spanMs) + 300;
  } else {
    /* TTS 超时/失败时的降级节奏：每段固定 3.2 秒，别用板书字数估
       （含公式的块文本会被算成 100 多秒）。 */
    const SEG = 3200;
    for (let i = 0; i < n; i++) starts[i] = i * SEG;
    total = n * SEG + 800;
  }
  if (!Number.isFinite(total) || total <= 0) total = n * 4000 + 500;
  window.__tutorTiming = { starts, total, audioDur: Math.round(audioDur), hasSpeech: !!speech };

  /* 等内核把 play 建起来（它自己会先 renderDoc 再装 play） */
  const exec = await waitPlayExec(playId, 4000);
  if (token !== lessonToken) return;
  if (!exec) { window.__tutorAnim.done = true; return; }
  const pid = { play_id: exec.play_id || playId, play_exec_id: exec.play_exec_id };

  /* R.run 的 settlePlayEffects() 会把 .qb-play-hidden 清光，所以等 play 真正
     建起来之后，再渲染一次带 initialPlay 的文档：内核按 effect.block.id 给
     每块加 .qb-play-hidden。sleep 是等 R.run 的同步 settle 收尾。 */
  await sleep(260);
  if (window.__quizboard?.board?.showBoardDoc) {
    try { await window.__quizboard.board.showBoardDoc(doc, { initialPlay: anim.play }); }
    catch (e) { try { (window.__ad || (window.__ad = [])).push('showBoardDoc: ' + String(e)); } catch { /* 忽略 */ } }
  }
  /* 图形 DOM 在这一刻才稳定（R.run 会重渲染）；initFigure() 在下方
     变量声明完成后调用，避免 let/const 的暂时性死区。 */

  /** 内核 show 作用的显示单元：与 whiteboard.mjs 的 ad(e,{precise:true}) 同规则。
      优先 .wb-block 父容器（showBoardDoc 就是把 hidden 加在它上面）。 */
  const esc = (v) => (window.CSS?.escape ? CSS.escape(String(v)) : String(v).replace(/"/g, '\\"'));
  const unitsOf = (seg) => {
    const B = document.getElementById('board');
    if (!B) return [];
    const out = [];
    for (const b of seg.blocks || []) {
      let el = null;
      try { el = B.querySelector(`[data-doc-id="${esc(b.id)}"]`); } catch { /* 忽略 */ }
      if (!el) continue;
      if (el.matches('.doc-formula,.doc-mark,.doc-correction,.qb-part') || el.closest('.boardggb-svg')) { out.push(el); continue; }
      const n = el.closest('[data-wb-block="1"]');
      if (!n) { out.push(el); continue; }
      out.push(el !== n && el.dataset.docId && n.querySelector('[data-doc-id]') !== el ? el : n);
    }
    return [...new Set(out)];
  };
  let units = anim.segs.map(unitsOf);
  const reunits = () => { units = anim.segs.map(unitsOf); };
  /** 每帧自己维护可见性：内核 DOM 一旦重建，隐藏类丢了也能自愈。
      已到点的段 remove hidden，没到点的段补上 hidden；与内核 show 不冲突。 */
  const syncVisibility = (pos) => {
    for (let i = 0; i < n; i++) {
      const show = pos >= starts[i];
      for (const el of units[i] || []) {
        if (show) { el.classList.remove('qb-play-hidden'); el.classList.add('qb-play-revealed'); }
        else { el.classList.add('qb-play-hidden'); el.classList.remove('qb-play-revealed'); }
      }
    }
  };

  /* ── 左栏图形：按内核语义分层，讲到哪画到哪 ───────────────────────
     逆向线上 SVG 的真实结构（63 个元素）：前 43 个全是网格线/坐标轴/
     刻度数字，紫色圆与向量、点、点标签全挤在最后 20 个。所以「按 DOM
     顺序均分」永远不对：开场刷一堆刻度，圆却拖到中段。
     这里按内核自己的 data-boardggb-reveal-role 与描边颜色分语义层，
     对齐 boardggb-reveal.mjs 的 axis→point→pointLabel→line→face 时间线：
       L0 底纸（网格/坐标轴/刻度）→ mark0
       L1 几何主体（紫色圆、向量、箭头）→ mark1，stroke-dashoffset 逐笔描绘
       L2 点与点标签（seed/labeled/small-point + 无 class 的 text）→ mark2
     最后几段留给动点在圆上移动与高亮脉冲，表达「P 是圆上动点」。
     好处：严格跟 TTS 时间轴，且内核重渲染 DOM 后按元素属性自愈。 */
  const FIG_NS = 'http://www.w3.org/2000/svg';
  let figInit = false;
  let figDot = null;
  let figCircle = null;
  const figSvg = () => document.querySelector('#board svg.boardggb-svg');
  const collectFig = () => {
    const svg = figSvg();
    if (!svg) return [];
    return [...svg.querySelectorAll('line,path,polyline,polygon,circle,ellipse,rect,text')]
      .filter((e) => !e.closest('defs') && e !== figDot);
  };
  /** 按元素自身属性判语义层，与 DOM 顺序无关。
      关键：用「白名单认底纸」而不是「认几何颜色」。模型换题会换图形配色，
      硬编码紫色会把几何误判成底纸、开场一次全亮；而底纸的样式是内核固定
      的（网格 rgba(31,26,20,.095)、轴/刻度线 #b8afa2、.wb-axis2d-label
      刻度数字），认这个才稳。除底纸和点之外的一律是几何主体。 */
  const figLayer = (e) => {
    const role = e.getAttribute('data-boardggb-reveal-role') || '';
    const stroke = String(e.getAttribute('stroke') || '').toLowerCase();
    const cls = String(e.getAttribute('class') || '');
    const tag = e.tagName.toLowerCase();
    if (/point/.test(role)) return 2;                       // 内核标注的点
    if (tag === 'text' && !cls) return 2;                  // O / C / A / P 点标签
    if (stroke.includes('rgba(31, 26, 20')) return 0;     // 网格线
    if (stroke === '#b8afa2') return 0;                    // 坐标轴 / 刻度线
    if (cls.includes('wb-axis2d-label')) return 0;         // 刻度数字
    return 1;                                              // 其余 = 几何主体
  };
  /** 层 → 段：留最后一段给动点收尾，别让新几何在结尾才冒出来 */
  const figGroupOf = (e) => Math.min(Math.max(0, n - 2), figLayer(e));
  /** 只给几何主体做逐笔描绘；底纸淡入即可，43 条网格一起 dash 会太慢 */
  const isStrokeGeom = (e) => figLayer(e) === 1;

  function initFigure() {
    const svg = figSvg();
    if (!svg) return;
    svg.style.opacity = '';              // 撤掉 renderFull 阶段的预隐藏
    const els = collectFig();
    let geomIdx = 0;
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      if (e.dataset.qbFigOld === undefined) e.dataset.qbFigOld = e.style.opacity || '';
      if (isStrokeGeom(e)) {
        try {
          const L = typeof e.getTotalLength === 'function' ? e.getTotalLength() : 0;
          if (L > 2 && L < 6000) {
            const len = String(Math.ceil(L));
            e.dataset.qbFigLen = len;
            e.style.strokeDasharray = len;
            e.style.strokeDashoffset = len;
          }
        } catch { /* text / rect 没有 getTotalLength，忽略 */ }
        /* 几何主体内部按笔顺错峰，逐笔画出圆/向量，而不是同时亮 */
        e.style.transitionDelay = Math.round(geomIdx++ * 95) + 'ms';
      }
      e.style.transition = 'opacity .38s ease, stroke-dashoffset .72s ease';
    }
    /* 动点轨迹：从紫色几何主体的包围盒里找「近似正方形且最大」的那一个，
       也就是题目里的圆。线上 circle 元素全是 r≈2 的标注点，按最大圆找会
       落到兜底值上；用 getBBox 才拿得到真实圆。 */
    let best = null;
    for (const e of svg.querySelectorAll('path,polyline,polygon,ellipse,rect')) {
      if (!isStrokeGeom(e)) continue;
      let bb;
      try { bb = e.getBBox(); } catch { continue; }
      const w = Number(bb.width), h = Number(bb.height);
      if (!(w > 16 && w < 420 && h > 16 && h < 420)) continue;
      const square = Math.abs(w - h) / Math.max(w, h) < 0.28;
      if (square && (!best || w * h > best.w * best.h)) {
        best = { cx: bb.x + w / 2, cy: bb.y + h / 2, r: Math.min(w, h) / 2, w, h };
      }
    }
    if (!best) {
      /* 非圆题（三角形/函数等）：用几何主体整体包围盒的内切圆兜底 */
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const e of svg.querySelectorAll('path,polyline,polygon,ellipse,rect')) {
        if (!isStrokeGeom(e)) continue;
        let bb; try { bb = e.getBBox(); } catch { continue; }
        x0 = Math.min(x0, bb.x); y0 = Math.min(y0, bb.y);
        x1 = Math.max(x1, bb.x + bb.width); y1 = Math.max(y1, bb.y + bb.height);
      }
      if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0) {
        const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
        const w = Number.isFinite(vb[2]) && vb[2] > 0 ? vb[2] : 532;
        const h = Number.isFinite(vb[3]) && vb[3] > 0 ? vb[3] : 280;
        x0 = w * 0.18; y0 = h * 0.2; x1 = w * 0.66; y1 = h * 0.8;
      }
      best = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: Math.min(x1 - x0, y1 - y0) / 2 };
    }
    figCircle = best;
    if (!figDot || !figDot.isConnected) {
      figDot = document.createElementNS(FIG_NS, 'circle');
      figDot.setAttribute('r', '5');
      figDot.setAttribute('fill', '#e14b34');
      figDot.setAttribute('stroke', '#fff');
      figDot.setAttribute('stroke-width', '2');
      figDot.style.pointerEvents = 'none';
      svg.appendChild(figDot);
    }
    figInit = true;
    syncFigure(0);
  }

  function syncFigure(pos) {
    if (!figInit) return;
    const svg = figSvg();
    if (!svg) return;
    /* 每帧重新取元素：内核可能重建 SVG，旧引用会失效；分组按元素属性判定，
       所以 DOM 顺序变了也不会错层。 */
    const els = collectFig();
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      const show = pos >= starts[Math.min(n - 1, figGroupOf(e))];
      if (e.dataset.qbFigOld === undefined) e.dataset.qbFigOld = e.style.opacity || '';
      if (show) {
        if (e.dataset.qbFigShown !== '1') {
          e.dataset.qbFigShown = '1';
          e.style.opacity = e.dataset.qbFigOld || '';
          if (e.dataset.qbFigLen) e.style.strokeDashoffset = '0';
        }
      } else {
        e.dataset.qbFigShown = '0';
        e.style.opacity = '0';
        if (e.dataset.qbFigLen) e.style.strokeDashoffset = e.dataset.qbFigLen;
      }
    }
    /* 动点 P：讲完前两段（圆和点都画出来）才登场，沿圆弧从右上移到左下
       的取等位置后停住 —— 对应原版「P 移到圆上另一侧，向量随之变化」，
       不是绕一整圈回到起点。 */
    if (figDot && figCircle) {
      if (!figDot.isConnected) svg.appendChild(figDot);
      const from = Math.min(starts[Math.min(2, n - 1)], total * 0.42);
      const to = Math.max(from + 1, total * 0.92);
      const p = Math.max(0, Math.min(1, (pos - from) / Math.max(1, to - from)));
      const eased = p * p * (3 - 2 * p);
      const a = -Math.PI / 4 + eased * Math.PI * 1.15;
      figDot.setAttribute('cx', String(figCircle.cx + figCircle.r * Math.cos(a)));
      figDot.setAttribute('cy', String(figCircle.cy + figCircle.r * Math.sin(a)));
      figDot.style.opacity = pos >= from ? '0.95' : '0';
    }
  }

  initFigure();

  /* ── 蓝色画笔：讲到哪画到哪 ─────────────────────────────────────────
     逆向原版（逐帧对照 9~12s 左图、20~24s 右栏）：重点不是一次性高亮，
     而是笔尖跟着讲解逐笔写出、笔迹累计保留、越讲越多 ——
       · 右栏公式 / 关键句写出时，下方留一道青蓝色手绘下划线
       · 左图讲到某个量时，用蓝色笔把刚画出的几何主体手绘圈一下
     实现：在 #board 上叠一层 pointer-events:none 的 SVG；每个 mark 段
     对应几条 path，stroke-dashoffset 从左往右写出，蓝色笔尖沿路径移动。
     状态机 hidden → writing → done，保证 seek 快进时不重播动画、回退时
     能正确隐藏；内核重渲染 / 右栏滚动导致 rect 变化时自动重建笔迹。 */
  /* ── 蓝色画笔：按内核 board_draw 机制复刻 ───────────────────────────
     逆向 11/7 APK（assets/quizboard/，重新下载解压的原始未改包）：
       · board-theme.mjs  blue #2563d9；DRAW_STROKES.ink = 2.8
       · board-draw.mjs   INK_KINDS 9 种（circle/box/underline/strike/brace/
                          check/cross/cancel/marker）；MARKER_FILL_OPACITY=.22；
                          defaultInkColor: underline/circle/box → blue；
                          inkShapePlan: underline 在 unionRect.bottom+4，
                          circle 是 rx=w/2+7 / ry=h/2+5 的椭圆；
                          inkDrawDurationMs = clamp(300, 300+1.6*len, 900)
       · play.mjs         原生 effect kind 含 highlight（action_id + phase）
       · whiteboard.mjs   笔迹用 WAAPI 动画 strokeDashoffset→0，各 path 按
                          长度比例分配 duration；笔尖 circle.qb-draw-pen-tip
                          (r=3、白描边 1.2) 每帧由播放时钟 Fe() 驱动
                          getPointAtLength，fill 取 path 的 stroke
       · teacher-pen.mjs  GLIDE 220 / REST 1200 / FADE 300 / TRAVEL 250~900
     不另造播放协议，按同一套参数与时钟在宿主层复刻：笔迹累计保留、
     seek 快进不重播、内核重渲染后按缓存 path 自愈。 */
  const INK_BLUE = '#2563d9';
  const INK_MARKER = '#8096ff';
  const INK_MARKER_OP = '0.22';
  const INK_W = 2.8;
  const PEN_GLIDE_MS = 220, PEN_REST_MS = 1200, PEN_FADE_MS = 300;
  let inkSvg = null;
  let inkTip = null;
  const inkPaths = new Array(n).fill(null);
  const inkSpecs = new Array(n).fill(null);   // 缓存 d：层被内核重建时照原样恢复
  const inkState = new Array(n).fill('hidden');   // hidden | writing | done
  const inkWriting = new Array(n).fill(null);
  const boardEl = () => document.getElementById('board');

  function ensureInkLayer() {
    const B = boardEl();
    if (!B) return null;
    if (inkSvg && inkSvg.isConnected) return inkSvg;
    const br = B.getBoundingClientRect();
    inkSvg = document.createElementNS(FIG_NS, 'svg');
    inkSvg.setAttribute('class', 'qb-blue-ink');
    inkSvg.setAttribute('viewBox', `0 0 ${Math.max(1, br.width)} ${Math.max(1, br.height)}`);
    Object.assign(inkSvg.style, {
      position: 'absolute', left: '0', top: '0',
      width: br.width + 'px', height: br.height + 'px',
      pointerEvents: 'none', zIndex: '9999', overflow: 'visible',
    });
    if (getComputedStyle(B).position === 'static') B.style.position = 'relative';
    B.appendChild(inkSvg);
    inkTip = document.createElementNS(FIG_NS, 'circle');
    inkTip.setAttribute('class', 'qb-draw-pen-tip');
    inkTip.setAttribute('r', '3');
    inkTip.setAttribute('stroke', '#fff');
    inkTip.setAttribute('stroke-width', '1.2');
    inkTip.setAttribute('fill', INK_BLUE);
    inkTip.style.opacity = '0';
    inkSvg.appendChild(inkTip);
    inkPaths.fill(null);          // SVG 丢了，下面按 inkSpecs 重建，笔迹不丢
    return inkSvg;
  }

  /* 几何照抄 inkShapePlan；内核用 rough.js 加抖动，这里用一段轻微 Q 近似 */
  const inkLine = (x1, y, x2) => {
    if (x2 - x1 < 24) return '';
    const mx = (x1 + x2) / 2;
    return `M ${x1.toFixed(1)} ${(y + 0.6).toFixed(1)} Q ${mx.toFixed(1)} ${(y - 1.3).toFixed(1)} ${x2.toFixed(1)} ${(y - 0.4).toFixed(1)}`;
  };
  const inkEllipse = (cx, cy, rx, ry) => (
    `M ${(cx - rx).toFixed(1)} ${cy.toFixed(1)} ` +
    `C ${(cx - rx).toFixed(1)} ${(cy - ry * 1.18).toFixed(1)}, ${(cx + rx).toFixed(1)} ${(cy - ry * 1.18).toFixed(1)}, ${(cx + rx).toFixed(1)} ${cy.toFixed(1)} ` +
    `C ${(cx + rx).toFixed(1)} ${(cy + ry * 1.18).toFixed(1)}, ${(cx - rx).toFixed(1)} ${(cy + ry * 1.18).toFixed(1)}, ${(cx - rx - 1).toFixed(1)} ${(cy + 2).toFixed(1)}`
  );

  /** 该段重点：关键方法框 / 阶段标题 / 公式块优先，最多 2 处 */
  function inkTargets(i) {
    const scored = [];
    for (const el of units[i] || []) {
      if (!el || !el.isConnected) continue;
      const cls = String(el.className || '');
      let s = 0;
      if (/callout|hint|tip|key/i.test(cls)) s += 5;
      if (/stage|heading|title/i.test(cls)) s += 4;
      if (/formula|math/i.test(cls)) s += 3;
      if (el.querySelector && el.querySelector('.doc-formula,.qb-formula,katex,mjx-container')) s += 2;
      s += Math.min(2, String(el.innerText || '').length / 70);
      scored.push({ el, s });
    }
    scored.sort((a, b) => b.s - a.s);
    /* 每段只标一处重点，避免同一段两条线叠在一起；内核 inkTargetList
       也是按一次 highlight action 对应一个 text_range */
    return scored.slice(0, 1).map((x) => x.el);
  }

  /** 生成该段所有笔迹的 path d（相对 #board 的像素坐标），并缓存下来 */
  function computeInkSpecs(i) {
    const B = boardEl();
    if (!B) return [];
    const br = B.getBoundingClientRect();
    const specs = [];
    for (const el of inkTargets(i)) {
      let r;
      try { r = el.getBoundingClientRect(); } catch { continue; }
      if (!(r.width > 30 && r.height > 8)) continue;
      /* 内核 underline：unionRect.bottom + 4，left-2 → right+2 */
      const x1 = r.left - br.left - 2;
      const x2 = Math.min(r.right - br.left + 2, x1 + 430);
      /* 内核用文字 Range 的 unionRect.bottom+4；我们量的是整块 rect，
         含 padding，所以贴块底内侧 -2，线才不会跑到下一块文字上方 */
      const d = inkLine(x1, r.bottom - br.top - 2, x2);
      if (d) specs.push(d);
    }
    /* 左栏：圈住这一段刚描绘出来的几何主体（内核 circle: rx=w/2+7, ry=h/2+5） */
    try {
      const svg = figSvg();
      if (svg) {
        const els = collectFig().filter((e) => i === figGroupOf(e) && isStrokeGeom(e)).slice(0, 4);
        if (els.length) {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const e of els) {
            const r = e.getBoundingClientRect();
            if (r.width < 1 && r.height < 1) continue;
            x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top);
            x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
          }
          if (x1 > x0 && y1 > y0 && x1 - x0 < br.width * 0.55 && y1 - y0 < br.height * 0.7) {
            const cx = (x0 + x1) / 2 - br.left, cy = (y0 + y1) / 2 - br.top;
            specs.push(inkEllipse(cx, cy, (x1 - x0) / 2 + 7, (y1 - y0) / 2 + 5));
          }
        }
      }
    } catch { /* 忽略 */ }
    return specs;
  }

  /** 每条笔迹两层：MARKER_FILL_OPACITY 的荧光底 + DRAW_STROKES.ink 的蓝色笔锋 */
  function buildInkPaths(i, specs) {
    const S = ensureInkLayer();
    if (!S) return [];
    const made = [];
    for (const d of specs) {
      for (const layer of [
        { color: INK_MARKER, w: 9, op: INK_MARKER_OP },
        { color: INK_BLUE, w: INK_W, op: '1' },
      ]) {
        const p = document.createElementNS(FIG_NS, 'path');
        p.setAttribute('d', d);
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', layer.color);
        p.setAttribute('stroke-width', String(layer.w));
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
        p.style.opacity = layer.op;
        p.style.display = 'none';
        S.appendChild(p);
        made.push(p);
      }
    }
    return made;
  }

  /** 已画完且有 path 就直接复用；层被重建时用 inkSpecs 缓存恢复，绝不因
      DOM 抖动重新量坐标 —— 这是上一版「结束帧笔迹只剩 2 条」的根因。 */
  function ensureInkPaths(i) {
    if (!ensureInkLayer()) return [];
    const cached = inkPaths[i];
    if (cached && cached.length && cached.every((p) => p.isConnected)) return cached;
    let specs = inkSpecs[i];
    if (!specs || !specs.length) {
      specs = computeInkSpecs(i);
      if (specs.length) inkSpecs[i] = specs;
    }
    for (const p of cached || []) { try { p.remove(); } catch { /* 忽略 */ } }
    inkPaths[i] = specs.length ? buildInkPaths(i, specs) : [];
    return inkPaths[i];
  }

  /** 笔尖按播放时钟 pos 走，不自己起 rAF —— seek/快进才不会错位 */
  function syncInkTip(pos) {
    if (!inkTip || !inkTip.isConnected) return;
    let w = null;
    for (let i = 0; i < n; i++) {
      const c = inkWriting[i];
      if (c && (!w || c.startPos > w.startPos)) w = c;
    }
    if (!w) { inkTip.style.opacity = '0'; return; }
    const t = pos - w.startPos;
    if (t < 0 || t > w.total + PEN_REST_MS + PEN_FADE_MS) { inkTip.style.opacity = '0'; return; }
    const tt = Math.min(t, w.total);
    let seg = w.segs[w.segs.length - 1];
    for (const s of w.segs) { if (tt < s.start + s.dur) { seg = s; break; } }
    const q = Math.max(0, Math.min(1, (tt - seg.start) / Math.max(1, seg.dur)));
    let pt;
    try { pt = seg.path.getPointAtLength(q * seg.len); } catch { inkTip.style.opacity = '0'; return; }
    inkTip.setAttribute('cx', String(pt.x));
    inkTip.setAttribute('cy', String(pt.y));
    inkTip.setAttribute('fill', seg.path.getAttribute('stroke') || INK_BLUE);
    let op = 1;
    if (t < PEN_GLIDE_MS) op = t / PEN_GLIDE_MS;
    else if (t > w.total + PEN_REST_MS) op = 1 - (t - w.total - PEN_REST_MS) / PEN_FADE_MS;
    inkTip.style.opacity = String(Math.max(0, Math.min(1, op)));
  }

  /** 每帧同步：到点的段显示、没到点隐藏；笔迹累计保留 */
  function syncInk(pos, deep) {
    if (!ensureInkLayer()) return;
    for (let i = 0; i < n; i++) {
      if (deep && (!inkSpecs[i] || !inkSpecs[i].length)) ensureInkPaths(i);
      const ps = inkPaths[i] || [];
      if (pos < starts[i]) {
        inkState[i] = 'hidden';
        for (const p of ps) p.style.display = 'none';
        continue;
      }
      if (inkState[i] === 'hidden') inkState[i] = 'done';   // 快进：直接画完
      if (inkState[i] === 'done') {
        for (const p of ps) {
          p.style.display = '';
          try { p.getAnimations?.().forEach((a) => a.cancel()); } catch { /* 忽略 */ }
          p.style.strokeDashoffset = '0';
        }
      } else {
        for (const p of ps) p.style.display = '';           // writing：让 WAAPI 跑
      }
    }
    syncInkTip(pos);
  }

  /** mark 到达：按内核 inkDrawDurationMs 与各 path 长度比例分配 duration，
      用 WAAPI 写 strokeDashoffset，笔尖由 syncInkTip 随播放时钟驱动。 */
  function startInk(i) {
    const ps = ensureInkPaths(i);
    if (!ps.length) return;
    inkState[i] = 'writing';
    const lens = ps.map((p) => { try { return Math.max(1, p.getTotalLength()); } catch { return 1; } });
    const totalLen = lens.reduce((a, b) => a + b, 0) || 1;
    const totalDur = Math.round(Math.min(900, Math.max(300, 300 + 1.6 * totalLen)));
    let acc = 0;
    const segs = [];
    for (let k = 0; k < ps.length; k++) {
      const p = ps[k], len = lens[k];
      const dur = Math.max(60, Math.round(totalDur * len / totalLen));
      p.style.display = '';
      p.style.strokeDasharray = `${len} ${len}`;
      p.style.strokeDashoffset = String(len);
      try {
        p.getAnimations?.().forEach((a) => a.cancel());
        p.animate(
          [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
          { duration: dur, delay: acc, easing: 'ease-in-out', fill: 'both' }
        );
      } catch { p.style.strokeDashoffset = '0'; }
      segs.push({ path: p, len, start: acc, dur });
      acc += dur;
    }
    inkWriting[i] = { startPos: starts[i], total: acc, segs };
  }

  function finishInk() {
    if (!ensureInkLayer()) return;
    for (let i = 0; i < n; i++) {
      const ps = ensureInkPaths(i);
      inkState[i] = 'done';
      for (const p of ps) {
        p.style.display = '';
        try { p.getAnimations?.().forEach((a) => a.cancel()); } catch { /* 忽略 */ }
        p.style.strokeDashoffset = '0';
      }
    }
    try { inkTip.style.opacity = '0'; } catch { /* 忽略 */ }
  }

  const tlog = [];
  let firstReject = null;
  const emit = (ev) => {
    let r;
    try { r = api.handleSpeechPlaybackEvent({ ...pid, ...ev }); } catch (e) { r = { thrown: String(e && e.message) }; }
    if (r && r.then) {
      const p = r.then((v) => { tlog.push(`${Math.round(performance.now())} ${ev.type}→${JSON.stringify(v)}`); return v; })
        .catch((e) => { tlog.push(`${ev.type} rej ${e && e.message}`); });
      if (tlog.length > 160) tlog.splice(0, 60);
      window.__tutorTalk.log = tlog;
      return p;
    }
    tlog.push(`${Math.round(performance.now())} ${ev.type}→${JSON.stringify(r)}`);
    if (!firstReject && r && r.accepted === false) firstReject = `${ev.type}:${r.reason}`;
    if (tlog.length > 160) tlog.splice(0, 60);
    window.__tutorTalk.log = tlog;
    window.__tutorTalk.firstReject = firstReject;
    return Promise.resolve(r);
  };

  const segMarks = anim.segs.map((s2, i) => ({ name: s2.mark, offset_ms: starts[i] }));
  try { (window.__ad || (window.__ad = [])).push('MT ' + JSON.stringify(segMarks) + ' total=' + total + ' speech=' + !!speech); } catch { /* 忽略 */ }

  /* mark_timings 必须在 started 之前：setMarkTimings 会重算 speechDuration，
     duration_ms 必须是正有限数，否则 le() 返回 null、排期全失效。 */
  await emit({ type: 'mark_timings', marks: segMarks, duration_ms: total });
  await emit({ type: 'started', audio_ms: 0, playing: true, host_at_ms: Date.now() });

  const audio = new Audio();
  audio.preload = 'auto';
  audio.setAttribute('playsinline', '');
  let stop = false;
  window.__tutorStop = () => { stop = true; try { audio.pause(); } catch { /* 忽略 */ } forceReveal(); };
  if (speech) {
    try {
      audio.src = URL.createObjectURL(speech.blob);
      const pr = audio.play();
      if (pr && pr.catch) pr.catch(() => { /* 自动播放被拦：画面照走 */ });
    } catch { /* 忽略 */ }
  }

  /** 兜底：把仍被隐藏的块全部点亮，避免某段 mark 丢失导致板书缺一块。 */
  function forceReveal() {
    const B = document.getElementById('board');
    if (!B) return;
    B.querySelectorAll('.qb-play-hidden').forEach((el) => {
      el.classList.remove('qb-play-hidden');
      el.classList.add('qb-play-revealed');
    });
    /* 图形别留半张：把全部绘制元素点亮、动点停到终点 */
    syncFigure(Math.max(1, total));
    try { finishInk(); } catch { /* 忽略 */ }
  }
  const fireMark = (i) => {
    if (i < 0 || i >= n) return;
    emit({ type: 'mark', name: anim.segs[i].mark, event: 'MarkReached' });
    /* 图形跟着讲解走：只给这一段（按语义层）真正被描绘出来的元素
       来一下高亮脉冲，避免脉冲打在还没画出来的元素上 */
    try {
      const els = collectFig();
      for (let k = 0; k < els.length; k++) {
        const e = els[k];
        if (i !== Math.min(n - 1, figGroupOf(e))) continue;
        e.style.filter = 'drop-shadow(0 0 4px rgba(225,75,52,.85))';
        setTimeout(() => { try { e.style.filter = ''; } catch { /* 忽略 */ } }, 850);
      }
    } catch { /* 忽略 */ }
    /* 蓝色画笔：讲到这一段才把重点笔迹写出来 */
    try { startInk(i); } catch { /* 忽略 */ }
    try { (window.__ad || (window.__ad = [])).push('MARK m' + (i + 1) + ' @' + Math.round(performance.now())); } catch { /* 忽略 */ }
  };

  let t0 = performance.now();
  /* 调试/回放钩子：把播放位置拨到指定毫秒，便于验证逐段揭示 */
  window.__tutorSeek = (ms) => { t0 = performance.now() - Math.max(0, Number(ms) || 0); window.__tutorNoAudioSync = true; };
  let lastClock = -1;
  let lastReunit = -1;
  let lastFigSync = -1;
  let segIdx = 0;
  const tick = () => {
    if (stop || token !== lessonToken) return;
    let pos = performance.now() - t0;
    const ap = speech && audio.readyState >= 2 ? audio.currentTime * 1000 : -1;
    if (!window.__tutorNoAudioSync && ap >= 0 && Math.abs(ap - pos) > 350) pos = ap;

    /* 到点就发 mark：内核直接放行这一段的全部 show 效果 */
    while (segIdx < n && pos >= starts[segIdx]) { fireMark(segIdx); segIdx += 1; }
    window.__tutorAnim.stageIndex = segIdx;
    syncVisibility(pos);
    syncInk(pos, false);
    if (Math.abs(pos - lastFigSync) >= 110) { lastFigSync = pos; syncFigure(pos); }
    if (Math.abs(pos - lastReunit) >= 300) { lastReunit = pos; reunits(); syncInk(pos, true); }

    if (pos >= total) {
      while (segIdx < n) { fireMark(segIdx); segIdx += 1; }
      emit({ type: 'clock', audio_ms: Math.round(total), playing: true, host_at_ms: Date.now() });
      emit({ type: 'complete' });
      setTimeout(forceReveal, 500);
      window.__tutorAnim.done = true;
      window.__tutorAnim.stageIndex = n;
      return;
    }
    /* clock 只同步时间轴，200ms 一次足够；放行靠 mark */
    if (Math.abs(pos - lastClock) >= 200) {
      lastClock = pos;
      emit({ type: 'clock', audio_ms: Math.round(pos), playing: true, host_at_ms: Date.now() });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** 等内核真的把 play 建起来（拿到 play_exec_id 才算数） */
async function waitPlayExec(playId, ms = 2000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const list = window.__quizboardPlayExecutions || [];
    const hit = list.filter((x) => x && (!playId || x.play_id === playId)).pop();
    if (hit?.play_exec_id && hit.state !== 'completed') return hit;
    await sleep(40);
  }
  return null;
}

function stopSpeak() {
  try { window.speechSynthesis?.cancel(); } catch { /* 忽略 */ }
}

/* ── 完整板书 ───────────────────────────────────────────────────── */
async function renderFull(plan, question) {
  const board = $('board');
  setSceneWidth(board?.clientWidth || window.innerWidth);
  const doc = planToBoardScene({ ...plan, problem: question || plan.problem }, 'tutor');

  // 先撤掉内核的占位场景，再渲染真实文档；否则进度层会盖在板书上
  api.setOpeningPreparationProgress({ visible: false, steps: [], skeletonHeight: 0 });
  rows = [];

  const anim = buildPlay(doc, plan.steps || []);

  /* 先用普通 renderDoc 把完整版式铺好（并让 board_embed 记下 __lastBoardDoc）。
     带 initialPlay 的 showBoardDoc 必须放到 play 建立**之后**：R.run 开头会
     settlePlayEffects() 把 .qb-play-hidden 全部清掉，早渲染等于白隐藏。 */
  await api.renderDoc(doc);
  /* 讲题开始前先别把整张图摊开：等 play 建立、initFigure() 接管分层描绘 */
  const earlyFig = document.querySelector('#board svg.boardggb-svg');
  if (earlyFig) earlyFig.style.opacity = '0';
  if (anim) {
    anim._fullDoc = doc;
    anim._baseText = (document.getElementById('board')?.innerText || '').replace(/\s+/g, '').length;
  }

  currentPlan = plan;
  $('session-title').textContent = String(plan?.title || '讲解').slice(0, 30);
  inFlight = false;
  window.__tutorRendered = {
    blocks: doc.blocks?.length || 0,
    figures: (doc.blocks || []).filter((b) => b.type === 'figure').length,
    width: doc.width,
  };

  window.__tutorAnim = { ...(anim || {}), startedAt: Date.now(), done: !anim, stageIndex: 0 };
  if (!anim) return;

  /* 逐段播放：起始文档已就位 → play 建立 → 拿到 play_exec_id → 音频时钟推进 */
  /* 注意：内核这个 Promise 要到整段 play 播完才 resolve（它在等 mark/complete）。
     这里**绝不能 await**，否则时钟自己永远起不来 —— 动画不动就是栽在这。 */
  try {
    const pr = api.handleRuntimeMessage({ type: 'play', scope: 'board', play: anim.play, doc });
    if (pr && pr.catch) pr.catch(() => {});
  } catch { /* 内核拒播时走纯渲染，页面不白屏 */ }
  await playLesson(anim, api, doc, anim.play.id);
}

/* ── 主流程 ─────────────────────────────────────────────────────── */
async function run(question) {
  const q = String(question || '').trim();
  if (!q || !api || inFlight) return;
  await startSession(q);
  applyStage({ key: 'received', completed: true });   // 题目真的到手了
  try {
    const plan = await explainStream(q);
    applyStage({ key: 'board', completed: true });     // 板书内容已生成
    await renderFull(plan, q);
    remember(q);
  } catch (e) {
    toast(e?.message || '讲解失败，请重试', true);
    setTimeout(endSession, 900);
  }
}


/* ── 拍照 / 选图后的裁切 ──────────────────────────────────────────
   纯前端 Canvas，不引第三方库（iPad Safari 也要能用）：
   选图 → 全屏弹层框选题目区域 → canvas 裁切 + 压缩 → 再把 File 交给 OCR。
   返回：确认 = 裁切后的 File；「使用原图」= 原始 file；取消 = null。
   顺带解决两件事：整张卷子拍照时 OCR 容易认错行、原图几 MB 上传慢。 */
let cropBusy = false;
const CROP_CSS = `
.tc-mask{position:fixed;inset:0;z-index:99999;background:rgba(24,20,15,.88);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
.tc-panel{width:min(960px,100%);height:min(780px,100%);background:#fffdf8;border-radius:18px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.45)}
.tc-head{padding:14px 18px;border-bottom:1px solid #e7e1d4;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-shrink:0}
.tc-title{font-size:17px;font-weight:700;color:#241f18}
.tc-hint{font-size:13px;color:#8a8172;margin-top:4px;line-height:1.5}
.tc-x{width:40px;height:40px;border:0;border-radius:10px;background:#f1ede3;color:#5c5446;font-size:20px;cursor:pointer;flex-shrink:0}
.tc-stage{position:relative;flex:1;min-height:0;background:#1c1915;overflow:hidden;touch-action:none}
.tc-stage img{position:absolute;user-select:none;-webkit-user-drag:none;pointer-events:none}
.tc-box{position:absolute;border:2px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,.58);box-sizing:border-box;touch-action:none;cursor:move}
.tc-grid{position:absolute;inset:0;pointer-events:none}
.tc-grid i{position:absolute;background:rgba(255,255,255,.32)}
.tc-grid i.v{top:0;bottom:0;width:1px}
.tc-grid i.h{left:0;right:0;height:1px}
.tc-h{position:absolute;width:18px;height:18px;background:#fff;border:2px solid #2563d9;border-radius:5px;box-sizing:border-box}
.tc-h[data-h=nw]{left:-10px;top:-10px;cursor:nwse-resize}.tc-h[data-h=n]{left:calc(50% - 9px);top:-10px;cursor:ns-resize}
.tc-h[data-h=ne]{right:-10px;top:-10px;cursor:nesw-resize}.tc-h[data-h=e]{right:-10px;top:calc(50% - 9px);cursor:ew-resize}
.tc-h[data-h=se]{right:-10px;bottom:-10px;cursor:nwse-resize}.tc-h[data-h=s]{left:calc(50% - 9px);bottom:-10px;cursor:ns-resize}
.tc-h[data-h=sw]{left:-10px;bottom:-10px;cursor:nesw-resize}.tc-h[data-h=w]{left:-10px;top:calc(50% - 9px);cursor:ew-resize}
.tc-foot{display:flex;gap:10px;justify-content:flex-end;padding:12px 16px;border-top:1px solid #e7e1d4;flex-wrap:wrap;flex-shrink:0}
.tc-btn{min-height:46px;padding:0 18px;border-radius:12px;border:1px solid #e7e1d4;background:#fff;color:#241f18;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit}
.tc-btn.primary{background:#2563d9;border-color:#2563d9;color:#fff}
.tc-btn:active{transform:scale(.97)}
@media (max-width:680px){.tc-panel{height:100%}.tc-foot{justify-content:stretch}.tc-btn{flex:1;padding:0 8px;font-size:14px}.tc-hint{font-size:12px}}
`;

function openCropper(file) {
  return new Promise((resolve) => {
    if (cropBusy || !file) { resolve(null); return; }
    cropBusy = true;
    const urls = [];
    const u0 = URL.createObjectURL(file);
    urls.push(u0);

    if (!document.getElementById('tc-style')) {
      const st = document.createElement('style');
      st.id = 'tc-style';
      st.textContent = CROP_CSS;
      document.head.appendChild(st);
    }
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const mask = document.createElement('div');
    mask.className = 'tc-mask';
    mask.innerHTML = `
      <div class="tc-panel">
        <div class="tc-head">
          <div><div class="tc-title">框选题目区域</div>
            <div class="tc-hint">拖动白框或四角，只保留要识别的那一道题；确认后会裁切并压缩再上传</div></div>
          <button class="tc-x" type="button" aria-label="关闭">✕</button>
        </div>
        <div class="tc-stage" id="tc-stage">
          <img id="tc-img" alt="待裁切的照片" />
          <div class="tc-box" id="tc-box">
            <div class="tc-grid"><i class="v" style="left:33.33%"></i><i class="v" style="left:66.66%"></i><i class="h" style="top:33.33%"></i><i class="h" style="top:66.66%"></i></div>
            <div class="tc-h" data-h="nw"></div><div class="tc-h" data-h="n"></div><div class="tc-h" data-h="ne"></div><div class="tc-h" data-h="e"></div>
            <div class="tc-h" data-h="se"></div><div class="tc-h" data-h="s"></div><div class="tc-h" data-h="sw"></div><div class="tc-h" data-h="w"></div>
          </div>
        </div>
        <div class="tc-foot">
          <button class="tc-btn" type="button" data-act="cancel">取消</button>
          <button class="tc-btn" type="button" data-act="rotate">旋转 90°</button>
          <button class="tc-btn" type="button" data-act="reset">重置</button>
          <button class="tc-btn" type="button" data-act="raw">使用原图</button>
          <button class="tc-btn primary" type="button" data-act="ok">确认裁切并识别</button>
        </div>
      </div>`;
    document.body.appendChild(mask);

    const stage = mask.querySelector('#tc-stage');
    const img = mask.querySelector('#tc-img');
    const box = mask.querySelector('#tc-box');
    let geom = null;
    let bx = 0, by = 0, bw = 0, bh = 0;
    let drag = null;
    const MIN = 64;
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

    function measure() {
      const vw = stage.clientWidth, vh = stage.clientHeight;
      const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
      const scale = Math.min(vw / iw, vh / ih);
      const dw = iw * scale, dh = ih * scale;
      const ox = (vw - dw) / 2, oy = (vh - dh) / 2;
      img.style.width = dw + 'px';
      img.style.height = dh + 'px';
      img.style.left = ox + 'px';
      img.style.top = oy + 'px';
      geom = { scale, ox, oy, dw, dh };
    }
    function applyBox() {
      box.style.left = bx + 'px';
      box.style.top = by + 'px';
      box.style.width = bw + 'px';
      box.style.height = bh + 'px';
    }
    function resetBox() {
      measure();
      const g = geom;
      bx = g.ox + g.dw * 0.06; by = g.oy + g.dh * 0.05;
      bw = g.dw * 0.88; bh = g.dh * 0.78;
      applyBox();
    }
    function onResize() {
      if (!geom || drag) return;
      const old = geom;
      const sx = (bx - old.ox) / old.scale, sy = (by - old.oy) / old.scale;
      const sw = bw / old.scale, sh = bh / old.scale;
      measure();
      const g = geom;
      bx = g.ox + sx * g.scale; by = g.oy + sy * g.scale;
      bw = sw * g.scale; bh = sh * g.scale;
      bx = clamp(bx, g.ox, g.ox + g.dw - bw);
      by = clamp(by, g.oy, g.oy + g.dh - bh);
      applyBox();
    }
    function onDown(e) {
      const h = e.target?.dataset?.h || '';
      drag = { x: e.clientX, y: e.clientY, bx, by, bw, bh, h };
      e.preventDefault();
    }
    function onMove(e) {
      if (!drag || !geom) return;
      const g = geom, dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.h) {
        bx = clamp(drag.bx + dx, g.ox, g.ox + g.dw - drag.bw);
        by = clamp(drag.by + dy, g.oy, g.oy + g.dh - drag.bh);
        bw = drag.bw; bh = drag.bh;
      } else {
        let l = drag.bx, t = drag.by, r = drag.bx + drag.bw, b = drag.by + drag.bh;
        if (drag.h.includes('w')) l = clamp(drag.bx + dx, g.ox, r - MIN);
        if (drag.h.includes('e')) r = clamp(drag.bx + drag.bw + dx, l + MIN, g.ox + g.dw);
        if (drag.h.includes('n')) t = clamp(drag.by + dy, g.oy, b - MIN);
        if (drag.h.includes('s')) b = clamp(drag.by + drag.bh + dy, t + MIN, g.oy + g.dh);
        bx = l; by = t; bw = r - l; bh = b - t;
      }
      applyBox();
      e.preventDefault();
    }
    function onUp() { drag = null; }
    function onKey(e) { if (e.key === 'Escape') finish(null); }

    box.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKey);

    function finish(result) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = oldOverflow;
      mask.remove();
      urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch { /* 忽略 */ } });
      cropBusy = false;
      resolve(result);
    }

    function canvasBlob(cv) {
      return new Promise((res) => {
        if (cv.toBlob) { cv.toBlob((b) => res(b), 'image/jpeg', 0.9); return; }
        try {
          const d = cv.toDataURL('image/jpeg', 0.9);
          const bin = atob(d.split(',')[1]);
          const a = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
          res(new Blob([a], { type: 'image/jpeg' }));
        } catch { res(null); }
      });
    }
    async function doRotate() {
      const c = document.createElement('canvas');
      c.width = img.naturalHeight; c.height = img.naturalWidth;
      const cx = c.getContext('2d');
      cx.translate(c.width, 0); cx.rotate(Math.PI / 2);
      cx.drawImage(img, 0, 0);
      const blob = await canvasBlob(c);
      if (!blob) { toast('旋转失败，可以点「使用原图」', true); return; }
      const u = URL.createObjectURL(blob);
      urls.push(u);
      img.onload = () => resetBox();
      img.src = u;
    }
    async function doCrop() {
      if (!geom) { finish(file); return; }
      const g = geom;
      const sx = clamp((bx - g.ox) / g.scale, 0, img.naturalWidth);
      const sy = clamp((by - g.oy) / g.scale, 0, img.naturalHeight);
      const sw = clamp(bw / g.scale, 1, img.naturalWidth - sx);
      const sh = clamp(bh / g.scale, 1, img.naturalHeight - sy);
      const k = Math.min(1, 2200 / Math.max(sw, sh));
      const cw = Math.max(1, Math.round(sw * k)), ch = Math.max(1, Math.round(sh * k));
      const cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, cw, ch);
      try { cx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch); }
      catch { toast('裁切失败，已改用原图', true); finish(file); return; }
      const blob = await canvasBlob(cv);
      finish(blob ? new File([blob], 'photo-crop.jpg', { type: 'image/jpeg' }) : file);
    }

    mask.addEventListener('click', (e) => {
      const act = e.target?.dataset?.act;
      if (e.target?.classList?.contains('tc-x')) { finish(null); return; }
      if (act === 'cancel') finish(null);
      else if (act === 'raw') finish(file);
      else if (act === 'reset') resetBox();
      else if (act === 'rotate') doRotate();
      else if (act === 'ok') doCrop();
    });

    img.onload = () => resetBox();
    img.onerror = () => {
      // HEIC 等浏览器打不开的格式：不阻断流程，退回原图
      toast('这张图浏览器预览不了，已按原图识别', true);
      finish(file);
    };
    img.src = u0;
  });
}

async function runWithFile(file) {
  if (!file || !api || inFlight || cropBusy) return;
  /* 先让用户框选题目区域，再上传；取消就什么都不做，不会留下空会话 */
  const picked = await openCropper(file);
  if (!picked) return;
  await startSession('');                              // 左栏先出三条题目骨架
  applyStage({ key: 'received', completed: true });   // 照片已收到
  try {
    const q = await ocr(picked);
    currentQuestion = q;
    $('session-title').textContent = q.replace(/\s+/g, ' ').slice(0, 30);
    await showLoading(q);                              // 题目渐现（骨架 → 真文字）
    applyStage({ key: 'reading', completed: true });  // OCR 真的返回了
    const plan = await explainStream(q);
    applyStage({ key: 'board', completed: true });
    await renderFull(plan, q);
    remember(q);
  } catch (e) {
    toast(e?.message || '识别失败，请重试', true);
    setTimeout(endSession, 900);
  }
}

/* ── 离线样题：不调后端，直接出完整欧拉板书（用于快速核对视觉） ──── */
const DEMO = {
  title: '圆上动点向量数量积最小值',
  problem:
    '已知圆 $C:(x-1)^2+(y-\\sqrt{3})^2=1$，点 $A(\\sqrt{3},1)$，$P$ 为圆上动点，\n求 $\\overrightarrow{CP}\\cdot\\overrightarrow{OA}$ 的最小值。',
  think: ['看到「数量积最小」，先想能不能把动点方向单独拎出来。', '什么时候两个向量夹角的余弦最小？'],
  steps: [
    {
      index: 1, title: '建系与定点',
      text: '先把坐标系、圆心 $C(1,\\sqrt{3})$ 和定点 $A(\\sqrt{3},1)$ 画出来。',
      board: [
        { op: 'axis', xmin: -1, xmax: 4, ymin: -1, ymax: 4 },
        { op: 'circle', cx: 1, cy: 1.73, r: 1 },
        { op: 'point', name: 'O', x: 0, y: 0 },
        { op: 'point', name: 'C', x: 1, y: 1.73 },
        { op: 'point', name: 'A', x: 1.73, y: 1 },
        { op: 'line', from: [0, 0], to: [1.73, 1], label: 'OA', dash: true },
      ],
    },
    {
      index: 2, title: '设动点并连向量',
      text: '设 $P$ 在圆上，连 $\\overrightarrow{CP}$ 与 $\\overrightarrow{OA}$。',
      board: [
        { op: 'orbit', name: 'P', cx: 1, cy: 1.73, r: 1, from: 0, to: 360 },
        { op: 'vector', from: 'C', to: 'P', label: 'CP' },
        { op: 'polygon', points: ['O', 'A', 'P'], fill: 'none' },
      ],
    },
    {
      index: 3, title: '求最小值',
      text: '当 $\\overrightarrow{CP}$ 与 $\\overrightarrow{OA}$ 反向时取最小。',
      board: [
        { op: 'move', name: 'P', to: [0.13, 1.73] },
        { op: 'angle', at: 'C', label: '180°', x: 0.5, y: 2.0 },
      ],
    },
  ],
  keyMethod: '把动向量投影到定向量方向，最值在共线反向时取到',
  pitfall: { wrong: '直接对坐标求导', right: '用投影定方向再算模长' },
  answer: '$\\sqrt{5-2\\sqrt{3}}$',
};

async function showDemo() {
  if (!api || inFlight) return;
  await startSession(DEMO.problem.replace(/\s+/g, ' ').slice(0, 30));
  rows = ORDER.map((k) => ({ key: k, label: LABELS[k].done, completed: true }));
  pushProgress(true);
  await sleep(420);   // 样题是离线直出，留一帧让完整清单可见
  try { await renderFull(DEMO, DEMO.problem); }
  catch (e) { toast(e?.message || '样题渲染失败', true); endSession(); }
}

/* ── 历史 ───────────────────────────────────────────────────────── */
const readHistory = () => {
  try {
    const v = JSON.parse(localStorage.getItem('tutor-history') || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 6) : [];
  } catch { return []; }
};
function remember(q) {
  const next = [q, ...readHistory().filter((x) => x !== q)].slice(0, 6);
  try { localStorage.setItem('tutor-history', JSON.stringify(next)); } catch { /* 忽略 */ }
  drawHistory();
}
function drawHistory() {
  const box = $('history');
  if (!box) return;
  const list = readHistory();
  box.replaceChildren();
  for (const q of list) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = q.replace(/\s+/g, ' ').slice(0, 26);
    b.title = q;
    b.onclick = () => { $('question').value = q; run(q); };
    box.appendChild(b);
  }
}

/* ── 事件绑定 ───────────────────────────────────────────────────── */
function bind() {
  $('btn-home-back').onclick = () => { window.location.href = '/'; };
  $('btn-back').onclick = () => endSession();
  $('btn-again').onclick = () => {
    const q = currentQuestion || $('question').value;
    endSession();
    setTimeout(() => { if (q) run(q); }, 60);
  };

  const pick = (inputId) => $(inputId)?.click();
  $('btn-camera').onclick = () => pick('file-camera');
  $('mini-camera').onclick = () => pick('file-camera');
  $('btn-gallery').onclick = () => pick('file-gallery');
  $('mini-gallery').onclick = () => pick('file-gallery');
  $('file-camera').onchange = (e) => { const f = e.target.files?.[0]; if (f) runWithFile(f); e.target.value = ''; };
  $('file-gallery').onchange = (e) => { const f = e.target.files?.[0]; if (f) runWithFile(f); e.target.value = ''; };

  $('btn-send').onclick = () => run($('question').value);
  $('question').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run($('question').value); }
  });
  $('btn-demo').onclick = () => showDemo();
  $('btn-clear-history').onclick = () => {
    try { localStorage.removeItem('tutor-history'); } catch { /* 忽略 */ }
    drawHistory();
  };

  // 视口变化后按新宽度重排（内核自己也会重排，这里补一次画布宽度）
  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (currentPlan && api && document.body.classList.contains('in-session')) {
        const board = $('board');
        setSceneWidth(board?.clientWidth || window.innerWidth);
        const doc = planToBoardScene({ ...currentPlan, problem: currentQuestion || currentPlan.problem }, 'tutor');
        api.renderDoc(doc).catch(() => {});
      }
    }, 260);
  });
}

/* ── 启动：等内核 ready（board_embed.mjs 顶层 await，兄弟 module 不保证顺序） ── */
async function boot() {
  // UI 先绑好：万一登录态校验没过，左上角「返回主站」仍然可点，不会把人困死
  bind();
  drawHistory();

  /* 登录态必须由服务端判定。keyi_token 是 httpOnly，JS 读不到；
     只看 localStorage 会把「靠 cookie 登录」的已登录用户误判成未登录，
     紧接着 replace('/') —— 表现就是点进 AI 实验室又被弹回首页。 */
  let loggedIn = false;
  try {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin', headers: authHeaders() });
    loggedIn = r.ok;
  } catch { loggedIn = false; }
  if (!loggedIn) {
    const hint = $('boot-hint');
    if (hint) hint.textContent = '登录已失效，请点左上角返回主站重新登录';
    toast('登录已失效，请返回主站重新登录', true);
    return;
  }

  for (let i = 0; i < 400 && !window.__quizboardReady; i++) await sleep(100);
  if (!window.__quizboardReady) {
    const hint = $('boot-hint');
    if (hint) hint.textContent = '白板加载失败，请刷新页面重试';
    toast('白板内核加载失败，请刷新重试', true);
    return;
  }
  api = await window.__quizboardReady;
  window.__tutorApi = api;
  // 内核就绪后才放开首页动作，避免首屏资源加载期间点了没反应
  document.querySelectorAll('.entry, .send, #btn-demo, #mini-camera, #mini-gallery')
    .forEach((el) => { el.disabled = false; });
  $('boot-hint')?.classList.add('hidden');
  window.__tutorReady = true;

  // URL 带 ?q= 时直接开讲（便于从站内其它页面深链）
  const q = new URLSearchParams(location.search).get('q');
  if (q) { $('question').value = q; run(q); }
}

/* [2026-11-12] 把已验证的 Canvas 裁剪器暴露给同页的「云端讲解视频」面板复用，
   避免复制一份逻辑。openCropper 返回 Promise<File|null>：确认=裁切后 File，
   「使用原图」=原始 File，取消=null。面板在点击时才读取，加载顺序不影响。 */
window.__openCropper = openCropper;

boot();
