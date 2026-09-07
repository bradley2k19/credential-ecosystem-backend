"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = __importDefault(require("../controllers/auth.controller"));
const router = (0, express_1.Router)();
router.post('/register/institution', auth_controller_1.default.registerInstitution);
router.post('/register/student', auth_controller_1.default.registerStudent);
router.post('/register/employer', auth_controller_1.default.registerEmployer);
router.post('/login', auth_controller_1.default.login);
exports.default = router;
