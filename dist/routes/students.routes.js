"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const students_controller_1 = __importDefault(require("../controllers/students.controller"));
const router = (0, express_1.Router)();
const studentOnly = [auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)('STUDENT')];
router.get('/me', studentOnly, students_controller_1.default.getProfile);
router.get('/me/certificates', studentOnly, students_controller_1.default.listCertificates);
router.get('/me/certificates/:certificateId', studentOnly, students_controller_1.default.getCertificate);
router.get('/me/verifications', studentOnly, students_controller_1.default.getVerificationHistory);
exports.default = router;
