import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

export type LeaderboardPeriod = 'week' | 'month' | 'all'

@Injectable()
export class LeaderboardService {
  constructor(private prisma: PrismaService) {}

  async getLeaderboard(period: LeaderboardPeriod, currentUserId?: number) {
    const since = this.periodStart(period)

    const ranked = await this.prisma.transaction.groupBy({
      by: ['userId'],
      where: {
        type: { in: ['EARN', 'BONUS'] },
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
    })

    const top = ranked.slice(0, 10)
    const users = await this.prisma.user.findMany({
      where: { id: { in: top.map(r => r.userId) } },
    })
    const userById = new Map(users.map(u => [u.id, u]))

    const leaderboard = top.map((entry, index) => {
      const user = userById.get(entry.userId)!
      return {
        rank: index + 1,
        username: user.instagramUsername,
        profilePicUrl: user.profilePicUrl,
        totalEarned: entry._sum.amount ?? 0,
        completedTasksCount: user.completedTasksCount,
      }
    })

    let currentUserRank: number | null = null
    if (currentUserId) {
      const index = ranked.findIndex(r => r.userId === currentUserId)
      currentUserRank = index >= 0 ? index + 1 : null
    }

    return { leaderboard, currentUserRank }
  }

  private periodStart(period: LeaderboardPeriod): Date | null {
    if (period === 'all') return null
    const days = period === 'week' ? 7 : 30
    return new Date(Date.now() - days * 86_400_000)
  }
}
