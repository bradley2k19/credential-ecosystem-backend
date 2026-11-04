"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const admin_controller_1 = __importDefault(require("../controllers/admin.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Every /api/admin route, including unknown paths, requires an ADMIN token.
router.use(auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)('ADMIN'));
router.get('/overview', admin_controller_1.default.getOverview);
router.get('/institutions', admin_controller_1.default.listInstitutions);
router.patch('/institutions/:institutionId/verification', admin_controller_1.default.setInstitutionVerification);
router.post('/institutions/:institutionId/grant-issuer', admin_controller_1.default.grantIssuerRole);
router.post('/institutions/:institutionId/revoke-issuer', admin_controller_1.default.revokeIssuerRole);
router.get('/audit-logs', admin_controller_1.default.listAuditLogs);
exports.default = router;
