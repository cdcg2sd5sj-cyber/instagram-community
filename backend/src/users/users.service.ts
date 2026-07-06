import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: number) {
    const [user, earnedResult, spentResult] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        include: { _count: { select: { referrals: true } } },
      }),
      this.prisma.transaction.aggregate({
        where: { userId, type: 'EARN' },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { userId, type: 'SPEND' },
        _sum: { amount: true },
      }),
    ])

    if (!user) throw new UnauthorizedException()

    return {
      id: user.id,
      igUsername: user.instagramUsername,
      balance: user.balance,
      completedTasks: user.completedTasksCount,
      earnedTotal: earnedResult._sum.amount ?? 0,
      spentTotal: Math.abs(spentResult._sum.amount ?? 0),
      referralCode: user.referralCode,
      referrals: user._count.referrals,
      streak: user.streak,
    }
  }
}
