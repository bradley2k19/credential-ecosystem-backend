"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueCertificate = issueCertificate;
exports.listCertificates = listCertificates;
exports.getCertificate = getCertificate;
exports.revokeCertificate = revokeCertificate;
exports.recordBlockchainTransaction = recordBlockchainTransaction;
exports.getBlockchainStatus = getBlockchainStatus;
const crypto_1 = __importDefault(require("crypto"));
const client_1 = require("@prisma/client");
const db_1 = __importDefault(require("../config/db"));
const certificateHash_1 = require("../utils/certificateHash");
const certificateFacts_1 = require("../utils/certificateFacts");
const blockchain_1 = require("../config/blockchain");
const notifications_1 = require("../utils/notifications");
const onChain_1 = require("../utils/onChain");
const snapshot_1 = require("../templates/snapshot");
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
    templateId: true,
    // hashVersion, the frozen facts, and the live student (see withPrintedStudent).
    ...certificateFacts_1.certificateFactFields
};
// The single-certificate response feeds the renderer and never carries the hash. The issue and list responses
// still include it, because the institution's on-chain issue step signs it.
const { certificateHash: _certificateHash, ...singleCertificateFields } = certificateFields;
/**
 * A certificate as the institution's pages show it: `student` is the name and number printed on it (frozen at
 * issuance for version 2, the live record for version 1), and the internal frozen-fact fields are left out.
 */
function withPrintedStudent(row) {
    const { hashVersion: _version, studentNameAtIssue: _name, studentNumberAtIssue: _number, institutionNameAtIssue: _institutionName, institution: _institution, ...rest } = row;
    const facts = (0, certificateFacts_1.certificateFacts)(row);
    return { ...rest, student: { fullName: facts.studentName, studentNumber: facts.studentNumber } };
}
/** Thrown inside the issuing transaction when another replacement was linked first; rolls the issuance back. */
class ReplacementAlreadyIssued extends Error {
}
async function getInstitutionId(userId) {
    const institution = await db_1.default.institution.findUnique({
        where: { userId },
        select: { id: true }
    });
    return institution?.id;
}
async function getOwnedCertificate(certificateId, institutionId) {
    return db_1.default.certificate.findFirst({
        where: { id: certificateId, institutionId },
        select: { id: true, certificateUid: true }
    });
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
    const { studentId, certificateType, programName, classification, issueDate, graduationDate, templateId, correctionRequestId } = req.body;
    if (!studentId || !certificateType || !programName || !issueDate) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    if (correctionRequestId !== undefined && correctionRequestId !== null && (typeof correctionRequestId !== 'string' || !correctionRequestId)) {
        return res.status(400).json({ error: 'correctionRequestId must be a correction request id' });
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
        const result = await db_1.default.$transaction(async (tx) => {
            const student = await tx.student.findFirst({
                where: { id: studentId, institutionId },
                select: { id: true, fullName: true, studentNumber: true, userId: true }
            });
            if (!student)
                return { status: 404, body: { error: 'Student not found' } };
            const institution = await tx.institution.findUnique({ where: { id: institutionId }, select: { name: true } });
            if (!institution)
                return { status: 403, body: { error: 'Institution profile not found' } };
            // Reissuing for a correction request: it must be this institution's, approved, without a replacement yet,
            // and the replacement goes to the same student as the original.
            let correction = null;
            if (correctionRequestId) {
                const request = await tx.credentialCorrectionRequest.findUnique({
                    where: { id: correctionRequestId },
                    select: { id: true, status: true, replacementCertificateId: true, certificate: { select: { institutionId: true, studentId: true, certificateUid: true } } }
                });
                if (!request || request.certificate.institutionId !== institutionId)
                    return { status: 404, body: { error: 'Correction request not found' } };
                if (request.status !== client_1.CorrectionStatus.APPROVED)
                    return { status: 409, body: { error: 'Only an approved correction request can be reissued' } };
                if (request.replacementCertificateId)
                    return { status: 409, body: { error: 'A replacement certificate has already been issued for this correction request' } };
                if (request.certificate.studentId !== studentId) {
                    return { status: 400, body: { error: 'A replacement must be issued to the same student as the original certificate' } };
                }
                correction = { id: request.id, originalUid: request.certificate.certificateUid };
            }
            // Presentation only: the template and snapshot never feed into the certificate hash below.
            const render = await (0, snapshot_1.buildRenderSnapshot)(tx, institutionId, templateId);
            if (!render.ok)
                return { status: 400, body: { error: render.error } };
            // Everything the certificate prints, as it will be stored: the student's and institution's current
            // details are copied (frozen) here and never written again, and hash version 2 covers all of it.
            const stored = {
                hashVersion: certificateHash_1.CURRENT_HASH_VERSION,
                certificateUid: crypto_1.default.randomUUID(),
                studentId,
                institutionId,
                certificateType,
                programName,
                classification: classification ?? null,
                issueDate: parsedIssueDate,
                graduationDate: parsedGraduationDate ?? null,
                studentNameAtIssue: student.fullName,
                studentNumberAtIssue: student.studentNumber,
                institutionNameAtIssue: institution.name
            };
            // The same dispatcher verification uses, from exactly the values being stored.
            const certificateHash = (0, certificateHash_1.computeCertificateHash)(stored);
            if (!certificateHash)
                throw new Error(`No hash function for hash version ${stored.hashVersion}`);
            const certificate = await tx.certificate.create({
                data: {
                    ...stored,
                    certificateHash,
                    status: client_1.CertificateStatus.ACTIVE,
                    // Frozen here and never written again.
                    renderSnapshot: render.snapshot,
                    templateId: render.templateId
                },
                select: certificateFields
            });
            // In the same transaction: the request now points at its replacement (only if nothing else got there first).
            if (correction) {
                const linked = await tx.credentialCorrectionRequest.updateMany({
                    where: { id: correction.id, status: client_1.CorrectionStatus.APPROVED, replacementCertificateId: null },
                    data: { replacementCertificateId: certificate.id }
                });
                if (linked.count !== 1)
                    throw new ReplacementAlreadyIssued();
            }
            const message = correction
                ? notifications_1.notificationMessages.replacementIssued(institution.name, certificateType, programName, correction.originalUid)
                : notifications_1.notificationMessages.certificateIssued(institution.name, certificateType, programName);
            return {
                status: 201,
                body: { ...withPrintedStudent(certificate), templateName: render.snapshot.template.name },
                notice: { userId: student.userId, message, certificateId: certificate.id }
            };
        });
        // After the certificate is committed; a notification failure never affects the issuance.
        if (result.notice)
            await (0, notifications_1.notify)(result.notice.userId, client_1.NotificationType.CERT_ISSUED, result.notice.message, { certificateId: result.notice.certificateId });
        return res.status(result.status).json(result.body);
    }
    catch (error) {
        if (error instanceof ReplacementAlreadyIssued) {
            return res.status(409).json({ error: 'A replacement certificate has already been issued for this correction request' });
        }
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
        const [rows, total] = await db_1.default.$transaction([
            db_1.default.certificate.findMany({
                where,
                select: {
                    ...certificateFields,
                    renderSnapshot: true,
                    blockchainTransactions: onChain_1.onChainTransactionsSelect
                },
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit
            }),
            db_1.default.certificate.count({ where })
        ]);
        // The list carries only the frozen template name, never the full snapshot, and the student as printed.
        const certificates = rows.map(({ blockchainTransactions, renderSnapshot, ...certificate }) => ({
            ...withPrintedStudent(certificate),
            templateName: (0, snapshot_1.snapshotTemplateName)(renderSnapshot),
            onChain: (0, onChain_1.summariseOnChain)(blockchainTransactions)
        }));
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
            select: { ...singleCertificateFields, renderSnapshot: true }
        });
        if (!certificate)
            return res.status(404).json({ error: 'Certificate not found' });
        const { renderSnapshot, ...row } = certificate;
        // The certificate's own facts: frozen at issuance for version 2, the live records for version 1 (as before).
        const facts = (0, certificateFacts_1.certificateFacts)(certificate);
        const rendered = (0, snapshot_1.renderSnapshotForResponse)(renderSnapshot, facts.institutionName);
        return res.json({
            ...withPrintedStudent(row),
            institutionName: facts.institutionName,
            // From the stored snapshot only, so older certificates report null rather than the fallback's name.
            templateName: (0, snapshot_1.snapshotTemplateName)(renderSnapshot),
            ...rendered,
            ...(facts.frozen ? { renderSnapshot: (0, snapshot_1.withPrintedInstitutionName)(rendered.renderSnapshot, facts.institutionName) } : {})
        });
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
            select: { id: true, certificateUid: true, status: true, certificateType: true, student: { select: { userId: true } } }
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
        // After the revocation is saved; a notification failure never affects it.
        await (0, notifications_1.notify)(certificate.student.userId, client_1.NotificationType.CERT_REVOKED, notifications_1.notificationMessages.certificateRevoked(certificate.certificateType, revokedReason), { certificateId: certificate.id });
        return res.json(withPrintedStudent(revoked));
    }
    catch (error) {
        console.error('Database error while revoking certificate:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable or operation failed' });
    }
}
async function recordBlockchainTransaction(req, res) {
    const { txType, txHash } = req.body;
    if (!['ISSUE', 'REVOKE'].includes(txType) || typeof txHash !== 'string' || !txHash.trim()) {
        return res.status(400).json({ error: 'txType must be ISSUE or REVOKE and txHash is required' });
    }
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId)
        return res.status(403).json({ error: 'Institution profile not found' });
    try {
        const certificate = await getOwnedCertificate(req.params.certificateId, institutionId);
        if (!certificate)
            return res.status(404).json({ error: 'Certificate not found' });
        const existingConfirmed = await db_1.default.blockchainTransaction.findFirst({
            where: { certificateId: certificate.id, txType, status: 'CONFIRMED' },
            select: { id: true }
        });
        if (existingConfirmed) {
            return res.status(409).json({ error: `A confirmed ${txType} transaction already exists for this certificate` });
        }
        const transaction = await db_1.default.blockchainTransaction.create({
            data: {
                certificateId: certificate.id,
                txType,
                txHash: txHash.trim(),
                network: 'amoy',
                status: 'PENDING',
                submittedAt: new Date()
            }
        });
        return res.status(201).json(transaction);
    }
    catch (error) {
        console.error('Database error while recording blockchain transaction:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable or operation failed' });
    }
}
async function getBlockchainStatus(req, res) {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId)
        return res.status(403).json({ error: 'Institution profile not found' });
    try {
        const certificate = await getOwnedCertificate(req.params.certificateId, institutionId);
        if (!certificate)
            return res.status(404).json({ error: 'Certificate not found' });
        const transactions = await db_1.default.blockchainTransaction.findMany({
            where: { certificateId: certificate.id },
            orderBy: { submittedAt: 'desc' }
        });
        for (const transaction of transactions.filter((item) => item.status === 'PENDING')) {
            const receipt = await blockchain_1.blockchainProvider.getTransactionReceipt(transaction.txHash);
            if (!receipt)
                continue;
            await db_1.default.blockchainTransaction.update({
                where: { id: transaction.id },
                data: receipt.status === 1
                    ? {
                        status: 'CONFIRMED',
                        blockNumber: receipt.blockNumber,
                        gasUsed: Number(receipt.gasUsed),
                        confirmedAt: new Date()
                    }
                    : { status: 'FAILED', confirmedAt: new Date() }
            });
        }
        const currentTransactions = await db_1.default.blockchainTransaction.findMany({
            where: { certificateId: certificate.id },
            orderBy: { submittedAt: 'desc' }
        });
        return res.json({ certificateId: certificate.id, certificateUid: certificate.certificateUid, transactions: currentTransactions });
    }
    catch (error) {
        console.error('Blockchain status error:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database or blockchain provider unavailable' });
    }
}
exports.default = {
    issueCertificate,
    listCertificates,
    getCertificate,
    revokeCertificate,
    recordBlockchainTransaction,
    getBlockchainStatus
};
