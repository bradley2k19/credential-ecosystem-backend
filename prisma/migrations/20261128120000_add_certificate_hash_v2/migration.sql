-- Hash version 2 and the frozen certificate facts. Additive only: existing certificates get hashVersion 1 (the
-- default) and null frozen columns, so they keep verifying exactly as before. No existing value is changed.
-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN     "hashVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "institutionNameAtIssue" TEXT,
ADD COLUMN     "studentNameAtIssue" TEXT,
ADD COLUMN     "studentNumberAtIssue" TEXT;
