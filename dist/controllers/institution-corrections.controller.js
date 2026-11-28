"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCorrectionRequests = listCorrectionRequests;
exports.getCorrectionRequest = getCorrectionRequest;
exports.approveCorrectionRequest = approveCorrectionRequest;
exports.rejectCorrectionRequest = rejectCorrectionRequest;
const client_1 = require("@prisma/client");
const db_1 = __importDefault(require("../config/db"));
const corrections_1 = require("../utils/corrections");
const notifications_1 = require("../utils/notifications");
async function getInstitutionId(userId) {
    const institution = await db_1.default.institution.findUnique({ where: { userId }, select: { id: true } });
    return institution?.id;
}
/** Only requests about this institution's own certificates; anything else is indistinguishable from missing. */
const ownedBy = (institutionId) => ({ certificate: { institutionId } });
async function listCorrectionRequests(req, res) {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId)
        return res.status(403).json({ error: 'Institution profile not found' });
    const page = Math.max(Number.parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
    const statusValue = typeof req.query.status === 'string' && req.query.status ? req.query.status.toUpperCase() : undefined;
    if (statusValue && !Object.values(client_1.CorrectionStatus).includes(statusValue)) {
        return res.status(400).json({ error: 'status must be pending, approved or rejected' });
    }
    const where = {
        ...ownedBy(institutionId),
        ...(statusValue ? { status: statusValue } : {})
    };
    try {
        const [rows, total, pending] = await Promise.all([
            db_1.default.credentialCorrectionRequest.findMany({
                where,
                orderBy: { requestedAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                select: corrections_1.correctionRequestFields
            }),
            db_1.default.credentialCorrectionRequest.count({ where }),
            db_1.default.credentialCorrectionRequest.count({ where: { ...ownedBy(institutionId), status: client_1.CorrectionStatus.PENDING } })
        ]);
        return res.json({
            correctionRequests: rows.map(corrections_1.toInstitutionCorrection),
            pendingCount: pending,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    }
    catch (error) {
        console.error('Database error while listing correction requests:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable' });
    }
}
async function getCorrectionRequest(req, res) {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId)
        return res.status(403).json({ error: 'Institution profile not found' });
    try {
        const request = await db_1.default.credentialCorrectionRequest.findFirst({
            where: { id: req.params.requestId, ...ownedBy(institutionId) },
            select: corrections_1.correctionRequestFields
        });
        if (!request)
            return res.status(404).json({ error: 'Correction request not found' });
        return res.json((0, corrections_1.toInstitutionCorrection)(request));
    }
    catch (error) {
        console.error('Database error while fetching a correction request:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable' });
    }
}
/**
 * Approves or rejects a PENDING request. Only the request changes: approving never edits or revokes the
 * certificate (a correction is made by issuing a replacement, then revoking the original). The decision is
 * written to the audit log without the request text, and the student is notified.
 */
async function decide(req, res, decision) {
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (req.body?.note !== undefined && req.body.note !== null && typeof req.body.note !== 'string') {
        return res.status(400).json({ error: 'note must be text' });
    }
    if (decision === client_1.CorrectionStatus.REJECTED && !note)
        return res.status(400).json({ error: 'A note is required to reject a correction request' });
    if (note.length > corrections_1.RESOLUTION_NOTE_MAX)
        return res.status(400).json({ error: `The note can be at most ${corrections_1.RESOLUTION_NOTE_MAX} characters` });
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId)
        return res.status(403).json({ error: 'Institution profile not found' });
    try {
        const request = await db_1.default.credentialCorrectionRequest.findFirst({
            where: { id: req.params.requestId, ...ownedBy(institutionId) },
            select: { id: true, status: true, certificateId: true, certificate: { select: { certificateUid: true } }, student: { select: { userId: true } } }
        });
        if (!request)
            return res.status(404).json({ error: 'Correction request not found' });
        if (request.status !== client_1.CorrectionStatus.PENDING)
            return res.status(409).json({ error: 'This correction request has already been decided' });
        const decided = await db_1.default.$transaction(async (tx) => {
            // Only a request that is still PENDING moves on, so two decisions can never both apply.
            const moved = await tx.credentialCorrectionRequest.updateMany({
                where: { id: request.id, status: client_1.CorrectionStatus.PENDING },
                data: { status: decision, resolvedAt: new Date(), resolutionNote: note || null }
            });
            if (moved.count !== 1)
                return false;
            await tx.auditLog.create({
                data: {
                    userId: req.user.id,
                    action: decision === client_1.CorrectionStatus.APPROVED ? 'CORRECTION_APPROVED' : 'CORRECTION_REJECTED',
                    entityType: 'correctionRequest',
                    entityId: request.id,
                    // Never the request text (or the note): only which certificate and whether a note was given.
                    details: { certificateUid: request.certificate.certificateUid, hasNote: Boolean(note) }
                }
            });
            return true;
        });
        if (!decided)
            return res.status(409).json({ error: 'This correction request has already been decided' });
        await (0, notifications_1.notify)(request.student.userId, client_1.NotificationType.CORRECTION_RESOLVED, notifications_1.notificationMessages.correctionResolved(decision === client_1.CorrectionStatus.APPROVED, note || null), { certificateId: request.certificateId, correctionRequestId: request.id });
        const updated = await db_1.default.credentialCorrectionRequest.findFirst({ where: { id: request.id }, select: corrections_1.correctionRequestFields });
        return res.json(updated ? (0, corrections_1.toInstitutionCorrection)(updated) : { id: request.id, status: decision });
    }
    catch (error) {
        console.error('Database error while deciding a correction request:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable or operation failed' });
    }
}
function approveCorrectionRequest(req, res) {
    return decide(req, res, client_1.CorrectionStatus.APPROVED);
}
function rejectCorrectionRequest(req, res) {
    return decide(req, res, client_1.CorrectionStatus.REJECTED);
}
exports.default = { listCorrectionRequests, getCorrectionRequest, approveCorrectionRequest, rejectCorrectionRequest };
