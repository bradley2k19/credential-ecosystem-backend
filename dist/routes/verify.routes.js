"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const verify_controller_1 = __importDefault(require("../controllers/verify.controller"));
const rateLimit_1 = require("../utils/rateLimit");
const router = (0, express_1.Router)();
// The limit runs first, so a blocked request never reaches the controller and writes no verification log row.
router.get('/:certificateUid', (0, rateLimit_1.limitRequestsByIp)(rateLimit_1.RATE_LIMITS.verify, rateLimit_1.RATE_LIMIT_MESSAGES.verify), verify_controller_1.default.verifyCertificate);
exports.default = router;
