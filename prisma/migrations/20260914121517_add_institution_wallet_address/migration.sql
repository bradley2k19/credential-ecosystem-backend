/*
  Warnings:

  - A unique constraint covering the columns `[walletAddress]` on the table `Institution` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Institution" ADD COLUMN     "walletAddress" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Institution_walletAddress_key" ON "Institution"("walletAddress");
