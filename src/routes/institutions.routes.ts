import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import institutionStudentsController from '../controllers/institution-students.controller';

const router = Router();

const institutionOnly = [requireAuth, requireRole('INSTITUTION')];

router.post('/students', institutionOnly, institutionStudentsController.createStudent);
router.get('/students', institutionOnly, institutionStudentsController.listStudents);
router.get('/students/:studentId', institutionOnly, institutionStudentsController.getStudent);
router.put('/students/:studentId', institutionOnly, institutionStudentsController.updateStudent);

export default router;
