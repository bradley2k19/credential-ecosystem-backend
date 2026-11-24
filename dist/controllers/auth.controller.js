"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = __importDefault(require("../config/db"));
const password_1 = require("../utils/password");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = __importDefault(require("../config/env"));
const clientIp_1 = require("../utils/clientIp");
const rateLimit_1 = require("../utils/rateLimit");
const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
async function registerInstitution(req, res) {
    const { email, password, name, registrationNumber, address, contactEmail } = req.body;
    if (!email || !password || !name || !registrationNumber) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!emailRegex.test(email))
        return res.status(400).json({ error: 'Invalid email' });
    let existing;
    try {
        existing = await db_1.default.user.findUnique({ where: { email } });
    }
    catch (err) {
        console.error('Database unreachable:', err.message || err);
        return res.status(503).json({ error: 'Database unreachable' });
    }
    if (existing)
        return res.status(409).json({ error: 'Email already registered' });
    const passwordHash = await (0, password_1.hashPassword)(password);
    try {
        const result = await db_1.default.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: { email, passwordHash, role: 'INSTITUTION' }
            });
            const institution = await tx.institution.create({
                data: {
                    userId: user.id,
                    name,
                    registrationNumber,
                    address,
                    contactEmail
                }
            });
            return { user, institution };
        });
        return res.status(201).json({ id: result.user.id, email: result.user.email, role: result.user.role });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to register institution' });
    }
}
async function registerStudent(req, res) {
    const { email, password, fullName, studentNumber, institutionId, programName, enrollmentYear, dateOfBirth } = req.body;
    if (!email || !password || !fullName || !studentNumber || !institutionId || !programName || !enrollmentYear) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!emailRegex.test(email))
        return res.status(400).json({ error: 'Invalid email' });
    try {
        const existingStudentUser = await db_1.default.user.findUnique({ where: { email } });
        if (existingStudentUser)
            return res.status(409).json({ error: 'Email already registered' });
        // ensure institution exists
        const institution = await db_1.default.institution.findUnique({ where: { id: institutionId } });
        if (!institution)
            return res.status(400).json({ error: 'Invalid institutionId' });
        const passwordHash = await (0, password_1.hashPassword)(password);
        const result = await db_1.default.$transaction(async (tx) => {
            const user = await tx.user.create({ data: { email, passwordHash, role: 'STUDENT' } });
            const student = await tx.student.create({
                data: {
                    userId: user.id,
                    institutionId,
                    fullName,
                    studentNumber,
                    programName,
                    enrollmentYear: Number(enrollmentYear),
                    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined
                }
            });
            return { user, student };
        });
        return res.status(201).json({ id: result.user.id, email: result.user.email, role: result.user.role });
    }
    catch (err) {
        console.error('Database error:', err.message || err);
        return res.status(503).json({ error: 'Database unreachable or operation failed' });
    }
}
async function registerEmployer(req, res) {
    const { email, password, companyName, registrationNumber, industry, contactEmail } = req.body;
    if (!email || !password || !companyName)
        return res.status(400).json({ error: 'Missing required fields' });
    if (!emailRegex.test(email))
        return res.status(400).json({ error: 'Invalid email' });
    try {
        const existingEmployerUser = await db_1.default.user.findUnique({ where: { email } });
        if (existingEmployerUser)
            return res.status(409).json({ error: 'Email already registered' });
        const passwordHash = await (0, password_1.hashPassword)(password);
        const result = await db_1.default.$transaction(async (tx) => {
            const user = await tx.user.create({ data: { email, passwordHash, role: 'EMPLOYER' } });
            const employer = await tx.employer.create({
                data: {
                    userId: user.id,
                    companyName,
                    registrationNumber,
                    industry,
                    contactEmail
                }
            });
            return { user, employer };
        });
        return res.status(201).json({ id: result.user.id, email: result.user.email, role: result.user.role });
    }
    catch (err) {
        console.error('Database error:', err.message || err);
        return res.status(503).json({ error: 'Database unreachable or operation failed' });
    }
}
async function login(req, res) {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
        return res.status(400).json({ error: 'Missing email or password' });
    }
    // Failed attempts are limited per IP, and per email and IP together: never per email alone, so a stranger
    // cannot lock someone else out of their account. The limits are checked before the password is compared, and
    // the lockout message is the same whether or not the account exists.
    const ip = (0, clientIp_1.getClientIp)(req);
    const emailAndIp = `${email.trim().toLowerCase()}\n${ip}`;
    const wait = (0, rateLimit_1.longestWait)(await Promise.all([
        rateLimit_1.rateLimiter.check(rateLimit_1.RATE_LIMITS.loginIp, ip),
        rateLimit_1.rateLimiter.check(rateLimit_1.RATE_LIMITS.loginPair, emailAndIp)
    ]));
    if (wait !== null)
        return (0, rateLimit_1.sendTooManyRequests)(res, rateLimit_1.RATE_LIMIT_MESSAGES.attempts, wait);
    const recordFailure = () => Promise.all([
        rateLimit_1.rateLimiter.record(rateLimit_1.RATE_LIMITS.loginIp, ip),
        rateLimit_1.rateLimiter.record(rateLimit_1.RATE_LIMITS.loginPair, emailAndIp)
    ]);
    try {
        const user = await db_1.default.user.findUnique({ where: { email } });
        const generic = { error: 'Invalid credentials' };
        // Without an account the password is still checked (against a dummy hash), so an unknown email and a wrong
        // password take about the same time.
        const ok = await (0, password_1.verifyPassword)(password, user?.passwordHash);
        if (!user || !ok) {
            await recordFailure();
            return res.status(401).json(generic);
        }
        // Administrator sessions are deliberately short-lived.
        const expiresIn = user.role === 'ADMIN' ? '2h' : '24h';
        const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, env_1.default.JWT_SECRET, { expiresIn });
        return res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
    }
    catch (err) {
        console.error('Database error:', err.message || err);
        return res.status(503).json({ error: 'Database unreachable' });
    }
}
async function changePassword(req, res) {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Authentication required' });
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
        return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    // Wrong current passwords are limited per user, checked before the password is compared.
    const limit = await rateLimit_1.rateLimiter.check(rateLimit_1.RATE_LIMITS.changePassword, userId);
    if (!limit.allowed)
        return (0, rateLimit_1.sendTooManyRequests)(res, rateLimit_1.RATE_LIMIT_MESSAGES.attempts, limit.retryAfterSeconds);
    try {
        const user = await db_1.default.user.findUnique({ where: { id: userId }, select: { id: true, passwordHash: true } });
        // Compared even without an account (against a dummy hash), so both cases take about the same time.
        const ok = await (0, password_1.verifyPassword)(currentPassword, user?.passwordHash);
        if (!user)
            return res.status(401).json({ error: 'Invalid or expired token' });
        if (!ok) {
            await rateLimit_1.rateLimiter.record(rateLimit_1.RATE_LIMITS.changePassword, userId);
            return res.status(400).json({ error: 'Current password is incorrect' });
        }
        if (newPassword === currentPassword) {
            return res.status(400).json({ error: 'New password must be different from the current password' });
        }
        const passwordHash = await (0, password_1.hashPassword)(newPassword);
        await db_1.default.user.update({ where: { id: user.id }, data: { passwordHash } });
        return res.json({ message: 'Password changed successfully' });
    }
    catch (err) {
        console.error('Database error while changing password:', err.message || err);
        return res.status(503).json({ error: 'Database unreachable or operation failed' });
    }
}
exports.default = { registerInstitution, registerStudent, registerEmployer, login, changePassword };
