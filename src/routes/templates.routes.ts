import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import institutionTemplatesController from '../controllers/institution-templates.controller';

const router = Router();

router.get('/options', requireAuth, requireRole('INSTITUTION'), institutionTemplatesController.getOptions);

export default router;
