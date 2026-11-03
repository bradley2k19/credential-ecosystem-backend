import { Response } from 'express';
import { CertificateStatus, Prisma, VerificationResult } from '@prisma/client';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';
import { onChainTransactionsSelect, summariseOnChain } from '../utils/onChain';
import { csvDate, toCsv } from '../utils/csv';

const EXPORT_ROW_LIMIT = 10000;

// NOT_FOUND attempts are not linked to a certificate, so they can never belong to an institution.
const attributableResults: VerificationResult[] = [
  VerificationResult.VALID,
  VerificationResult.REVOKED,
  VerificationResult.TAMPERED,
  VerificationResult.PENDING_CHAIN
];

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

async function getInstitutionId(userId: string) {
  const institution = await prisma.institution.findUnique({
    where: { userId },
    select: { id: true }
  });
  return institution?.id;
}

/**
 * Builds an inclusive date range filter from optional `from` and `to` query values.
 * A date-only `to` (YYYY-MM-DD) covers that whole UTC day; full ISO timestamps are used as given.
 * Returns null when a value is present but invalid.
 */
function parseDateRange(from: unknown, to: unknown): Prisma.DateTimeFilter | undefined | null {
  const filter: Prisma.DateTimeFilter = {};
  for (const [bound, value] of [['from', from], ['to', to]] as const) {
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string') return null;
    const date = new Date(dateOnly.test(value) ? `${value}T00:00:00.000Z` : value);
    if (Number.isNaN(date.getTime())) return null;
    if (bound === 'from') filter.gte = date;
    else if (dateOnly.test(value)) filter.lt = new Date(date.getTime() + 24 * 60 * 60 * 1000);
    else filter.lte = date;
  }
  if (filter.gte && ((filter.lt && filter.gte >= filter.lt) || (filter.lte && filter.gte > filter.lte))) return null;
  return Object.keys(filter).length ? filter : undefined;
}

export async function listVerifications(req: AuthRequest, res: Response) {
  const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
  if (!institutionId) return res.status(403).json({ error: 'Institution profile not found' });

  const page = Math.max(Number.parseInt(String(req.query.page || '1'), 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
  const resultValue = typeof req.query.result === 'string' && req.query.result ? req.query.result.toUpperCase() : undefined;
  if (resultValue && !attributableResults.includes(resultValue as VerificationResult)) {
    return res.status(400).json({ error: 'result must be VALID, REVOKED, TAMPERED or PENDING_CHAIN' });
  }
  const verifiedAt = parseDateRange(req.query.from, req.query.to);
  if (verifiedAt === null) return res.status(400).json({ error: 'from and to must be valid ISO dates, with from not after to' });

  const where: Prisma.CertificateVerificationWhereInput = {
    certificate: { institutionId },
    result: resultValue ? (resultValue as VerificationResult) : { in: attributableResults },
    ...(verifiedAt ? { verifiedAt } : {})
  };

  try {
    const [rows, total] = await prisma.$transaction([
      prisma.certificateVerification.findMany({
        where,
        orderBy: { verifiedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          verifiedAt: true,
          result: true,
          method: true,
          certificate: {
            select: {
              certificateUid: true,
              certificateType: true,
              programName: true,
              student: { select: { fullName: true, studentNumber: true } }
            }
          },
          employer: { select: { companyName: true } }
        }
      }),
      prisma.certificateVerification.count({ where })
    ]);

    const verifications = rows.map(({ certificate, employer, ...verification }) => ({
      ...verification,
      certificate: certificate
        ? { certificateUid: certificate.certificateUid, certificateType: certificate.certificateType, programName: certificate.programName }
        : null,
      student: certificate ? certificate.student : null,
      verifiedBy: employer?.companyName ?? 'Anonymous'
    }));

    return res.json({ verifications, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('Database error while listing institution verifications:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Verification activity is temporarily unavailable' });
  }
}

export async function getSummary(req: AuthRequest, res: Response) {
  const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
  if (!institutionId) return res.status(403).json({ error: 'Institution profile not found' });

  const verificationWhere: Prisma.CertificateVerificationWhereInput = {
    certificate: { institutionId },
    result: { in: attributableResults }
  };
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  try {
    const [total, active, revoked, issueConfirmed, issueMissingOrFailed, byResult, last30Days] = await Promise.all([
      prisma.certificate.count({ where: { institutionId } }),
      prisma.certificate.count({ where: { institutionId, status: CertificateStatus.ACTIVE } }),
      prisma.certificate.count({ where: { institutionId, status: CertificateStatus.REVOKED } }),
      prisma.certificate.count({
        where: { institutionId, blockchainTransactions: { some: { txType: 'ISSUE', status: 'CONFIRMED' } } }
      }),
      // No issuance recorded at all, or only failed attempts (nothing confirmed or still pending).
      prisma.certificate.count({
        where: { institutionId, blockchainTransactions: { none: { txType: 'ISSUE', status: { in: ['CONFIRMED', 'PENDING'] } } } }
      }),
      prisma.certificateVerification.groupBy({ by: ['result'], where: verificationWhere, _count: { _all: true } }),
      prisma.certificateVerification.count({ where: { ...verificationWhere, verifiedAt: { gte: since } } })
    ]);

    const results = Object.fromEntries(attributableResults.map((result) => [result, 0])) as Record<string, number>;
    for (const group of byResult) results[group.result] = group._count._all;

    return res.json({
      certificates: {
        total,
        active,
        revoked,
        issueConfirmed,
        issuePending: total - issueConfirmed - issueMissingOrFailed,
        issueMissingOrFailed
      },
      verifications: {
        total: Object.values(results).reduce((sum, count) => sum + count, 0),
        last30Days,
        byResult: results
      }
    });
  } catch (error) {
    console.error('Database error while building institution summary:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Report summary is temporarily unavailable' });
  }
}

const onChainLabels: Record<string, string> = { CONFIRMED: 'Confirmed', PENDING: 'Pending', FAILED: 'Failed' };

export async function exportCertificatesCsv(req: AuthRequest, res: Response) {
  const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
  if (!institutionId) return res.status(403).json({ error: 'Institution profile not found' });

  const statusValue = typeof req.query.status === 'string' && req.query.status ? req.query.status.toUpperCase() : undefined;
  if (statusValue && !['ACTIVE', 'REVOKED'].includes(statusValue)) {
    return res.status(400).json({ error: 'status must be ACTIVE or REVOKED' });
  }
  const issueDate = parseDateRange(req.query.from, req.query.to);
  if (issueDate === null) return res.status(400).json({ error: 'from and to must be valid ISO dates, with from not after to' });

  const where: Prisma.CertificateWhereInput = {
    institutionId,
    ...(statusValue ? { status: statusValue as CertificateStatus } : {}),
    ...(issueDate ? { issueDate } : {})
  };

  try {
    const count = await prisma.certificate.count({ where });
    if (count > EXPORT_ROW_LIMIT) {
      return res.status(400).json({
        error: `This export would contain ${count.toLocaleString('en-US')} certificates, more than the limit of ${EXPORT_ROW_LIMIT.toLocaleString('en-US')}. Narrow the status or issue date filters and try again.`
      });
    }

    const rows = await prisma.certificate.findMany({
      where,
      orderBy: { issueDate: 'desc' },
      take: EXPORT_ROW_LIMIT,
      select: {
        certificateUid: true,
        certificateType: true,
        programName: true,
        classification: true,
        issueDate: true,
        graduationDate: true,
        status: true,
        revokedReason: true,
        revokedAt: true,
        student: { select: { fullName: true, studentNumber: true } },
        blockchainTransactions: onChainTransactionsSelect
      }
    });

    const csv = toCsv(
      [
        'Certificate ID', 'Student name', 'Student number', 'Certificate type', 'Programme', 'Classification',
        'Issue date', 'Graduation date', 'Status', 'Revoked reason', 'Revoked at', 'On-chain issuance', 'On-chain revocation'
      ],
      rows.map((certificate) => {
        const onChain = summariseOnChain(certificate.blockchainTransactions);
        return [
          certificate.certificateUid,
          certificate.student.fullName,
          certificate.student.studentNumber,
          certificate.certificateType,
          certificate.programName,
          certificate.classification,
          csvDate(certificate.issueDate),
          csvDate(certificate.graduationDate),
          certificate.status === CertificateStatus.REVOKED ? 'Revoked' : 'Active',
          certificate.revokedReason,
          csvDate(certificate.revokedAt),
          onChain.issue ? onChainLabels[onChain.issue.status] : 'Not recorded',
          onChain.revoke ? onChainLabels[onChain.revoke.status] : ''
        ];
      })
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="certificates-${csvDate(new Date())}.csv"`);
    // The byte order mark makes Excel read the file as UTF-8, so accented names display correctly.
    return res.send(`﻿${csv}`);
  } catch (error) {
    console.error('Database error while exporting certificates:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Certificate export is temporarily unavailable' });
  }
}

export default { listVerifications, getSummary, exportCertificatesCsv };
