// 每次构建生成一个新版本号 → public/version.json
// 前端入口脚本据此判断是否有新版本，有则清缓存并刷新一次
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, '..', 'public', 'version.json');

const payload = {
  version: String(Date.now()),
  buildTime: new Date().toISOString(),
};

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log('[gen-version]', payload.version, payload.buildTime);
