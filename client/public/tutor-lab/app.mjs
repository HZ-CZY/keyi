/**
 * /tutor-lab · 刻忆 AI 实验室（对话式）
 * ─────────────────────────────────────────────────────────────
 * 只支持「发送图片」这一种输入：拍照 / 相册 → 框选题目 → 发送 →
 * 对话里出现排队气泡 → 讲好的视频作为一条新消息发回对话框。
 * 不加载旧白板内核，裁剪器从 host.mjs 抽出为独立 cropper.mjs。
 */
import openCropper from './cropper.mjs';

const API = '/api/lesson-video';
const $ = (id) => document.getElementById(id);

const state = {
  jobs: [],                 // 按 created_at 升序
  groups: new Map(),        // id -> { el, ai, userImg, bar, barMeta, lastMode, videoUrl }
  pending: null,            // { file, url }
  sending: false,
  pollTimer: 0,
  /* 「新对话」只是一个视图起点：比它早的任务收进历史抽屉，不删除、不重排。
     存在 sessionStorage 里，刷新页面仍停在这次新对话，超过 12 小时自动回到全部。 */
  sessionStart: 0,
};

/* ── 基础工具 ───────────────────────────────────────────────────── */
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2400);
}

function fmtBytes(n) {
  if (!n) return '';
  return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${mm}`;
}

function authHeaders() {
  const t = localStorage.getItem('token') || '';
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function api(url, options = {}) {
  const r = await fetch(API + url, {
    credentials: 'same-origin',
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  let data = null;
  try { data = await r.json(); } catch { /* 非 JSON */ }
  if (!r.ok) throw new Error(data?.error || `请求失败 (${r.status})`);
  return data;
}

/* 【2026-11-12】deferred = 同题合并：同一道题已有人在讲，不占队位，等成片复用 */
const isPending = (j) => j.status === 'queued' || j.status === 'running' || j.status === 'deferred';

/* ── 对话渲染 ───────────────────────────────────────────────────── */
function ensureGroup(j) {
  let g = state.groups.get(j.id);
  if (g) return g;
  const el = document.createElement('div');
  el.className = 'group';
  el.dataset.id = j.id;
  el.innerHTML = `
    <div class="group-time">${fmtTime(j.created_at)}</div>
    <div class="msg-user">
      <div class="bubble user"><img alt="题目图片" /></div>
    </div>
    <div class="msg-ai">
      <div class="avatar"><img src="/brain.svg" alt="刻忆" /></div>
      <div class="bubble ai"></div>
    </div>`;
  const img = el.querySelector('.bubble.user img');
  img.dataset.src = j.image_url || '';
  img.src = j.image_url || '';
  img.addEventListener('click', () => showImage(img.src));
  g = {
    el,
    ai: el.querySelector('.bubble.ai'),
    img,
    bar: null,
    barMeta: null,
    cancelBtn: null,
    lastMode: '',
    videoUrl: '',
  };
  state.groups.set(j.id, g);
  $('thread').appendChild(el);
  return g;
}

/* 排队气泡：先把骨架建好，之后每 2.5s 只改文字，避免整块重绘闪一下。
   注意「Agent正在讲题中」只在 running 时出现 —— 排队阶段说这句，
   学生会以为已经开讲、以为卡住了。 */
function setPendingBubble(g) {
  g.ai.className = 'bubble ai';
  g.ai.innerHTML = `
    <div class="q-main"></div>
    <div class="q-sub"></div>
    <div class="agent-line">
      <span class="spinner"></span><span class="agent-text"></span>
      <span class="typing" hidden><i></i><i></i><i></i></span>
    </div>
    <div class="bar"><i></i></div>
    <div class="bar-meta"></div>
    <button class="cancel-btn" type="button" hidden>取消这次排队</button>`;
  g.qMain = g.ai.querySelector('.q-main');
  g.qSub = g.ai.querySelector('.q-sub');
  g.agentText = g.ai.querySelector('.agent-text');
  g.typing = g.ai.querySelector('.typing');
  g.barBox = g.ai.querySelector('.bar');
  g.bar = g.ai.querySelector('.bar i');
  g.barMeta = g.ai.querySelector('.bar-meta');
  g.cancelBtn = g.ai.querySelector('.cancel-btn');
  g.cancelBtn.onclick = () => cancelJob(g.el.dataset.id);
  g.lastMode = 'pending';
}

function fmtWait(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m <= 0) return '不到 1 分钟';
  if (m < 60) return `约 ${m} 分钟`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `约 ${h} 小时 ${r} 分钟` : `约 ${h} 小时`;
}

function updatePendingBubble(g, j) {
  const ahead = Math.max(0, Number(j.queue_ahead) || 0);
  if (j.status === 'deferred') {
    g.qMain.textContent = '这道题已经有人在讲';
    g.qSub.textContent = '同一个老师讲一遍就够，成片直接发给你，不用重新排队、也不用再拍一次';
    g.agentText.textContent = '同题合并 · 等成片';
    g.typing.hidden = true;
    g.barBox.hidden = true;
    g.barMeta.textContent = '不占用排队名额';
    g.cancelBtn.hidden = true;
    return;
  }
  if (j.status === 'queued') {
    g.qMain.textContent = '正在排队';
    g.qSub.textContent = ahead > 0
      ? `前方还有 ${ahead} 位同学，预计等待${fmtWait(j.est_wait_minutes)}`
      : '马上就轮到你，先别关页面';
    g.agentText.textContent = '排队中 · 还没开始讲';
    g.typing.hidden = true;
    g.barBox.hidden = true;                 // 排队阶段没有真实进度，别画 0%
    const pos = Number(j.queue_position) || 0;
    const len = Number(j.queue_length) || 0;
    g.barMeta.textContent = pos > 0 ? `你的位置：第 ${pos} 位 / 共 ${len} 位` : '';
    g.cancelBtn.hidden = false;
  } else {
    g.qMain.textContent = '轮到你了';
    g.qSub.textContent = `Agent 正在讲这道题，预计${fmtWait(j.est_remain_minutes || 15)}`;
    g.agentText.textContent = 'Agent正在讲题中';
    g.typing.hidden = false;
    g.barBox.hidden = false;
    const p = Math.max(0, Math.min(100, Number(j.progress) || 0));
    g.bar.style.width = p + '%';
    g.barMeta.textContent = `${p}%`;
    g.cancelBtn.hidden = true;              // 已开讲的任务不能取消
  }
}

function setDoneBubble(g, j) {
  const url = j.video_url || `/api/lesson-video/jobs/${j.id}/video`;
  if (g.lastMode === 'done' && g.videoUrl === url) return;
  const compressed = j.original_bytes && j.bytes && j.original_bytes > j.bytes
    ? ` · 已压缩 ${fmtBytes(j.original_bytes)} → ${fmtBytes(j.bytes)}`
    : '';
  g.ai.className = 'bubble ai';
  g.ai.innerHTML = `
    <div class="done-title">讲好啦，视频发给你</div>
    <div class="video-box">
      <video controls playsinline preload="metadata" src="${url}"></video>
    </div>
    <div class="video-meta">${fmtBytes(j.bytes) || '成片已就绪'}${compressed}</div>
    <a class="dl-btn" href="${url}?download=1" download="lesson-${j.id}.mp4">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>
      </svg>下载视频
    </a>`;
  const v = g.ai.querySelector('video');
  const meta = g.ai.querySelector('.video-meta');
  v.addEventListener('loadedmetadata', () => {
    if (!isFinite(v.duration)) return;
    const s = Math.round(v.duration);
    meta.textContent = `时长 ${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒 · `
      + (fmtBytes(j.bytes) || '成片已就绪') + compressed;
  });
  g.lastMode = 'done';
  g.videoUrl = url;
}

function setFinalBubble(g, j) {
  /* 管理员让出资源 vs 自己取消，是两种状态，文案不同 */
  const adminCancel = j.status === 'canceled' && j.stage_key === 'admin_cancel';
  /* 【2026-11-12】中断原因分两类：题目较简单 / 请上传单题（整页练习册） */
  const reason = j.cancel_reason === 'single' ? 'single' : 'simple';
  const mode = adminCancel ? 'admin_cancel:' + reason : j.status;
  if (g.lastMode === mode) return;
  g.ai.className = 'bubble ai' + (j.status === 'failed' ? ' fail' : '');
  if (adminCancel) {
    g.ai.innerHTML = reason === 'single'
      ? '<div class="q-main">请上传单题</div>'
        + '<div class="q-sub">一次只讲一道题，整张练习册我讲不过来，裁成单题再拍一张就好</div>'
      : '<div class="q-main">这次先不讲了</div>'
        + '<div class="q-sub">监测到题目较简单，请把资源让给更需要的同学</div>';
  } else if (j.status === 'canceled') {
    g.ai.innerHTML = '<div class="q-main">这次已取消</div>'
      + '<div class="q-sub">想讲的时候，再拍一张发给我</div>';
  } else if (j.status === 'failed' && j.reject_kind) {
    /* 【2026-11-12】题图被 App 拒绝：科目不支持 / 题干被截断。
       以前一律说“这次没讲完，稍后再试”，学生不知道改哪儿，会原图再拍一次。 */
    g.ai.innerHTML = j.reject_kind === 'subject'
      ? '<div class="q-main">这道题讲不了</div>'
        + '<div class="q-sub">目前能讲数学和物理，化学、生物这类暂时还讲不了</div>'
      : '<div class="q-main">题目没拍全</div>'
        + '<div class="q-sub">题干或小问被截掉了，把整道题连同小问一起拍进来，再发一次</div>';
  } else {
    g.ai.innerHTML = '<div class="q-main">这次没讲完</div>'
      + '<div class="q-sub">稍后再拍一张试试，我会重新排队</div>';
  }
  g.lastMode = mode;
}

function renderJob(j) {
  const g = ensureGroup(j);
  if (g.img.dataset.src !== (j.image_url || '')) {
    g.img.dataset.src = j.image_url || '';
    g.img.src = j.image_url || '';
  }
  if (isPending(j)) {
    if (g.lastMode !== 'pending') setPendingBubble(g);
    updatePendingBubble(g, j);
  } else if (j.status === 'done') {
    setDoneBubble(g, j);
  } else {
    setFinalBubble(g, j);
  }
}

function render() {
  const all = state.jobs.slice().sort((a, b) => a.created_at - b.created_at);
  const list = all.filter((j) => j.created_at >= state.sessionStart);

  /* 新对话会把旧任务移出视野，对应的 DOM 也要真的移除，
     否则它们还留在 thread 里，只是没人更新。 */
  const keep = new Set(list.map((j) => j.id));
  for (const [id, g] of [...state.groups]) {
    if (!keep.has(id)) {
      g.el.remove();
      state.groups.delete(id);
    }
  }

  $('hero').hidden = list.length > 0;
  $('thread').hidden = list.length === 0;
  for (const j of list) renderJob(j);
  renderDrawer(all.slice().reverse());
}

function scrollBottom(smooth = true) {
  const s = $('stage');
  s.scrollTo({ top: s.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

/* ── 历史抽屉 ───────────────────────────────────────────────────── */
const HIST_TEXT = {
  queued: '排队中', running: 'Agent正在讲题中', deferred: '同题合并 · 等成片',
  done: '已讲好，视频可回看', failed: '这次没讲完', canceled: '已取消',
};

function histText(j) {
  if (j.status === 'failed' && j.reject_kind) {
    return j.reject_kind === 'subject' ? '化学/生物 · 没讲' : '题目没拍全 · 没讲';
  }
  if (j.status === 'canceled' && j.stage_key === 'admin_cancel') {
    return j.cancel_reason === 'single' ? '未裁成单题 · 已让出' : '题目较简单 · 已让出';
  }
  if (j.status === 'queued') {
    const ahead = Math.max(0, Number(j.queue_ahead) || 0);
    return ahead > 0 ? `排队中 · 前方 ${ahead} 位` : '排队中 · 即将开始';
  }
  return HIST_TEXT[j.status] || j.status;
}

let drawerSig = null;

function renderDrawer(list) {
  /* 2.5s 轮询一次，如果只是同一个状态，不必整块重建 —— 否则抽屉里的
     滚动位置和缩略图会被反复重置。 */
  const sig = list.map((j) => `${j.id}:${j.status}:${j.queue_ahead || 0}`).join('|');
  if (sig === drawerSig) return;
  drawerSig = sig;

  const box = $('drawer-list');
  if (!list.length) {
    box.innerHTML = '<div class="drawer-empty">还没有记录，拍一道题开始吧</div>';
    return;
  }
  box.innerHTML = list.map((j) => `
    <button class="hist" data-id="${j.id}">
      <img src="${j.image_url || ''}" alt="" loading="lazy" />
      <span class="hist-txt"><b>${fmtTime(j.created_at)}</b><small>${histText(j)}</small></span>
      <span class="hist-dot s-${j.status}"></span>
    </button>`).join('');
  box.querySelectorAll('.hist').forEach((b) => {
    b.onclick = () => {
      closeDrawer();
      let g = state.groups.get(b.dataset.id);
      if (!g) {
        /* 点的是「新对话」之前的老记录：把时间线拉回全部，再定位过去 */
        state.sessionStart = 0;
        try { sessionStorage.removeItem('tl_session_start'); } catch { /* ignore */ }
        render();
        g = state.groups.get(b.dataset.id);
      }
      if (g) g.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  });
}

function openDrawer() {
  $('drawer').classList.add('open');
  $('drawer-mask').classList.add('on');
}
function closeDrawer() {
  $('drawer').classList.remove('open');
  $('drawer-mask').classList.remove('on');
}

/* ── 队列刷新 ───────────────────────────────────────────────────── */
function syncPolling() {
  const need = state.jobs.some(isPending);
  if (need && !state.pollTimer) {
    state.pollTimer = setInterval(refresh, 2500);
  } else if (!need && state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = 0;
  }
}

async function refresh(scrollOnDone = false) {
  try {
    const { jobs } = await api('/jobs');
    const beforeDone = new Set(state.jobs.filter((j) => j.status === 'done').map((j) => j.id));
    const map = new Map(state.jobs.map((j) => [j.id, j]));
    for (const j of jobs) map.set(j.id, j);
    state.jobs = [...map.values()];
    render();
    const newDone = state.jobs.find((j) =>
      j.status === 'done' && !beforeDone.has(j.id) && j.created_at >= state.sessionStart);
    if (scrollOnDone && newDone) scrollBottom();
    syncPolling();
  } catch (e) {
    if (/未登录|401|身份验证/.test(e.message)) {
      toast('请先登录刻忆，再回来讲题');
    } else if (!state.jobs.length) {
      $('hero').hidden = false;
      $('thread').hidden = true;
    }
  }
}

/* ── 选图 / 裁剪 / 发送 ─────────────────────────────────────────── */
function updateSend() {
  const b = $('btn-send');
  b.disabled = !state.pending || state.sending;
  b.className = 'send' + (state.sending ? ' busy' : state.pending ? ' ready' : '');
  $('btn-camera').disabled = state.sending;
  $('btn-gallery').disabled = state.sending;
}

function clearPending() {
  if (state.pending) {
    try { URL.revokeObjectURL(state.pending.url); } catch { /* ignore */ }
  }
  state.pending = null;
  $('pending').hidden = true;
  $('pending-img').removeAttribute('src');
  updateSend();
}

function setPending(file) {
  clearPending();
  state.pending = { file, url: URL.createObjectURL(file) };
  $('pending-img').src = state.pending.url;
  $('pending').hidden = false;
  updateSend();
}

async function handleFile(file) {
  if (!file || state.sending) return;
  if (!file.type.startsWith('image/')) { toast('请选择图片文件'); return; }
  let picked;
  try { picked = await openCropper(file); } catch { picked = file; }
  if (!picked) return;                     // 用户取消框选
  setPending(picked);
}

async function submit() {
  if (!state.pending || state.sending) return;
  state.sending = true;
  updateSend();
  const file = state.pending.file;
  try {
    const fd = new FormData();
    fd.append('image', file, 'question.jpg');
    const job = await api('/jobs', { method: 'POST', body: fd });
    clearPending();
    const map = new Map(state.jobs.map((j) => [j.id, j]));
    map.set(job.id, job);
    state.jobs = [...map.values()];
    render();
    scrollBottom(false);
    syncPolling();
    toast('已发送');
    refresh(true);
  } catch (e) {
    toast(e.message || '发送失败，请重试');
  } finally {
    state.sending = false;
    updateSend();
  }
}

async function cancelJob(id) {
  try {
    const j = await api(`/jobs/${id}/cancel`, { method: 'POST' });
    const map = new Map(state.jobs.map((x) => [x.id, x]));
    map.set(id, j);
    state.jobs = [...map.values()];
    render();
    syncPolling();
    toast('这次排队已取消');
  } catch (e) { toast(e.message || '取消失败'); }
}

/* ── 弹层 ───────────────────────────────────────────────────────── */
function showImage(url) {
  if (!url) return;
  $('image-big').src = url;
  $('image-modal').hidden = false;
}

function showSample() {
  const done = state.jobs.filter((j) => j.status === 'done')
    .sort((a, b) => b.created_at - a.created_at)[0];
  const body = $('sample-body');
  if (done) {
    body.innerHTML = `
      <video controls playsinline preload="metadata" src="${done.video_url}"></video>
      <div class="modal-tip">这是一次完整讲解的样子：一道题从图形、板书到提问，按顺序讲完，最后生成可回看的视频。</div>`;
  } else {
    body.innerHTML = `
      <div class="modal-tip" style="font-size:13.5px">
        ① 点左下角相机或相册，框选一道题<br />
        ② 发送后会告诉你前方还有几位、大概要等多久<br />
        ③ 轮到你时 Agent 开始讲题，讲好的视频直接发回这里
      </div>`;
  }
  $('sample-modal').hidden = false;
}

/* ── 新对话 / 返回 ─────────────────────────────────────────────── */
function newChat() {
  state.sessionStart = Date.now();
  try { sessionStorage.setItem('tl_session_start', String(state.sessionStart)); } catch { /* ignore */ }
  render();
  $('stage').scrollTo({ top: 0, behavior: 'smooth' });
  toast(state.jobs.some(isPending)
    ? '已开启新对话，排队中的题还在讲，可在左上角查看'
    : '已开启新对话，之前的记录在左上角');
}

/* ── 绑定 ───────────────────────────────────────────────────────── */
function bind() {
  $('back-btn').onclick = () => { location.href = '/'; };
  $('new-chat').onclick = newChat;
  $('side-btn').onclick = () => ($('drawer').classList.contains('open') ? closeDrawer() : openDrawer());
  $('drawer-close').onclick = closeDrawer;
  $('drawer-mask').onclick = closeDrawer;

  $('btn-camera').onclick = () => $('file-camera').click();
  $('btn-gallery').onclick = () => $('file-gallery').click();
  for (const id of ['file-camera', 'file-gallery']) {
    $(id).addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
      e.target.value = '';
    });
  }
  $('pending-del').onclick = clearPending;
  $('btn-send').onclick = submit;
  $('btn-mic').onclick = () => toast('暂不支持语音，请发送题目图片');
  $('fake-input').onclick = () => toast('现在只支持发送题目图片，点左下角相机或相册');
  $('tab-homework').onclick = () => toast('批改作业还没开放，先用题目答疑吧');
  $('tab-question').onclick = () => {
    $('tab-question').classList.add('active');
    $('tab-homework').classList.remove('active');
  };

  $('sample-link').onclick = showSample;
  $('sample-close').onclick = () => {
    $('sample-modal').hidden = true;
    $('sample-body').innerHTML = '';
  };
  $('image-close').onclick = () => { $('image-modal').hidden = true; };
  $('sample-modal').addEventListener('click', (e) => {
    if (e.target.id === 'sample-modal') $('sample-close').click();
  });
  $('image-modal').addEventListener('click', (e) => {
    if (e.target.id === 'image-modal') $('image-modal').hidden = true;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('sample-modal').hidden = true;
      $('image-modal').hidden = true;
      closeDrawer();
    }
    if (e.key === 'Enter' && state.pending && !state.sending) submit();
  });

  /* 拖入图片也能直接发 */
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });
}

try {
  const saved = Number(sessionStorage.getItem('tl_session_start')) || 0;
  state.sessionStart = saved && Date.now() - saved < 12 * 3600 * 1000 ? saved : 0;
} catch { /* ignore */ }

bind();
refresh(false).then(() => scrollBottom(false));   // 像聊天一样默认停在最新一条
updateSend();

window.__keyiLab = { state, refresh, submit };
