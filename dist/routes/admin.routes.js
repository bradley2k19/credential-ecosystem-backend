"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const admin_controller_1 = __importDefault(require("../controllers/admin.controller"));
const admin_middleware_1 = __importDefault(require("../middleware/admin.middleware"));
const router = (0, express_1.Router)();
router.post('/institutions/:institutionId/grant-issuer', admin_middleware_1.default, admin_controller_1.default.grantIssuerRole);
exports.default = router;
