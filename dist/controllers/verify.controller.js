"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyCertificate = verifyCertificate;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("@prisma/client");
const db_1 = __importDefault(require("../config/db"));
const blockchain_1 = require("../config/blockchain");
const env_1 = __importDefault(require("../config/env"));
const snapshot_1 = require("../templates/snapshot");
const certificateHash_1 = require("../utils/certificateHash");
const certificateFacts_1 = require("../utils/certificateFacts");
const notifications_1 = require("../utils/notifications");
const auditActions_1 = require("../utils/auditActions");
const clientIp_1 = require("../utils/clientIp");
const STATUS_MISMATCH_LOG_INTERVAL_MS = 60 * 60 * 1000;
// The response waits at most this long for the verification notifications (they normally take a few queries).
const NOTIFY_WAIT_MS = 1500;
const RESULT_LABELS = {
    [client_1.VerificationResult.VALID]: 'valid',
    [client_1.VerificationResult.REVOKED]: 'revoked',
    [client_1.VerificationResult.PENDING_CHAIN]: 'pending blockchain confirmation'
};
async function verifierName(employerId) {
    if (!employerId)
        return 'an anonymous verifier';
    try {
        const employer = await db_1.default.employer.findUnique({ where: { id: employerId }, select: { companyName: true } });
        return employer?.companyName || 'an employer';
    }
    catch {
        return 'an employer';
    }
}
/**
 * After a verification linked to a certificate has been logged: tells the student (unless they turned this off)
 * and the institution, each at most once per certificate and result per 24 hours. Never throws.
 */
async function notifyVerified(certificate, result, employerId) {
    try {
        const options = { certificateId: certificate.id, dedupeKey: `verified:${certificate.id}:${result}` };
        const tampered = result === client_1.VerificationResult.TAMPERED;
        const label = RESULT_LABELS[result] ?? result.toLowerCase();
        const studentName = (0, certificateFacts_1.certificateFacts)(certificate).studentName;
        const toStudent = async () => {
            if (!certificate.student.user.notifyOnVerification)
                return;
            const message = tampered
                ? notifications_1.notificationMessages.integrityConcernForStudent(certificate.certificateType)
                : notifications_1.notificationMessages.verifiedForStudent(certificate.certificateType, label, await verifierName(employerId));
            await (0, notifications_1.notify)(certificate.student.userId, client_1.NotificationType.VERIFICATION_REQUEST, message, options);
        };
        const toInstitution = (0, notifications_1.notify)(certificate.institution.userId, client_1.NotificationType.VERIFICATION_REQUEST, tampered
            ? notifications_1.notificationMessages.integrityConcernForInstitution(certificate.certificateType, studentName)
            : notifications_1.notificationMessages.verifiedForInstitution(certificate.certificateType, studentName, label), options);
        await Promise.all([toStudent(), toInstitution]);
    }
    catch (error) {
        console.error('Could not send verification notifications:', error instanceof Error ? error.message : error);
    }
}
function getMethod(value) {
    if (value === undefined)
        return client_1.VerificationMethod.MANUAL_ID;
    if (value === 'qr')
        return client_1.VerificationMethod.QR;
    if (value === 'manual_id')
        return client_1.VerificationMethod.MANUAL_ID;
    return undefined;
}
async function getOptionalEmployerId(req) {
    const authorization = req.header('Authorization');
    if (!authorization?.startsWith('Bearer '))
        return null;
    try {
        const payload = jsonwebtoken_1.default.verify(authorization.slice(7), env_1.default.JWT_SECRET);
        if (typeof payload === 'string' || payload.role !== 'EMPLOYER' || typeof payload.id !== 'string')
            return null;
        const employer = await db_1.default.employer.findFirst({
            where: { userId: payload.id, user: { role: 'EMPLOYER', isActive: true } },
            select: { id: true }
        });
        return employer?.id ?? null;
    }
    catch {
        return null;
    }
}
async function logVerification(input) {
    await db_1.default.certificateVerification.create({
        data: {
            certificateId: input.certificateId,
            certificateUidQueried: input.certificateUid,
            employerId: input.employerId,
            method: input.method,
            result: input.result,
            ipAddress: input.ipAddress
        }
    });
}
/**
 * Records that the blockchain says a certificate is revoked while the database says it is active: one system
 * AuditLog entry (no user), at most once per certificate per hour so repeated verifications do not flood the log.
 * Holds no hash. Only reads and writes the audit log: the certificate itself is never changed here. A failure is
 * logged and never changes the verification response.
 */
async function recordStatusMismatch(certificate) {
    try {
        const recent = await db_1.default.auditLog.findFirst({
            where: {
                action: auditActions_1.STATUS_MISMATCH_ACTION,
                entityType: 'certificate',
                entityId: certificate.id,
                createdAt: { gte: new Date(Date.now() - STATUS_MISMATCH_LOG_INTERVAL_MS) }
            },
            select: { id: true }
        });
        if (recent)
            return;
        await db_1.default.auditLog.create({
            data: {
                userId: null,
                action: auditActions_1.STATUS_MISMATCH_ACTION,
                entityType: 'certificate',
                entityId: certificate.id,
                details: { certificateUid: certificate.certificateUid, databaseStatus: certificate.status, onChainRevoked: true }
            }
        });
    }
    catch (error) {
        console.error('Could not record a verification status mismatch:', error instanceof Error ? error.message : error);
    }
}
/**
 * What the verification page needs to draw a VALID or REVOKED certificate: its frozen render snapshot (or,
 * for certificates issued before templates, the computed fallback, which is never stored) and the values it
 * shows. The values are `verified`, the details just checked against the blockchain, and the graduation date
 * read in the same query (hashed too for version 2). For certificates with frozen facts, the snapshot's
 * institution name is replaced by the verified one, so the name drawn is the name the hash covers. The snapshot
 * is the public copy, without internal ids (no template id, no signatory ids). Never includes the certificate
 * hash, a date of birth or contact details. If it cannot be built, the result is returned without it.
 */
async function buildVerificationRender(certificateId, verified, graduationDate, factsAreFrozen) {
    try {
        const row = await db_1.default.certificate.findUnique({
            where: { id: certificateId },
            select: { renderSnapshot: true }
        });
        if (!row)
            return null;
        const { renderSnapshot, snapshotIsFallback } = (0, snapshot_1.renderSnapshotForResponse)(row.renderSnapshot, verified.institutionName);
        return {
            snapshot: (0, snapshot_1.publicRenderSnapshot)(renderSnapshot, factsAreFrozen ? verified.institutionName : undefined),
            snapshotIsFallback,
            data: {
                studentName: verified.studentName,
                studentNumber: verified.studentNumber,
                certificateType: verified.certificateType,
                programName: verified.programName,
                classification: verified.classification,
                issueDate: verified.issueDate,
                graduationDate,
                certificateUid: verified.certificateUid,
                institutionName: verified.institutionName
            }
        };
    }
    catch (error) {
        console.error('Could not build the certificate render for verification:', error instanceof Error ? error.message : error);
        return null;
    }
}
async function verifyCertificate(req, res) {
    // A result can change (for example when a certificate is revoked), so no response may be cached.
    res.setHeader('Cache-Control', 'no-store');
    const certificateUid = req.params.certificateUid;
    const method = getMethod(req.query.method);
    if (!method)
        return res.status(400).json({ error: 'method must be qr or manual_id' });
    try {
        const employerId = await getOptionalEmployerId(req);
        const certificate = await db_1.default.certificate.findUnique({
            where: { certificateUid },
            select: {
                id: true,
                certificateUid: true,
                studentId: true,
                institutionId: true,
                certificateType: true,
                programName: true,
                classification: true,
                issueDate: true,
                graduationDate: true,
                certificateHash: true,
                status: true,
                revokedReason: true,
                // hashVersion, the frozen facts, and the live student and institution (used by version 1 only).
                ...certificateFacts_1.certificateFactFields,
                // The same, plus who to notify (never sent in the response).
                student: { select: { fullName: true, studentNumber: true, userId: true, user: { select: { notifyOnVerification: true } } } },
                institution: { select: { name: true, userId: true } }
            }
        });
        if (!certificate) {
            await logVerification({
                certificateUid,
                employerId,
                method,
                result: client_1.VerificationResult.NOT_FOUND,
                ipAddress: (0, clientIp_1.getClientIp)(req)
            });
            return res.status(404).json({ result: 'not_found', message: 'No certificate with this identifier was found.' });
        }
        // What the certificate prints: its own frozen copy (version 2), or the live records (version 1, as before).
        const facts = (0, certificateFacts_1.certificateFacts)(certificate);
        const certificateDetails = {
            certificateUid: certificate.certificateUid,
            studentName: facts.studentName,
            studentNumber: facts.studentNumber,
            certificateType: certificate.certificateType,
            programName: certificate.programName,
            classification: certificate.classification,
            issueDate: certificate.issueDate,
            institutionName: facts.institutionName
        };
        // The same dispatcher issuance used: version 1 exactly as before, version 2 from the row's own fields only.
        // An unknown version gives null, which never matches.
        const recomputedHash = (0, certificateHash_1.computeCertificateHash)(certificate);
        const chainRecord = await blockchain_1.certificateRegistry.getCertificate(certificate.certificateUid);
        const onChainHash = String(chainRecord.certificateHash ?? chainRecord[0]);
        const onChainRevoked = Boolean(chainRecord.revoked ?? chainRecord[2]);
        const issuedAt = BigInt(chainRecord.issuedAt ?? chainRecord[3]);
        if (issuedAt === 0n || /^0x0{64}$/i.test(onChainHash)) {
            await logVerification({
                certificateId: certificate.id,
                certificateUid,
                employerId,
                method,
                result: client_1.VerificationResult.PENDING_CHAIN,
                ipAddress: (0, clientIp_1.getClientIp)(req)
            });
            await (0, notifications_1.settleWithin)(notifyVerified(certificate, client_1.VerificationResult.PENDING_CHAIN, employerId), NOTIFY_WAIT_MS);
            // Not yet confirmed on the chain: identifying details only, without the classification.
            return res.json({
                result: 'pending-chain',
                message: 'The certificate exists in the database but does not yet have a confirmed blockchain record.',
                certificate: {
                    certificateUid: certificateDetails.certificateUid,
                    studentName: certificateDetails.studentName,
                    studentNumber: certificateDetails.studentNumber,
                    certificateType: certificateDetails.certificateType,
                    programName: certificateDetails.programName,
                    issueDate: certificateDetails.issueDate,
                    institutionName: certificateDetails.institutionName
                }
            });
        }
        if (recomputedHash === null
            || onChainHash.toLowerCase() !== recomputedHash.toLowerCase()
            || certificate.certificateHash.toLowerCase() !== recomputedHash.toLowerCase()) {
            await logVerification({
                certificateId: certificate.id,
                certificateUid,
                employerId,
                method,
                result: client_1.VerificationResult.TAMPERED,
                ipAddress: (0, clientIp_1.getClientIp)(req)
            });
            await (0, notifications_1.settleWithin)(notifyVerified(certificate, client_1.VerificationResult.TAMPERED, employerId), NOTIFY_WAIT_MS);
            // The stored details may have been altered, so none of them are returned: only the identifier queried.
            return res.json({
                result: 'tampered',
                message: 'Data integrity concern: the certificate data stored in the database does not match its blockchain record.',
                certificateUid
            });
        }
        // Status is not part of the hash, so the database status is cross-checked with the on-chain revoked flag:
        // revoked if either says so. Database REVOKED with the chain not (yet) revoked is the normal database-first
        // revocation; the chain revoked with the database ACTIVE is a mismatch, and the chain is trusted.
        const databaseRevoked = certificate.status === 'REVOKED';
        const statusMismatch = onChainRevoked && !databaseRevoked;
        const result = databaseRevoked || onChainRevoked ? client_1.VerificationResult.REVOKED : client_1.VerificationResult.VALID;
        if (statusMismatch)
            await recordStatusMismatch(certificate);
        await logVerification({
            certificateId: certificate.id,
            certificateUid,
            employerId,
            method,
            result,
            ipAddress: (0, clientIp_1.getClientIp)(req)
        });
        // Notifications run alongside building the render; the response waits for them only briefly.
        const notifying = notifyVerified(certificate, result, employerId);
        // Only VALID and REVOKED results reach this point, so only they ever carry `render`.
        const render = await buildVerificationRender(certificate.id, certificateDetails, certificate.graduationDate, facts.frozen);
        await (0, notifications_1.settleWithin)(notifying, NOTIFY_WAIT_MS);
        return res.json({
            result: result.toLowerCase(),
            message: result === client_1.VerificationResult.REVOKED
                ? 'This certificate is revoked.'
                : 'Certificate verified successfully.',
            certificate: certificateDetails,
            ...(result === client_1.VerificationResult.REVOKED
                ? {
                    revokedReason: certificate.revokedReason ?? null,
                    revocation: { onChain: onChainRevoked, statusMismatch }
                }
                : {}),
            ...(render ? { render } : {})
        });
    }
    catch (error) {
        console.error('Certificate verification failed:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Certificate verification is temporarily unavailable' });
    }
}
exports.default = { verifyCertificate };
