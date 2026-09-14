"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueCertificate = issueCertificate;
exports.listCertificates = listCertificates;
exports.getCertificate = getCertificate;
exports.revokeCertificate = revokeCertificate;
const crypto_1 = __importDefault(require("crypto"));
const client_1 = require("@prisma/client");
const db_1 = __importDefault(require("../config/db"));
const certificateHash_1 = require("../utils/certificateHash");
const certificateFields = {
    id: true,
    certificateUid: true,
    studentId: true,
    institutionId: true,
    certificateType: true,
    programName: true,
    classification: true,
    issueDate: true,
    graduationDate: true,
    documentUrl: true,
    certificateHash: true,
    qrCodeUrl: true,
    status: true,
    revokedReason: true,
    revokedAt: true,
    createdAt: true,
    updatedAt: true,
    student: {
        select: {
            fullName: true,
            studentNumber: true
        }
    }
};
async function getInstitutionId(userId) {
    const institution = await db_1.default.institution.findUnique({
        where: { userId },
        select: { id: true }
    });
    return institution?.id;
}
function parseDate(value) {
    if (typeof value !== 'string' && !(value instanceof Date))
        return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}
function isUniqueConstraintError(error) {
    return error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
async function issueCertificate(req, res) {
    const { studentId, certificateType, programName, classification, issueDate, graduationDate } = req.body;
    if (!studentId || !certificateType || !programName || !issueDate) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const parsedIssueDate = parseDate(issueDate);
    const parsedGraduationDate = graduationDate === undefined ? undefined : parseDate(graduationDate);
    if (!parsedIssueDate || (graduationDate !== undefined && !parsedGraduationDate)) {
        return res.status(400).json({ error: 'Invalid issueDate or graduationDate' });
    }
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId)
        return res.status(403).json({ error: 'Institution profile not found' });
    try {
        const student = await db_1.default.student.findFirst({
            where: { id: studentId, institutionId },
            select: { id: true }
        });
        if (!student)
            return res.status(404).json({ error: 'Student not found' });
        const certificateUid = crypto_1.default.randomUUID();
        const certificateHash = (0, certificateHash_1.generateCertificateHash)({
            studentId,
            institutionId,
            certificateType,
            programName,
            classification: classification ?? null,
            issueDate: parsedIssueDate,
            certificateUid
        });
        const certificate = await db_1.default.certificate.create({
            data: {
                certificateUid,
                studentId,
                institutionId,
                certificateType,
                programName,
                classification: classification ?? null,
                issueDate: parsedIssueDate,
                graduationDate: parsedGraduationDate,
                certificateHash,
                status: client_1.CertificateStatus.ACTIVE
            },
            select: certificateFields
        });
        return res.status(201).json(certificate);
    }
    catch (error) {
        if (isUniqueConstraintError(error))
            return res.status(409).json({ error: 'Certificate identifier already exists' });
        console.error('Database error while issuing certificate:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable or operation failed' });
    }
}
async function listCertificates(req, res) {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId)
        return res.status(403).json({ error: 'Institution profile not found' });
    const page = Math.max(Number.parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
    const statusValue = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
    if (statusValue && !['ACTIVE', 'REVOKED'].includes(statusValue)) {
        return res.status(400).json({ error: 'status must be active or revoked' });
    }
    const where = {
        institutionId,
        ...(typeof req.query.studentId === 'string' ? { studentId: req.query.studentId } : {}),
        ...(statusValue ? { status: statusValue } : {})
    };
    try {
        const [certificates, total] = await db_1.default.$transaction([
            db_1.default.certificate.findMany({
                where,
                select: certificateFields,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit
            }),
            db_1.default.certificate.count({ where })
        ]);
        return res.json({ certificates, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    }
    catch (error) {
        console.error('Database error while listing certificates:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable' });
    }
}
async function getCertificate(req, res) {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId)
        return res.status(403).json({ error: 'Institution profile not found' });
    try {
        const certificate = await db_1.default.certificate.findFirst({
            where: { id: req.params.certificateId, institutionId },
            select: certificateFields
        });
        if (!certificate)
            return res.status(404).json({ error: 'Certificate not found' });
        return res.json(certificate);
    }
    catch (error) {
        console.error('Database error while fetching certificate:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable' });
    }
}
async function revokeCertificate(req, res) {
    const { revokedReason } = req.body;
    if (!revokedReason || typeof revokedReason !== 'string' || !revokedReason.trim()) {
        return res.status(400).json({ error: 'revokedReason is required' });
    }
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId)
        return res.status(403).json({ error: 'Institution profile not found' });
    try {
        const certificate = await db_1.default.certificate.findFirst({
            where: { id: req.params.certificateId, institutionId },
            select: { id: true, status: true }
        });
        if (!certificate)
            return res.status(404).json({ error: 'Certificate not found' });
        if (certificate.status === client_1.CertificateStatus.REVOKED) {
            return res.status(400).json({ error: 'Certificate is already revoked' });
        }
        const revoked = await db_1.default.certificate.update({
            where: { id: certificate.id },
            data: { status: client_1.CertificateStatus.REVOKED, revokedReason: revokedReason.trim(), revokedAt: new Date() },
            select: certificateFields
        });
        return res.json(revoked);
    }
    catch (error) {
        console.error('Database error while revoking certificate:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable or operation failed' });
    }
}
exports.default = { issueCertificate, listCertificates, getCertificate, revokeCertificate };
