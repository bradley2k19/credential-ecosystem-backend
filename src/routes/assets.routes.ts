import { Router } from 'express';
import assetsController from '../controllers/assets.controller';

const router = Router();

// Public on purpose: see assets.controller.ts.
router.get('/:assetId', assetsController.getAsset);

export default router;
