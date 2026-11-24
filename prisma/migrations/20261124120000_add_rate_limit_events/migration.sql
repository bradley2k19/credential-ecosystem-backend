-- Rate limiting events (src/utils/rateLimit.ts). Additive only: one new table and its index; no existing table
-- is changed. keyHash is an HMAC, so no raw IP address or email is stored.
-- CreateTable
CREATE TABLE "RateLimitEvent" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateLimitEvent_scope_keyHash_createdAt_idx" ON "RateLimitEvent"("scope", "keyHash", "createdAt");
