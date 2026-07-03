import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class CampaignsService {
  constructor(private prisma: PrismaService) {}

  async createCampaign(userId: number, reelsUrl: string, totalSlots: number) {
    const COST_PER_SLOT = 1.5
    const totalCost = Math.ceil(totalSlots * COST_PER_SLOT)

    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user || user.balance < totalCost) {
      throw new BadRequestException(`Недостаточно Credits. Нужно ${totalCost} ₢`)
    }

    if (totalSlots < 5 || totalSlots > 100) {
      throw new BadRequestException('Количество участников: от 5 до 100')
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
