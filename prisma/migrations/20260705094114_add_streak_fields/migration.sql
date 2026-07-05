-- AlterTable
ALTER TABLE "User" ADD COLUMN     "instagramTrustScore" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "lastActivityDate" TIMESTAMP(3),
ADD COLUMN     "streak" INTEGER NOT NULL DEFAULT 0;
