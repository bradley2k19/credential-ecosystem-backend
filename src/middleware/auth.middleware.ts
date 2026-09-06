import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import env from '../config/env';

export interface AuthRequest extends Request {
  user?: { id: string; role: string; [key: string]: any };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as any;
    req.user = { id: payload.id, role: payload.role };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(roles: string | string[]) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Missing authorization token' });
    if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    return next();
  };
}

export default { requireAuth, requireRole };
