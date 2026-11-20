-- Когда пользователю последний раз отправляли напоминание в боте (чтобы не чаще раза в сутки).
ALTER TABLE "User" ADD COLUMN "lastReminderAt" TIMESTAMP(3);
