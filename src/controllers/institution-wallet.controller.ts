import { isAddress, getAddress } from 'ethers';
import { Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';
import { certificateRegistry } from '../config/blockchain';

async function getInstitution(userId: string) {
  return prisma.institution.findUnique({
    where: { userId },
    select: {
      id: true,
      name: true,
      registrationNumber: true,
      address: true,
      contactEmail: true,
      walletAddress: true,
      isVerified: true,
      createdAt: true
    }
  });
}

export async function setWalletAddress(req: AuthRequest, res: Response) {
  const { walletAddress } = req.body;
  if (!walletAddress || typeof walletAddress !== 'string' || !isAddress(walletAddress)) {
    return res.status(400).json({ error: 'walletAddress must be a valid Ethereum address' });
  }

  try {
    const institution = req.user ? await getInstitution(req.user.id) : null;
    if (!institution) return res.status(404).json({ error: 'Institution profile not found' });

    const updated = await prisma.institution.update({
      where: { id: institution.id },
      data: { walletAddress: getAddress(walletAddress) },
      select: {
        id: true,
        name: true,
        registrationNumber: true,
        address: true,
        contactEmail: true,
        walletAddress: true,
        isVerified: true,
        createdAt: true
      }
    });
    return res.json(updated);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'That wallet address is already linked to another institution' });
    }
    console.error('Database error while saving institution wallet:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable or operation failed' });
  }
}

export async function getIssuerStatus(req: AuthRequest, res: Response) {
  try {
    const institution = req.user ? await getInstitution(req.user.id) : null;
    if (!institution) return res.status(404).json({ error: 'Institution profile not found' });
    if (!institution.walletAddress) return res.json({ hasWallet: false });

    const isIssuer = await certificateRegistry.isIssuer(institution.walletAddress);
    return res.json({ hasWallet: true, isIssuer });
  } catch (error) {
    console.error('Blockchain read error while checking issuer status:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Blockchain provider unavailable' });
  }
}

export default { setWalletAddress, getIssuerStatus };