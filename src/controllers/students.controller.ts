import { Response } from 'express';
import { CertificateStatus, Prisma, VerificationResult } from '@prisma/client';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';
import { onChainTransactionsSelect, summariseOnChain } from '../utils/onChain';

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

function toStudentCertificate({ institution, blockchainTransactions, revokedReason, ...certificate }: StudentCertificateRow) {
  return {
    ...certificate,
    ...(certificate.status === CertificateStatus.REVOKED ? { revokedReason } : {}),
    institutionName: institution.name,
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
        user: { select: { email: true } },
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
      institutionName: student.institution.name
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
      select: studentCertificateFields
    });
    if (!certificate) return res.status(404).json({ error: 'Certificate not found' });
    return res.json(toStudentCertificate(certificate));
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

export default { getProfile, listCertificates, getCertificate, getVerificationHistory };
