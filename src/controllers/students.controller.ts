import { Response } from 'express';
import { CertificateStatus, CorrectionStatus, NotificationType, Prisma, VerificationResult } from '@prisma/client';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';
import { onChainTransactionsSelect, summariseOnChain } from '../utils/onChain';
import { renderSnapshotForResponse, withPrintedInstitutionName } from '../templates/snapshot';
import { certificateFactFields, certificateFacts } from '../utils/certificateFacts';
import { correctionRequestFields, REQUEST_DETAILS_MAX, REQUEST_DETAILS_MIN, toStudentCorrection } from '../utils/corrections';
import { notificationMessages, notify } from '../utils/notifications';
import { rateLimiter, RATE_LIMIT_MESSAGES, RATE_LIMITS, sendTooManyRequests } from '../utils/rateLimit';

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
  ...certificateFactFields,
  blockchainTransactions: onChainTransactionsSelect
} as const;

type StudentCertificateRow = Prisma.CertificateGetPayload<{ select: typeof studentCertificateFields }>;

// The student is always resolved from the token, never from a client-supplied id.
async function getStudentId(userId: string) {
  const student = await prisma.student.findUnique({
    where: { userId },
    select: { id: true }
  });
  return student?.id;
}

/** A certificate for the student's pages: the institution name as printed on it (frozen for version 2). */
function toStudentCertificate(row: StudentCertificateRow) {
  const {
    institution: _institution, student: _student, hashVersion: _version, studentNameAtIssue: _name,
    studentNumberAtIssue: _number, institutionNameAtIssue: _institutionName, blockchainTransactions, revokedReason, ...certificate
  } = row;
  return {
    ...certificate,
    ...(certificate.status === CertificateStatus.REVOKED ? { revokedReason } : {}),
    institutionName: certificateFacts(row).institutionName,
    onChain: summariseOnChain(blockchainTransactions)
  };
}

export async function getProfile(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  try {
    const student = await prisma.student.findUnique({
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
    if (!student) return res.status(404).json({ error: 'Student profile not found' });

    return res.json({
      fullName: student.fullName,
      studentNumber: student.studentNumber,
      programName: student.programName,
      enrollmentYear: student.enrollmentYear,
      email: student.user.email,
      institutionName: student.institution.name,
      notifyOnVerification: student.user.notifyOnVerification
    });
  } catch (error) {
    console.error('Database error while fetching student profile:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable' });
  }
}

export async function listCertificates(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  const page = Math.max(Number.parseInt(String(req.query.page || '1'), 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);

  try {
    const studentId = await getStudentId(userId);
    if (!studentId) return res.status(404).json({ error: 'Student profile not found' });

    const where = { studentId };
    const [rows, total] = await prisma.$transaction([
      prisma.certificate.findMany({
        where,
        select: studentCertificateFields,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.certificate.count({ where })
    ]);

    return res.json({
      certificates: rows.map(toStudentCertificate),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('Database error while listing student certificates:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable' });
  }
}

export async function getCertificate(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  try {
    const studentId = await getStudentId(userId);
    if (!studentId) return res.status(404).json({ error: 'Student profile not found' });

    // Scoping by studentId makes another student's certificate indistinguishable from a missing one.
    const certificate = await prisma.certificate.findFirst({
      where: { id: req.params.certificateId, studentId },
      // The renderer's {{student_name}}, {{student_number}} and institution name come from certificateFacts.
      select: { ...studentCertificateFields, renderSnapshot: true }
    });
    if (!certificate) return res.status(404).json({ error: 'Certificate not found' });
    // Only the single-certificate response carries the snapshot: the frozen one, or the computed fallback.
    const { renderSnapshot, ...row } = certificate;
    // The certificate's own facts: frozen at issuance for version 2, the live records for version 1 (as before).
    const facts = certificateFacts(certificate);
    const rendered = renderSnapshotForResponse(renderSnapshot, facts.institutionName);
    return res.json({
      ...toStudentCertificate(row),
      student: { fullName: facts.studentName, studentNumber: facts.studentNumber },
      ...rendered,
      ...(facts.frozen ? { renderSnapshot: withPrintedInstitutionName(rendered.renderSnapshot, facts.institutionName) } : {})
    });
  } catch (error) {
    console.error('Database error while fetching student certificate:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable' });
  }
}

export async function getVerificationHistory(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  const page = Math.max(Number.parseInt(String(req.query.page || '1'), 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);

  try {
    const studentId = await getStudentId(userId);
    if (!studentId) return res.status(404).json({ error: 'Student profile not found' });

    const where: Prisma.CertificateVerificationWhereInput = {
      certificate: { studentId },
      result: { not: VerificationResult.NOT_FOUND }
    };
    const [rows, total] = await prisma.$transaction([
      prisma.certificateVerification.findMany({
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
      prisma.certificateVerification.count({ where })
    ]);

    const verifications = rows.map(({ employer, ...verification }) => ({
      ...verification,
      verifiedBy: employer?.companyName ?? 'Anonymous'
    }));

    return res.json({
      verifications,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('Unable to load student verification history:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Verification history is temporarily unavailable' });
  }
}

/** Saves the student's notification preference. Only `notifyOnVerification` can be set. */
export async function updatePreferences(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });
  const { notifyOnVerification } = req.body ?? {};
  if (typeof notifyOnVerification !== 'boolean' || Object.keys(req.body).length !== 1) {
    return res.status(400).json({ error: 'Send { notifyOnVerification: true | false }' });
  }

  try {
    const user = await prisma.user.update({ where: { id: userId }, data: { notifyOnVerification }, select: { notifyOnVerification: true } });
    return res.json({ notifyOnVerification: user.notifyOnVerification });
  } catch (error) {
    console.error('Database error while saving student preferences:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable or operation failed' });
  }
}

/**
 * Asks the institution to correct one of the student's active certificates. Nothing about the certificate changes:
 * if the institution approves, it issues a replacement and revokes the original.
 */
export async function requestCorrection(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });
  const requestDetails = typeof req.body?.requestDetails === 'string' ? req.body.requestDetails.trim() : '';
  if (requestDetails.length < REQUEST_DETAILS_MIN || requestDetails.length > REQUEST_DETAILS_MAX) {
    return res.status(400).json({ error: `Describe the correction in ${REQUEST_DETAILS_MIN} to ${REQUEST_DETAILS_MAX} characters` });
  }

  try {
    const studentId = await getStudentId(userId);
    if (!studentId) return res.status(404).json({ error: 'Student profile not found' });

    const certificate = await prisma.certificate.findFirst({
      where: { id: req.params.certificateId, studentId },
      select: {
        id: true,
        status: true,
        certificateType: true,
        programName: true,
        ...certificateFactFields,
        institution: { select: { name: true, userId: true } }
      }
    });
    if (!certificate) return res.status(404).json({ error: 'Certificate not found' });
    if (certificate.status !== CertificateStatus.ACTIVE) {
      return res.status(409).json({ error: 'Only an active certificate can be corrected' });
    }
    const pending = await prisma.credentialCorrectionRequest.findFirst({
      where: { certificateId: certificate.id, status: CorrectionStatus.PENDING },
      select: { id: true }
    });
    if (pending) return res.status(409).json({ error: 'A correction request for this certificate is already waiting for the institution' });

    // At most 5 created per student per day; checked here, counted only once a request is actually created.
    const limit = await rateLimiter.check(RATE_LIMITS.correctionRequest, studentId);
    if (!limit.allowed) return sendTooManyRequests(res, RATE_LIMIT_MESSAGES.correctionRequest, limit.retryAfterSeconds);

    const request = await prisma.credentialCorrectionRequest.create({
      data: { certificateId: certificate.id, studentId, requestDetails },
      select: correctionRequestFields
    });
    await rateLimiter.record(RATE_LIMITS.correctionRequest, studentId);
    await notify(
      certificate.institution.userId,
      NotificationType.CORRECTION_REQUEST,
      notificationMessages.correctionRequested(certificateFacts(certificate).studentName, certificate.certificateType, certificate.programName),
      { certificateId: certificate.id, correctionRequestId: request.id }
    );
    return res.status(201).json(toStudentCorrection(request));
  } catch (error) {
    console.error('Database error while requesting a correction:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable or operation failed' });
  }
}

/** The student's correction requests, newest first, each with its stage. */
export async function listCorrectionRequests(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  try {
    const studentId = await getStudentId(userId);
    if (!studentId) return res.status(404).json({ error: 'Student profile not found' });
    const requests = await prisma.credentialCorrectionRequest.findMany({
      where: { studentId },
      orderBy: { requestedAt: 'desc' },
      select: correctionRequestFields
    });
    return res.json({ correctionRequests: requests.map(toStudentCorrection) });
  } catch (error) {
    console.error('Database error while listing correction requests:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable' });
  }
}

export default { getProfile, listCertificates, getCertificate, getVerificationHistory, updatePreferences, requestCorrection, listCorrectionRequests };
