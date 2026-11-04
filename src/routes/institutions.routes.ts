import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import institutionStudentsController from '../controllers/institution-students.controller';
import institutionCertificatesController from '../controllers/institution-certificates.controller';
import institutionWalletController from '../controllers/institution-wallet.controller';
import institutionReportsController from '../controllers/institution-reports.controller';
import institutionProfileController from '../controllers/institution-profile.controller';

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
router.post('/certificates/:certificateId/blockchain-record', institutionOnly, institutionCertificatesController.recordBlockchainTransaction);
router.get('/certificates/:certificateId/blockchain-status', institutionOnly, institutionCertificatesController.getBlockchainStatus);
router.put('/wallet', institutionOnly, institutionWalletController.setWalletAddress);
router.get('/me/issuer-status', institutionOnly, institutionWalletController.getIssuerStatus);
router.get('/me/profile', institutionOnly, institutionProfileController.getProfile);
router.patch('/me/profile', institutionOnly, institutionProfileController.updateProfile);
router.put('/me/logo', institutionOnly, institutionProfileController.setLogo);
router.delete('/me/logo', institutionOnly, institutionProfileController.removeLogo);
router.put('/me/seal', institutionOnly, institutionProfileController.setSeal);
router.delete('/me/seal', institutionOnly, institutionProfileController.removeSeal);
router.get('/me/signatories', institutionOnly, institutionProfileController.listSignatories);
router.post('/me/signatories', institutionOnly, institutionProfileController.createSignatory);
// Registered before '/me/signatories/:signatoryId' so "order" is never read as an id.
router.patch('/me/signatories/order', institutionOnly, institutionProfileController.reorderSignatories);
router.patch('/me/signatories/:signatoryId', institutionOnly, institutionProfileController.updateSignatory);
router.delete('/me/signatories/:signatoryId', institutionOnly, institutionProfileController.archiveSignatory);
router.put('/me/signatories/:signatoryId/signature', institutionOnly, institutionProfileController.setSignature);
router.delete('/me/signatories/:signatoryId/signature', institutionOnly, institutionProfileController.removeSignature);
router.get('/verifications', institutionOnly, institutionReportsController.listVerifications);
router.get('/reports/summary', institutionOnly, institutionReportsController.getSummary);
router.get('/reports/certificates.csv', institutionOnly, institutionReportsController.exportCertificatesCsv);

export default router;
