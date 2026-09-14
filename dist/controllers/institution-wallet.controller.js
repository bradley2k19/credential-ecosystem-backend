"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setWalletAddress = setWalletAddress;
exports.getIssuerStatus = getIssuerStatus;
const ethers_1 = require("ethers");
const client_1 = require("@prisma/client");
const db_1 = __importDefault(require("../config/db"));
const blockchain_1 = require("../config/blockchain");
async function getInstitution(userId) {
    return db_1.default.institution.findUnique({
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
async function setWalletAddress(req, res) {
    const { walletAddress } = req.body;
    if (!walletAddress || typeof walletAddress !== 'string' || !(0, ethers_1.isAddress)(walletAddress)) {
        return res.status(400).json({ error: 'walletAddress must be a valid Ethereum address' });
    }
    try {
        const institution = req.user ? await getInstitution(req.user.id) : null;
        if (!institution)
            return res.status(404).json({ error: 'Institution profile not found' });
        const updated = await db_1.default.institution.update({
            where: { id: institution.id },
            data: { walletAddress: (0, ethers_1.getAddress)(walletAddress) },
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
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return res.status(409).json({ error: 'That wallet address is already linked to another institution' });
        }
        console.error('Database error while saving institution wallet:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable or operation failed' });
    }
}
async function getIssuerStatus(req, res) {
    try {
        const institution = req.user ? await getInstitution(req.user.id) : null;
        if (!institution)
            return res.status(404).json({ error: 'Institution profile not found' });
        if (!institution.walletAddress)
            return res.json({ hasWallet: false });
        const isIssuer = await blockchain_1.certificateRegistry.isIssuer(institution.walletAddress);
        return res.json({ hasWallet: true, isIssuer });
    }
    catch (error) {
        console.error('Blockchain read error while checking issuer status:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Blockchain provider unavailable' });
    }
}
exports.default = { setWalletAddress, getIssuerStatus };
