-- Add a distinct audit result for database certificates not yet recorded on-chain.
ALTER TYPE "VerificationResult" ADD VALUE 'PENDING_CHAIN';
