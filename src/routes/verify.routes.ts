import { Router } from 'express';
import verifyController from '../controllers/verify.controller';

const router = Router();

router.get('/:certificateUid', verifyController.verifyCertificate);

export default router;
