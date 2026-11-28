-- Notifications and correction requests. Additive only: one new enum value, new nullable or defaulted columns,
-- new indexes and two new foreign keys. No existing value is changed and nothing is dropped.
-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CORRECTION_RESOLVED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifyOnVerification" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "CredentialCorrectionRequest" ADD COLUMN     "replacementCertificateId" TEXT,
ADD COLUMN     "resolutionNote" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "relatedCorrectionRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CredentialCorrectionRequest_replacementCertificateId_key" ON "CredentialCorrectionRequest"("replacementCertificateId");

-- CreateIndex
CREATE INDEX "CredentialCorrectionRequest_certificateId_status_idx" ON "CredentialCorrectionRequest"("certificateId", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_dedupeKey_createdAt_idx" ON "Notification"("userId", "dedupeKey", "createdAt");

-- AddForeignKey
ALTER TABLE "CredentialCorrectionRequest" ADD CONSTRAINT "CredentialCorrectionRequest_replacementCertificateId_fkey" FOREIGN KEY ("replacementCertificateId") REFERENCES "Certificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_relatedCorrectionRequestId_fkey" FOREIGN KEY ("relatedCorrectionRequestId") REFERENCES "CredentialCorrectionRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
