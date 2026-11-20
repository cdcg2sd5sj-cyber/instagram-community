import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from './notifications.service'

// Раз в день напоминаем в боте тем, кто сегодня ещё не делал задание, но для кого задания есть.
// Время отправки — REMINDER_HOUR_UTC (16:00 UTC = 19:00 по Москве). Можно поменять переменной окружения.
const REMINDER_HOUR_UTC = Number(process.env.REMINDER_HOUR_UTC ?? 16)
const CHECK_EVERY_MS = 10 * 60 * 1000
// Не чаще одного напоминания примерно в сутки (с запасом на сдвиг времени проверки).
const MIN_GAP_MS = 20 * 60 * 60 * 1000
// Тех, кто не заходил дольше, не беспокоим — чтобы бот не превратился в спам.
const ACTIVE_WITHIN_MS = 14 * 24 * 60 * 60 * 1000
// Пауза между сообщениями: лимит Telegram ~30 сообщений в секунду.
const SEND_DELAY_MS = 60

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersService.name)
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_REMINDERS === 'true') return
    this.timer = setInterval(() => { void this.tick() }, CHECK_EVERY_MS)
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  private async tick() {
    if (this.running || new Date().getUTCHours() !== REMINDER_HOUR_UTC) return
    this.running = true
    try {
      await this.sendDailyReminders()
    } catch (error) {
      this.logger.error('Не удалось разослать напоминания', error instanceof Error ? error.stack : error)
    } finally {
      this.running = false
    }
  }

  async sendDailyReminders() {
    const now = Date.now()
    const startOfToday = new Date()
    startOfToday.setUTCHours(0, 0, 0, 0)
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000)
    const activeSince = new Date(now - ACTIVE_WITHIN_MS)

    const users = await this.prisma.user.findMany({
      where: {
        AND: [
          { OR: [{ lastTaskDate: null }, { lastTaskDate: { lt: startOfToday } }] },
          { OR: [{ lastTaskDate: { gte: activeSince } }, { createdAt: { gte: activeSince } }] },
          { OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: new Date(now - MIN_GAP_MS) } }] },
        ],
      },
      select: { id: true, telegramId: true, streak: true, lastTaskDate: true },
    })

    let sent = 0
    for (const user of users) {
      // Есть ли для него задание прямо сейчас (та же логика, что в /tasks/next).
      const available = await this.prisma.campaign.count({
        where: {
          status: 'ACTIVE',
          userId: { not: user.id },
          completions: { none: { userId: user.id } },
        },
      })
      if (available === 0) continue

      const streakAtRisk = user.streak >= 2 && user.lastTaskDate && user.lastTaskDate >= startOfYesterday
      const text = streakAtRisk
        ? `🔥 У тебя стрик ${user.streak} дней подряд! Выполни задание сегодня, чтобы его не потерять.`
        : `📲 Тебя ждут новые задания (${available}). Посмотри Reels и заработай ₢ на продвижение своего.`

      await this.notifications.sendNotification(user.telegramId, text, { openAppButton: true })
      await this.prisma.user.update({ where: { id: user.id }, data: { lastReminderAt: new Date() } })
      sent++
      await sleep(SEND_DELAY_MS)
    }

    this.logger.log(`Напоминания: отправлено ${sent} из ${users.length} кандидатов`)
  }
}
