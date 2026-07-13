import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/database';

const JWT_SECRET = process.env.JWT_SECRET || 'keyi-secret-change-in-production';

export interface AuthRequest extends Request {
  userId?: number;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: '需要身份验证' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: '令牌无效或已过期' });
  }
}

export function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  authMiddleware(req, res, () => {
    try {
      const db = getDb();
      const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.userId) as any;
      if (!user || user.role !== 'admin') {
        res.status(403).json({ error: '需要管理员权限' });
        return;
      }
      next();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

export function generateToken(userId: number): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}
