"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const employers_controller_1 = __importDefault(require("../controllers/employers.controller"));
const router = (0, express_1.Router)();
router.get('/verifications', auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)('EMPLOYER'), employers_controller_1.default.getVerificationHistory);
exports.default = router;
