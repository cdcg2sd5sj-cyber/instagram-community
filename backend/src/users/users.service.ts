import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

const DAY_MS = 86_400_000

type UserWithReferralCount = {
  completedTasksCount: number
  streak: number
  createdAt: Date
  _count: { referrals: number }
}

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
      profilePicUrl: user.profilePicUrl,
      balance: user.balance,
      completedTasks: user.completedTasksCount,
      earnedTotal: earnedResult._sum.amount ?? 0,
      spentTotal: Math.abs(spentResult._sum.amount ?? 0),
      referralCode: user.referralCode,
      referrals: user._count.referrals,
      streak: user.streak,
      achievements: this.computeAchievements(user),
    }
  }

  async getUserAchievements(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { _count: { select: { referrals: true } } },
    })
    if (!user) throw new UnauthorizedException()

    return this.computeAchievements(user)
  }

  private computeAchievements(user: UserWithReferralCount) {
    const accountAgeDays = (Date.now() - user.createdAt.getTime()) / DAY_MS

    return [
      { id: 'first-steps', title: 'Первые шаги', unlocked: user.completedTasksCount >= 1 },
      { id: 'active', title: 'Активный', unlocked: user.completedTasksCount >= 10 },
      { id: 'pro', title: 'Профи', unlocked: user.completedTasksCount >= 50 },
      { id: 'fire', title: 'Огонь', unlocked: user.streak >= 7 },
      { id: 'legend', title: 'Легенда', unlocked: user.streak >= 30 },
      { id: 'ambassador', title: 'Амбассадор', unlocked: user._count.referrals >= 5 },
      { id: 'veteran', title: 'Ветеран', unlocked: accountAgeDays > 30 },
    ]
  }
}
