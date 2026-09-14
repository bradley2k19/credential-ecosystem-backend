import { Response } from 'express';
import prisma from '../config/db';
import { adminCertificateRegistry } from '../config/blockchain';
import { AuthRequest } from '../middleware/auth.middleware';

export async function grantIssuerRole(req: AuthRequest, res: Response) {
  try {
    const institution = await prisma.institution.findUnique({
      where: { id: req.params.institutionId },
      select: { id: true, walletAddress: true, isVerified: true }
    });
    if (!institution) return res.status(404).json({ error: 'Institution not found' });
    if (!institution.walletAddress) return res.status(400).json({ error: 'Institution has no wallet address' });
    if (!institution.isVerified) return res.status(400).json({ error: 'Institution must be verified before receiving issuer access' });

    const issuerRole = await adminCertificateRegistry.ISSUER_ROLE();
    const transaction = await adminCertificateRegistry.grantRole(issuerRole, institution.walletAddress);
    const receipt = await transaction.wait();

    return res.json({
      institutionId: institution.id,
      walletAddress: institution.walletAddress,
      transactionHash: receipt.hash,
      confirmed: receipt.status === 1,
      blockNumber: receipt.blockNumber
    });
  } catch (error) {
    console.error('Blockchain error while granting issuer role:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Unable to grant issuer role' });
  }
}

export default { grantIssuerRole };