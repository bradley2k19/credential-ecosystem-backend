import { Request, Response } from 'express';
import prisma from '../config/db';
import { hashPassword, comparePassword } from '../utils/password';
import jwt from 'jsonwebtoken';
import env from '../config/env';

const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function registerInstitution(req: Request, res: Response) {
  const { email, password, name, registrationNumber, address, contactEmail } = req.body;
  if (!email || !password || !name || !registrationNumber) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email' });

  let existing;
  try {
    existing = await prisma.user.findUnique({ where: { email } });
  } catch (err: any) {
    console.error('Database unreachable:', err.message || err);
    return res.status(503).json({ error: 'Database unreachable' });
  }
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const passwordHash = await hashPassword(password);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash, role: 'INSTITUTION' }
      });
      const institution = await tx.institution.create({
        data: {
          userId: user.id,
          name,
          registrationNumber,
          address,
          contactEmail
        }
      });
      return { user, institution };
    });
    return res.status(201).json({ id: result.user.id, email: result.user.email, role: result.user.role });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to register institution' });
  }
}

async function registerStudent(req: Request, res: Response) {
  const { email, password, fullName, studentNumber, institutionId, programName, enrollmentYear, dateOfBirth } = req.body;
  if (!email || !password || !fullName || !studentNumber || !institutionId || !programName || !enrollmentYear) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email' });

  try {
    const existingStudentUser = await prisma.user.findUnique({ where: { email } });
    if (existingStudentUser) return res.status(409).json({ error: 'Email already registered' });

    // ensure institution exists
    const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
    if (!institution) return res.status(400).json({ error: 'Invalid institutionId' });

    const passwordHash = await hashPassword(password);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, passwordHash, role: 'STUDENT' } });
      const student = await tx.student.create({
        data: {
          userId: user.id,
          institutionId,
          fullName,
          studentNumber,
          programName,
          enrollmentYear: Number(enrollmentYear),
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined
        }
      });
      return { user, student };
    });
    return res.status(201).json({ id: result.user.id, email: result.user.email, role: result.user.role });
  } catch (err: any) {
    console.error('Database error:', err.message || err);
    return res.status(503).json({ error: 'Database unreachable or operation failed' });
  }
}

async function registerEmployer(req: Request, res: Response) {
  const { email, password, companyName, registrationNumber, industry, contactEmail } = req.body;
  if (!email || !password || !companyName) return res.status(400).json({ error: 'Missing required fields' });
  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email' });

  try {
    const existingEmployerUser = await prisma.user.findUnique({ where: { email } });
    if (existingEmployerUser) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await hashPassword(password);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, passwordHash, role: 'EMPLOYER' } });
      const employer = await tx.employer.create({
        data: {
          userId: user.id,
          companyName,
          registrationNumber,
          industry,
          contactEmail
        }
      });
      return { user, employer };
    });
    return res.status(201).json({ id: result.user.id, email: result.user.email, role: result.user.role });
  } catch (err: any) {
    console.error('Database error:', err.message || err);
    return res.status(503).json({ error: 'Database unreachable or operation failed' });
  }
}

async function login(req: Request, res: Response) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    const generic = { error: 'Invalid credentials' };
    if (!user) return res.status(401).json(generic);
    const ok = await comparePassword(password, user.passwordHash);
    if (!ok) return res.status(401).json(generic);

    const token = jwt.sign({ id: user.id, role: user.role }, env.JWT_SECRET, { expiresIn: '24h' });
    return res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err: any) {
    console.error('Database error:', err.message || err);
    return res.status(503).json({ error: 'Database unreachable' });
  }
}

export default { registerInstitution, registerStudent, registerEmployer, login };
