import { Response } from 'express';
import { getAddress, id, isError } from 'ethers';
import { CertificateStatus, Prisma } from '@prisma/client';
import prisma from '../config/db';
import { adminCertificateRegistry, certificateRegistry, getFeeOverrides } from '../config/blockchain';
import { AuthRequest } from '../middleware/auth.middleware';

// keccak256("ISSUER_ROLE"), the contract's constant; computed locally to save an RPC round trip.
const ISSUER_ROLE = id('ISSUER_ROLE');
// One slow RPC read must never hold up a whole response.
const ROLE_READ_TIMEOUT_MS = 4000;
// Serverless functions have a short time limit, so stop waiting for mining well before it.
const MINE_WAIT_MS = 8000;

const AUDIT_ACTIONS = ['INSTITUTION_VERIFIED', 'INSTITUTION_UNVERIFIED', 'ISSUER_GRANTED', 'ISSUER_REVOKED'] as const;
type AuditAction = typeof AUDIT_ACTIONS[number];

const institutionSummaryFields = {
  id: true,
  name: true,
  registrationNumber: true,
  contactEmail: true,
  isVerified: true,
  walletAddress: true,
  createdAt: true,
  _count: { select: { certificates: true } }
} as const;

type InstitutionSummaryRow = Prisma.InstitutionGetPayload<{ select: typeof institutionSummaryFields }>;

function parsePage(query: AuthRequest['query'], maxLimit: number) {
  const page = Math.max(Number.parseInt(String(query.page || '1'), 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(String(query.limit || '20'), 10) || 20, 1), maxLimit);
  return { page, limit };
}

function checksumAddress(address: string | null) {
  if (!address) return null;
  try {
    return getAddress(address);
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The live on-chain role: true or false, or null when there is no wallet or the chain could not be read in time. */
async function readIsIssuer(walletAddress: string | null): Promise<boolean | null> {
  if (!walletAddress) return null;
  try {
    return Boolean(await withTimeout<boolean>(certificateRegistry.isIssuer(walletAddress), ROLE_READ_TIMEOUT_MS));
  } catch (error) {
    console.error('Blockchain read error while checking issuer role:', error instanceof Error ? error.message : error);
    return null;
  }
}

function toInstitutionSummary(row: InstitutionSummaryRow, isIssuer: boolean | null) {
  return {
    id: row.id,
    name: row.name,
    registrationNumber: row.registrationNumber,
    contactEmail: row.contactEmail,
    isVerified: row.isVerified,
    walletAddress: checksumAddress(row.walletAddress),
    createdAt: row.createdAt,
    certificatesIssued: row._count.certificates,
    isIssuer
  };
}

function auditEntry(userId: string, action: AuditAction, institutionId: string, details: Prisma.InputJsonObject) {
  return { userId, action, entityType: 'institution', entityId: institutionId, details };
}

/** Records an on-chain admin action. A logging failure is reported but never changes the response. */
async function writeAuditLog(userId: string, action: AuditAction, institutionId: string, details: Prisma.InputJsonObject) {
  try {
    await prisma.auditLog.create({ data: auditEntry(userId, action, institutionId, details) });
  } catch (error) {
    console.error('Failed to write audit log entry:', error instanceof Error ? error.message : error);
  }
}

// Gas estimation failures carry the revert data but ethers leaves custom errors undecoded there.
function customErrorName(data: string | null | undefined) {
  if (!data) return undefined;
  try {
    return certificateRegistry.interface.parseError(data)?.name;
  } catch {
    return undefined;
  }
}

/** Maps blockchain errors to short client messages. Raw RPC text is only ever logged, never returned. */
function describeChainError(error: unknown): { status: number; message: string } {
  let text = error instanceof Error ? error.message : String(error);
  try {
    text += ` ${JSON.stringify(error) ?? ''}`;
  } catch {
    // Circular error objects fall back to the message alone.
  }
  text = text.toLowerCase();

  if (isError(error, 'INSUFFICIENT_FUNDS') || text.includes('insufficient funds')) {
    return { status: 503, message: 'The administrator wallet does not have enough POL to pay for this transaction.' };
  }
  if (text.includes('gas price below minimum') || text.includes('gas tip cap') || text.includes('underpriced') || text.includes('fee too low')) {
    return { status: 503, message: 'The network rejected the transaction fee. Please try again.' };
  }
  if (isError(error, 'CALL_EXCEPTION')) {
    if (error.reason?.includes('Admin cannot also be issuer')) {
      return { status: 422, message: 'This wallet is the contract administrator and cannot also hold the issuer role.' };
    }
    if ((error.revert?.name ?? customErrorName(error.data)) === 'AccessControlUnauthorizedAccount') {
      return { status: 422, message: 'The administrator wallet is not authorised to manage issuer roles on this contract.' };
    }
    return { status: 422, message: 'The contract rejected this role change.' };
  }
  return { status: 503, message: 'The blockchain network could not be reached. Please try again.' };
}

export async function getOverview(req: AuthRequest, res: Response) {
  try {
    const [institutions, verifiedInstitutions, students, certificates, activeCertificates, revokedCertificates, verifications] = await Promise.all([
      prisma.institution.count(),
      prisma.institution.count({ where: { isVerified: true } }),
      prisma.student.count(),
      prisma.certificate.count(),
      prisma.certificate.count({ where: { status: CertificateStatus.ACTIVE } }),
      prisma.certificate.count({ where: { status: CertificateStatus.REVOKED } }),
      prisma.certificateVerification.count()
    ]);

    return res.json({
      institutions: { total: institutions, verified: verifiedInstitutions, awaitingVerification: institutions - verifiedInstitutions },
      students: { total: students },
      certificates: { total: certificates, active: activeCertificates, revoked: revokedCertificates },
      verifications: { total: verifications }
    });
  } catch (error) {
    console.error('Database error while building admin overview:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable' });
  }
}

export async function listInstitutions(req: AuthRequest, res: Response) {
  const { page, limit } = parsePage(req.query, 50);
  const verified = req.query.verified;
  if (verified !== undefined && verified !== 'true' && verified !== 'false') {
    return res.status(400).json({ error: 'verified must be true or false' });
  }
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';

  const where: Prisma.InstitutionWhereInput = {
    ...(verified !== undefined ? { isVerified: verified === 'true' } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { registrationNumber: { contains: search, mode: 'insensitive' } }
          ]
        }
      : {})
  };

  try {
    const [rows, total] = await prisma.$transaction([
      prisma.institution.findMany({
        where,
        select: institutionSummaryFields,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.institution.count({ where })
    ]);

    // Only the institutions on this page, read in parallel, each with its own timeout.
    const roles = await Promise.all(rows.map((row) => readIsIssuer(checksumAddress(row.walletAddress))));
    const institutions = rows.map((row, index) => toInstitutionSummary(row, roles[index]));

    return res.json({ institutions, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('Database error while listing institutions:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable' });
  }
}

export async function setInstitutionVerification(req: AuthRequest, res: Response) {
  const { isVerified } = req.body ?? {};
  if (typeof isVerified !== 'boolean') return res.status(400).json({ error: 'isVerified must be true or false' });
  const adminUserId = req.user!.id;

  try {
    const existing = await prisma.institution.findUnique({
      where: { id: req.params.institutionId },
      select: { id: true, name: true, isVerified: true }
    });
    if (!existing) return res.status(404).json({ error: 'Institution not found' });

    // Unverifying only changes this flag; the on-chain issuer role is a separate, explicit action.
    const [updated] = await prisma.$transaction([
      prisma.institution.update({ where: { id: existing.id }, data: { isVerified }, select: institutionSummaryFields }),
      prisma.auditLog.create({
        data: auditEntry(adminUserId, isVerified ? 'INSTITUTION_VERIFIED' : 'INSTITUTION_UNVERIFIED', existing.id, {
          institutionName: existing.name,
          previousIsVerified: existing.isVerified
        })
      })
    ]);

    return res.json(toInstitutionSummary(updated, await readIsIssuer(checksumAddress(updated.walletAddress))));
  } catch (error) {
    console.error('Database error while updating institution verification:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable or operation failed' });
  }
}

async function changeIssuerRole(req: AuthRequest, res: Response, action: 'grant' | 'revoke') {
  const adminUserId = req.user!.id;

  let institution: { id: string; name: string; walletAddress: string | null; isVerified: boolean } | null;
  try {
    institution = await prisma.institution.findUnique({
      where: { id: req.params.institutionId },
      select: { id: true, name: true, walletAddress: true, isVerified: true }
    });
  } catch (error) {
    console.error('Database error while loading institution:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable' });
  }
  if (!institution) return res.status(404).json({ error: 'Institution not found' });
  if (!institution.walletAddress) return res.status(400).json({ error: 'Institution has no wallet address' });
  if (action === 'grant' && !institution.isVerified) {
    return res.status(400).json({ error: 'Institution must be verified before receiving issuer access' });
  }
  const walletAddress = checksumAddress(institution.walletAddress);
  if (!walletAddress) return res.status(400).json({ error: 'The institution has an invalid wallet address on file' });

  let holdsRole: boolean;
  try {
    holdsRole = Boolean(await withTimeout<boolean>(certificateRegistry.isIssuer(walletAddress), ROLE_READ_TIMEOUT_MS));
  } catch (error) {
    console.error('Blockchain read error while checking issuer role:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'The blockchain network could not be reached. Please try again.' });
  }
  if (action === 'grant' && holdsRole) {
    return res.status(409).json({ error: "This institution's wallet already holds the issuer role." });
  }
  // revokeRole on a wallet without the role succeeds silently on-chain, so refuse it here instead.
  if (action === 'revoke' && !holdsRole) {
    return res.status(409).json({ error: "This institution's wallet does not currently hold the issuer role." });
  }

  const auditAction: AuditAction = action === 'grant' ? 'ISSUER_GRANTED' : 'ISSUER_REVOKED';
  const baseDetails = { institutionName: institution.name, walletAddress };
  let transactionHash: string | null = null;

  try {
    const feeOverrides = await getFeeOverrides();
    const transaction = action === 'grant'
      ? await adminCertificateRegistry.grantRole(ISSUER_ROLE, walletAddress, feeOverrides)
      : await adminCertificateRegistry.revokeRole(ISSUER_ROLE, walletAddress, feeOverrides);
    transactionHash = transaction.hash as string;

    let receipt;
    try {
      receipt = await transaction.wait(1, MINE_WAIT_MS);
    } catch (error) {
      if (!isError(error, 'TIMEOUT')) throw error;
      await writeAuditLog(adminUserId, auditAction, institution.id, { ...baseDetails, transactionHash, outcome: 'PENDING' });
      return res.status(202).json({
        institutionId: institution.id,
        walletAddress,
        transactionHash,
        status: 'PENDING',
        message: 'The transaction was submitted but is not mined yet. Refresh the institution list shortly to see the final state.'
      });
    }

    const blockNumber = receipt?.blockNumber ?? null;
    await writeAuditLog(adminUserId, auditAction, institution.id, { ...baseDetails, transactionHash, outcome: 'CONFIRMED', blockNumber });
    return res.json({
      institutionId: institution.id,
      walletAddress,
      transactionHash,
      status: 'CONFIRMED',
      blockNumber,
      isIssuer: action === 'grant'
    });
  } catch (error) {
    console.error(`Blockchain error while ${action === 'grant' ? 'granting' : 'revoking'} issuer role:`, error instanceof Error ? error.message : error);
    const failure = describeChainError(error);
    await writeAuditLog(adminUserId, auditAction, institution.id, {
      ...baseDetails,
      transactionHash,
      outcome: 'FAILED',
      failure: failure.message
    });
    return res.status(failure.status).json({ error: failure.message, ...(transactionHash ? { transactionHash } : {}) });
  }
}

export function grantIssuerRole(req: AuthRequest, res: Response) {
  return changeIssuerRole(req, res, 'grant');
}

// Certificates the institution issued earlier stay on-chain, so they remain valid and verifiable.
export function revokeIssuerRole(req: AuthRequest, res: Response) {
  return changeIssuerRole(req, res, 'revoke');
}

export async function listAuditLogs(req: AuthRequest, res: Response) {
  const { page, limit } = parsePage(req.query, 100);
  const actionValue = typeof req.query.action === 'string' && req.query.action ? req.query.action.toUpperCase() : undefined;
  if (actionValue && !AUDIT_ACTIONS.includes(actionValue as AuditAction)) {
    return res.status(400).json({ error: `action must be one of ${AUDIT_ACTIONS.join(', ')}` });
  }

  const where: Prisma.AuditLogWhereInput = { action: actionValue ?? { in: [...AUDIT_ACTIONS] } };

  try {
    const [rows, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          createdAt: true,
          action: true,
          entityId: true,
          details: true,
          user: { select: { email: true } }
        }
      }),
      prisma.auditLog.count({ where })
    ]);

    const institutionIds = [...new Set(rows.map((row) => row.entityId).filter((value): value is string => Boolean(value)))];
    const institutions = institutionIds.length
      ? await prisma.institution.findMany({ where: { id: { in: institutionIds } }, select: { id: true, name: true } })
      : [];
    const namesById = new Map(institutions.map((institution) => [institution.id, institution.name]));

    const auditLogs = rows.map((row) => {
      const details = row.details && typeof row.details === 'object' && !Array.isArray(row.details) ? row.details : {};
      const recordedName = typeof details.institutionName === 'string' ? details.institutionName : null;
      return {
        id: row.id,
        createdAt: row.createdAt,
        adminEmail: row.user?.email ?? null,
        action: row.action,
        institution: { id: row.entityId, name: (row.entityId && namesById.get(row.entityId)) || recordedName },
        details
      };
    });

    return res.json({ auditLogs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('Database error while listing audit logs:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable' });
  }
}

export default {
  getOverview,
  listInstitutions,
  setInstitutionVerification,
  grantIssuerRole,
  revokeIssuerRole,
  listAuditLogs
};
