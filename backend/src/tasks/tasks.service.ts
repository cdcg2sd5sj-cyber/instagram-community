import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import Anthropic from '@anthropic-ai/sdk'

@Injectable()
export class TasksService {
  private anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  constructor(private prisma: PrismaService) {}

  async getNextTask(userId: number) {
    // Prisma не умеет сравнивать два поля одной записи прямо в where,
    // поэтому забираем активные кампании и фильтруем по заполненности в коде.
    const campaigns = await this.prisma.campaign.findMany({
      where: {
        status: 'ACTIVE',
        userId: { not: userId },
        completions: {
          none: { userId },
        },
      },
      orderBy: { filledSlots: 'asc' },
    })

    const campaign = campaigns.find((c) => c.filledSlots < c.totalSlots)
    if (!campaign) {
      return null
    }

    return {
      id: campaign.id,
      reelsUrl: campaign.reelsUrl,
      reward: campaign.creditsPerTask,
      slotsLeft: campaign.totalSlots - campaign.filledSlots,
    }
  }

  async completeTask(userId: number, campaignId: number, comment: string) {
    const words = comment.trim().split(/\s+/).filter(w => w.length > 0)
    if (words.length < 10) {
      throw new BadRequestException('Комментарий должен содержать минимум 10 слов')
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

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })

    const now = new Date()
    const todayStr = now.toDateString()
    const yesterdayStr = new Date(now.getTime() - 86400000).toDateString()
    const lastStr = user.lastActivityDate ? user.lastActivityDate.toDateString() : null

    let newStreak = user.streak
    if (lastStr === todayStr) {
      // уже была активность сегодня — стрик не меняется
    } else if (lastStr === yesterdayStr) {
      newStreak = user.streak + 1
    } else {
      newStreak = 1
    }
    const streakBonus = newStreak > 0 && newStreak % 7 === 0 ? 30 : 0
    const totalCredits = campaign.creditsPerTask + streakBonus

    const ops = [
      this.prisma.taskCompletion.create({
        data: {
          userId,
          campaignId,
          comment,
          commentWords: words.length,
          aiApproved: true,
          creditsEarned: campaign.creditsPerTask,
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
          balance: { increment: totalCredits },
          completedTasksCount: { increment: 1 },
          streak: newStreak,
          lastActivityDate: now,
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

    if (streakBonus > 0) {
      ops.push(
        this.prisma.transaction.create({
          data: {
            userId,
            amount: streakBonus,
            type: 'BONUS',
            description: `Стрик-бонус: ${newStreak} дней подряд`,
          },
        }),
      )
    }

    await this.prisma.$transaction(ops)

    return { creditsEarned: totalCredits, streak: newStreak, streakBonusApplied: streakBonus > 0 }
  }

  private async checkCommentWithAI(comment: string): Promise<boolean> {
    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: `Проверь комментарий к Instagram Reels. Ответь только YES или NO.
Комментарий считается плохим если:
- Это просто эмодзи или одно слово
- Бессмысленный набор слов
- Явный спам

Комментарий: "${comment}"

Ответ (только YES если хороший, NO если плохой):`
        }],
      })

      const result = response.content[0].type === 'text' ? response.content[0].text.trim() : 'NO'
      return result.includes('YES')
    } catch {
      return true
    }
  }
}
