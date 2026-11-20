-- Уже запущенные кампании тоже переводим на новую награду 5 ₢ за задание.
UPDATE "Campaign" SET "creditsPerTask" = 5 WHERE "status" = 'ACTIVE' AND "creditsPerTask" = 15;
