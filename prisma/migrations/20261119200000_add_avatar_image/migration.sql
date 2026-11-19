-- Сохраняем саму картинку аватарки: ссылки Instagram CDN временные и протухают.
ALTER TABLE "User" ADD COLUMN "avatarImage" BYTEA;
ALTER TABLE "User" ADD COLUMN "avatarContentType" TEXT;
