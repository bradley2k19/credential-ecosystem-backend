"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProfile = getProfile;
exports.listCertificates = listCertificates;
exports.getCertificate = getCertificate;
exports.getVerificationHistory = getVerificationHistory;
exports.updatePreferences = updatePreferences;
exports.requestCorrection = requestCorrection;
exports.listCorrectionRequests = listCorrectionRequests;
const client_1 = require("@prisma/client");
const db_1 = __importDefault(require("../config/db"));
const onChain_1 = require("../utils/onChain");
const snapshot_1 = require("../templates/snapshot");
const certificateFacts_1 = require("../utils/certificateFacts");
const corrections_1 = require("../utils/corrections");
const notifications_1 = require("../utils/notifications");
const rateLimit_1 = require("../utils/rateLimit");
// Deliberately excludes certificateHash, studentId and institutionId.
const studentCertificateFields = {
    id: true,
    certificateUid: true,
    certificateType: true,
    programName: true,
    classification: true,
    issueDate: true,
    graduationDate: true,
    status: true,
    revokedReason: true,
    // hashVersion, the frozen facts, and the live student and institution (see certificateFacts).
    ...certificateFacts_1.certificateFactFields,
    blockchainTransactions: onChain_1.onChainTransactionsSelect
};
// The student is always resolved from the token, never from a client-supplied id.
async function getStudentId(userId) {
    const student = await db_1.default.student.findUnique({
        where: { userId },
        select: { id: true }
    });
    return student?.id;
}
/** A certificate for the student's pages: the institution name as printed on it (frozen for version 2). */
function toStudentCertificate(row) {
    const { institution: _institution, student: _student, hashVersion: _version, studentNameAtIssue: _name, studentNumberAtIssue: _number, institutionNameAtIssue: _institutionName, blockchainTransactions, revokedReason, ...certificate } = row;
    return {
        ...certificate,
        ...(certificate.status === client_1.CertificateStatus.REVOKED ? { revokedReason } : {}),
        institutionName: (0, certificateFacts_1.certificateFacts)(row).institutionName,
        onChain: (0, onChain_1.summariseOnChain)(blockchainTransactions)
    };
}
async function getProfile(req, res) {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Authentication required' });
    try {
        const student = await db_1.default.student.findUnique({
            where: { userId },
            select: {
                fullName: true,
                studentNumber: true,
                programName: true,
                enrollmentYear: true,
                user: { select: { email: true, notifyOnVerification: true } },
                institution: { select: { name: true } }
            }
        });
        if (!student)
            return res.status(404).json({ error: 'Student profile not found' });
        return res.json({
            fullName: student.fullName,
            studentNumber: student.studentNumber,
            programName: student.programName,
            enrollmentYear: student.enrollmentYear,
            email: student.user.email,
            institutionName: student.institution.name,
            notifyOnVerification: student.user.notifyOnVerification
        });
    }
    catch (error) {
        console.error('Database error while fetching student profile:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable' });
    }
}
async function listCertificates(req, res) {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Authentication required' });
    const page = Math.max(Number.parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
    try {
        const studentId = await getStudentId(userId);
        if (!studentId)
            return res.status(404).json({ error: 'Student profile not found' });
        const where = { studentId };
        const [rows, total] = await db_1.default.$transaction([
            db_1.default.certificate.findMany({
                where,
                select: studentCertificateFields,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit
            }),
            db_1.default.certificate.count({ where })
        ]);
        return res.json({
            certificates: rows.map(toStudentCertificate),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    }
    catch (error) {
        console.error('Database error while listing student certificates:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable' });
    }
}
async function getCertificate(req, res) {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Authentication required' });
    try {
        const studentId = await getStudentId(userId);
        if (!studentId)
            return res.status(404).json({ error: 'Student profile not found' });
        // Scoping by studentId makes another student's certificate indistinguishable from a missing one.
        const certificate = await db_1.default.certificate.findFirst({
            where: { id: req.params.certificateId, studentId },
            // The renderer's {{student_name}}, {{student_number}} and institution name come from certificateFacts.
            select: { ...studentCertificateFields, renderSnapshot: true }
        });
        if (!certificate)
            return res.status(404).json({ error: 'Certificate not found' });
        // Only the single-certificate response carries the snapshot: the frozen one, or the computed fallback.
        const { renderSnapshot, ...row } = certificate;
        // The certificate's own facts: frozen at issuance for version 2, the live records for version 1 (as before).
        const facts = (0, certificateFacts_1.certificateFacts)(certificate);
        const rendered = (0, snapshot_1.renderSnapshotForResponse)(renderSnapshot, facts.institutionName);
        return res.json({
            ...toStudentCertificate(row),
            student: { fullName: facts.studentName, studentNumber: facts.studentNumber },
            ...rendered,
            ...(facts.frozen ? { renderSnapshot: (0, snapshot_1.withPrintedInstitutionName)(rendered.renderSnapshot, facts.institutionName) } : {})
        });
    }
    catch (error) {
        console.error('Database error while fetching student certificate:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable' });
    }
}
async function getVerificationHistory(req, res) {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Authentication required' });
    const page = Math.max(Number.parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
    try {
        const studentId = await getStudentId(userId);
        if (!studentId)
            return res.status(404).json({ error: 'Student profile not found' });
        const where = {
            certificate: { studentId },
            result: { not: client_1.VerificationResult.NOT_FOUND }
        };
        const [rows, total] = await db_1.default.$transaction([
            db_1.default.certificateVerification.findMany({
                where,
                orderBy: { verifiedAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                select: {
                    id: true,
                    method: true,
                    result: true,
                    verifiedAt: true,
                    certificate: { select: { certificateUid: true, certificateType: true } },
                    employer: { select: { companyName: true } }
                }
            }),
            db_1.default.certificateVerification.count({ where })
        ]);
        const verifications = rows.map(({ employer, ...verification }) => ({
            ...verification,
            verifiedBy: employer?.companyName ?? 'Anonymous'
        }));
        return res.json({
            verifications,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    }
    catch (error) {
        console.error('Unable to load student verification history:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Verification history is temporarily unavailable' });
    }
}
/** Saves the student's notification preference. Only `notifyOnVerification` can be set. */
async function updatePreferences(req, res) {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Authentication required' });
    const { notifyOnVerification } = req.body ?? {};
    if (typeof notifyOnVerification !== 'boolean' || Object.keys(req.body).length !== 1) {
        return res.status(400).json({ error: 'Send { notifyOnVerification: true | false }' });
    }
    try {
        const user = await db_1.default.user.update({ where: { id: userId }, data: { notifyOnVerification }, select: { notifyOnVerification: true } });
        return res.json({ notifyOnVerification: user.notifyOnVerification });
    }
    catch (error) {
        console.error('Database error while saving student preferences:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable or operation failed' });
    }
}
/**
 * Asks the institution to correct one of the student's active certificates. Nothing about the certificate changes:
 * if the institution approves, it issues a replacement and revokes the original.
 */
async function requestCorrection(req, res) {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Authentication required' });
    const requestDetails = typeof req.body?.requestDetails === 'string' ? req.body.requestDetails.trim() : '';
    if (requestDetails.length < corrections_1.REQUEST_DETAILS_MIN || requestDetails.length > corrections_1.REQUEST_DETAILS_MAX) {
        return res.status(400).json({ error: `Describe the correction in ${corrections_1.REQUEST_DETAILS_MIN} to ${corrections_1.REQUEST_DETAILS_MAX} characters` });
    }
    try {
        const studentId = await getStudentId(userId);
        if (!studentId)
            return res.status(404).json({ error: 'Student profile not found' });
        const certificate = await db_1.default.certificate.findFirst({
            where: { id: req.params.certificateId, studentId },
            select: {
                id: true,
                status: true,
                certificateType: true,
                programName: true,
                ...certificateFacts_1.certificateFactFields,
                institution: { select: { name: true, userId: true } }
            }
        });
        if (!certificate)
            return res.status(404).json({ error: 'Certificate not found' });
        if (certificate.status !== client_1.CertificateStatus.ACTIVE) {
            return res.status(409).json({ error: 'Only an active certificate can be corrected' });
        }
        const pending = await db_1.default.credentialCorrectionRequest.findFirst({
            where: { certificateId: certificate.id, status: client_1.CorrectionStatus.PENDING },
            select: { id: true }
        });
        if (pending)
            return res.status(409).json({ error: 'A correction request for this certificate is already waiting for the institution' });
        // At most 5 created per student per day; checked here, counted only once a request is actually created.
        const limit = await rateLimit_1.rateLimiter.check(rateLimit_1.RATE_LIMITS.correctionRequest, studentId);
        if (!limit.allowed)
            return (0, rateLimit_1.sendTooManyRequests)(res, rateLimit_1.RATE_LIMIT_MESSAGES.correctionRequest, limit.retryAfterSeconds);
        const request = await db_1.default.credentialCorrectionRequest.create({
            data: { certificateId: certificate.id, studentId, requestDetails },
            select: corrections_1.correctionRequestFields
        });
        await rateLimit_1.rateLimiter.record(rateLimit_1.RATE_LIMITS.correctionRequest, studentId);
        await (0, notifications_1.notify)(certificate.institution.userId, client_1.NotificationType.CORRECTION_REQUEST, notifications_1.notificationMessages.correctionRequested((0, certificateFacts_1.certificateFacts)(certificate).studentName, certificate.certificateType, certificate.programName), { certificateId: certificate.id, correctionRequestId: request.id });
        return res.status(201).json((0, corrections_1.toStudentCorrection)(request));
    }
    catch (error) {
        console.error('Database error while requesting a correction:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable or operation failed' });
    }
}
/** The student's correction requests, newest first, each with its stage. */
async function listCorrectionRequests(req, res) {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Authentication required' });
    try {
        const studentId = await getStudentId(userId);
        if (!studentId)
            return res.status(404).json({ error: 'Student profile not found' });
        const requests = await db_1.default.credentialCorrectionRequest.findMany({
            where: { studentId },
            orderBy: { requestedAt: 'desc' },
            select: corrections_1.correctionRequestFields
        });
        return res.json({ correctionRequests: requests.map(corrections_1.toStudentCorrection) });
    }
    catch (error) {
        console.error('Database error while listing correction requests:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable' });
    }
}
exports.default = { getProfile, listCertificates, getCertificate, getVerificationHistory, updatePreferences, requestCorrection, listCorrectionRequests };
