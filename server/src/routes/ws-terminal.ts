import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import { adminMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(adminMiddleware);

// Track active terminal sessions
interface Session {
  pty: ReturnType<typeof spawn>;
  cols: number;
  rows: number;
}
const sessions = new Map<string, Session>();

function streamOutput(sessionId: string, stream: any) {
  stream.on('data', (data: Buffer) => {
    const ws = sessionWsMap.get(sessionId);
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString('utf-8') }));
    }
  });
}

// Create a new PTY session
router.post('/create', (req: AuthRequest, res: Response) => {
  try {
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const cols = parseInt(req.body.cols) || 80;
    const rows = parseInt(req.body.rows) || 24;

    const pty = spawn('bash', ['--login'], {
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        LANG: 'zh_CN.UTF-8',
      },
      cwd: '/root/project-backup',
    });

    sessions.set(sessionId, { pty, cols, rows });

    streamOutput(sessionId, pty.stdout);
    streamOutput(sessionId, pty.stderr);

    pty.on('exit', () => {
      sessions.delete(sessionId);
      const ws = sessionWsMap.get(sessionId);
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'closed' }));
      }
    });

    pty.on('error', (err: Error) => {
      console.error(`PTY error [${sessionId}]:`, err.message);
      const ws = sessionWsMap.get(sessionId);
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    });

    res.json({ sessionId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Resize session
router.post('/resize', (req: AuthRequest, res: Response) => {
  try {
    const { sessionId, cols, rows } = req.body;
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: '会话不存在' });
      return;
    }
    session.cols = cols;
    session.rows = rows;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List active sessions
router.get('/sessions', (req: AuthRequest, res: Response) => {
  const list: { sessionId: string; cols: number; rows: number }[] = [];
  sessions.forEach((session, id) => {
    list.push({ sessionId: id, cols: session.cols, rows: session.rows });
  });
  res.json(list);
});

// Kill a session
router.post('/kill', (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);
    if (session) {
      session.pty.kill('SIGTERM');
      sessions.delete(sessionId);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Map from sessionId to WebSocket
const sessionWsMap = new Map<string, any>();

export { sessions, sessionWsMap, router as terminalRouter };
export default router;
