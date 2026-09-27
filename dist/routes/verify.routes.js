"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const verify_controller_1 = __importDefault(require("../controllers/verify.controller"));
const router = (0, express_1.Router)();
router.get('/:certificateUid', verify_controller_1.default.verifyCertificate);
exports.default = router;
