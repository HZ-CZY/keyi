import express from 'express';
import cors from 'cors';
import path from 'path';
import { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import authRoutes from './routes/auth';
import deckRoutes from './routes/decks';
import cardRoutes from './routes/cards';
import noteRoutes from './routes/notes';
import importRoutes from './routes/import';
import adminRoutes from './routes/admin';
import adminAiImportRoutes from './routes/admin-ai-import';
import adminAiChatRoutes from './routes/admin-ai-chat';
import adminChangelogRoutes, { publicRouter as changelogPublicRoutes } from './routes/admin-changelog';
import translateRoutes from './routes/translate';
import dictRoutes from './routes/dict';
import announcementsRoutes, { publicRouter as announcementsPublicRoutes } from './routes/announcements';
import terminalRoutes, { sessions, sessionWsMap } from './routes/ws-terminal';

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy so req.ip reads X-Forwarded-From (real client IP behind nginx)
app.set('trust proxy', true);

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/decks', deckRoutes);
app.use('/api/cards', cardRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/import', importRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', adminAiImportRoutes);
app.use('/api/admin', adminAiChatRoutes);
app.use('/api/admin', adminChangelogRoutes);
app.use('/api', changelogPublicRoutes);
app.use('/api/translate', translateRoutes);
app.use('/api/dict', dictRoutes);
app.use('/api/admin', announcementsRoutes);
app.use('/api/admin/terminal', terminalRoutes);
app.use('/api', announcementsPublicRoutes);

// Serve uploaded avatars
app.use('/uploads/avatars', express.static(path.join(__dirname, '..', 'public', 'avatars')));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const clientPath = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
  });
}

// ── WebSocket Terminal ──────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

const server = app.listen(PORT, () => {
  console.log(`刻忆 Server running on http://localhost:${PORT}`);
});

// Handle WebSocket upgrades
server.on('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
  const url = request.url || '';
  // Match /api/admin/terminal/ws?sessionId=xxx&token=xxx
  if (url.startsWith('/api/admin/terminal/ws')) {
    console.log('[Terminal] Upgrade request:', url);
    const params = new URLSearchParams(url.split('?')[1]);
    const sessionId = params.get('sessionId');
    const token = params.get('token');
    console.log('[Terminal] sessionId:', sessionId, 'token length:', token ? token.length : 0);

    if (!sessionId || !token) {
      socket.destroy();
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // Authenticate
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'keyi-secret-change-me';
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      if (decoded.role !== 'admin') {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    } catch (err) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws: any) => {
      wss.emit('connection', ws, sessionId);
    });
  }
});

// WebSocket connection handler
wss.on('connection', (ws: any, sessionId: string) => {
  const session = sessions.get(sessionId);
  if (!session) {
    ws.close();
    return;
  }

  sessionWsMap.set(sessionId, ws);

  console.log(`Terminal connected: ${sessionId}`);

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    message: '刻忆交互式终端\n输入命令并回车执行。\n按 Ctrl+C 发送中断信号。\n'
  }));

  // Handle incoming data from client
  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'input') {
        const input = msg.data + '\n';
        session.pty.stdin.write(input);
      } else if (msg.type === 'resize') {
        const cols = msg.cols || 80;
        const rows = msg.rows || 24;
        try {
          const { execSync } = require('child_process');
          execSync(`stty cols ${cols} rows ${rows} < /dev/tty 2>/dev/null`, {
            stdio: ['pipe', 'ignore', 'ignore']
          });
        } catch(e) {}
        session.cols = cols;
        session.rows = rows;
      } else if (msg.type === 'keydown') {
        const key = msg.data;
        if (key === '\x03') { // Ctrl+C
          session.pty.stdin.write('\x03');
        } else if (key === '\x04') { // Ctrl+D
          session.pty.stdin.write('\x04');
        } else if (key === '\x1c') { // Ctrl+Z
          session.pty.stdin.write('\x1c');
        } else {
          session.pty.stdin.write(key);
        }
      }
    } catch (err) {
      session.pty.stdin.write(data.toString());
    }
  });

  // Handle client disconnect
  ws.on('close', () => {
    console.log(`Terminal disconnected: ${sessionId}`);
    sessionWsMap.delete(sessionId);
  });

  ws.on('error', (err: Error) => {
    console.error(`WS error [${sessionId}]:`, err.message);
    sessionWsMap.delete(sessionId);
  });
});

export default app;
