import { createHmac } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import prisma from '../config/db';
import env from '../config/env';
import { getClientIp } from './clientIp';

/**
 * Rate limiting backed by the database, because serverless instances share no memory. Each counted request is
 * one RateLimitEvent row; a limit is "at most `limit` events for the same scope and key in the last
 * `windowSeconds`". Keys (IP addresses, emails, user ids) are stored only as an HMAC, never raw.
 */

export interface RateLimitRule {
  scope: string;
  limit: number;
  windowSeconds: number;
}

/** Every limit in one place. */
export const RATE_LIMITS = {
  // Every public verification request, per IP.
  verify: { scope: 'verify', limit: 30, windowSeconds: 60 },
  // Failed logins per IP, and per email and IP together (never the email alone, so nobody can lock
  // someone else out of their account).
  loginIp: { scope: 'login-ip', limit: 20, windowSeconds: 15 * 60 },
  loginPair: { scope: 'login-pair', limit: 5, windowSeconds: 15 * 60 },
  // Every registration request (institution, student and employer together), per IP.
  register: { scope: 'register', limit: 5, windowSeconds: 60 * 60 },
  // Wrong current passwords, per signed-in user.
  changePassword: { scope: 'pwd', limit: 5, windowSeconds: 15 * 60 }
} as const satisfies Record<string, RateLimitRule>;

export const RATE_LIMIT_MESSAGES = {
  verify: 'Too many verification requests. Please wait a minute and try again.',
  // The same message for every lockout, so it never reveals whether an account exists.
  attempts: 'Too many attempts. Please try again later.'
} as const;

/** About one call in this many also deletes events older than RETENTION_MS. */
const CLEANUP_ONE_IN = 50;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** The few database operations the limiter needs (injected in tests). */
export interface RateLimitStore {
  /** The newest `take` events for the scope and key created after `since`, newest first. */
  recentEvents(scope: string, keyHash: string, since: Date, take: number): Promise<{ createdAt: Date }[]>;
  addEvent(scope: string, keyHash: string, createdAt: Date): Promise<unknown>;
  deleteOlderThan(cutoff: Date): Promise<unknown>;
}

export const prismaRateLimitStore: RateLimitStore = {
  recentEvents: (scope, keyHash, since, take) => prisma.rateLimitEvent.findMany({
    where: { scope, keyHash, createdAt: { gt: since } },
    orderBy: { createdAt: 'desc' },
    take,
    select: { createdAt: true }
  }),
  addEvent: (scope, keyHash, createdAt) => prisma.rateLimitEvent.create({ data: { scope, keyHash, createdAt } }),
  deleteOlderThan: (cutoff) => prisma.rateLimitEvent.deleteMany({ where: { createdAt: { lt: cutoff } } })
};

export interface RateLimiterOptions {
  store: RateLimitStore;
  secret: string;
  now?: () => Date;
  random?: () => number;
  logError?: (message: string, error: unknown) => void;
}

const logToConsole = (message: string, error: unknown) => console.error(message, error instanceof Error ? error.message : error);

export function createRateLimiter({ store, secret, now = () => new Date(), random = Math.random, logError = logToConsole }: RateLimiterOptions) {
  /** HMAC-SHA256 of the key (with its scope), so raw IP addresses and emails are never stored. */
  function hashKey(scope: string, key: string) {
    return createHmac('sha256', secret).update(`${scope}\n${key}`).digest('hex');
  }

  async function decide(rule: RateLimitRule, keyHash: string, at: Date): Promise<RateLimitDecision> {
    const windowMs = rule.windowSeconds * 1000;
    const recent = await store.recentEvents(rule.scope, keyHash, new Date(at.getTime() - windowMs), rule.limit);
    if (recent.length < rule.limit) return { allowed: true };
    // Once the limit-th newest event leaves the window, fewer than `limit` remain. When the count is exactly
    // at the limit, that is the oldest event in the window.
    const freedAt = recent[rule.limit - 1].createdAt.getTime() + windowMs;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((freedAt - at.getTime()) / 1000)) };
  }

  async function cleanUp(at: Date) {
    if (random() >= 1 / CLEANUP_ONE_IN) return;
    try {
      await store.deleteOlderThan(new Date(at.getTime() - RETENTION_MS));
    } catch (error) {
      logError('Rate limit cleanup failed:', error);
    }
  }

  /** Counts only. Fails open: if the database cannot be read, the request is allowed. */
  async function check(rule: RateLimitRule, key: string): Promise<RateLimitDecision> {
    try {
      return await decide(rule, hashKey(rule.scope, key), now());
    } catch (error) {
      logError(`Rate limit check failed (${rule.scope}); allowing the request:`, error);
      return { allowed: true };
    }
  }

  /** Records one event (for example a failed login). A failure to record is logged and ignored. */
  async function record(rule: RateLimitRule, key: string): Promise<void> {
    const at = now();
    try {
      await store.addEvent(rule.scope, hashKey(rule.scope, key), at);
    } catch (error) {
      logError(`Rate limit record failed (${rule.scope}):`, error);
    }
    await cleanUp(at);
  }

  /** Blocks when the limit is already reached, otherwise records this request and allows it. Fails open. */
  async function checkAndRecord(rule: RateLimitRule, key: string): Promise<RateLimitDecision> {
    const at = now();
    const keyHash = hashKey(rule.scope, key);
    try {
      const decision = await decide(rule, keyHash, at);
      if (!decision.allowed) return decision;
      await store.addEvent(rule.scope, keyHash, at);
    } catch (error) {
      logError(`Rate limit check failed (${rule.scope}); allowing the request:`, error);
      return { allowed: true };
    }
    await cleanUp(at);
    return { allowed: true };
  }

  return { check, record, checkAndRecord, hashKey };
}

export const rateLimiter = createRateLimiter({ store: prismaRateLimitStore, secret: env.JWT_SECRET });

/** The longest wait among blocked decisions, or null when every one allows the request. */
export function longestWait(decisions: RateLimitDecision[]): number | null {
  const waits = decisions.flatMap((decision) => (decision.allowed ? [] : [decision.retryAfterSeconds]));
  return waits.length ? Math.max(...waits) : null;
}

/** 429 with a Retry-After header (seconds) and `{ error, retryAfterSeconds }`. */
export function sendTooManyRequests(res: Response, message: string, retryAfterSeconds: number) {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(429).json({ error: message, retryAfterSeconds });
}

/** Middleware: counts every request per client IP under `rule`, and answers 429 once the limit is reached. */
export function limitRequestsByIp(rule: RateLimitRule, message: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const decision = await rateLimiter.checkAndRecord(rule, getClientIp(req));
    if (!decision.allowed) return sendTooManyRequests(res, message, decision.retryAfterSeconds);
    return next();
  };
}
