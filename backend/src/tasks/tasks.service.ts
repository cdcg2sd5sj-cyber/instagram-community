import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { CampaignsService } from '../campaigns/campaigns.service'
import Anthropic from '@anthropic-ai/sdk'

const STREAK_BONUS_EVERY = 7
const STREAK_BONUS_AMOUNT = 30

@Injectable()
export class TasksService {
  private anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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
      },
      orderBy: { filledSlots: 'asc' },
      include: { user: true },
    })

    if (!campaign) return null

    return {
      id: campaign.id,
      reelsUrl: campaign.reelsUrl,
      reward: campaign.creditsPerTask,
      slotsLeft: campaign.totalSlots - campaign.filledSlots,
      author: {
        username: campaign.user.instagramUsername,
        profilePicUrl: campaign.user.profilePicUrl,
      },
    }
  }

  async completeTask(userId: number, campaignId: number, comment: string) {
    const words = comment.trim().split(/\s+/).filter(w => w.length > 0)
    if (words.length < 5) {
      throw new BadRequestException('Комментарий должен содержать минимум 5 слов')
    }

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

    const aiApproved = await this.checkCommentWithAI(comment)
    if (!aiApproved) {
      throw new BadRequestException('Комментарий не прошёл проверку — напиши более осмысленный текст')
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
          comment,
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

    if (campaign.filledSlots + 1 >= campaign.totalSlots) {
      await this.campaignsService.notifyIfFilled(campaignId)
    }

    return { creditsEarned: totalEarned, streak: newStreak, streakBonusApplied }
  }

  private async checkCommentWithAI(comment: string): Promise<boolean> {
    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{
          role: 'user',
          content: `Проверь комментарий к Instagram Reels. Ответь только YES или NO.
Комментарий плохой если:
- Просто эмодзи или одно слово
- Бессмысленный набор слов
- Явный спам

Комментарий: "${comment}"

Ответ (только YES если хороший, NO если плохой):`,
        }],
      })

      const result = response.content[0].type === 'text' ? response.content[0].text.trim() : 'NO'
      return result.startsWith('YES')
    } catch {
      return true
    }
  }
}
