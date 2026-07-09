import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'

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
        data: { userId, reelsUrl, totalSlots, creditsPerTask: 15 },
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

  async getUserCampaigns(userId: number) {
    return this.prisma.campaign.findMany({
      where: { userId },
      include: { _count: { select: { completions: true } } },
      orderBy: { createdAt: 'desc' },
    })
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
