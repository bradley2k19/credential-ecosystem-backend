"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAsset = getAsset;
const db_1 = __importDefault(require("../config/db"));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Public read of an institution image. No login: these images appear on certificates students share publicly,
 * and asset ids are random UUIDs. Assets never change, so responses can be cached forever.
 */
async function getAsset(req, res) {
    const { assetId } = req.params;
    if (!uuidPattern.test(assetId))
        return res.status(404).json({ error: 'Asset not found' });
    try {
        const asset = await db_1.default.institutionAsset.findUnique({
            where: { id: assetId },
            select: { mimeType: true, data: true }
        });
        if (!asset)
            return res.status(404).json({ error: 'Asset not found' });
        res.setHeader('Content-Type', asset.mimeType);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.send(Buffer.from(asset.data));
    }
    catch (error) {
        console.error('Database error while reading asset:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable' });
    }
}
exports.default = { getAsset };
