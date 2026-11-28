import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import studentsController from '../controllers/students.controller';

const router = Router();

const studentOnly = [requireAuth, requireRole('STUDENT')];

router.get('/me', studentOnly, studentsController.getProfile);
router.patch('/me/preferences', studentOnly, studentsController.updatePreferences);
router.get('/me/certificates', studentOnly, studentsController.listCertificates);
router.get('/me/certificates/:certificateId', studentOnly, studentsController.getCertificate);
router.post('/me/certificates/:certificateId/correction-requests', studentOnly, studentsController.requestCorrection);
router.get('/me/correction-requests', studentOnly, studentsController.listCorrectionRequests);
router.get('/me/verifications', studentOnly, studentsController.getVerificationHistory);

export default router;
