import { Response } from 'express';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';

const MAX_PAGE_SIZE = 50;
const RETENTION_DAYS = 90;
/** About one call in this many also deletes notifications older than RETENTION_DAYS (for everyone). */
const CLEANUP_ONE_IN = 50;

const notificationFields = {
  id: true,
  type: true,
  message: true,
  isRead: true,
  createdAt: true,
  relatedCertificateId: true,
  relatedCorrectionRequestId: true
} as const;

async function cleanUpOldNotifications() {
  if (Math.random() >= 1 / CLEANUP_ONE_IN) return;
  try {
    await prisma.notification.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000) } } });
  } catch (error) {
    console.error('Notification cleanup failed:', error instanceof Error ? error.message : error);
  }
}

/** The signed-in user's notifications, newest first; `unread=true` lists only unread ones. */
export async function listNotifications(req: AuthRequest, res: Response) {
  const userId = req.user!.id;
  const page = Math.max(Number.parseInt(String(req.query.page || '1'), 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '20'), 10) || 20, 1), MAX_PAGE_SIZE);
  const unread = req.query.unread;
  if (unread !== undefined && unread !== 'true' && unread !== 'false') return res.status(400).json({ error: 'unread must be true or false' });

  const where = { userId, ...(unread === 'true' ? { isRead: false } : {}) };
  try {
    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit, select: notificationFields }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, isRead: false } })
    ]);
    await cleanUpOldNotifications();
    return res.json({ notifications, unreadCount, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('Database error while listing notifications:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Notifications are temporarily unavailable' });
  }
}

export async function getUnreadCount(req: AuthRequest, res: Response) {
  try {
    const unreadCount = await prisma.notification.count({ where: { userId: req.user!.id, isRead: false } });
    await cleanUpOldNotifications();
    return res.json({ unreadCount });
  } catch (error) {
    console.error('Database error while counting notifications:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Notifications are temporarily unavailable' });
  }
}

/** Marks one of the user's notifications read. Someone else's is indistinguishable from a missing one (404). */
export async function markRead(req: AuthRequest, res: Response) {
  try {
    const updated = await prisma.notification.updateMany({ where: { id: req.params.notificationId, userId: req.user!.id }, data: { isRead: true } });
    if (updated.count === 0) return res.status(404).json({ error: 'Notification not found' });
    return res.json({ id: req.params.notificationId, isRead: true });
  } catch (error) {
    console.error('Database error while marking a notification read:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Notifications are temporarily unavailable' });
  }
}

export async function markAllRead(req: AuthRequest, res: Response) {
  try {
    const updated = await prisma.notification.updateMany({ where: { userId: req.user!.id, isRead: false }, data: { isRead: true } });
    return res.json({ updated: updated.count });
  } catch (error) {
    console.error('Database error while marking notifications read:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Notifications are temporarily unavailable' });
  }
}

export default { listNotifications, getUnreadCount, markRead, markAllRead };
