-- Новая экономика: награда 5 ₢ за задание, стартовый баланс 50 ₢ (меняются только значения по умолчанию).
ALTER TABLE "User" ALTER COLUMN "balance" SET DEFAULT 50;
ALTER TABLE "Campaign" ALTER COLUMN "creditsPerTask" SET DEFAULT 5;
