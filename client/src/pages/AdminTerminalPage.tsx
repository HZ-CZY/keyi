import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import {
  Terminal as TerminalIcon,
  Monitor,
  MonitorOff,
  RefreshCw,
  Maximize2,
  Minimize2,
  Server,
  Cpu,
  MemoryStick,
  Clock,
  Activity,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import 'xterm/css/xterm.css';

interface SystemInfo {
  hostname: string;
  platform: string;
  arch: string;
  uptime: number;
  totalMemory: number;
  freeMemory: number;
  usedMemory: number;
  cpuCount: number;
  nodeVersion: string;
  projectDir: string;
}

export default function AdminTerminalPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const termInitRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Load system info on mount
  useEffect(() => {
    api.admin.terminalSystemInfo()
      .then(setSystemInfo)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Initialize xterm.js once
  useEffect(() => {
    if (!containerRef.current || termInitRef.current) return;
    termInitRef.current = true;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, monospace',
      theme: {
        background: '#0a0a0a',
        foreground: '#d4d4d4',
        cursor: '#aeafad',
        selectionBackground: '#ffffff40',
        black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
        blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
        brightBlack: '#555555', brightRed: '#f14c4c', brightGreen: '#23d18b',
        brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6',
        brightCyan: '#29b8db', brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Forward terminal input to WebSocket
    term.onData((data) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }));
      }
    });

    return () => {
      // Don't dispose on unmount, we'll handle it on disconnect
    };
  }, []);

  // Connect to terminal
  const connect = useCallback(async () => {
    if (connected) return;
    setLoading(true);
    setError('');

    try {
      // 1. Create session
      const { sessionId } = await api.admin.terminalCreate({ cols: 80, rows: 24 });

      // 2. Get token
      const token = localStorage.getItem('token');
      if (!token) {
        setError('未找到登录凭证，请刷新页面');
        setLoading(false);
        return;
      }

      // 3. Build WebSocket URL
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const host = window.location.hostname;
      const port = window.location.port || '3099';
      const wsUrl = `${proto}://${host}:${port}/api/admin/terminal/ws?sessionId=${sessionId}&token=${token}`;

      console.log('[Terminal] Connecting to:', wsUrl);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Terminal] Connected');
        setConnected(true);
        setLoading(false);
        // Fit after connection
        setTimeout(() => fitAddonRef.current?.fit(), 100);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === 'output' && termRef.current) {
            termRef.current.write(msg.data);
          }
        } catch(e) {
          // Raw text
          if (termRef.current) {
            termRef.current.write(event.data as string);
          }
        }
      };

      ws.onerror = () => {
        console.error('[Terminal] WebSocket error');
        setError('连接失败，请检查网络');
        setLoading(false);
      };

      ws.onclose = () => {
        console.log('[Terminal] Disconnected');
        setConnected(false);
        wsRef.current = null;
        setLoading(false);
        // Auto reconnect after 3s
        reconnectTimerRef.current = setTimeout(() => {
          console.log('[Terminal] Auto reconnecting...');
          connect();
        }, 3000);
      };
    } catch (err: any) {
      console.error('[Terminal] Connect error:', err);
      setError(err.message || '连接失败');
      setLoading(false);
    }
  }, [connected]);

  // Disconnect
  const disconnect = useCallback(async () => {
    // Clear reconnect timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    // Kill session on server
    const sessionId = wsRef.current?.url?.split('sessionId=')[1]?.split('&')[0];
    if (sessionId) {
      try {
        await api.admin.terminalKill({ sessionId });
      } catch(e) {}
    }

    // Close WS
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnected(false);
  }, []);

  // Resize handler
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current) {
        try { fitAddonRef.current.fit(); } catch(e) {}
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen().catch(() => {});
      setFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setFullscreen(false);
    }
  };

  if (loading && !connected) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin text-primary-600" />
          <p className="text-gray-500">正在连接终端...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <TerminalIcon className="w-8 h-8 text-indigo-500" />
            系统终端
          </h1>
          <p className="text-gray-500 mt-1">交互式 Shell — 像 SSH 一样操作服务器</p>
        </div>
        <div className="flex items-center gap-2">
          {!connected ? (
            <button
              onClick={connect}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-all text-sm font-medium"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Monitor className="w-4 h-4" />}
              {loading ? '连接中...' : '连接终端'}
            </button>
          ) : (
            <>
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 text-green-700 text-sm font-medium border border-green-200">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                已连接
              </span>
              <button onClick={() => { if (fitAddonRef.current) { fitAddonRef.current.fit(); } }}
                className="p-2 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-all" title="调整大小">
                <RefreshCw className="w-4 h-4" />
              </button>
              <button onClick={toggleFullscreen}
                className="p-2 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-all" title="全屏">
                {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
              <button onClick={disconnect}
                className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all" title="断开">
                <MonitorOff className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* System Info */}
      {systemInfo && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { icon: Server, label: '主机名', value: systemInfo.hostname, color: 'text-blue-600' },
            { icon: Cpu, label: 'CPU', value: `${systemInfo.cpuCount}核`, color: 'text-green-600' },
            { icon: MemoryStick, label: '内存', value: `${(systemInfo.usedMemory / 1024 / 1024 / 1024).toFixed(1)}G`, color: 'text-purple-600' },
            { icon: Clock, label: '运行', value: `${Math.floor(systemInfo.uptime / 3600)}小时`, color: 'text-cyan-600' },
            { icon: Activity, label: 'Node', value: systemInfo.nodeVersion, color: 'text-emerald-600' },
            { icon: Monitor, label: '状态', value: connected ? '在线' : '离线', color: connected ? 'text-green-600' : 'text-gray-400' },
          ].map(({ icon: Icon, label, value, color }, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-2.5 shadow-sm">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Icon className={`w-3.5 h-3.5 ${color}`} />
                <span className="text-xs text-gray-500">{label}</span>
              </div>
              <p className="text-sm font-medium text-gray-900">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Terminal Container */}
      <div className={`bg-gray-950 rounded-xl border border-gray-800 shadow-soft-lg overflow-hidden ${fullscreen ? 'fixed inset-0 z-50 rounded-none border-0' : ''}`}>
        {/* Terminal Header Bar */}
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-800">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <div className="w-3 h-3 rounded-full bg-green-500" />
          </div>
          <span className="text-xs text-gray-500 font-mono ml-2">
            {connected ? `root@${systemInfo?.hostname || 'server'} — bash` : '未连接'}
          </span>
        </div>

        {/* Terminal Body */}
        <div ref={containerRef} className={`${connected ? 'h-[calc(100vh-280px)] min-h-[400px]' : 'h-[300px]'} flex items-center justify-center`}>
          {!connected && !error && (
            <div className="text-center text-gray-500">
              <TerminalIcon className="w-12 h-12 mx-auto mb-3 text-gray-700" />
              <p className="text-gray-400 mb-2">点击「连接终端」开始</p>
              <p className="text-xs text-gray-600">连接后将获得一个交互式 bash Shell</p>
            </div>
          )}
        </div>
      </div>

      {/* Warning */}
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-amber-800 font-medium">终端警告</p>
          <p className="text-amber-700 text-sm mt-1">
            您拥有服务器的完全访问权限。请谨慎操作，错误的命令可能导致系统不稳定或数据丢失。
          </p>
        </div>
      </div>
    </div>
  );
}
