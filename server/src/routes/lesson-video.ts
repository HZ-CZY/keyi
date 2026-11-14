/**
 * 云端讲解视频 · 任务队列（挂在 /api/lesson-video）
 * ─────────────────────────────────────────────────────────────
 * 前端（/tutor-lab「云端讲解视频」面板）把裁剪后的题目图传上来，
 * 服务端排队，由唯一 worker 串行调用 /root/auto_export.py 驱动 redroid
 * 里的欧拉 APK：拍题 → AI 生成讲解 → AI 自动答提问 → 完整播放 → ⋯ 导出视频
 * → 回传 MP4。完成后前端可在线播放 / 下载。
 *
 * 为什么必须串行：只有一台 redroid、一个已登录账号，auto_export.py 有
 * 文件锁，并发第二个任务只会撞锁失败。所以这里做单 worker 队列 + SQLite
 * 持久化，服务重启自动把 running 退回 queued 重新排队。
 *
 * 鉴权：authMiddleware + ownerOnly（与 /api/tutor 一致，仅站长可用）。
 *
 * 接口：
 *   GET  /api/lesson-video/ping           健康检查 + 队列概况
 *   POST /api/lesson-video/jobs          上传题目图，创建任务
 *   GET  /api/lesson-video/jobs          最近任务列表
 *   GET  /api/lesson-video/jobs/:id      单任务状态（含排队位置、阶段、进度）
 *   POST /api/lesson-video/jobs/:id/cancel  取消排队中的任务
 *   GET  /api/lesson-video/jobs/:id/video  播放/下载 MP4（支持 Range）
 */

import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';
import { getDb } from '../db/database';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();
const OWNER = '陈子洋';

const ROOT = '/root/lesson-video';
const IMG_DIR = path.join(ROOT, 'images');
const OUT_DIR = path.join(ROOT, 'videos');
const RAW_DIR = path.join(ROOT, 'raw');
const THUMB_DIR = path.join(ROOT, 'thumbs');
const LOG_DIR = path.join(ROOT, 'logs');
const AUTO_EXPORT = '/root/auto_export.py';
const ANSWER_AI = '/root/answer_ai.py';
const MOCK_MP4 = path.join(ROOT, 'mock.mp4');
const DRY_RUN = process.env.LESSON_VIDEO_DRY_RUN === '1';
const JOB_TIMEOUT_MS = 35 * 60 * 1000;
const EXPORT_GRACE_MS = 15 * 60 * 1000;
const KEEP_DAYS = 7;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

type JobRow = {
  id: string;
  user_id: number;
  status: 'queued' | 'running' | 'done' | 'failed' | 'canceled';
  stage: string;
  stage_key: string;
  cancel_reason?: string;
  reject_kind?: string;
  progress: number;
  detail: string;
  error: string;
  image_path: string;
  video_path: string;
  bytes: number;
  original_bytes: number;
  answer_log: string;
  created_at: number;
  started_at: number;
  finished_at: number;
};

/* ── 惰性初始化：避免模块加载早于 DB 就绪 ───────────────────────── */
let initialized = false;
const queue: string[] = [];
let active = false;
let currentId = '';
/* 【2026-11-12】管理后台可以随时中止某个任务，所以要能拿到正在跑的子进程句柄。
   被管理员中止的任务先落库成 canceled，子进程 close 回来时不能再改写成 failed。 */
const children = new Map<string, any>();
const ADMIN_CANCEL_TEXT = '监测到题目较简单，请把资源让给更需要的同学';
/* 【2026-11-12】中断原因可定制：默认「题目较简单」，管理员也可选「请上传单题」。
   学生端按 stage_key 里的 key 取话术，不会暴露「被管理员踢了」。 */
const CANCEL_REASONS: Record<string, { title: string; sub: string; hist: string }> = {
  simple: {
    title: '这次先不讲了',
    sub: ADMIN_CANCEL_TEXT,
    hist: '题目较简单 · 已让出',
  },
  single: {
    title: '请上传单题',
    sub: '一次只讲一道题，请把整张练习册裁成单题再拍',
    hist: '未裁成单题 · 已让出',
  },
};
function reasonKey(k?: unknown): string {
  return typeof k === 'string' && CANCEL_REASONS[k] ? k : 'simple';
}

function db() {
  const conn = getDb();
  if (!initialized) {
    for (const d of [ROOT, IMG_DIR, OUT_DIR, RAW_DIR, THUMB_DIR, LOG_DIR]) {
      fs.mkdirSync(d, { recursive: true });
    }
    conn.exec(`
      CREATE TABLE IF NOT EXISTS lesson_video_jobs (
        id           TEXT PRIMARY KEY,
        user_id      INTEGER NOT NULL,
        status       TEXT NOT NULL,
        stage        TEXT NOT NULL DEFAULT '',
        stage_key    TEXT NOT NULL DEFAULT '',
        reject_kind  TEXT NOT NULL DEFAULT '',
        cancel_reason TEXT NOT NULL DEFAULT 'simple',
        progress     INTEGER NOT NULL DEFAULT 0,
        detail       TEXT NOT NULL DEFAULT '',
        error        TEXT NOT NULL DEFAULT '',
        image_path   TEXT NOT NULL DEFAULT '',
        video_path   TEXT NOT NULL DEFAULT '',
        bytes        INTEGER NOT NULL DEFAULT 0,
        original_bytes INTEGER NOT NULL DEFAULT 0,
        answer_log   TEXT NOT NULL DEFAULT '',
        created_at   INTEGER NOT NULL,
        started_at   INTEGER NOT NULL DEFAULT 0,
        finished_at  INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_lvj_created ON lesson_video_jobs(created_at DESC);
    `);
    /* 老库补列：original_bytes 记录压缩前体积，前端据此显示「已压缩 x → y」 */
    const cols = conn.prepare('PRAGMA table_info(lesson_video_jobs)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'original_bytes')) {
      conn.exec('ALTER TABLE lesson_video_jobs ADD COLUMN original_bytes INTEGER NOT NULL DEFAULT 0');
    }
    /* 服务重启：上一轮进程已随服务一起没了，running 必须退回 queued，
       否则任务永远卡在 running，前端一直转圈。 */
    conn.prepare("UPDATE lesson_video_jobs SET status='queued', stage='服务重启，重新排队', "
      + "stage_key='queued', progress=0, error='' WHERE status='running'").run();
    /* 【2026-11-12】中断原因（simple / single），老库自动补列 */
    try { conn.exec("ALTER TABLE lesson_video_jobs ADD COLUMN cancel_reason TEXT NOT NULL DEFAULT 'simple'"); } catch { /* 已存在 */ }
    try { conn.exec("ALTER TABLE lesson_video_jobs ADD COLUMN reject_kind TEXT NOT NULL DEFAULT ''"); } catch { /* 已存在 */ }
    const pending = conn.prepare(
      "SELECT id FROM lesson_video_jobs WHERE status='queued' ORDER BY created_at ASC"
    ).all() as { id: string }[];
    for (const r of pending) queue.push(r.id);
    initialized = true;
    /* 启动即恢复队列（异步，不阻塞模块加载） */
    setImmediate(() => kick());
  }
  return conn;
}

/* 【2026-11-12 内测开放】原先只允许站长调用，单人使用不存在「排队」这回事。
   现在默认对所有已登录用户开放；如需临时收回（例如额度吃紧），
   在环境变量里设 TUTOR_LAB_OPEN=0 即回到仅站长可用，不必改代码。 */
const OPEN_TO_ALL = process.env.TUTOR_LAB_OPEN !== '0';

function labAccess(req: AuthRequest, res: Response, next: NextFunction): void {
  const uid = req.userId;
  if (!uid) {
    res.status(401).json({ error: '未登录' });
    return;
  }
  if (OPEN_TO_ALL) {
    next();
    return;
  }
  const row = db().prepare('SELECT username FROM users WHERE id = ?').get(uid) as
    | { username?: string }
    | undefined;
  if (row?.username !== OWNER) {
    res.status(403).json({ error: '该功能未开放' });
    return;
  }
  next();
}

router.use(authMiddleware, labAccess);

/* 多用户之后，任务必须按人隔离：否则学生能看到别人的题图、取消别人的任务。 */
function ownJob(req: AuthRequest, res: Response): JobRow | null {
  const j = getJob(req.params.id);
  if (!j) {
    res.status(404).json({ error: '任务不存在' });
    return null;
  }
  if (j.user_id !== (req.userId || 0)) {
    res.status(403).json({ error: '无权访问该任务' });
    return null;
  }
  return j;
}

function update(id: string, patch: Partial<JobRow>): void {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sql = 'UPDATE lesson_video_jobs SET '
    + keys.map((k) => `${k} = ?`).join(', ') + ' WHERE id = ?';
  db().prepare(sql).run(...keys.map((k) => (patch as any)[k]), id);
}

function getJob(id: string): JobRow | undefined {
  return db().prepare('SELECT * FROM lesson_video_jobs WHERE id = ?').get(id) as JobRow | undefined;
}

/* 每位同学平均占用 agent 的时长，前端据此估算等待时间。
   实测单题全流程（生成 + 播放 + 导出）约 12–15 分钟，取 15 保守一点。 */
const MINUTES_PER_JOB = 15;

function publicJob(j: JobRow): any {
  const pos = j.status === 'queued' ? queue.indexOf(j.id) + 1 : 0;
  /* 前方还有几个人：排队中的前序任务 + 正在讲的那一位。
     只用「位次」说话，不暴露 worker / 设备之类的实现细节。 */
  const ahead = j.status === 'queued' ? Math.max(0, pos - 1) + (active ? 1 : 0) : 0;
  return {
    id: j.id,
    status: j.status,
    /* 排队阶段不能说「Agent 正在讲题」，那是轮到本人才有的状态 */
    stage: j.status === 'queued' ? '排队等待中' : j.status === 'running' ? 'Agent正在讲题中' : j.stage,
    stage_key: j.stage_key,
    cancel_reason: j.cancel_reason || 'simple',
    reject_kind: j.reject_kind || '',
    progress: j.progress,
    detail: j.detail,
    error: j.error,
    bytes: j.bytes,
    original_bytes: j.original_bytes || 0,
    answer_log: j.answer_log,
    created_at: j.created_at,
    started_at: j.started_at,
    finished_at: j.finished_at,
    queue_position: pos > 0 ? pos : 0,
    queue_ahead: ahead,
    queue_length: queue.length + (active ? 1 : 0),
    /* 1 位 ≈ 15 分钟；轮到自己时给一个剩余预估 */
    est_wait_minutes: j.status === 'queued' ? ahead * MINUTES_PER_JOB : 0,
    est_remain_minutes: j.status === 'running' ? MINUTES_PER_JOB : 0,
    image_url: j.image_path ? `/api/lesson-video/jobs/${j.id}/image` : null,
    video_url: j.status === 'done' ? `/api/lesson-video/jobs/${j.id}/video` : null,
  };
}

/* ── 阶段映射：把 auto_export.py 的中文步骤翻成进度 ─────────────── */
const STAGE_RULES: { re: RegExp; key: string; label: string; progress: number }[] = [
  { re: /检查设备与 App 状态/, key: 'ready', label: 'Agent 准备中', progress: 3 },
  { re: /推送题目图并进入相册框选/, key: 'attach', label: '上传题目并框选', progress: 8 },
  { re: /授权存储权限/, key: 'attach', label: '授权相册权限', progress: 10 },
  { re: /等待讲解完整播放至完成态/, key: 'generating', label: 'AI 生成讲解中', progress: 18 },
  { re: /提问环节：/, key: 'answering', label: 'AI 自动作答提问', progress: 34 },
  { re: /稳定完成态/, key: 'playing', label: '讲解完整播放中', progress: 50 },
  { re: /打开 ⋯ 菜单并进入导出/, key: 'menu', label: '打开导出菜单', progress: 57 },
  { re: /开始逐帧生成视频/, key: 'exporting', label: '正在生成视频', progress: 60 },
  { re: /视频已生成/, key: 'muxing', label: '视频已生成，正在回传', progress: 98 },
  { re: /回传 MP4/, key: 'pulling', label: '回传视频文件', progress: 99 },
];

function parseLine(id: string, line: string): void {
  const s = line.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '').trim();
  if (!s) return;

  /* AI 答题结果：auto_export.py 会打印 AI_ANSWER idx=N ... */
  const ai = /AI_ANSWER idx=(\d+)(?:\s+model=([\w./:-]+))?/.exec(s);
  if (ai) {
    update(id, {
      answer_log: `AI 自动选第 ${ai[1]} 项${ai[2] ? `（模型 ${ai[2]}）` : ''}`,
      detail: s,
    });
    return;
  }

  /* 导出编码进度：60% ~ 97% 留给逐帧编码 */
  const pct = /进度\s+(\d+)%/.exec(s);
  if (pct) {
    const p = Math.min(97, 60 + Math.round(Number(pct[1]) * 0.37));
    update(id, { stage_key: 'exporting', stage: `正在生成视频 ${pct[1]}%`, progress: p, detail: s });
    return;
  }

  if (s.startsWith('→ ')) {
    const name = s.slice(2);
    for (const r of STAGE_RULES) {
      if (r.re.test(name)) {
        update(id, { stage_key: r.key, stage: r.label, progress: r.progress, detail: name });
        return;
      }
    }
    update(id, { detail: name });
    return;
  }

  /* 【2026-11-12】欧拉 App 拒绝题图（科目不对 / 题干被截断）。
    脚本抛出 REJECT|kind|reason，这里翻成学生看得懂的话，并打上 reject_kind，
     前端据此显示不同的失败气泡，不用学生干等 15 分钟超时。 */
  const rej = /REJECT\|(subject|crop)\|(.+)$/.exec(s);
  if (rej) {
    const kind = rej[1];
    const raw = rej[2].trim();
    const text = kind === 'subject'
      ? '这道题现在讲不了：目前只支持数学题，化学、物理、生物等科目还讲不了。'
      : '题目没拍全：题干或小问被截掉了，把整道题连同小题一起拍进来再拍一张。';
    update(id, {
      status: 'failed',
      stage: '题目不符合要求',
      stage_key: 'rejected',
      reject_kind: kind,
      error: text + (raw ? '（App 原话：' + raw.slice(0, 120) + '）' : ''),
      detail: raw.slice(0, 160),
      finished_at: Date.now(),
    });
    return;
  }

  if (/^✗ 失败/.test(s)) {
    update(id, { error: s });
    return;
  }
  if (/^  ✓/.test(s) || /^完成：/.test(s)) {
    update(id, { detail: s });
  }
}

/* ── 成片压缩：回传前先压一遍 ─────────────────────────────────────
   App 导出的 MP4 是 1280×968@24fps 的高码率 H.264，两三分钟就有 9~12MB。
   板书类画面静态占比高，缩到最长边 960 + CRF 30 + 单声道 64k AAC 通常能
   压掉 60%~75%，iPad 上首帧与拖动进度条都明显更快。
   原片留一份到 raw/ 便于核对；压缩失败或反而变大，就回退回传原片，
   绝不因为压缩把一条已经讲好的任务判成失败。 */
function compressVideo(src: string, id: string): Promise<{ after: number; before: number; ok: boolean }> {
  return new Promise((resolve) => {
    const before = fs.statSync(src).size;
    const raw = path.join(RAW_DIR, `${id}.mp4`);
    const tmp = path.join(OUT_DIR, `${id}.compressed.mp4`);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }

    const args = [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', src,
      '-vf', "scale='min(960,iw)':-2",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
      '-pix_fmt', 'yuv420p', '-profile:v', 'main',
      '-c:a', 'aac', '-b:a', '64k', '-ac', '1',
      '-movflags', '+faststart', tmp,
    ];
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr?.on('data', (d) => { err = (err + String(d)).slice(-1200); });
    const timer = setTimeout(() => { try { ff.kill('SIGKILL'); } catch { /* ignore */ } }, 240_000);
    timer.unref?.();

    const fallback = () => {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
      try { if (!fs.existsSync(src) && fs.existsSync(raw)) fs.renameSync(raw, src); } catch { /* ignore */ }
      resolve({ after: before, before, ok: false });
    };

    ff.on('error', () => { clearTimeout(timer); fallback(); });
    ff.on('close', (code) => {
      clearTimeout(timer);
      try {
        const size = fs.statSync(tmp).size;
        if (code !== 0 || size < 50_000) throw new Error(`ffmpeg=${code} ${err.slice(-200)}`);
        if (size >= before) throw new Error('压缩后未变小');
        /* 先换走原片，再把压缩片顶到回传路径，中途失败就把原片换回来 */
        if (fs.existsSync(raw)) fs.unlinkSync(raw);
        fs.renameSync(src, raw);
        try {
          fs.renameSync(tmp, src);
        } catch (e) {
          fs.renameSync(raw, src);
          throw e;
        }
        console.log(`[lesson-video] ${id} 压缩 ${(before / 1048576).toFixed(1)}MB → ${(size / 1048576).toFixed(1)}MB`);
        resolve({ after: size, before, ok: true });
      } catch (e) {
        console.warn('[lesson-video] 压缩失败，回退回传原片：', String(e));
        fallback();
      }
    });
  });
}

/* ── 单 worker：一次只跑一个任务 ────────────────────────────────── */
function kick(): void {
  if (active || !queue.length) return;
  active = true;
  const id = queue.shift()!;
  currentId = id;
  const job = getJob(id);
  if (!job || job.status !== 'queued') {
    active = false;
    setImmediate(kick);
    return;
  }
  runJob(id)
    .catch((e) => {
      console.error('[lesson-video] worker 异常：', e);
      update(id, { status: 'failed', error: String(e?.message || e), finished_at: Date.now() });
    })
    .finally(() => {
      active = false;
      currentId = '';
      setImmediate(kick);
    });
}

function runJob(id: string): Promise<void> {
  const job = getJob(id)!;
  const out = path.join(OUT_DIR, `${id}.mp4`);
  const jsonOut = path.join(LOG_DIR, `${id}.json`);
  const logPath = path.join(LOG_DIR, `${id}.log`);
  update(id, {
    status: 'running', stage: '排队完成，开始处理', stage_key: 'ready',
    progress: 2, started_at: Date.now(), error: '',
  });

  return new Promise<void>((resolve) => {
    let stream: fs.WriteStream | null = null;
    try {
      stream = fs.createWriteStream(logPath, { flags: 'a' });
    } catch { /* 日志失败不影响主流程 */ }

    const finish = (ok: boolean, err?: string, bytes?: number, originalBytes?: number) => {
      try { stream?.end(); } catch { /* ignore */ }
      /* 管理员已中止 / 用户已取消：保留 canceled，别被子进程的退出码覆盖成 failed */
      const cur = getJob(id);
      if (cur?.status === 'canceled') { resolve(); return; }
      if (ok) {
        const saved = originalBytes && bytes
          ? `成片已压缩 ${Math.round((1 - bytes / originalBytes) * 100)}%`
          : '成片可播放 / 下载';
        update(id, {
          status: 'done', stage: '视频已生成', stage_key: 'done', progress: 100,
          video_path: out, bytes: bytes || 0, original_bytes: originalBytes || 0,
          finished_at: Date.now(),
          detail: saved, error: '',
        });
      } else {
        update(id, {
          status: 'failed', stage: '任务失败', stage_key: 'failed',
          error: (err || '未知错误').slice(0, 500), finished_at: Date.now(),
        });
      }
      resolve();
    };

    /* dry-run：只验证前后端链路，不驱动 APK、不消耗 AI 额度。
       用一份已有成片冒充产物，跑完一条模拟进度。 */
    if (DRY_RUN) {
      const steps: [number, string, string, number][] = [
        [300, 'ready', '检查云端安卓设备', 3],
        [900, 'attach', '上传题目并框选', 8],
        [900, 'generating', 'AI 生成讲解中', 18],
        [900, 'answering', 'AI 自动作答提问', 34],
        [900, 'playing', '讲解完整播放中', 50],
        [900, 'menu', '打开导出菜单', 57],
        [900, 'exporting', '正在生成视频 45%', 77],
        [900, 'muxing', '视频已生成，正在回传', 98],
      ];
      let i = 0;
      const tick = () => {
        /* 管理员中途叫停：模拟进度停下，并 resolve 掉 Promise，
           否则 active 永远为 true，后面的队列再也起不来 */
        if (getJob(id)?.status === 'canceled') { finish(false, '管理员已让出资源'); return; }
        if (i >= steps.length) {
          try {
            if (fs.existsSync(MOCK_MP4)) fs.copyFileSync(MOCK_MP4, out);
            else fs.writeFileSync(out, Buffer.alloc(0));
            update(id, { answer_log: 'dry-run：跳过 AI 答题' });
            void compressVideo(out, id).then((r) => finish(true, undefined, r.after, r.ok ? r.before : 0));
          } catch (e: any) {
            finish(false, 'dry-run 准备成片失败：' + e?.message);
          }
          return;
        }
        const [, key, label, progress] = steps[i++];
        update(id, { stage_key: key, stage: label, progress, detail: 'dry-run 模拟' });
        setTimeout(tick, steps[i - 1][0]);
      };
      tick();
      return;
    }

    const args = [
      AUTO_EXPORT,
      '--image', job.image_path,
      '--out', out,
      '--json', jsonOut,
      '--answer-cmd', ANSWER_AI,
      '--style', 'landscape',
      '--lesson-timeout', '1200',
      '--export-timeout', '1800',
    ];
    const child = spawn('python3', args, {
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        LESSON_VIDEO_JOB_ID: id,
        LESSON_ANSWER_LOG: path.join(LOG_DIR, 'answer_ai.log'),
        LESSON_CROP_SHOT: path.join(LOG_DIR, id + '_crop.png'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    children.set(id, child);   // 管理后台「中断」要靠它杀进程
    child.on('close', () => children.delete(id));

    /* 【2026-11-12 放宽】原 20 分钟一刀切，导出还没跑完就被 SIGKILL：
       17:19 提交的任务在导出 77% 处被杀，学生白等 20 分钟还没视频。
       现在的规则：到点不直接杀，先看阶段 —— 已进入导出/压缩就再等一个导出超时的时长；
       仍停在讲解阶段才判失败。总上限仍由 JOB_TIMEOUT_MS + EXPORT_GRACE_MS 兜住。 */
    const EXPORT_STAGES = ['menu', 'exporting', 'compressing', 'muxing'];
    const timer = setTimeout(function check() {
      const cur = getJob(id);
      if (cur && EXPORT_STAGES.includes(cur.stage_key) && Date.now() < (cur.started_at || 0) + JOB_TIMEOUT_MS + EXPORT_GRACE_MS) {
        const t2 = setTimeout(check, 60000);
        t2.unref?.();
        return;
      }
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      finish(false, '任务超过 ' + Math.round(JOB_TIMEOUT_MS / 60000) + ' 分钟，已强制终止');
    }, JOB_TIMEOUT_MS);
    timer.unref?.();

    const pipe = (readable: NodeJS.ReadableStream | null) => {
      if (!readable) return;
      const rl = readline.createInterface({ input: readable as any });
      rl.on('line', (line) => {
        try { stream?.write(line + '\n'); } catch { /* ignore */ }
        try { parseLine(id, line); } catch (e) { console.warn('[lesson-video] parse:', e); }
      });
    };
    pipe(child.stdout);
    pipe(child.stderr);

    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.on('error', (e) => {
      done(() => finish(false, '无法启动导出脚本：' + e.message));
    });
    child.on('close', (code) => {
      done(() => {
        /* 以 auto_export.py 的 RESULT_JSON 为准；文件完整性由脚本自己校验过 */
        let result: any = null;
        try { result = JSON.parse(fs.readFileSync(jsonOut, 'utf8')); } catch { /* ignore */ }
        if (result?.ok && result?.result?.mp4 && fs.existsSync(out)) {
          const data = fs.readFileSync(out);
          if (data.length > 100_000 && data.includes(Buffer.from('moov')) && data.includes(Buffer.from('mdat'))) {
            /* 回传前压缩；压缩片替换回传路径，前端播放 / 下载都拿到小体积版本 */
            update(id, {
              stage: '整理成片，准备发送', stage_key: 'compressing', progress: 99,
              detail: '正在压缩视频',
            });
            void compressVideo(out, id).then((r) => {
              finish(true, undefined, r.after, r.ok ? r.before : 0);
            });
            return;
          }
          finish(false, 'MP4 不完整（缺 moov/mdat 或过小），导出可能被中断');
          return;
        }
        const j = getJob(id);
        finish(false, result?.error || j?.error || `导出脚本退出码 ${code}，未产出成片`);
      });
    });
  });
}

/* ── 清理：只保留最近 7 天 / 最多 40 条 ─────────────────────────── */
function cleanup(): void {
  try {
    const cutoff = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
    const old = db().prepare(
      'SELECT id, image_path, video_path FROM lesson_video_jobs WHERE created_at < ?'
    ).all(cutoff) as { id: string; image_path: string; video_path: string }[];
    for (const r of old) {
      const extras = [
        path.join(RAW_DIR, `${r.id}.mp4`),
        path.join(THUMB_DIR, `${r.id}.jpg`),
        path.join(LOG_DIR, `${r.id}_crop.png`),
      ];
      for (const f of [r.image_path, r.video_path, ...extras]) {
        try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
      }
      db().prepare('DELETE FROM lesson_video_jobs WHERE id = ?').run(r.id);
    }
  } catch (e) {
    console.warn('[lesson-video] 清理失败：', e);
  }
}

/* ── 路由 ───────────────────────────────────────────────────────── */
router.get('/ping', (_req, res) => {
  res.json({
    ok: true,
    dry_run: DRY_RUN,
    worker_active: active,
    current_id: currentId,
    queued: queue.length,
    auto_export_exists: fs.existsSync(AUTO_EXPORT),
    answer_ai_exists: fs.existsSync(ANSWER_AI),
  });
});

/* 【2026-11-12 管理后台】讲题队列实时面板。
   与 /jobs 不同：这里跨用户、带用户名，只给 role=admin 看。
   前端每 5 秒轮询一次，所以只做「一次联表查询 + 内存队列排序」，不做重统计。 */
function isAdminUser(uid?: number): boolean {
  if (!uid) return false;
  const row = db().prepare('SELECT role FROM users WHERE id = ?').get(uid) as
    | { role?: string }
    | undefined;
  return row?.role === 'admin';
}

/* 只读任务：本人或管理员。写操作（取消）仍然只允许本人。 */
function jobForRead(req: AuthRequest, res: Response): JobRow | null {
  const j = getJob(req.params.id);
  if (!j) {
    res.status(404).json({ error: '任务不存在' });
    return null;
  }
  if (j.user_id !== (req.userId || 0) && !isAdminUser(req.userId)) {
    res.status(403).json({ error: '无权访问该任务' });
    return null;
  }
  return j;
}

router.get('/admin/queue', (req: AuthRequest, res: Response) => {
  if (!isAdminUser(req.userId)) {
    res.status(403).json({ error: '需要管理员权限' });
    return;
  }
  const rows = db().prepare(
    `SELECT j.*, u.username FROM lesson_video_jobs j
       LEFT JOIN users u ON u.id = j.user_id
      WHERE j.status IN ('queued','running')
      ORDER BY j.created_at ASC`
  ).all() as (JobRow & { username?: string })[];

  /* 位次以内存队列为准（与 worker 完全一致），DB 只用来补用户名/阶段 */
  const order = [...(active && currentId ? [currentId] : []), ...queue];
  const rank = new Map<string, number>(order.map((id, i) => [id, i + 1]));
  const now = Date.now();

  const jobs = rows.map((j) => {
    const pos = rank.get(j.id) || 0;
    const ahead = pos > 0 ? pos - 1 : 0;
    /* order 把「正在讲的那一位」放在第 1 位，所以排队第 1 位的 ahead 是 1 ≈ 15 分钟 */
    const waitStart = j.status === 'running' ? j.started_at || j.created_at : j.created_at;
    return {
      id: j.id,
      user_id: j.user_id,
      username: j.username || `#${j.user_id}`,
      status: j.status,
      stage: j.stage,
      stage_key: j.stage_key,
      progress: j.progress,
      detail: j.detail,
      queue_position: pos,
      queue_ahead: ahead,
      est_wait_minutes: j.status === 'queued' ? ahead * MINUTES_PER_JOB : 0,
      est_remain_minutes: j.status === 'running' ? MINUTES_PER_JOB : 0,
      elapsed_minutes: Math.max(0, Math.round((now - waitStart) / 60000)),
      created_at: j.created_at,
      started_at: j.started_at,
      image_url: j.image_path ? `/api/lesson-video/jobs/${j.id}/image` : null,
    };
  });

  /* 今日统计（按北京时间自然日） */
  const TZ = 8 * 3600 * 1000;
  const dayStart = Math.floor((now + TZ) / 86400000) * 86400000 - TZ;
  const today = db().prepare(
    `SELECT
       SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) submitted,
       SUM(CASE WHEN status = 'done' AND finished_at >= ? THEN 1 ELSE 0 END) done,
       SUM(CASE WHEN status = 'failed' AND finished_at >= ? THEN 1 ELSE 0 END) failed,
       AVG(CASE WHEN status = 'done' AND finished_at >= ? AND started_at > 0
                THEN (finished_at - started_at) / 60000.0 END) avg_minutes
     FROM lesson_video_jobs`
  ).get(dayStart, dayStart, dayStart, dayStart) as
    | { submitted: number | null; done: number | null; failed: number | null; avg_minutes: number | null }
    | undefined;

  res.json({
    ok: true,
    dry_run: DRY_RUN,
    server_time: now,
    minutes_per_job: MINUTES_PER_JOB,
    worker_active: active,
    current_id: currentId || null,
    queued: queue.length,
    total_in_system: jobs.length,
    total_wait_minutes: queue.length * MINUTES_PER_JOB,
    today: {
      submitted: today?.submitted || 0,
      done: today?.done || 0,
      failed: today?.failed || 0,
      avg_minutes: today?.avg_minutes ? Math.round(today.avg_minutes * 10) / 10 : null,
    },
    jobs,
  });
});

/* 管理后台 · 中止某个任务（排队中或正在讲都可以）。
   场景：管理员看到题目明显超出「错题拆解」定位（比如整页基础题），
   直接把资源收回来给后面排队的人。学生端看到的是统一话术，不暴露「被踢」。
   被中断的任务保留题图，方便事后核对是不是误判。 */
router.post('/admin/jobs/:id/cancel', (req: AuthRequest, res: Response) => {
  if (!isAdminUser(req.userId)) {
    res.status(403).json({ error: '需要管理员权限' });
    return;
  }
  const j = getJob(req.params.id);
  if (!j) {
    res.status(404).json({ error: '任务不存在' });
    return;
  }
  if (j.status !== 'queued' && j.status !== 'running') {
    res.status(409).json({ error: '这个任务已经结束了' });
    return;
  }

  const wasRunning = j.status === 'running';
  if (!wasRunning) {
    const i = queue.indexOf(j.id);
    if (i >= 0) queue.splice(i, 1);
  }
  const rk = reasonKey(req.body?.reason);
  update(j.id, {
    status: 'canceled',
    stage: CANCEL_REASONS[rk].sub,
    stage_key: 'admin_cancel',
    cancel_reason: rk,
    finished_at: Date.now(),
    error: '',
  });

  if (wasRunning) {
    const child = children.get(j.id);
    if (child) {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 3000).unref?.();
    }
    /* 兜底：万一子进程僵死、close 一直不来，20 秒后强制把 worker 释放，
       否则整个队列会卡在这一个任务上，后面所有同学都排不动。 */
    setTimeout(() => {
      if (currentId !== j.id) return;
      console.warn('[lesson-video] 中断后 worker 未释放，强制复位：', j.id);
      children.delete(j.id);
      active = false;
      currentId = '';
      setImmediate(kick);
    }, 20000).unref?.();
    /* dry-run 没有子进程，靠 tick 里的 canceled 判断自行停下；
       真机任务等 close 事件触发，queue 会自动接着跑下一位。 */
  }

  console.log(`[lesson-video] admin(tmp=${req.userId}) canceled ${j.id} (${wasRunning ? 'running' : 'queued'}, user=${j.user_id})`);
  res.json({ ok: true, id: j.id, status: 'canceled', reason: rk, was_running: wasRunning });
});

router.post('/jobs', upload.single('image'), async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as any).file as { buffer: Buffer; mimetype: string } | undefined;
    if (!file) {
      res.status(400).json({ error: '缺少题目图片' });
      return;
    }
    /* 一人同时只排一题：agent 只有一个，一个人连发十张会把后面所有人的等待
       拉长到几小时。想换题就先取消当前这条。 */
    const busy = db().prepare(
      "SELECT id FROM lesson_video_jobs WHERE user_id = ? AND status IN ('queued','running') LIMIT 1"
    ).get(req.userId || 0) as { id: string } | undefined;
    if (busy) {
      res.status(429).json({ error: '你还有一题在讲，等讲完或取消后再发' });
      return;
    }
    /* 前端裁剪器输出 JPEG，但 auto_export.py 固定推成 /sdcard/Pictures/question.png，
       Matisse 也按这个名字找缩略图。统一转成 PNG，避免「扩展名 png / 内容 jpeg」
       让 Android 12 媒体扫描不建索引、相册里找不到图。 */
    let buf: Buffer;
    try {
      buf = await sharp(file.buffer).rotate().png().toBuffer();
    } catch {
      buf = file.buffer;   // 非常规格式兜底：原样交给脚本
    }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const imagePath = path.join(IMG_DIR, id + '.png');
    fs.writeFileSync(imagePath, buf);

    db().prepare(`
      INSERT INTO lesson_video_jobs
        (id, user_id, status, stage, stage_key, progress, detail, image_path, created_at)
      VALUES (?, ?, 'queued', '排队等待中', 'queued', 0, '', ?, ?)
    `).run(id, req.userId || 0, imagePath, Date.now());

    queue.push(id);
    cleanup();
    kick();
    const j = getJob(id)!;
    res.status(202).json(publicJob(j));
  } catch (e: any) {
    res.status(500).json({ error: e?.message || '创建任务失败' });
  }
});

router.get('/jobs', (req: AuthRequest, res: Response) => {
  const rows = db().prepare(
    'SELECT * FROM lesson_video_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 30'
  ).all(req.userId || 0) as JobRow[];
  res.json({ jobs: rows.map(publicJob) });
});

router.get('/jobs/:id', (req: AuthRequest, res: Response) => {
  const j = ownJob(req, res);
  if (!j) return;
  res.json(publicJob(j));
});

/* 历史对话里要显示用户当初发的那张题图。原图是 3~4MB 的 PNG，
   这里按 720px 宽生成一份 JPEG 缩略图并落盘缓存，聊天气泡秒开。 */
router.get('/jobs/:id/image', async (req: AuthRequest, res: Response) => {
  /* 管理后台队列面板要能看到学生提交的题图，所以这里放开给管理员（只读） */
  const j = jobForRead(req, res);
  if (!j) return;
  if (!j.image_path || !fs.existsSync(j.image_path)) {
    res.status(404).end('Not Found');
    return;
  }
  const thumb = path.join(THUMB_DIR, `${j.id}.jpg`);
  try {
    if (!fs.existsSync(thumb)) {
      await sharp(j.image_path).rotate()
        .resize({ width: 720, withoutEnlargement: true })
        .jpeg({ quality: 80 }).toFile(thumb);
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(thumb);
  } catch {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(j.image_path);
  }
});

router.post('/jobs/:id/cancel', (req: AuthRequest, res: Response) => {
  const j = ownJob(req, res);
  if (!j) return;
  if (j.status !== 'queued') {
    res.status(409).json({ error: '只有排队中的任务可以取消' });
    return;
  }
  const i = queue.indexOf(j.id);
  if (i >= 0) queue.splice(i, 1);
  update(j.id, { status: 'canceled', stage: '已取消', stage_key: 'canceled', finished_at: Date.now() });
  res.json(publicJob(getJob(j.id)!));
});

router.get('/jobs/:id/video', (req: AuthRequest, res: Response) => {
  /* 管理员可回看任意任务的成片（排查「讲错了」的反馈） */
  const j = jobForRead(req, res);
  if (!j) return;
  if (j.status !== 'done' || !j.video_path || !fs.existsSync(j.video_path)) {
    res.status(404).json({ error: '视频尚未生成' });
    return;
  }
  res.setHeader('Content-Type', 'video/mp4');
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="lesson-${j.id}.mp4"`);
  } else {
    res.setHeader('Content-Disposition', `inline; filename="lesson-${j.id}.mp4"`);
  }
  /* sendFile 自带 Range / 206 支持，浏览器拖动进度条才不会整段重下 */
  res.sendFile(j.video_path, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: '读取视频失败' });
    }
  });
});

/* 模块加载后触发惰性初始化（首次请求也会兜底） */
setImmediate(() => { try { db(); } catch (e) { console.warn('[lesson-video] 初始化延后：', e); } });

export default router;
