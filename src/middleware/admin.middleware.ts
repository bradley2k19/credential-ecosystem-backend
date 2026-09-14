import { NextFunction, Request, Response } from 'express';
import env from '../config/env';

// Placeholder for a real admin authentication and authorization system.
export function requireAdminSecret(req: Request, res: Response, next: NextFunction) {
  if (req.header('X-Admin-Secret') !== env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Invalid or missing admin secret' });
  }
  return next();
}

export default requireAdminSecret;