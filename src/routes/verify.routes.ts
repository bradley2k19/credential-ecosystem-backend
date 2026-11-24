import { Router } from 'express';
import verifyController from '../controllers/verify.controller';
import { limitRequestsByIp, RATE_LIMIT_MESSAGES, RATE_LIMITS } from '../utils/rateLimit';

const router = Router();

// The limit runs first, so a blocked request never reaches the controller and writes no verification log row.
router.get('/:certificateUid', limitRequestsByIp(RATE_LIMITS.verify, RATE_LIMIT_MESSAGES.verify), verifyController.verifyCertificate);

export default router;
