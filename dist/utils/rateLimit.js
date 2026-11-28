"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimiter = exports.prismaRateLimitStore = exports.RATE_LIMIT_MESSAGES = exports.RATE_LIMITS = void 0;
exports.createRateLimiter = createRateLimiter;
exports.longestWait = longestWait;
exports.sendTooManyRequests = sendTooManyRequests;
exports.limitRequestsByIp = limitRequestsByIp;
const crypto_1 = require("crypto");
const db_1 = __importDefault(require("../config/db"));
const env_1 = __importDefault(require("../config/env"));
const clientIp_1 = require("./clientIp");
/** Every limit in one place. */
exports.RATE_LIMITS = {
    // Every public verification request, per IP.
    verify: { scope: 'verify', limit: 30, windowSeconds: 60 },
    // Failed logins per IP, and per email and IP together (never the email alone, so nobody can lock
    // someone else out of their account).
    loginIp: { scope: 'login-ip', limit: 20, windowSeconds: 15 * 60 },
    loginPair: { scope: 'login-pair', limit: 5, windowSeconds: 15 * 60 },
    // Every registration request (institution, student and employer together), per IP.
    register: { scope: 'register', limit: 5, windowSeconds: 60 * 60 },
    // Wrong current passwords, per signed-in user.
    changePassword: { scope: 'pwd', limit: 5, windowSeconds: 15 * 60 },
    // Correction requests created, per student.
    correctionRequest: { scope: 'correction', limit: 5, windowSeconds: 24 * 60 * 60 }
};
exports.RATE_LIMIT_MESSAGES = {
    verify: 'Too many verification requests. Please wait a minute and try again.',
    correctionRequest: 'You can request at most 5 corrections a day. Please try again later.',
    // The same message for every lockout, so it never reveals whether an account exists.
    attempts: 'Too many attempts. Please try again later.'
};
/** About one call in this many also deletes events older than RETENTION_MS. */
const CLEANUP_ONE_IN = 50;
const RETENTION_MS = 24 * 60 * 60 * 1000;
exports.prismaRateLimitStore = {
    recentEvents: (scope, keyHash, since, take) => db_1.default.rateLimitEvent.findMany({
        where: { scope, keyHash, createdAt: { gt: since } },
        orderBy: { createdAt: 'desc' },
        take,
        select: { createdAt: true }
    }),
    addEvent: (scope, keyHash, createdAt) => db_1.default.rateLimitEvent.create({ data: { scope, keyHash, createdAt } }),
    deleteOlderThan: (cutoff) => db_1.default.rateLimitEvent.deleteMany({ where: { createdAt: { lt: cutoff } } })
};
const logToConsole = (message, error) => console.error(message, error instanceof Error ? error.message : error);
function createRateLimiter({ store, secret, now = () => new Date(), random = Math.random, logError = logToConsole }) {
    /** HMAC-SHA256 of the key (with its scope), so raw IP addresses and emails are never stored. */
    function hashKey(scope, key) {
        return (0, crypto_1.createHmac)('sha256', secret).update(`${scope}\n${key}`).digest('hex');
    }
    async function decide(rule, keyHash, at) {
        const windowMs = rule.windowSeconds * 1000;
        const recent = await store.recentEvents(rule.scope, keyHash, new Date(at.getTime() - windowMs), rule.limit);
        if (recent.length < rule.limit)
            return { allowed: true };
        // Once the limit-th newest event leaves the window, fewer than `limit` remain. When the count is exactly
        // at the limit, that is the oldest event in the window.
        const freedAt = recent[rule.limit - 1].createdAt.getTime() + windowMs;
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((freedAt - at.getTime()) / 1000)) };
    }
    async function cleanUp(at) {
        if (random() >= 1 / CLEANUP_ONE_IN)
            return;
        try {
            await store.deleteOlderThan(new Date(at.getTime() - RETENTION_MS));
        }
        catch (error) {
            logError('Rate limit cleanup failed:', error);
        }
    }
    /** Counts only. Fails open: if the database cannot be read, the request is allowed. */
    async function check(rule, key) {
        try {
            return await decide(rule, hashKey(rule.scope, key), now());
        }
        catch (error) {
            logError(`Rate limit check failed (${rule.scope}); allowing the request:`, error);
            return { allowed: true };
        }
    }
    /** Records one event (for example a failed login). A failure to record is logged and ignored. */
    async function record(rule, key) {
        const at = now();
        try {
            await store.addEvent(rule.scope, hashKey(rule.scope, key), at);
        }
        catch (error) {
            logError(`Rate limit record failed (${rule.scope}):`, error);
        }
        await cleanUp(at);
    }
    /** Blocks when the limit is already reached, otherwise records this request and allows it. Fails open. */
    async function checkAndRecord(rule, key) {
        const at = now();
        const keyHash = hashKey(rule.scope, key);
        try {
            const decision = await decide(rule, keyHash, at);
            if (!decision.allowed)
                return decision;
            await store.addEvent(rule.scope, keyHash, at);
        }
        catch (error) {
            logError(`Rate limit check failed (${rule.scope}); allowing the request:`, error);
            return { allowed: true };
        }
        await cleanUp(at);
        return { allowed: true };
    }
    return { check, record, checkAndRecord, hashKey };
}
exports.rateLimiter = createRateLimiter({ store: exports.prismaRateLimitStore, secret: env_1.default.JWT_SECRET });
/** The longest wait among blocked decisions, or null when every one allows the request. */
function longestWait(decisions) {
    const waits = decisions.flatMap((decision) => (decision.allowed ? [] : [decision.retryAfterSeconds]));
    return waits.length ? Math.max(...waits) : null;
}
/** 429 with a Retry-After header (seconds) and `{ error, retryAfterSeconds }`. */
function sendTooManyRequests(res, message, retryAfterSeconds) {
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(429).json({ error: message, retryAfterSeconds });
}
/** Middleware: counts every request per client IP under `rule`, and answers 429 once the limit is reached. */
function limitRequestsByIp(rule, message) {
    return async (req, res, next) => {
        const decision = await exports.rateLimiter.checkAndRecord(rule, (0, clientIp_1.getClientIp)(req));
        if (!decision.allowed)
            return sendTooManyRequests(res, message, decision.retryAfterSeconds);
        return next();
    };
}
