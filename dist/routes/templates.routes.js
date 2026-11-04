"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const institution_templates_controller_1 = __importDefault(require("../controllers/institution-templates.controller"));
const router = (0, express_1.Router)();
router.get('/options', auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)('INSTITUTION'), institution_templates_controller_1.default.getOptions);
exports.default = router;
