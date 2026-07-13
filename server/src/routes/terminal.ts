import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AuthRequest } from '../middleware/auth';
import { adminMiddleware } from '../middleware/auth';

const router = Router();
router.use(adminMiddleware);

const execAsync = promisify(exec);

// Allowed commands whitelist (safe subset for admin)
const ALLOWED_COMMANDS = [
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'find', 'du', 'df',
  'top', 'ps', 'free', 'uptime', 'uname', 'hostname', 'ip', 'ss',
  'systemctl', 'journalctl', 'git', 'npm', 'node', 'docker',
  'sqlite3', 'python3', 'curl', 'wget', 'tar', 'zip', 'unzip',
  'chmod', 'chown', 'mkdir', 'rm', 'cp', 'mv', 'touch',
  'kill', 'pkill', 'lsof', 'netstat', 'ping', 'nslookup',
  'dig', 'traceroute', 'ssh', 'scp', 'rsync',
  'htop', 'nmon', 'iotop', 'ifconfig', 'route',
  'echo', 'date', 'whoami', 'env', 'printenv', 'id',
  'systemd-analyze', 'mount', 'umount', 'blkid', 'fdisk',
  'apt', 'apt-get', 'dpkg', 'pip3', 'pip', 'pip3 install',
  'service', 'reload', 'restart', 'status', 'logs',
  'tail -f', 'less', 'more', 'man', 'info',
  'du -sh', 'df -h', 'free -h', 'top -bn1', 'ps aux',
  'ls -la', 'ls -lh', 'ls -l', 'ls -lah',
  'cat /etc/os-release', 'cat /etc/hostname', 'cat /proc/cpuinfo',
  'cat /proc/meminfo',
  'npx', 'yarn', 'pnpm', 'go', 'gcc', 'g++', 'make', 'cmake',
  'tree', 'xargs', 'sed', 'awk', 'sort', 'uniq', 'cut', 'tr',
  'tee', 'xsel', 'xclip', 'pbcopy', 'pbpaste',
  'pgrep', 'fuser', 'strace', 'ltrace', 'ldd', 'file',
  'md5sum', 'sha256sum', 'sha1sum', 'bc', 'expr',
];

// Max output size: 100KB
const MAX_OUTPUT_BYTES = 100 * 1024;

// Timeout: 60 seconds
const COMMAND_TIMEOUT = 60000;

function sanitizeCommand(input: string): string {
  // Remove null bytes and control characters (except newline/tab)
  return input.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

function checkCommandWhitelist(cmd: string): boolean {
  const trimmed = cmd.trim();
  // Direct match
  if (ALLOWED_COMMANDS.includes(trimmed)) return true;
  // Check base command
  const baseCmd = trimmed.split(/\s+/)[0].split('/').pop() || '';
  return ALLOWED_COMMANDS.some(a => {
    const aBase = a.split(/\s+/)[0].split('/').pop() || '';
    return aBase === baseCmd;
  });
}

// Execute a shell command
router.post('/execute', async (req: AuthRequest, res: Response) => {
  try {
    const { command, clean } = req.body as { command?: string; clean?: boolean };

    if (!command || typeof command !== 'string') {
      res.status(400).json({ error: '命令不能为空' });
      return;
    }

    const sanitized = sanitizeCommand(command);
    if (sanitized !== command) {
      res.status(400).json({ error: '命令包含非法字符' });
      return;
    }

    // If clean mode (default), enforce whitelist
    if (clean !== false && !checkCommandWhitelist(sanitized)) {
      res.status(403).json({ error: '该命令不在白名单中' });
      return;
    }

    // Block dangerous patterns regardless
    const dangerousPatterns = [
      /\/dev\/[a-z]/,           // overwrite critical devices
      /;\s*(shutdown|reboot|halt)/,  // system shutdown
      /&&\s*(shutdown|reboot|halt)/,
      /\|\s*(sudo|su\s)/,  // privilege escalation
      /\/etc\/(passwd|shadow)/,  // sensitive files
      /\$\{/,  // variable expansion
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(sanitized)) {
        res.status(403).json({ error: '命令包含不安全操作' });
        return;
      }
    }

    const safeCmd = sanitized.replace(/'/g, "'\\''");
    const result = await execAsync(`/bin/sh -c '${safeCmd}'`, {
      timeout: COMMAND_TIMEOUT,
      maxBuffer: MAX_OUTPUT_BYTES,
    });

    const output = (result.stdout || '') + (result.stderr || '');
    res.json({
      success: true,
      output: output.substring(0, MAX_OUTPUT_BYTES),
      exitCode: 0,
    });
  } catch (err: any) {
    const output = err.stdout || err.stderr || '';
    res.status(500).json({
      success: false,
      output: output.substring(0, MAX_OUTPUT_BYTES),
      exitCode: err.code || 1,
      error: err.message || '命令执行失败',
    });
  }
});

// Get system info
router.get('/system-info', (req: AuthRequest, res: Response) => {
  try {
    const os = require('os');

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    res.json({
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      uptime: os.uptime(),
      totalMemory: totalMem,
      freeMemory: freeMem,
      usedMemory: usedMem,
      cpuCount: os.cpus().length,
      nodeVersion: process.version,
      projectDir: process.cwd(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
