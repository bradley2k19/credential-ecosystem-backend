"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVerificationHistory = getVerificationHistory;
const db_1 = __importDefault(require("../config/db"));
async function getVerificationHistory(req, res) {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ error: 'Authentication required' });
    const page = Math.max(Number.parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
    try {
        const employer = await db_1.default.employer.findUnique({
            where: { userId },
            select: { id: true }
        });
        if (!employer)
            return res.status(404).json({ error: 'Employer profile not found' });
        const where = { employerId: employer.id };
        const [verifications, total] = await db_1.default.$transaction([
            db_1.default.certificateVerification.findMany({
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
            db_1.default.certificateVerification.count({ where })
        ]);
        return res.json({
            verifications,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    }
    catch (error) {
        console.error('Unable to load employer verification history:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Verification history is temporarily unavailable' });
    }
}
exports.default = { getVerificationHistory };
