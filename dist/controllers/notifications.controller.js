"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listNotifications = listNotifications;
exports.getUnreadCount = getUnreadCount;
exports.markRead = markRead;
exports.markAllRead = markAllRead;
const db_1 = __importDefault(require("../config/db"));
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
};
async function cleanUpOldNotifications() {
    if (Math.random() >= 1 / CLEANUP_ONE_IN)
        return;
    try {
        await db_1.default.notification.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000) } } });
    }
    catch (error) {
        console.error('Notification cleanup failed:', error instanceof Error ? error.message : error);
    }
}
/** The signed-in user's notifications, newest first; `unread=true` lists only unread ones. */
async function listNotifications(req, res) {
    const userId = req.user.id;
    const page = Math.max(Number.parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '20'), 10) || 20, 1), MAX_PAGE_SIZE);
    const unread = req.query.unread;
    if (unread !== undefined && unread !== 'true' && unread !== 'false')
        return res.status(400).json({ error: 'unread must be true or false' });
    const where = { userId, ...(unread === 'true' ? { isRead: false } : {}) };
    try {
        const [notifications, total, unreadCount] = await Promise.all([
            db_1.default.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit, select: notificationFields }),
            db_1.default.notification.count({ where }),
            db_1.default.notification.count({ where: { userId, isRead: false } })
        ]);
        await cleanUpOldNotifications();
        return res.json({ notifications, unreadCount, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    }
    catch (error) {
        console.error('Database error while listing notifications:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Notifications are temporarily unavailable' });
    }
}
async function getUnreadCount(req, res) {
    try {
        const unreadCount = await db_1.default.notification.count({ where: { userId: req.user.id, isRead: false } });
        await cleanUpOldNotifications();
        return res.json({ unreadCount });
    }
    catch (error) {
        console.error('Database error while counting notifications:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Notifications are temporarily unavailable' });
    }
}
/** Marks one of the user's notifications read. Someone else's is indistinguishable from a missing one (404). */
async function markRead(req, res) {
    try {
        const updated = await db_1.default.notification.updateMany({ where: { id: req.params.notificationId, userId: req.user.id }, data: { isRead: true } });
        if (updated.count === 0)
            return res.status(404).json({ error: 'Notification not found' });
        return res.json({ id: req.params.notificationId, isRead: true });
    }
    catch (error) {
        console.error('Database error while marking a notification read:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Notifications are temporarily unavailable' });
    }
}
async function markAllRead(req, res) {
    try {
        const updated = await db_1.default.notification.updateMany({ where: { userId: req.user.id, isRead: false }, data: { isRead: true } });
        return res.json({ updated: updated.count });
    }
    catch (error) {
        console.error('Database error while marking notifications read:', error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Notifications are temporarily unavailable' });
    }
}
exports.default = { listNotifications, getUnreadCount, markRead, markAllRead };
