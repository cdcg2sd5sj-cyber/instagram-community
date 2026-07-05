import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: number) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        _count: { select: { referrals: true } },
      },
    })

    const spentAgg = await this.prisma.transaction.aggregate({
      where: { userId, type: 'SPEND' },
      _sum: { amount: true },
    })
    const earnedAgg = await this.prisma.transaction.aggregate({
      where: { userId, type: { in: ['EARN', 'BONUS'] } },
      _sum: { amount: true },
    })

    return {
      id: user.id,
      igUsername: user.instagramUsername,
      balance: user.balance,
      completedTasks: user.completedTasksCount,
      earnedTotal: earnedAgg._sum.amount || 0,
      // amount хранится отрицательным для SPEND, поэтому берём модуль
      spentTotal: Math.abs(spentAgg._sum.amount || 0),
      referralCode: user.referralCode,
      referrals: user._count.referrals,
      streak: user.streak,
    }
  }
}
