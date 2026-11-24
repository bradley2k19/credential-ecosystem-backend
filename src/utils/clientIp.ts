import type { Request } from 'express';

/**
 * The client's IP address, the one value used for both verification logging and rate limiting. Express derives
 * `req.ip` from the connection, and from X-Forwarded-For only as far as `trust proxy` allows (index.ts trusts
 * exactly one hop: Vercel's edge, which sets that header itself). No client-sent header is read directly.
 */
export function getClientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export default getClientIp;
