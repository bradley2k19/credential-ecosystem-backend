import { Router } from 'express';
import authController from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { limitRequestsByIp, RATE_LIMIT_MESSAGES, RATE_LIMITS } from '../utils/rateLimit';

const router = Router();

// All three registration forms share one per-IP limit. Login and change-password count failures only (in the controller).
const limitRegistrations = limitRequestsByIp(RATE_LIMITS.register, RATE_LIMIT_MESSAGES.attempts);

router.post('/register/institution', limitRegistrations, authController.registerInstitution);
router.post('/register/student', limitRegistrations, authController.registerStudent);
router.post('/register/employer', limitRegistrations, authController.registerEmployer);
router.post('/login', authController.login);
router.patch('/change-password', requireAuth, authController.changePassword);

export default router;
