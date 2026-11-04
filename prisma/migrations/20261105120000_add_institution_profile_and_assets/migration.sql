-- Institution profile (brand colour, logo, seal), immutable image assets, and signatories. Additive only.
-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('LOGO', 'SEAL', 'SIGNATURE');

-- AlterTable
ALTER TABLE "Institution" ADD COLUMN     "brandColor" TEXT,
ADD COLUMN     "logoAssetId" TEXT,
ADD COLUMN     "sealAssetId" TEXT;

-- CreateTable
CREATE TABLE "InstitutionAsset" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstitutionAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signatory" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "signatureAssetId" TEXT,
    "displayOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "authorisationConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Signatory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstitutionAsset_institutionId_idx" ON "InstitutionAsset"("institutionId");

-- CreateIndex
CREATE INDEX "Signatory_institutionId_isActive_idx" ON "Signatory"("institutionId", "isActive");

-- AddForeignKey
ALTER TABLE "Institution" ADD CONSTRAINT "Institution_logoAssetId_fkey" FOREIGN KEY ("logoAssetId") REFERENCES "InstitutionAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Institution" ADD CONSTRAINT "Institution_sealAssetId_fkey" FOREIGN KEY ("sealAssetId") REFERENCES "InstitutionAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstitutionAsset" ADD CONSTRAINT "InstitutionAsset_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signatory" ADD CONSTRAINT "Signatory_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signatory" ADD CONSTRAINT "Signatory_signatureAssetId_fkey" FOREIGN KEY ("signatureAssetId") REFERENCES "InstitutionAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

