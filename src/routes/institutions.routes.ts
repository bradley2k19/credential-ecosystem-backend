import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import institutionStudentsController from '../controllers/institution-students.controller';
import institutionCertificatesController from '../controllers/institution-certificates.controller';
import institutionWalletController from '../controllers/institution-wallet.controller';

const router = Router();

const institutionOnly = [requireAuth, requireRole('INSTITUTION')];

router.post('/students', institutionOnly, institutionStudentsController.createStudent);
router.get('/students', institutionOnly, institutionStudentsController.listStudents);
router.get('/students/:studentId', institutionOnly, institutionStudentsController.getStudent);
router.put('/students/:studentId', institutionOnly, institutionStudentsController.updateStudent);
router.post('/certificates', institutionOnly, institutionCertificatesController.issueCertificate);
router.get('/certificates', institutionOnly, institutionCertificatesController.listCertificates);
router.get('/certificates/:certificateId', institutionOnly, institutionCertificatesController.getCertificate);
router.patch('/certificates/:certificateId/revoke', institutionOnly, institutionCertificatesController.revokeCertificate);
router.put('/wallet', institutionOnly, institutionWalletController.setWalletAddress);
router.get('/me/issuer-status', institutionOnly, institutionWalletController.getIssuerStatus);

export default router;
