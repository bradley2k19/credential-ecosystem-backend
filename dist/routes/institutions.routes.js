"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const institution_students_controller_1 = __importDefault(require("../controllers/institution-students.controller"));
const router = (0, express_1.Router)();
const institutionOnly = [auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRole)('INSTITUTION')];
router.post('/students', institutionOnly, institution_students_controller_1.default.createStudent);
router.get('/students', institutionOnly, institution_students_controller_1.default.listStudents);
router.get('/students/:studentId', institutionOnly, institution_students_controller_1.default.getStudent);
router.put('/students/:studentId', institutionOnly, institution_students_controller_1.default.updateStudent);
exports.default = router;
