"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getClientIp = getClientIp;
/**
 * The client's IP address, the one value used for both verification logging and rate limiting. Express derives
 * `req.ip` from the connection, and from X-Forwarded-For only as far as `trust proxy` allows (index.ts trusts
 * exactly one hop: Vercel's edge, which sets that header itself). No client-sent header is read directly.
 */
function getClientIp(req) {
    return req.ip || req.socket?.remoteAddress || 'unknown';
}
exports.default = getClientIp;
