import { Router, Response } from 'express';
import { getDb } from '../db/database';
import { enqueueAutoReply, feedbackMuteInfo } from '../lib/auto-reply';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(adminMiddleware);

// ── Changelog CRUD ─────────────────────────────────

// List all changelog entries
router.get('/changelog', (_req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const entries = db.prepare(
      'SELECT id, version, date, description, created_at, updated_at FROM changelog ORDER BY created_at DESC'
    ).all();
    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create changelog entry
router.post('/changelog', (req: AuthRequest, res: Response) => {
  try {
    const { version, date, description } = req.body;
    if (!version || !date || !description) {
      res.status(400).json({ error: '缺少必要字段 (version, date, description)' });
      return;
    }
    const db = getDb();
    const result = db.prepare(
      'INSERT INTO changelog (version, date, description) VALUES (?, ?, ?)'
    ).run(version, date, description);
    res.json({ id: result.lastInsertRowid, success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update changelog entry
router.put('/changelog/:id', (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { version, date, description } = req.body;
    const db = getDb();
    db.prepare(
      'UPDATE changelog SET version = ?, date = ?, description = ?, updated_at = unixepoch() WHERE id = ?'
    ).run(version, date, description, id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete changelog entry
router.delete('/changelog/:id', (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();
    db.prepare('DELETE FROM changelog WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Site Content management (version info & software statement) ──

// Get all site content (from settings table)
router.get('/site-content', (_req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT key, value FROM settings WHERE key IN ('app_name', 'app_version', 'build_date', 'software_statement')"
    ).all() as { key: string; value: string }[];
    const content: Record<string, string> = {};
    for (const row of rows) {
      content[row.key] = row.value;
    }
    res.json(content);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update site content
router.put('/site-content', (req: AuthRequest, res: Response) => {
  try {
    const { key, value } = req.body;
    if (!key) {
      res.status(400).json({ error: '缺少 key' });
      return;
    }
    const db = getDb();
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Public endpoints (no auth) ──────────────────────

// Admin: list feedback
router.get('/feedback', (_req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    /* 【2026-11-06 自动分诊】左连分诊表，把类型/模块/严重度/一句话摘要/待办组一起带出去。
       左连而不是内连：分诊还没跑到的反馈也要能看到，不能因为没分诊就消失。 */
    const entries = db.prepare(
      `SELECT f.id, f.user_id, f.username, f.content, f.contact, f.created_at,
              f.reply, f.replied_at, f.replied_by,
              t.ftype, t.module, t.severity, t.brief, t.grp, t.need_human, t.replied
         FROM feedback f
         LEFT JOIN feedback_triage t ON t.feedback_id = f.id
        ORDER BY f.created_at DESC`
    ).all();
    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── 反馈待办（2026-11-06）─────────────────────────────────
   一条待办 = 一个根因，可能对应多条用户反馈。
   站长按优先级改，改完把 status 置 done。 */
router.get('/feedback/todos', (_req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT grp, title, priority, fix, module, n_feedback, status, created_at, updated_at
         FROM feedback_todos
        ORDER BY priority ASC, n_feedback DESC`
    ).all();
    res.json(rows);
  } catch (err: any) {
    /* 表还没建时不要 500，返回空数组，前端照常显示 */
    res.json([]);
  }
});

router.patch('/feedback/todos/:grp', (req: AuthRequest, res: Response) => {
  try {
    const { grp } = req.params;
    const status = String((req.body && req.body.status) || '').trim();
    if (!['todo', 'doing', 'done'].includes(status)) {
      res.status(400).json({ error: 'status 只能是 todo/doing/done' });
      return;
    }
    const db = getDb();
    const info = db
      .prepare('UPDATE feedback_todos SET status = ?, updated_at = unixepoch() WHERE grp = ?')
      .run(status, grp);
    res.json({ success: info.changes > 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: delete feedback
router.delete('/feedback/:id', (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();
    /* 分诊记录跟着一起删，否则留成孤儿：统计口径会虚高，
       而且同 id 复用时旧分诊会串到新反馈上。 */
    db.prepare('DELETE FROM feedback_triage WHERE feedback_id = ?').run(id);
    db.prepare('DELETE FROM feedback WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: 回复反馈（2026-10-15 新增回复通道）
router.put('/feedback/:id/reply', (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const row = db.prepare('SELECT id FROM feedback WHERE id = ?').get(id);
    if (!row) {
      res.status(404).json({ error: '反馈不存在' });
      return;
    }
    /* 长度上限 2000：足够写清一段答复，也防止误贴长文本把后台撑爆 */
    const text = String((req.body && req.body.reply) ?? '').trim().slice(0, 2000);
    const admin =
      ((db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId) as any) || {}).username || '';
    /* reply_read 一律置 0：学生端重新亮红点。改过内容就要让他再看一次，
       否则「改了回复但学生永远不再点进来」等于没回。清空答复则连时间一起清掉。 */
    db.prepare(
      'UPDATE feedback SET reply = ?, replied_at = ?, replied_by = ?, reply_read = 0 WHERE id = ?'
    ).run(text, text ? Math.floor(Date.now() / 1000) : null, admin, id);
    res.json({ success: true, reply: text });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const publicRouter = Router();

// Public: submit feedback (must be logged in)
publicRouter.post('/feedback', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      res.status(400).json({ error: '反馈内容不能为空' });
      return;
    }
    const db = getDb();

    /* 反馈禁言：只停这个入口，账号其他功能照用。到期自动失效，不需要定时任务。 */
    const mute = feedbackMuteInfo(Number(req.userId));
    if (mute.muted) {
      const left = Math.max(1, Math.ceil((mute.until - Date.now() / 1000) / 3600));
      res.status(403).json({
        error: `反馈功能已暂停，约 ${left} 小时后恢复。有使用问题请到时再反馈。`,
        code: 'FEEDBACK_MUTED',
        mutedUntil: mute.until,
        reason: mute.reason,
      });
      return;
    }

    const username = (db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId) as any)?.username || '未知';
    /* 单条长度上限 2000，与回复一致；空内容前面已拦掉 */
    const info = db.prepare(
      "INSERT INTO feedback (user_id, username, content, reply, reply_read) VALUES (?, ?, ?, '', 0)"
    ).run(req.userId, username, content.trim().slice(0, 2000));
    res.json({ success: true });
    /* 先回响应再排队：学生提交不等 AI，Agnes 慢/挂都不影响他 */
    try {
      enqueueAutoReply(Number(info.lastInsertRowid));
    } catch (e: any) {
      console.error('[auto-reply] 入队失败', e.message);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── 学生端：查看自己的反馈与管理员回复（2026-10-15 新增） ──
   为什么查询要带 user_id 条件：这是学生自己的申诉记录，不应看到别人的。
   未读数同样只统计自己名下有回复且未读的条目。 */
publicRouter.get('/feedback/mine', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const items = db.prepare(`
      SELECT id, content, contact, created_at, reply, replied_at, reply_read, COALESCE(replied_by,'') AS replied_by
        FROM feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(req.userId);
    const row = db
      .prepare(
        "SELECT COUNT(*) AS c FROM feedback WHERE user_id = ? AND COALESCE(reply,'') <> '' AND reply_read = 0"
      )
      .get(req.userId) as any;
    res.json({ items, unread: Number(row && row.c) || 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* 轻量接口：只回未读数，供设置页入口红点轮询（不必拉整份列表） */
publicRouter.get('/feedback/unread', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const row = db
      .prepare(
        "SELECT COUNT(*) AS c FROM feedback WHERE user_id = ? AND COALESCE(reply,'') <> '' AND reply_read = 0"
      )
      .get(req.userId) as any;
    res.json({ unread: Number(row && row.c) || 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* 学生打开「帮助与反馈」时调用：把有回复的条目标记为已读（消红点） */
publicRouter.post('/feedback/read', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const info = db
      .prepare("UPDATE feedback SET reply_read = 1 WHERE user_id = ? AND COALESCE(reply,'') <> '' AND reply_read = 0")
      .run(req.userId);
    res.json({ success: true, marked: info.changes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Public: get changelog
publicRouter.get('/changelog', (_req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const entries = db.prepare(
      'SELECT id, version, date, description FROM changelog ORDER BY created_at DESC'
    ).all();
    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 班级学情报表（2026-11-06，清单第 7 项） ────────────────
// 数据由 server/scripts/class_report.js 预计算到三张表：
//   class_report_daily / class_report_weekly / class_report_summary
// 接口只做读取和分组，不做任何二次统计 —— 老师看到的数字要能跟脚本对得上。

function ensureReportTables(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS class_report_daily (
      user_id INTEGER NOT NULL, username TEXT NOT NULL DEFAULT '', day TEXT NOT NULL,
      reviews INTEGER NOT NULL DEFAULT 0, new_cards INTEGER NOT NULL DEFAULT 0,
      correct INTEGER NOT NULL DEFAULT 0, accuracy REAL NOT NULL DEFAULT 0,
      fast_n INTEGER NOT NULL DEFAULT 0, fast_pct REAL NOT NULL DEFAULT 0,
      seconds REAL NOT NULL DEFAULT 0, effective INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );
    CREATE TABLE IF NOT EXISTS class_report_weekly (
      user_id INTEGER NOT NULL, username TEXT NOT NULL DEFAULT '', week_start TEXT NOT NULL,
      reviews INTEGER NOT NULL DEFAULT 0, active_days INTEGER NOT NULL DEFAULT 0,
      accuracy REAL NOT NULL DEFAULT 0, fast_pct REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, week_start)
    );
    CREATE TABLE IF NOT EXISTS class_report_summary (
      user_id INTEGER PRIMARY KEY, username TEXT NOT NULL DEFAULT '',
      studied INTEGER NOT NULL DEFAULT 0, studied_pct REAL NOT NULL DEFAULT 0,
      rev_30d INTEGER NOT NULL DEFAULT 0, active_30d INTEGER NOT NULL DEFAULT 0,
      acc_30d REAL NOT NULL DEFAULT 0, fast_30d REAL NOT NULL DEFAULT 0,
      days_idle INTEGER NOT NULL DEFAULT 0, wrong_open INTEGER NOT NULL DEFAULT 0,
      flag TEXT NOT NULL DEFAULT '', computed_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

// 班级总览 + 分组
router.get('/class-report', (_req: AuthRequest, res: Response) => {
  try {
    ensureReportTables();
    const db = getDb();
    const rows = db
      .prepare(`SELECT * FROM class_report_summary
                 ORDER BY CASE flag
                   WHEN '稳定' THEN 0 WHEN '正常' THEN 1 WHEN '偏少' THEN 2
                   WHEN '掉队' THEN 3 WHEN '已流失' THEN 4 WHEN '疑似刷时长' THEN 5
                   ELSE 6 END, active_30d DESC`)
      .all() as any[];
    const flags = db
      .prepare('SELECT flag, COUNT(*) n FROM class_report_summary GROUP BY flag ORDER BY n DESC')
      .all() as any[];
    const computedAt = rows.length ? rows[0].computed_at : 0;
    res.json({
      computedAt,
      total: rows.length,
      flags,
      students: rows.map((r) => ({
        userId: r.user_id,
        username: r.username,
        studied: r.studied,
        studiedPct: r.studied_pct,
        rev30: r.rev_30d,
        active30: r.active_30d,
        acc30: r.acc_30d,
        fast30: r.fast_30d,
        daysIdle: r.days_idle,
        wrongOpen: r.wrong_open,
        flag: r.flag,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 近 N 天班级日曲线（有效学习人数、总复习量、平均正确率）
router.get('/class-report/trend', (req: AuthRequest, res: Response) => {
  try {
    ensureReportTables();
    const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 60);
    const rows = getDb()
      .prepare(`SELECT day,
                       SUM(reviews) AS reviews,
                       SUM(CASE WHEN effective=1 THEN 1 ELSE 0 END) AS effective_students,
                       COUNT(DISTINCT user_id) AS active_students,
                       SUM(CASE WHEN correct>0 THEN correct ELSE 0 END) AS correct,
                       SUM(CASE WHEN reviews>0 THEN reviews ELSE 0 END) AS tot
                  FROM class_report_daily
                 WHERE day >= date('now','-${days} days','+8 hours')
                 GROUP BY day ORDER BY day`)
      .all() as any[];
    res.json(
      rows.map((r) => ({
        day: r.day,
        reviews: r.reviews || 0,
        effectiveStudents: r.effective_students || 0,
        activeStudents: r.active_students || 0,
        accuracy: r.tot ? Math.round((r.correct / r.tot) * 1000) / 1000 : 0,
      }))
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 单个学生：近 60 天日表 + 近 8 周周表
router.get('/class-report/student/:id', (req: AuthRequest, res: Response) => {
  try {
    ensureReportTables();
    const db = getDb();
    const uid = Number(req.params.id);
    const summary = db.prepare('SELECT * FROM class_report_summary WHERE user_id=?').get(uid) as any;
    if (!summary) { res.status(404).json({ error: '没有该学生的报表数据' }); return; }
    const daily = db
      .prepare('SELECT day,reviews,new_cards,accuracy,fast_pct,seconds,effective FROM class_report_daily WHERE user_id=? ORDER BY day DESC LIMIT 60')
      .all(uid) as any[];
    const weekly = db
      .prepare('SELECT week_start,reviews,active_days,accuracy,fast_pct FROM class_report_weekly WHERE user_id=? ORDER BY week_start DESC LIMIT 8')
      .all(uid) as any[];
    res.json({
      userId: uid,
      username: summary.username,
      flag: summary.flag,
      studied: summary.studied,
      studiedPct: summary.studied_pct,
      rev30: summary.rev_30d,
      active30: summary.active_30d,
      acc30: summary.acc_30d,
      fast30: summary.fast_30d,
      daysIdle: summary.days_idle,
      wrongOpen: summary.wrong_open,
      daily: daily.map((d) => ({
        day: d.day, reviews: d.reviews, newCards: d.new_cards,
        accuracy: d.accuracy, fastPct: d.fast_pct, seconds: d.seconds, effective: d.effective,
      })),
      weekly: weekly.map((w) => ({
        weekStart: w.week_start, reviews: w.reviews, activeDays: w.active_days,
        accuracy: w.accuracy, fastPct: w.fast_pct,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 今日该找谁谈 —— 老师早上打开第一眼要看的
router.get('/class-report/attention', (_req: AuthRequest, res: Response) => {
  try {
    ensureReportTables();
    const db = getDb();
    const talk = db
      .prepare(`SELECT user_id,username,days_idle,studied,wrong_open,acc_30d
                  FROM class_report_summary WHERE flag IN ('掉队','已流失')
                  ORDER BY days_idle DESC, wrong_open DESC LIMIT 8`)
      .all() as any[];
    const fake = db
      .prepare(`SELECT user_id,username,fast_30d,rev_30d
                  FROM class_report_summary WHERE flag='疑似刷时长'
                  ORDER BY fast_30d DESC LIMIT 8`)
      .all() as any[];
    const never = db
      .prepare("SELECT user_id,username FROM class_report_summary WHERE flag='未开始' ORDER BY username")
      .all() as any[];
    const praise = db
      .prepare(`SELECT user_id,username,active_30d,acc_30d,studied
                  FROM class_report_summary WHERE flag='稳定'
                  ORDER BY active_30d DESC, acc_30d DESC LIMIT 5`)
      .all() as any[];
    res.json({ talk, fake, never, praise });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Public: get site content
publicRouter.get('/site-content', (_req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT key, value FROM settings WHERE key IN ('app_name', 'app_version', 'build_date', 'software_statement')"
    ).all() as { key: string; value: string }[];
    const content: Record<string, string> = {};
    for (const row of rows) {
      content[row.key] = row.value;
    }
    // Default fallbacks
    if (!content.app_name) content.app_name = '刻忆间隔学习平台';
    if (!content.app_version) content.app_version = 'v2.1.0';
    if (!content.build_date) content.build_date = '2026-06-22';
    if (!content.software_statement) {
      content.software_statement = '刻忆间隔学习平台 (Keyi) 是一个基于间隔重复原理的开源学习工具。\n\n本平台使用 Ebbinghaus 遗忘曲线算法优化学习效率，数据存储在本地服务器。\n\n平台不收集任何个人隐私数据，所有学习数据仅存储于您部署的服务器上。\n\n本软件按"原样"提供，不提供任何明示或暗示的保证。';
    }
    res.json(content);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { publicRouter };
export default router;
