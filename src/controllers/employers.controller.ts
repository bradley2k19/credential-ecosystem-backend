import { Response } from 'express';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';

export async function getVerificationHistory(req: AuthRequest, res: Response) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  const page = Math.max(Number.parseInt(String(req.query.page || '1'), 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);

  try {
    const employer = await prisma.employer.findUnique({
      where: { userId },
      select: { id: true }
    });
    if (!employer) return res.status(404).json({ error: 'Employer profile not found' });

    const where = { employerId: employer.id };
    const [verifications, total] = await prisma.$transaction([
      prisma.certificateVerification.findMany({
        where,
        orderBy: { verifiedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          certificateUidQueried: true,
          method: true,
          result: true,
          verifiedAt: true,
          certificate: {
            select: {
              certificateUid: true,
              certificateType: true,
              programName: true
            }
          }
        }
      }),
      prisma.certificateVerification.count({ where })
    ]);

    return res.json({
      verifications,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('Unable to load employer verification history:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Verification history is temporarily unavailable' });
  }
}

export default { getVerificationHistory };
