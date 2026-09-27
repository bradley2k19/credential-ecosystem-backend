import { Response, Request } from 'express';
import jwt from 'jsonwebtoken';
import { VerificationMethod, VerificationResult } from '@prisma/client';
import prisma from '../config/db';
import { blockchainProvider, certificateRegistry } from '../config/blockchain';
import env from '../config/env';
import { generateCertificateHash } from '../utils/certificateHash';

function getMethod(value: unknown): VerificationMethod | undefined {
  if (value === undefined) return VerificationMethod.MANUAL_ID;
  if (value === 'qr') return VerificationMethod.QR;
  if (value === 'manual_id') return VerificationMethod.MANUAL_ID;
  return undefined;
}

async function getOptionalEmployerId(req: Request): Promise<string | null> {
  const authorization = req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) return null;

  try {
    const payload = jwt.verify(authorization.slice(7), env.JWT_SECRET);
    if (typeof payload === 'string' || payload.role !== 'EMPLOYER' || typeof payload.id !== 'string') return null;

    const employer = await prisma.employer.findFirst({
      where: { userId: payload.id, user: { role: 'EMPLOYER', isActive: true } },
      select: { id: true }
    });
    return employer?.id ?? null;
  } catch {
    return null;
  }
}

async function logVerification(input: {
  certificateId?: string;
  certificateUid: string;
  employerId: string | null;
  method: VerificationMethod;
  result: VerificationResult;
  ipAddress: string | undefined;
}) {
  await prisma.certificateVerification.create({
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

export async function verifyCertificate(req: Request, res: Response) {
  const certificateUid = req.params.certificateUid;
  const method = getMethod(req.query.method);
  if (!method) return res.status(400).json({ error: 'method must be qr or manual_id' });

  try {
    const employerId = await getOptionalEmployerId(req);
    const certificate = await prisma.certificate.findUnique({
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
        result: VerificationResult.NOT_FOUND,
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

    const recomputedHash = generateCertificateHash({
      studentId: certificate.studentId,
      institutionId: certificate.institutionId,
      certificateType: certificate.certificateType,
      programName: certificate.programName,
      classification: certificate.classification,
      issueDate: certificate.issueDate,
      certificateUid: certificate.certificateUid
    });

    const chainRecord = await certificateRegistry.getCertificate(certificate.certificateUid);
    const onChainHash = String(chainRecord.certificateHash ?? chainRecord[0]);
    const issuedAt = BigInt(chainRecord.issuedAt ?? chainRecord[3]);

    if (issuedAt === 0n || /^0x0{64}$/i.test(onChainHash)) {
      await logVerification({
        certificateId: certificate.id,
        certificateUid,
        employerId,
        method,
        result: VerificationResult.PENDING_CHAIN,
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
        result: VerificationResult.TAMPERED,
        ipAddress: req.ip
      });
      return res.json({
        result: 'tampered',
        message: 'Data integrity concern: the certificate data stored in the database does not match its blockchain record.',
        certificate: certificateDetails
      });
    }

    const result = certificate.status === 'REVOKED' ? VerificationResult.REVOKED : VerificationResult.VALID;
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
      message: result === VerificationResult.REVOKED
        ? 'This certificate is revoked.'
        : 'Certificate verified successfully.',
      certificate: certificateDetails,
      ...(result === VerificationResult.REVOKED && certificate.revokedReason
        ? { revokedReason: certificate.revokedReason }
        : {})
    });
  } catch (error) {
    console.error('Certificate verification failed:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Certificate verification is temporarily unavailable' });
  }
}

export default { verifyCertificate };
