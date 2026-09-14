"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdminSecret = requireAdminSecret;
const env_1 = __importDefault(require("../config/env"));
// Placeholder for a real admin authentication and authorization system.
function requireAdminSecret(req, res, next) {
    if (req.header('X-Admin-Secret') !== env_1.default.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Invalid or missing admin secret' });
    }
    return next();
}
exports.default = requireAdminSecret;
