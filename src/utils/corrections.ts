import { CertificateStatus, CorrectionStatus, Prisma } from '@prisma/client';
import { certificateFactFields, certificateFacts } from './certificateFacts';

/**
 * Where a correction request stands. Derived, never stored:
 * - pending: waiting for the institution;
 * - rejected: the institution declined it;
 * - approved_awaiting_reissue: approved, no replacement certificate yet;
 * - replacement_issued: a replacement exists, the original is still active (it should now be revoked);
 * - completed: a replacement exists and the original is revoked.
 */
export type CorrectionStage = 'pending' | 'rejected' | 'approved_awaiting_reissue' | 'replacement_issued' | 'completed';

export function correctionStage(request: { status: CorrectionStatus; replacementCertificateId: string | null; certificate: { status: CertificateStatus } }): CorrectionStage {
  if (request.status === CorrectionStatus.PENDING) return 'pending';
  if (request.status === CorrectionStatus.REJECTED) return 'rejected';
  if (!request.replacementCertificateId) return 'approved_awaiting_reissue';
  return request.certificate.status === CertificateStatus.REVOKED ? 'completed' : 'replacement_issued';
}

export const REQUEST_DETAILS_MIN = 20;
export const REQUEST_DETAILS_MAX = 1000;
export const RESOLUTION_NOTE_MAX = 1000;

/** Everything either view of a correction request needs, in one select. */
export const correctionRequestFields = {
  id: true,
  requestDetails: true,
  status: true,
  resolutionNote: true,
  requestedAt: true,
  resolvedAt: true,
  replacementCertificateId: true,
  certificate: {
    select: {
      id: true,
      certificateUid: true,
      certificateType: true,
      programName: true,
      status: true,
      // The student's name and number as printed on the original certificate (frozen for version 2).
      ...certificateFactFields
    }
  },
  replacementCertificate: { select: { id: true, certificateUid: true, certificateType: true } }
} as const;

export type CorrectionRequestRow = Prisma.CredentialCorrectionRequestGetPayload<{ select: typeof correctionRequestFields }>;

/** What the student sees: their request, its stage, the institution's note and any replacement certificate. */
export function toStudentCorrection(request: CorrectionRequestRow) {
  return {
    id: request.id,
    requestDetails: request.requestDetails,
    status: request.status,
    stage: correctionStage(request),
    resolutionNote: request.resolutionNote,
    requestedAt: request.requestedAt,
    resolvedAt: request.resolvedAt,
    certificate: {
      id: request.certificate.id,
      certificateUid: request.certificate.certificateUid,
      certificateType: request.certificate.certificateType,
      programName: request.certificate.programName,
      status: request.certificate.status
    },
    replacement: request.replacementCertificate
      ? { id: request.replacementCertificate.id, certificateUid: request.replacementCertificate.certificateUid, certificateType: request.replacementCertificate.certificateType }
      : null
  };
}

/** What the institution sees: the same, plus the student as printed on the original certificate. */
export function toInstitutionCorrection(request: CorrectionRequestRow) {
  const facts = certificateFacts(request.certificate);
  return {
    ...toStudentCorrection(request),
    student: { fullName: facts.studentName, studentNumber: facts.studentNumber }
  };
}
