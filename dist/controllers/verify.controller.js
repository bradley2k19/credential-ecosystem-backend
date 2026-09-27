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
const certificateHash_1 = require("../utils/certificateHash");
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
async function verifyCertificate(req, res) {
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
                certificateHash: true,
                status: true,
                revokedReason: true,
                student: { select: { fullName: true, studentNumber: true } },
                institution: { select: { name: true } }
            }
        });
        if (!certificate) {
            await logVerification({
                certificateUid,
                employerId,
                method,
                result: client_1.VerificationResult.NOT_FOUND,
                ipAddress: req.ip
            });
            return res.status(404).json({ result: 'not_found', message: 'No certificate with this identifier was found.' });
        }
        const certificateDetails = {
            certificateUid: certificate.certificateUid,
            studentName: certificate.student.fullName,
            studentNumber: certificate.student.studentNumber,
            certificateType: certificate.certificateType,
            programName: certificate.programName,
            classification: certificate.classification,
            issueDate: certificate.issueDate,
            institutionName: certificate.institution.name
        };
        const recomputedHash = (0, certificateHash_1.generateCertificateHash)({
            studentId: certificate.studentId,
            institutionId: certificate.institutionId,
            certificateType: certificate.certificateType,
            programName: certificate.programName,
            classification: certificate.classification,
            issueDate: certificate.issueDate,
            certificateUid: certificate.certificateUid
        });
        const chainRecord = await blockchain_1.certificateRegistry.getCertificate(certificate.certificateUid);
        const onChainHash = String(chainRecord.certificateHash ?? chainRecord[0]);
        const issuedAt = BigInt(chainRecord.issuedAt ?? chainRecord[3]);
        if (issuedAt === 0n || /^0x0{64}$/i.test(onChainHash)) {
            await logVerification({
                certificateId: certificate.id,
                certificateUid,
                employerId,
                method,
                result: client_1.VerificationResult.PENDING_CHAIN,
                ipAddress: req.ip
            });
            return res.json({
                result: 'pending-chain',
                message: 'The certificate exists in the database but does not yet have a confirmed blockchain record.',
                certificate: certificateDetails
            });
        }
        if (onChainHash.toLowerCase() !== recomputedHash.toLowerCase()
            || certificate.certificateHash.toLowerCase() !== recomputedHash.toLowerCase()) {
            await logVerification({
                certificateId: certificate.id,
                certificateUid,
                employerId,
                method,
                result: client_1.VerificationResult.TAMPERED,
                ipAddress: req.ip
            });
            return res.json({
                result: 'tampered',
                message: 'Data integrity concern: the certificate data stored in the database does not match its blockchain record.',
                certificate: certificateDetails
            });
        }
        const result = certificate.status === 'REVOKED' ? client_1.VerificationResult.REVOKED : client_1.VerificationResult.VALID;
        await logVerification({
            certificateId: certificate.id,
            certificateUid,
            employerId,
            method,
            result,
            ipAddress: req.ip
        });
        return res.json({
            result: result.toLowerCase(),
            message: result === client_1.VerificationResult.REVOKED
                ? 'This certificate is revoked.'
                : 'Certificate verified successfully.',
            certificate: certificateDetails,
            ...(result === client_1.VerificationResult.REVOKED && certificate.revokedReason
                ? { revokedReason: certificate.revokedReason }
                : {})
        });
    }
    catch (error) {
        console.error('Certificate verification failed:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Certificate verification is temporarily unavailable' });
    }
}
exports.default = { verifyCertificate };
