import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import employersController from '../controllers/employers.controller';

const router = Router();

router.get('/verifications', requireAuth, requireRole('EMPLOYER'), employersController.getVerificationHistory);

export default router;
