import { NotificationType } from '@prisma/client';
import prisma from '../config/db';

/** In-app notifications only (no email or push). Messages are plain text of at most this many characters. */
export const MAX_NOTIFICATION_LENGTH = 300;
export const NOTIFICATION_DEDUPE_HOURS = 24;

/**
 * A message as stored: one line of plain text, at most 300 characters, with anything that looks like an email
 * address, an IP address or a hash removed (names, reasons and notes are free text written by people).
 */
export function notificationText(message: string) {
  const text = message
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}/gi, '[email removed]')
    .replace(/\b(?:0x)?[0-9a-f]{32,}\b/gi, '[removed]')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[address removed]')
    .replace(/\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){7}\b|(?:\b[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?/gi, '[address removed]')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > MAX_NOTIFICATION_LENGTH ? `${text.slice(0, MAX_NOTIFICATION_LENGTH - 1)}…` : text;
}

export interface NotifyOptions {
  certificateId?: string | null;
  correctionRequestId?: string | null;
  /** The same user gets at most one notification with this key per 24 hours. */
  dedupeKey?: string;
}

/**
 * Records an in-app notification. It never throws: a failure is logged and the action that caused it carries on.
 * Does nothing without a recipient, or when a notification with the same dedupe key went to the user in the last
 * 24 hours.
 */
export async function notify(userId: string | null | undefined, type: NotificationType, message: string, options: NotifyOptions = {}) {
  if (!userId) return;
  try {
    if (options.dedupeKey) {
      const recent = await prisma.notification.findFirst({
        where: {
          userId,
          dedupeKey: options.dedupeKey,
          createdAt: { gte: new Date(Date.now() - NOTIFICATION_DEDUPE_HOURS * 60 * 60 * 1000) }
        },
        select: { id: true }
      });
      if (recent) return;
    }
    await prisma.notification.create({
      data: {
        userId,
        type,
        message: notificationText(message),
        relatedCertificateId: options.certificateId ?? null,
        relatedCorrectionRequestId: options.correctionRequestId ?? null,
        dedupeKey: options.dedupeKey ?? null
      }
    });
  } catch (error) {
    console.error(`Could not record a ${type} notification:`, error instanceof Error ? error.message : error);
  }
}

/** Waits for `work` at most `ms`, so a slow database can never hold up a response for long. Never rejects. */
export function settleWithin(work: Promise<unknown>, ms: number) {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work.catch(() => undefined),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); })
  ]).finally(() => clearTimeout(timer));
}

/** "a Bachelor of Science certificate in Computer Science" */
const describeCertificate = (certificateType: string, programName: string) => `${certificateType} certificate in ${programName}`;

/** The texts, in one place. */
export const notificationMessages = {
  certificateIssued: (institutionName: string, certificateType: string, programName: string) =>
    `${institutionName} issued you a ${describeCertificate(certificateType, programName)}.`,
  replacementIssued: (institutionName: string, certificateType: string, programName: string, replacedUid: string) =>
    `${institutionName} issued you a corrected ${describeCertificate(certificateType, programName)}. It replaces your earlier certificate ${replacedUid}.`,
  certificateRevoked: (certificateType: string, reason: string) =>
    `Your ${certificateType} certificate was revoked. Reason: ${reason.trim().replace(/[.\s]+$/, '')}.`,
  verifiedForStudent: (certificateType: string, resultLabel: string, verifier: string) =>
    `Your ${certificateType} certificate was verified: ${resultLabel}, by ${verifier}.`,
  integrityConcernForStudent: (certificateType: string) =>
    `A verification reported a data integrity concern for your ${certificateType} certificate.`,
  verifiedForInstitution: (certificateType: string, studentName: string, resultLabel: string) =>
    `A ${certificateType} certificate issued to ${studentName} was verified: ${resultLabel}.`,
  integrityConcernForInstitution: (certificateType: string, studentName: string) =>
    `A verification reported a data integrity concern for a ${certificateType} certificate issued to ${studentName}.`,
  correctionRequested: (studentName: string, certificateType: string, programName: string) =>
    `${studentName} requested a correction to ${certificateType} (${programName}).`,
  correctionResolved: (approved: boolean, note: string | null) =>
    `Your correction request was ${approved ? 'approved' : 'rejected'}.${note ? ` ${note}` : ''}`
};
