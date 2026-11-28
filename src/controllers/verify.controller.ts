import { Response, Request } from 'express';
import jwt from 'jsonwebtoken';
import { VerificationMethod, VerificationResult } from '@prisma/client';
import prisma from '../config/db';
import { blockchainProvider, certificateRegistry } from '../config/blockchain';
import env from '../config/env';
import { publicRenderSnapshot, renderSnapshotForResponse } from '../templates/snapshot';
import { computeCertificateHash } from '../utils/certificateHash';
import { certificateFactFields, certificateFacts } from '../utils/certificateFacts';
import { STATUS_MISMATCH_ACTION } from '../utils/auditActions';
import { getClientIp } from '../utils/clientIp';

const STATUS_MISMATCH_LOG_INTERVAL_MS = 60 * 60 * 1000;

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

/**
 * Records that the blockchain says a certificate is revoked while the database says it is active: one system
 * AuditLog entry (no user), at most once per certificate per hour so repeated verifications do not flood the log.
 * Holds no hash. Only reads and writes the audit log: the certificate itself is never changed here. A failure is
 * logged and never changes the verification response.
 */
async function recordStatusMismatch(certificate: { id: string; certificateUid: string; status: string }) {
  try {
    const recent = await prisma.auditLog.findFirst({
      where: {
        action: STATUS_MISMATCH_ACTION,
        entityType: 'certificate',
        entityId: certificate.id,
        createdAt: { gte: new Date(Date.now() - STATUS_MISMATCH_LOG_INTERVAL_MS) }
      },
      select: { id: true }
    });
    if (recent) return;
    await prisma.auditLog.create({
      data: {
        userId: null,
        action: STATUS_MISMATCH_ACTION,
        entityType: 'certificate',
        entityId: certificate.id,
        details: { certificateUid: certificate.certificateUid, databaseStatus: certificate.status, onChainRevoked: true }
      }
    });
  } catch (error) {
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
async function buildVerificationRender(certificateId: string, verified: {
  certificateUid: string;
  studentName: string;
  studentNumber: string;
  certificateType: string;
  programName: string;
  classification: string | null;
  issueDate: Date;
  institutionName: string;
}, graduationDate: Date | null, factsAreFrozen: boolean) {
  try {
    const row = await prisma.certificate.findUnique({
      where: { id: certificateId },
      select: { renderSnapshot: true }
    });
    if (!row) return null;
    const { renderSnapshot, snapshotIsFallback } = renderSnapshotForResponse(row.renderSnapshot, verified.institutionName);
    return {
      snapshot: publicRenderSnapshot(renderSnapshot, factsAreFrozen ? verified.institutionName : undefined),
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
  } catch (error) {
    console.error('Could not build the certificate render for verification:', error instanceof Error ? error.message : error);
    return null;
  }
}

export async function verifyCertificate(req: Request, res: Response) {
  // A result can change (for example when a certificate is revoked), so no response may be cached.
  res.setHeader('Cache-Control', 'no-store');
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
        graduationDate: true,
        certificateHash: true,
        status: true,
        revokedReason: true,
        // hashVersion, the frozen facts, and the live student and institution (used by version 1 only).
        ...certificateFactFields
      }
    });

    if (!certificate) {
      await logVerification({
        certificateUid,
        employerId,
        method,
        result: VerificationResult.NOT_FOUND,
        ipAddress: getClientIp(req)
      });
      return res.status(404).json({ result: 'not_found', message: 'No certificate with this identifier was found.' });
    }

    // What the certificate prints: its own frozen copy (version 2), or the live records (version 1, as before).
    const facts = certificateFacts(certificate);
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
    const recomputedHash = computeCertificateHash(certificate);

    const chainRecord = await certificateRegistry.getCertificate(certificate.certificateUid);
    const onChainHash = String(chainRecord.certificateHash ?? chainRecord[0]);
    const onChainRevoked = Boolean(chainRecord.revoked ?? chainRecord[2]);
    const issuedAt = BigInt(chainRecord.issuedAt ?? chainRecord[3]);

    if (issuedAt === 0n || /^0x0{64}$/i.test(onChainHash)) {
      await logVerification({
        certificateId: certificate.id,
        certificateUid,
        employerId,
        method,
        result: VerificationResult.PENDING_CHAIN,
        ipAddress: getClientIp(req)
      });
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
        result: VerificationResult.TAMPERED,
        ipAddress: getClientIp(req)
      });
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
    const result = databaseRevoked || onChainRevoked ? VerificationResult.REVOKED : VerificationResult.VALID;
    if (statusMismatch) await recordStatusMismatch(certificate);
    await logVerification({
      certificateId: certificate.id,
      certificateUid,
      employerId,
      method,
      result,
      ipAddress: getClientIp(req)
    });

    // Only VALID and REVOKED results reach this point, so only they ever carry `render`.
    const render = await buildVerificationRender(certificate.id, certificateDetails, certificate.graduationDate, facts.frozen);
    return res.json({
      result: result.toLowerCase(),
      message: result === VerificationResult.REVOKED
        ? 'This certificate is revoked.'
        : 'Certificate verified successfully.',
      certificate: certificateDetails,
      ...(result === VerificationResult.REVOKED
        ? {
            revokedReason: certificate.revokedReason ?? null,
            revocation: { onChain: onChainRevoked, statusMismatch }
          }
        : {}),
      ...(render ? { render } : {})
    });
  } catch (error) {
    console.error('Certificate verification failed:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Certificate verification is temporarily unavailable' });
  }
}

export default { verifyCertificate };
