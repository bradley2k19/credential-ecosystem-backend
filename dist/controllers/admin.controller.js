"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantIssuerRole = grantIssuerRole;
const db_1 = __importDefault(require("../config/db"));
const blockchain_1 = require("../config/blockchain");
async function grantIssuerRole(req, res) {
    try {
        const institution = await db_1.default.institution.findUnique({
            where: { id: req.params.institutionId },
            select: { id: true, walletAddress: true, isVerified: true }
        });
        if (!institution)
            return res.status(404).json({ error: 'Institution not found' });
        if (!institution.walletAddress)
            return res.status(400).json({ error: 'Institution has no wallet address' });
        if (!institution.isVerified)
            return res.status(400).json({ error: 'Institution must be verified before receiving issuer access' });
        const issuerRole = await blockchain_1.adminCertificateRegistry.ISSUER_ROLE();
        const transaction = await blockchain_1.adminCertificateRegistry.grantRole(issuerRole, institution.walletAddress);
        const receipt = await transaction.wait();
        return res.json({
            institutionId: institution.id,
            walletAddress: institution.walletAddress,
            transactionHash: receipt.hash,
            confirmed: receipt.status === 1,
            blockNumber: receipt.blockNumber
        });
    }
    catch (error) {
        console.error('Blockchain error while granting issuer role:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Unable to grant issuer role' });
    }
}
exports.default = { grantIssuerRole };
