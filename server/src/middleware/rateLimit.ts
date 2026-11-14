import { Request, Response, NextFunction } from 'express';

/**
 * 极简内存滑动窗口限流中间件。
 *
 * 【2026-09-12 新增】本站在此之前**完全没有限流**，配合 bcrypt.compareSync 的
 * 同步阻塞（实测单次约 96ms），构成一个未授权的低成本拒绝服务：
 * 攻击者并发打 /api/auth/login 或 /api/course/unlock 即可让单进程 Node 的
 * 事件循环饱和，133 名用户的整站卡死。
 *
 * 设计取舍：
 *  - 单进程内存实现，够用且不引入新依赖（本项目依赖已经很精简）。
 *  - 若将来做多实例部署，必须换成 Redis 等共享存储，否则限流形同虚设。
 *  - 计数 key 默认取 req.ip。这依赖 index.ts 里 trust proxy 的正确配置：
 *    必须是 'loopback'（只信任本机 nginx），若写成 true 则 req.ip 取的是
 *    客户端可伪造的 X-Forwarded-For 最左值，限流可被一行请求头绕过。
 */

export interface RateLimitOptions {
  /** 窗口长度（毫秒） */
  windowMs: number;
  /** 窗口内允许的最大请求数 */
  max: number;
  /** 超限时的提示文案 */
  message?: string;
  /** 自定义计数维度；默认 req.ip */
  keyOf?: (req: Request) => string;
}

interface Bucket {
  hits: number[];
}

export function rateLimit(opts: RateLimitOptions) {
  const { windowMs, max, message = '请求过于频繁，请稍后再试', keyOf } = opts;
  const buckets = new Map<string, Bucket>();

  // 定期清理过期 bucket，避免内存随 IP 数无限增长
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
      if (bucket.hits.length === 0) buckets.delete(key);
    }
  }, Math.max(windowMs, 30_000));
  // 不要因为这个定时器而阻止进程退出
  if (typeof sweeper.unref === 'function') sweeper.unref();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const key = keyOf ? keyOf(req) : req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { hits: [] };
      buckets.set(key, bucket);
    }
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

    if (bucket.hits.length >= max) {
      const oldest = bucket.hits[0];
      const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({ error: message, retryAfter: retryAfterSec });
      return;
    }

    bucket.hits.push(now);
    next();
  };
}
