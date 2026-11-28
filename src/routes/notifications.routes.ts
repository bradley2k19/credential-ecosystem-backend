import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import notificationsController from '../controllers/notifications.controller';

// Any signed-in role; every route works only on the notifications of the user in the token.
const router = Router();

router.get('/', requireAuth, notificationsController.listNotifications);
router.get('/unread-count', requireAuth, notificationsController.getUnreadCount);
router.post('/read-all', requireAuth, notificationsController.markAllRead);
router.patch('/:notificationId/read', requireAuth, notificationsController.markRead);

export default router;
