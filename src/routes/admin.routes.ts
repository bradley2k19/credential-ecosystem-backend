import { Router } from 'express';
import adminController from '../controllers/admin.controller';
import { requireAuth, requireRole } from '../middleware/auth.middleware';

const router = Router();

// Every /api/admin route, including unknown paths, requires an ADMIN token.
router.use(requireAuth, requireRole('ADMIN'));

router.get('/overview', adminController.getOverview);
router.get('/institutions', adminController.listInstitutions);
router.patch('/institutions/:institutionId/verification', adminController.setInstitutionVerification);
router.post('/institutions/:institutionId/grant-issuer', adminController.grantIssuerRole);
router.post('/institutions/:institutionId/revoke-issuer', adminController.revokeIssuerRole);
router.get('/audit-logs', adminController.listAuditLogs);

export default router;
