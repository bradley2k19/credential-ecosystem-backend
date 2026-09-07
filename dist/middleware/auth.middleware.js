"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireRole = requireRole;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = __importDefault(require("../config/env"));
function requireAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing authorization token' });
    }
    const token = auth.split(' ')[1];
    try {
        const payload = jsonwebtoken_1.default.verify(token, env_1.default.JWT_SECRET);
        req.user = { id: payload.id, role: payload.role };
        return next();
    }
    catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}
function requireRole(roles) {
    const allowed = Array.isArray(roles) ? roles : [roles];
    return (req, res, next) => {
        if (!req.user)
            return res.status(401).json({ error: 'Missing authorization token' });
        if (!allowed.includes(req.user.role))
            return res.status(403).json({ error: 'Forbidden' });
        return next();
    };
}
exports.default = { requireAuth, requireRole };
