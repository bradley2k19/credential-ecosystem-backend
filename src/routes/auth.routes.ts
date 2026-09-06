import { Router } from 'express';
import authController from '../controllers/auth.controller';

const router = Router();

router.post('/register/institution', authController.registerInstitution);
router.post('/register/student', authController.registerStudent);
router.post('/register/employer', authController.registerEmployer);
router.post('/login', authController.login);

export default router;
