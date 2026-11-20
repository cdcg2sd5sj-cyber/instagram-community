-- Учёт генераций ИИ-идей за день (лимит по тарифу).
ALTER TABLE "User" ADD COLUMN "ideasUsedDate" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "ideasUsedCount" INTEGER NOT NULL DEFAULT 0;
