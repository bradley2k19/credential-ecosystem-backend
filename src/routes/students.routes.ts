import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import studentsController from '../controllers/students.controller';

const router = Router();

const studentOnly = [requireAuth, requireRole('STUDENT')];

router.get('/me', studentOnly, studentsController.getProfile);
router.get('/me/certificates', studentOnly, studentsController.listCertificates);
router.get('/me/certificates/:certificateId', studentOnly, studentsController.getCertificate);
router.get('/me/verifications', studentOnly, studentsController.getVerificationHistory);

export default router;
