import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

const PACKAGE_PRICES: Record<number, number> = {
  10: 50,
  25: 100,
  60: 200,
  200: 500,
}

@Injectable()
export class CampaignsService {
  constructor(private prisma: PrismaService) {}

  async createCampaign(userId: number, reelsUrl: string, totalSlots: number) {
    const totalCost = PACKAGE_PRICES[totalSlots]
    if (!totalCost) {
      throw new BadRequestException(
        `Недопустимое количество участников. Доступные пакеты: ${Object.keys(PACKAGE_PRICES).join(', ')}`,
      )
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user || user.balance < totalCost) {
      throw new BadRequestException(`Недостаточно Credits. Нужно ${totalCost} ₢`)
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
}
