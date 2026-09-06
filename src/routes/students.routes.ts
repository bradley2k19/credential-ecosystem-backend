import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => res.json({ message: 'Students routes placeholder' }));

export default router;
