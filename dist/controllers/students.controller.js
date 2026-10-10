"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProfile = getProfile;
exports.listCertificates = listCertificates;
exports.getCertificate = getCertificate;
exports.getVerificationHistory = getVerificationHistory;
const client_1 = require("@prisma/client");
const db_1 = __importDefault(require("../config/db"));
const onChain_1 = require("../utils/onChain");
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
    institution: { select: { name: true } },
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
function toStudentCertificate({ institution, blockchainTransactions, revokedReason, ...certificate }) {
    return {
        ...certificate,
        ...(certificate.status === client_1.CertificateStatus.REVOKED ? { revokedReason } : {}),
        institutionName: institution.name,
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
                user: { select: { email: true } },
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
            institutionName: student.institution.name
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
            select: studentCertificateFields
        });
        if (!certificate)
            return res.status(404).json({ error: 'Certificate not found' });
        return res.json(toStudentCertificate(certificate));
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
exports.default = { getProfile, listCertificates, getCertificate, getVerificationHistory };
