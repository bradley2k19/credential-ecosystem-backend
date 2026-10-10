import { Router } from 'express';
import authController from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.post('/register/institution', authController.registerInstitution);
router.post('/register/student', authController.registerStudent);
router.post('/register/employer', authController.registerEmployer);
router.post('/login', authController.login);
router.patch('/change-password', requireAuth, authController.changePassword);

export default router;
