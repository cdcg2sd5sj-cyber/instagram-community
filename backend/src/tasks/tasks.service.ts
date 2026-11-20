import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { CampaignsService } from '../campaigns/campaigns.service'
import { hasInstagramShareToken, isSameReel } from '../common/url.util'
import { avatarPath, ensureAvatarSaved } from '../common/instagram-avatar'

// Сколько секунд должно пройти от «Открыть Reels» до отправки ссылки.
// Должно совпадать с REQUIRED_SECONDS во фронтенде (app/page.tsx).
export const MIN_WATCH_SECONDS = 30
// Запас на задержку сети между нажатием кнопки и записью на сервере.
const WATCH_TOLERANCE_SECONDS = 3

const STREAK_BONUS_EVERY = 7
const STREAK_BONUS_AMOUNT = 30

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private campaignsService: CampaignsService,
  ) {}

  async getNextTask(userId: number) {
    // status: 'ACTIVE' guarantees filledSlots < totalSlots because completeTask
    // transitions the campaign to COMPLETED when the last slot is filled.
    const campaign = await this.prisma.campaign.findFirst({
      where: {
        status: 'ACTIVE',
        userId: { not: userId },
        completions: { none: { userId } },
        taskReports: { none: { userId } },
      },
      orderBy: { filledSlots: 'asc' },
      include: { user: true },
    })

    if (!campaign) return null

    const authorHasAvatar = await ensureAvatarSaved(this.prisma, campaign.user)

    return {
      id: campaign.id,
      reelsUrl: campaign.reelsUrl,
      reward: campaign.creditsPerTask,
      slotsLeft: campaign.totalSlots - campaign.filledSlots,
      author: {
        username: campaign.user.instagramUsername,
        profilePicUrl: avatarPath(campaign.user.id, authorHasAvatar),
      },
    }
  }

  // «Reels не открывается»: убираем задание у этого пользователя, а после нескольких
  // жалоб от разных людей ставим кампанию на паузу с возвратом кредитов автору.
  async reportTask(userId: number, campaignId: number) {
    if (!Number.isInteger(campaignId)) throw new BadRequestException('Задание недоступно')
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, userId: { not: userId } },
      select: { id: true },
    })
    if (!campaign) throw new BadRequestException('Задание недоступно')

    await this.prisma.taskReport.upsert({
      where: { userId_campaignId: { userId, campaignId } },
      create: { userId, campaignId },
      update: {},
    })
    const reports = await this.prisma.taskReport.count({ where: { campaignId } })
    if (reports >= CampaignsService.REPORTS_TO_PAUSE) {
      await this.campaignsService.pauseForReports(campaignId)
    }
    return { ok: true }
  }

  // Запоминаем момент первого «Открыть Reels». Повторное открытие время не сбрасывает.
  async startTask(userId: number, campaignId: number) {
    if (!Number.isInteger(campaignId)) throw new BadRequestException('Задание недоступно')
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, status: 'ACTIVE', userId: { not: userId } },
      select: { id: true },
    })
    if (!campaign) throw new BadRequestException('Задание недоступно')

    const start = await this.prisma.taskStart.upsert({
      where: { userId_campaignId: { userId, campaignId } },
      create: { userId, campaignId },
      update: {},
    })
    return { openedAt: start.openedAt, minWatchSeconds: MIN_WATCH_SECONDS }
  }

  // Задание: открыть Reels → лайк → «Поделиться → Копировать ссылку» → вставить ссылку.
  // Комментарий больше не обязателен; если старая версия приложения его прислала — просто сохраняем.
  async completeTask(userId: number, campaignId: number, comment: string | undefined, reelsUrl: string) {
    if (!reelsUrl || !reelsUrl.trim()) {
      throw new BadRequestException('Вставь ссылку, скопированную в Instagram')
    }
    const commentText = (comment ?? '').trim()
    const words = commentText.split(/\s+/).filter(w => w.length > 0)

    const existing = await this.prisma.taskCompletion.findUnique({
      where: { userId_campaignId: { userId, campaignId } },
    })
    if (existing) {
      throw new BadRequestException('Ты уже выполнил это задание')
    }

    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, status: 'ACTIVE' },
    })
    if (!campaign || campaign.filledSlots >= campaign.totalSlots) {
      throw new BadRequestException('Задание недоступно')
    }

    // Ссылку принимаем, только если Reels открывали через приложение и прошло достаточно времени.
    const start = await this.prisma.taskStart.findUnique({
      where: { userId_campaignId: { userId, campaignId } },
    })
    if (!start) {
      throw new BadRequestException('Сначала открой Reels кнопкой «Открыть Reels» в задании')
    }
    const watchedSeconds = (Date.now() - start.openedAt.getTime()) / 1000
    if (watchedSeconds < MIN_WATCH_SECONDS - WATCH_TOLERANCE_SECONDS) {
      const left = Math.ceil(MIN_WATCH_SECONDS - watchedSeconds)
      throw new BadRequestException(`Посмотри Reels ещё ${left} сек., потом отправляй ссылку`)
    }

    if (!isSameReel(reelsUrl, campaign.reelsUrl)) {
      throw new BadRequestException('Ссылка не совпадает с заданием — убедись что копируешь именно из Instagram')
    }

    // Ссылка должна быть скопирована кнопкой «Поделиться» в Instagram (а не взята из задания).
    // SHARE_LINK_CHECK=off выключает проверку, если Instagram снова поменяет формат ссылок.
    if (process.env.SHARE_LINK_CHECK !== 'off' && !hasInstagramShareToken(reelsUrl)) {
      throw new BadRequestException('Скопируй ссылку в самом Instagram: под роликом «Поделиться» → «Копировать ссылку»')
    }

    // Streak calculation
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    let newStreak = 1
    if (user.lastTaskDate) {
      const last = new Date(user.lastTaskDate)
      last.setHours(0, 0, 0, 0)
      const diffDays = Math.round((today.getTime() - last.getTime()) / 86_400_000)
      if (diffDays === 0) newStreak = user.streak        // already did task today
      else if (diffDays === 1) newStreak = user.streak + 1  // consecutive day
      else newStreak = 1                                  // gap — reset
    }

    const streakBonusApplied = newStreak > 0 && newStreak % STREAK_BONUS_EVERY === 0
    const streakBonus = streakBonusApplied ? STREAK_BONUS_AMOUNT : 0
    const totalEarned = campaign.creditsPerTask + streakBonus

    const ops: any[] = [
      this.prisma.taskCompletion.create({
        data: {
          userId,
          campaignId,
          comment: commentText,
          commentWords: words.length,
          aiApproved: true,
          creditsEarned: totalEarned,
        },
      }),
      this.prisma.campaign.update({
        where: { id: campaignId },
        data: {
          filledSlots: { increment: 1 },
          status: campaign.filledSlots + 1 >= campaign.totalSlots ? 'COMPLETED' : 'ACTIVE',
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          balance: { increment: totalEarned },
          completedTasksCount: { increment: 1 },
          streak: newStreak,
          lastTaskDate: new Date(),
        },
      }),
      this.prisma.transaction.create({
        data: {
          userId,
          amount: campaign.creditsPerTask,
          type: 'EARN',
          description: `Выполнение задания #${campaignId}`,
        },
      }),
    ]

    if (streakBonusApplied) {
      ops.push(
        this.prisma.transaction.create({
          data: {
            userId,
            amount: streakBonus,
            type: 'BONUS',
            description: `Стрик-бонус ${newStreak} дней подряд`,
          },
        }),
      )
    }

    await this.prisma.$transaction(ops)

    if (streakBonusApplied) {
      await this.notifications.sendNotification(
        user.telegramId,
        `🔥 Стрик ${newStreak} дней! Начислен бонус +30₢`,
      )
    }

    const newFilled = campaign.filledSlots + 1
    if (newFilled >= campaign.totalSlots) {
      await this.campaignsService.notifyIfFilled(campaignId)
    } else {
      await this.campaignsService.notifyProgress(campaignId, newFilled, user.instagramUsername)
    }

    return { creditsEarned: totalEarned, streak: newStreak, streakBonusApplied }
  }
}
