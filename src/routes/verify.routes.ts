import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => res.json({ message: 'Verify routes placeholder' }));

export default router;
