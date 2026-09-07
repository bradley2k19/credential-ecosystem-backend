"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStudent = createStudent;
exports.listStudents = listStudents;
exports.getStudent = getStudent;
exports.updateStudent = updateStudent;
const crypto_1 = __importDefault(require("crypto"));
const client_1 = require("@prisma/client");
const db_1 = __importDefault(require("../config/db"));
const password_1 = require("../utils/password");
const studentFields = {
    id: true,
    fullName: true,
    studentNumber: true,
    dateOfBirth: true,
    programName: true,
    enrollmentYear: true,
    createdAt: true,
    updatedAt: true,
    user: {
        select: {
            email: true
        }
    }
};
function isUniqueConstraintError(error) {
    return error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
function generateTemporaryPassword() {
    return crypto_1.default.randomBytes(24).toString('base64url');
}
async function getInstitutionId(userId) {
    const institution = await db_1.default.institution.findUnique({
        where: { userId },
        select: { id: true }
    });
    return institution?.id;
}
async function createStudent(req, res) {
    const { fullName, studentNumber, dateOfBirth, programName, enrollmentYear, email } = req.body;
    if (!fullName || !studentNumber || !programName || enrollmentYear === undefined || !email) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId)
        return res.status(403).json({ error: 'Institution profile not found' });
    const temporaryPassword = generateTemporaryPassword();
    try {
        const passwordHash = await (0, password_1.hashPassword)(temporaryPassword);
        const student = await db_1.default.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: { email, passwordHash, role: 'STUDENT' }
            });
            return tx.student.create({
                data: {
                    userId: user.id,
                    institutionId,
                    fullName,
                    studentNumber,
                    programName,
                    enrollmentYear: Number(enrollmentYear),
                    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined
                },
                select: studentFields
            });
        });
        return res.status(201).json({
            id: student.id,
            fullName: student.fullName,
            studentNumber: student.studentNumber,
            email: student.user.email,
            temporaryPassword
        });
    }
    catch (error) {
        if (isUniqueConstraintError(error)) {
            return res.status(409).json({ error: 'Email or student number is already registered' });
        }
        console.error('Database error while creating student:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable or operation failed' });
    }
}
async function listStudents(req, res) {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId)
        return res.status(403).json({ error: 'Institution profile not found' });
    const page = Math.max(Number.parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
    const where = { institutionId };
    try {
        const [students, total] = await db_1.default.$transaction([
            db_1.default.student.findMany({
                where,
                select: studentFields,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit
            }),
            db_1.default.student.count({ where })
        ]);
        return res.json({ students, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    }
    catch (error) {
        console.error('Database error while listing students:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable' });
    }
}
async function getStudent(req, res) {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId)
        return res.status(403).json({ error: 'Institution profile not found' });
    try {
        const student = await db_1.default.student.findFirst({
            where: { id: req.params.studentId, institutionId },
            select: studentFields
        });
        if (!student)
            return res.status(404).json({ error: 'Student not found' });
        return res.json(student);
    }
    catch (error) {
        console.error('Database error while fetching student:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable' });
    }
}
async function updateStudent(req, res) {
    const { fullName, programName, enrollmentYear, dateOfBirth } = req.body;
    const allowedFields = ['fullName', 'programName', 'enrollmentYear', 'dateOfBirth'];
    if (Object.keys(req.body).some((field) => !allowedFields.includes(field))) {
        return res.status(400).json({ error: 'Only fullName, programName, enrollmentYear, and dateOfBirth can be updated' });
    }
    if (Object.keys(req.body).length === 0)
        return res.status(400).json({ error: 'No fields to update' });
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId)
        return res.status(403).json({ error: 'Institution profile not found' });
    try {
        const existing = await db_1.default.student.findFirst({
            where: { id: req.params.studentId, institutionId },
            select: { id: true }
        });
        if (!existing)
            return res.status(404).json({ error: 'Student not found' });
        const student = await db_1.default.student.update({
            where: { id: existing.id },
            data: {
                ...(fullName !== undefined ? { fullName } : {}),
                ...(programName !== undefined ? { programName } : {}),
                ...(enrollmentYear !== undefined ? { enrollmentYear: Number(enrollmentYear) } : {}),
                ...(dateOfBirth !== undefined ? { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null } : {})
            },
            select: studentFields
        });
        return res.json(student);
    }
    catch (error) {
        console.error('Database error while updating student:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable or operation failed' });
    }
}
exports.default = { createStudent, listStudents, getStudent, updateStudent };
