import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { avatarPath } from '../common/instagram-avatar'

// Награда за выполнение задания. Должна быть близка к цене одного слота (Мини: 50 ₢ / 10 слотов = 5 ₢),
// иначе кредиты «печатаются» быстрее, чем тратятся.
export const TASK_REWARD = 5

// Must match PACKAGES in frontend app/page.tsx
const PACKAGES: Record<number, number> = {
  10: 50,
  25: 100,
  60: 200,
  200: 500,
}

@Injectable()
export class CampaignsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async createCampaign(userId: number, reelsUrl: string, totalSlots: number) {
    const totalCost = PACKAGES[totalSlots]
    if (!totalCost) {
      throw new BadRequestException('Выбери один из пакетов: 10, 25, 60 или 200 участников')
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user || user.balance < totalCost) {
      throw new BadRequestException(`Недостаточно Credits — нужно ${totalCost} ₢`)
    }

    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const campaignToday = await this.prisma.campaign.findFirst({
      where: { userId, createdAt: { gte: startOfToday } },
    })
    if (campaignToday) {
      throw new BadRequestException(
        'Ты уже запускал продвижение сегодня. Новую кампанию можно создать завтра',
      )
    }

    const [campaign] = await this.prisma.$transaction([
      this.prisma.campaign.create({
        data: { userId, reelsUrl, totalSlots, creditsPerTask: TASK_REWARD },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { balance: { decrement: totalCost } },
      }),
      this.prisma.transaction.create({
        data: {
          userId,
          amount: -totalCost,
          type: 'SPEND',
          description: `Запуск продвижения — ${totalSlots} участников`,
        },
      }),
    ])

    return campaign
  }

  // Сколько последних участников показываем автору в карточке кампании.
  private static readonly VIEWERS_LIMIT = 50

  async getUserCampaigns(userId: number) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { userId },
      include: {
        _count: { select: { completions: true } },
        completions: {
          orderBy: { createdAt: 'desc' },
          take: CampaignsService.VIEWERS_LIMIT,
          select: {
            createdAt: true,
            // avatarContentType заполняется вместе с картинкой — по нему видно, есть ли аватарка,
            // не вытягивая из БД сами байты.
            user: { select: { id: true, instagramUsername: true, avatarContentType: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return campaigns.map(({ completions, ...campaign }) => ({
      ...campaign,
      viewers: completions.map(c => ({
        username: c.user.instagramUsername,
        profilePicUrl: avatarPath(c.user.id, !!c.user.avatarContentType),
        completedAt: c.createdAt,
      })),
    }))
  }

  // Автору: первый участник и половина кампании. 100% — в notifyIfFilled.
  async notifyProgress(campaignId: number, filled: number, viewerUsername: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { user: true },
    })
    if (!campaign) return

    const half = Math.ceil(campaign.totalSlots / 2)
    let text: string | null = null
    if (filled === 1) {
      text = `👀 Первый участник уже посмотрел твой Reels — @${viewerUsername}. Дальше будет больше!`
    } else if (filled === half && campaign.totalSlots >= 10) {
      text = `🔥 Половина пути: твой Reels посмотрели ${filled} из ${campaign.totalSlots} участников.`
    }
    if (text) await this.notifications.sendNotification(campaign.user.telegramId, text, { openAppButton: true })
  }

  async notifyIfFilled(campaignId: number) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { user: true },
    })
    if (!campaign || campaign.filledSlots < campaign.totalSlots) return

    await this.notifications.sendNotification(
      campaign.user.telegramId,
      '🎉 Твоя кампания заполнена на 100%! Загляни проверить результаты.',
    )
  }
}
