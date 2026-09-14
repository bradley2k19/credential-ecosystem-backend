import { Router } from 'express';
import adminController from '../controllers/admin.controller';
import requireAdminSecret from '../middleware/admin.middleware';

const router = Router();

router.post('/institutions/:institutionId/grant-issuer', requireAdminSecret, adminController.grantIssuerRole);

export default router;