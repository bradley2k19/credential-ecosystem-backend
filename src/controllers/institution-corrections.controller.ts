import { Response } from 'express';
import { CorrectionStatus, NotificationType, Prisma } from '@prisma/client';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';
import { correctionRequestFields, RESOLUTION_NOTE_MAX, toInstitutionCorrection } from '../utils/corrections';
import { notificationMessages, notify } from '../utils/notifications';

async function getInstitutionId(userId: string) {
  const institution = await prisma.institution.findUnique({ where: { userId }, select: { id: true } });
  return institution?.id;
}

/** Only requests about this institution's own certificates; anything else is indistinguishable from missing. */
const ownedBy = (institutionId: string): Prisma.CredentialCorrectionRequestWhereInput => ({ certificate: { institutionId } });

export async function listCorrectionRequests(req: AuthRequest, res: Response) {
  const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
  if (!institutionId) return res.status(403).json({ error: 'Institution profile not found' });

  const page = Math.max(Number.parseInt(String(req.query.page || '1'), 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
  const statusValue = typeof req.query.status === 'string' && req.query.status ? req.query.status.toUpperCase() : undefined;
  if (statusValue && !Object.values(CorrectionStatus).includes(statusValue as CorrectionStatus)) {
    return res.status(400).json({ error: 'status must be pending, approved or rejected' });
  }

  const where: Prisma.CredentialCorrectionRequestWhereInput = {
    ...ownedBy(institutionId),
    ...(statusValue ? { status: statusValue as CorrectionStatus } : {})
  };
  try {
    const [rows, total, pending] = await Promise.all([
      prisma.credentialCorrectionRequest.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: correctionRequestFields
      }),
      prisma.credentialCorrectionRequest.count({ where }),
      prisma.credentialCorrectionRequest.count({ where: { ...ownedBy(institutionId), status: CorrectionStatus.PENDING } })
    ]);
    return res.json({
      correctionRequests: rows.map(toInstitutionCorrection),
      pendingCount: pending,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('Database error while listing correction requests:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable' });
  }
}

export async function getCorrectionRequest(req: AuthRequest, res: Response) {
  const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
  if (!institutionId) return res.status(403).json({ error: 'Institution profile not found' });

  try {
    const request = await prisma.credentialCorrectionRequest.findFirst({
      where: { id: req.params.requestId, ...ownedBy(institutionId) },
      select: correctionRequestFields
    });
    if (!request) return res.status(404).json({ error: 'Correction request not found' });
    return res.json(toInstitutionCorrection(request));
  } catch (error) {
    console.error('Database error while fetching a correction request:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable' });
  }
}

/**
 * Approves or rejects a PENDING request. Only the request changes: approving never edits or revokes the
 * certificate (a correction is made by issuing a replacement, then revoking the original). The decision is
 * written to the audit log without the request text, and the student is notified.
 */
async function decide(req: AuthRequest, res: Response, decision: 'APPROVED' | 'REJECTED') {
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  if (req.body?.note !== undefined && req.body.note !== null && typeof req.body.note !== 'string') {
    return res.status(400).json({ error: 'note must be text' });
  }
  if (decision === CorrectionStatus.REJECTED && !note) return res.status(400).json({ error: 'A note is required to reject a correction request' });
  if (note.length > RESOLUTION_NOTE_MAX) return res.status(400).json({ error: `The note can be at most ${RESOLUTION_NOTE_MAX} characters` });

  const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
  if (!institutionId) return res.status(403).json({ error: 'Institution profile not found' });

  try {
    const request = await prisma.credentialCorrectionRequest.findFirst({
      where: { id: req.params.requestId, ...ownedBy(institutionId) },
      select: { id: true, status: true, certificateId: true, certificate: { select: { certificateUid: true } }, student: { select: { userId: true } } }
    });
    if (!request) return res.status(404).json({ error: 'Correction request not found' });
    if (request.status !== CorrectionStatus.PENDING) return res.status(409).json({ error: 'This correction request has already been decided' });

    const decided = await prisma.$transaction(async (tx) => {
      // Only a request that is still PENDING moves on, so two decisions can never both apply.
      const moved = await tx.credentialCorrectionRequest.updateMany({
        where: { id: request.id, status: CorrectionStatus.PENDING },
        data: { status: decision, resolvedAt: new Date(), resolutionNote: note || null }
      });
      if (moved.count !== 1) return false;
      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: decision === CorrectionStatus.APPROVED ? 'CORRECTION_APPROVED' : 'CORRECTION_REJECTED',
          entityType: 'correctionRequest',
          entityId: request.id,
          // Never the request text (or the note): only which certificate and whether a note was given.
          details: { certificateUid: request.certificate.certificateUid, hasNote: Boolean(note) }
        }
      });
      return true;
    });
    if (!decided) return res.status(409).json({ error: 'This correction request has already been decided' });

    await notify(
      request.student.userId,
      NotificationType.CORRECTION_RESOLVED,
      notificationMessages.correctionResolved(decision === CorrectionStatus.APPROVED, note || null),
      { certificateId: request.certificateId, correctionRequestId: request.id }
    );
    const updated = await prisma.credentialCorrectionRequest.findFirst({ where: { id: request.id }, select: correctionRequestFields });
    return res.json(updated ? toInstitutionCorrection(updated) : { id: request.id, status: decision });
  } catch (error) {
    console.error('Database error while deciding a correction request:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable or operation failed' });
  }
}

export function approveCorrectionRequest(req: AuthRequest, res: Response) {
  return decide(req, res, CorrectionStatus.APPROVED);
}

export function rejectCorrectionRequest(req: AuthRequest, res: Response) {
  return decide(req, res, CorrectionStatus.REJECTED);
}

export default { listCorrectionRequests, getCorrectionRequest, approveCorrectionRequest, rejectCorrectionRequest };
