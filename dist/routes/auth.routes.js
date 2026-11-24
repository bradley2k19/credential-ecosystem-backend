"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = __importDefault(require("../controllers/auth.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const rateLimit_1 = require("../utils/rateLimit");
const router = (0, express_1.Router)();
// All three registration forms share one per-IP limit. Login and change-password count failures only (in the controller).
const limitRegistrations = (0, rateLimit_1.limitRequestsByIp)(rateLimit_1.RATE_LIMITS.register, rateLimit_1.RATE_LIMIT_MESSAGES.attempts);
router.post('/register/institution', limitRegistrations, auth_controller_1.default.registerInstitution);
router.post('/register/student', limitRegistrations, auth_controller_1.default.registerStudent);
router.post('/register/employer', limitRegistrations, auth_controller_1.default.registerEmployer);
router.post('/login', auth_controller_1.default.login);
router.patch('/change-password', auth_middleware_1.requireAuth, auth_controller_1.default.changePassword);
exports.default = router;
