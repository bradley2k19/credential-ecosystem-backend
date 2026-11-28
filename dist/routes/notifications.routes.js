"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const notifications_controller_1 = __importDefault(require("../controllers/notifications.controller"));
// Any signed-in role; every route works only on the notifications of the user in the token.
const router = (0, express_1.Router)();
router.get('/', auth_middleware_1.requireAuth, notifications_controller_1.default.listNotifications);
router.get('/unread-count', auth_middleware_1.requireAuth, notifications_controller_1.default.getUnreadCount);
router.post('/read-all', auth_middleware_1.requireAuth, notifications_controller_1.default.markAllRead);
router.patch('/:notificationId/read', auth_middleware_1.requireAuth, notifications_controller_1.default.markRead);
exports.default = router;
