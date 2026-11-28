"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationMessages = exports.NOTIFICATION_DEDUPE_HOURS = exports.MAX_NOTIFICATION_LENGTH = void 0;
exports.notificationText = notificationText;
exports.notify = notify;
exports.settleWithin = settleWithin;
const db_1 = __importDefault(require("../config/db"));
/** In-app notifications only (no email or push). Messages are plain text of at most this many characters. */
exports.MAX_NOTIFICATION_LENGTH = 300;
exports.NOTIFICATION_DEDUPE_HOURS = 24;
/**
 * A message as stored: one line of plain text, at most 300 characters, with anything that looks like an email
 * address, an IP address or a hash removed (names, reasons and notes are free text written by people).
 */
function notificationText(message) {
    const text = message
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}/gi, '[email removed]')
        .replace(/\b(?:0x)?[0-9a-f]{32,}\b/gi, '[removed]')
        .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[address removed]')
        .replace(/\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){7}\b|(?:\b[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?/gi, '[address removed]')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > exports.MAX_NOTIFICATION_LENGTH ? `${text.slice(0, exports.MAX_NOTIFICATION_LENGTH - 1)}…` : text;
}
/**
 * Records an in-app notification. It never throws: a failure is logged and the action that caused it carries on.
 * Does nothing without a recipient, or when a notification with the same dedupe key went to the user in the last
 * 24 hours.
 */
async function notify(userId, type, message, options = {}) {
    if (!userId)
        return;
    try {
        if (options.dedupeKey) {
            const recent = await db_1.default.notification.findFirst({
                where: {
                    userId,
                    dedupeKey: options.dedupeKey,
                    createdAt: { gte: new Date(Date.now() - exports.NOTIFICATION_DEDUPE_HOURS * 60 * 60 * 1000) }
                },
                select: { id: true }
            });
            if (recent)
                return;
        }
        await db_1.default.notification.create({
            data: {
                userId,
                type,
                message: notificationText(message),
                relatedCertificateId: options.certificateId ?? null,
                relatedCorrectionRequestId: options.correctionRequestId ?? null,
                dedupeKey: options.dedupeKey ?? null
            }
        });
    }
    catch (error) {
        console.error(`Could not record a ${type} notification:`, error instanceof Error ? error.message : error);
    }
}
/** Waits for `work` at most `ms`, so a slow database can never hold up a response for long. Never rejects. */
function settleWithin(work, ms) {
    let timer;
    return Promise.race([
        work.catch(() => undefined),
        new Promise((resolve) => { timer = setTimeout(resolve, ms); })
    ]).finally(() => clearTimeout(timer));
}
/** "a Bachelor of Science certificate in Computer Science" */
const describeCertificate = (certificateType, programName) => `${certificateType} certificate in ${programName}`;
/** The texts, in one place. */
exports.notificationMessages = {
    certificateIssued: (institutionName, certificateType, programName) => `${institutionName} issued you a ${describeCertificate(certificateType, programName)}.`,
    replacementIssued: (institutionName, certificateType, programName, replacedUid) => `${institutionName} issued you a corrected ${describeCertificate(certificateType, programName)}. It replaces your earlier certificate ${replacedUid}.`,
    certificateRevoked: (certificateType, reason) => `Your ${certificateType} certificate was revoked. Reason: ${reason.trim().replace(/[.\s]+$/, '')}.`,
    verifiedForStudent: (certificateType, resultLabel, verifier) => `Your ${certificateType} certificate was verified: ${resultLabel}, by ${verifier}.`,
    integrityConcernForStudent: (certificateType) => `A verification reported a data integrity concern for your ${certificateType} certificate.`,
    verifiedForInstitution: (certificateType, studentName, resultLabel) => `A ${certificateType} certificate issued to ${studentName} was verified: ${resultLabel}.`,
    integrityConcernForInstitution: (certificateType, studentName) => `A verification reported a data integrity concern for a ${certificateType} certificate issued to ${studentName}.`,
    correctionRequested: (studentName, certificateType, programName) => `${studentName} requested a correction to ${certificateType} (${programName}).`,
    correctionResolved: (approved, note) => `Your correction request was ${approved ? 'approved' : 'rejected'}.${note ? ` ${note}` : ''}`
};
