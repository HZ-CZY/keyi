/**
 * /tutor-lab · 云端讲解视频面板
 * ─────────────────────────────────────────────────────────────
 * 复用 host.mjs 里已有的 Canvas 裁剪器（window.__openCropper），把题目图
 * 裁好上传到 /api/lesson-video/jobs，然后轮询单 worker 队列；任务完成后
 * 直接内嵌播放 / 下载 App 原生导出的 MP4。
 *
 * 与现有 Web 版讲题互不干扰：这里是「原版 APK 导出成片」的通道，
 * 不启动白板、不调讲题模型，只有答题环节由服务端用轻量模型选答案。
 */

const $ = (id) => document.getElementById(id);
const API = '/api/lesson-video';

const authHeaders = () => {
  const t = localStorage.getItem('token') || '';
  return t ? { Authorization: `Bearer ${t}` } : {};
};

let currentId = '';
let pollTimer = 0;
let busy = false;

function toast(msg, isError = false) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = isError ? 'show error' : 'show';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, 2600);
}

function fmtBytes(n) {
  if (!n) return '';
  return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

/* ── 面板开关 ───────────────────────────────────────────────────── */
function openPanel() {
  $('cv-mask').hidden = false;
  document.body.style.overflow = 'hidden';
  loadJobs();
  if (currentId) startPolling(currentId);
}
function closePanel() {
  $('cv-mask').hidden = true;
  document.body.style.overflow = '';
}

/* ── 选图 → 裁剪 → 上传 ─────────────────────────────────────────── */
async function handleFile(file) {
  if (!file || busy) return;
  if (!file.type.startsWith('image/')) { toast('请选择图片文件', true); return; }
  let picked = file;
  if ($('cv-crop').checked) {
    const cropper = window.__openCropper;
    if (typeof cropper === 'function') {
      picked = await cropper(file);
      if (!picked) return;                       // 用户取消裁剪
    } else {
      toast('裁剪器还没就绪，已按原图上传');
    }
  }
  busy = true;
  setUploading(true);
  try {
    const fd = new FormData();
    fd.append('image', picked, 'question.png');
    const job = await api('/jobs', { method: 'POST', body: fd });
    currentId = job.id;
    showStatus(true);
    render(job);
    startPolling(job.id);
    loadJobs();
    toast('已加入队列，开始处理');
  } catch (e) {
    toast(e.message || '上传失败', true);
  } finally {
    busy = false;
    setUploading(false);
  }
}

function setUploading(on) {
  $('cv-camera').disabled = on;
  $('cv-gallery').disabled = on;
  $('cv-drop').classList.toggle('busy', on);
}

function showStatus(on) {
  $('cv-status').hidden = !on;
  $('cv-result').hidden = true;
  $('cv-error').hidden = true;
}

/* ── 轮询 ───────────────────────────────────────────────────────── */
function startPolling(id) {
  clearInterval(pollTimer);
  const tick = async () => {
    try {
      const j = await api('/jobs/' + id);
      render(j);
      if (j.status === 'done' || j.status === 'failed' || j.status === 'canceled') {
        clearInterval(pollTimer);
        pollTimer = 0;
        loadJobs();
      }
    } catch (e) {
      clearInterval(pollTimer);
      pollTimer = 0;
      $('cv-detail').textContent = '状态查询失败：' + e.message;
    }
  };
  tick();
  pollTimer = setInterval(tick, 2200);
}

function render(j) {
  showStatus(true);
  const p = Math.max(0, Math.min(100, Number(j.progress) || 0));
  $('cv-stage').textContent = j.stage || j.status;
  $('cv-pct').textContent = p + '%';
  $('cv-bar').style.width = p + '%';
  $('cv-status').dataset.state = j.status;

  const bits = [];
  if (j.status === 'queued') {
    bits.push(j.queue_position > 1
      ? `排队中：前面还有 ${j.queue_position - 1} 个任务`
      : '排队中：下一个就轮到你');
  }
  if (j.status === 'running') bits.push('云端安卓正在处理，请保持页面开着');
  if (j.answer_log) bits.push('✓ ' + j.answer_log);
  if (j.bytes) bits.push('成片 ' + fmtBytes(j.bytes));
  if (j.finished_at) bits.push(fmtTime(j.finished_at) + ' 完成');
  else if (j.created_at) bits.push('提交于 ' + fmtTime(j.created_at));
  $('cv-meta').textContent = bits.join(' · ');
  $('cv-detail').textContent = j.detail || '';
  $('cv-cancel').hidden = j.status !== 'queued';

  const err = $('cv-error');
  if (j.status === 'failed') {
    err.hidden = false;
    err.textContent = '任务失败：' + (j.error || '未知原因');
  } else if (j.status === 'canceled') {
    err.hidden = false;
    err.textContent = '任务已取消';
  } else {
    err.hidden = true;
  }

  const result = $('cv-result');
  if (j.status === 'done' && j.video_url) {
    if (result.hidden) {
      result.hidden = false;
      const v = $('cv-video');
      v.src = j.video_url + '?t=' + Date.now();
      $('cv-download').href = j.video_url + '?download=1';
      $('cv-download').setAttribute('download', `lesson-${j.id}.mp4`);
      v.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } else {
    result.hidden = true;
  }
}

/* ── 最近任务列表 ───────────────────────────────────────────────── */
const STATE_TEXT = {
  queued: '排队中', running: '处理中', done: '已完成',
  failed: '失败', canceled: '已取消',
};

async function loadJobs() {
  try {
    const { jobs } = await api('/jobs');
    const box = $('cv-jobs');
    if (!jobs.length) {
      box.innerHTML = '<div class="cv-empty">还没有任务，先上传一张题目图吧</div>';
      return;
    }
    box.innerHTML = '';
    for (const j of jobs) {
      const row = document.createElement('button');
      row.className = 'cv-job' + (j.id === currentId ? ' active' : '');
      row.innerHTML = `
        <span class="cv-job-state s-${j.status}">${STATE_TEXT[j.status] || j.status}</span>
        <span class="cv-job-main">
          <b>${fmtTime(j.created_at)}</b>
          <small>${(j.stage || '').slice(0, 46)}${j.bytes ? ' · ' + fmtBytes(j.bytes) : ''}</small>
        </span>
        <span class="cv-job-pct">${j.progress}%</span>`;
      row.onclick = () => {
        currentId = j.id;
        showStatus(true);
        render(j);
        if (j.status === 'queued' || j.status === 'running') startPolling(j.id);
        else clearInterval(pollTimer);
      };
      box.appendChild(row);
    }
  } catch (e) {
    $('cv-jobs').innerHTML = `<div class="cv-empty">列表加载失败：${e.message}</div>`;
  }
}

/* ── 绑定 ───────────────────────────────────────────────────────── */
function bind() {
  $('btn-cloud-video')?.addEventListener('click', openPanel);
  $('cv-close')?.addEventListener('click', closePanel);
  $('cv-mask')?.addEventListener('click', (e) => {
    if (e.target === $('cv-mask')) closePanel();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('cv-mask').hidden) closePanel();
  });

  const pick = (which) => {
    const input = $('cv-file-' + which);
    if (input) input.click();
  };
  $('cv-camera').onclick = () => pick('camera');
  $('cv-gallery').onclick = () => pick('gallery');
  for (const which of ['camera', 'gallery']) {
    const input = $('cv-file-' + which);
    input?.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
      e.target.value = '';
    });
  }

  const drop = $('cv-drop');
  drop?.addEventListener('click', () => pick('gallery'));
  ['dragenter', 'dragover'].forEach((ev) => drop?.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((ev) => drop?.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.remove('over');
  }));
  drop?.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });

  $('cv-cancel')?.addEventListener('click', async () => {
    if (!currentId) return;
    try {
      const j = await api(`/jobs/${currentId}/cancel`, { method: 'POST' });
      render(j);
      loadJobs();
    } catch (e) { toast(e.message, true); }
  });

  $('cv-new')?.addEventListener('click', () => {
    clearInterval(pollTimer);
    pollTimer = 0;
    currentId = '';
    showStatus(false);
    $('cv-video').pause();
    $('cv-video').removeAttribute('src');
    $('cv-video').load();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bind);
} else {
  bind();
}

/* 供调试：控制台可直接查看当前任务 */
window.__lessonVideo = { open: openPanel, close: closePanel, currentId: () => currentId };
