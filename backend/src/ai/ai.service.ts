import { BadGatewayException, BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import Anthropic from '@anthropic-ai/sdk'
import { PrismaService } from '../prisma/prisma.service'

// Сколько генераций идей в день доступно пользователю.
// Пока у всех бесплатный тариф; платные (Pro / Max) добавятся здесь же.
export function ideasDailyLimit(_user: { id: number }): number | null {
  return 1 // null = без ограничений
}

// Дополнительная генерация сверх бесплатной — за заработанные кредиты (1 задание = 5 ₢).
export const IDEAS_CREDIT_PRICE = 10
// Потолок генераций в день (бесплатные + за кредиты), чтобы не сжечь бюджет на Claude.
export const IDEAS_DAILY_CAP = 10

export interface IdeasResult {
  ideas: { hook: string; structure: string; cta: string }[]
  caption: string
  hashtags: string[]
}

const startOfTodayUtc = () => {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)
  private client: Anthropic | null = null

  constructor(private prisma: PrismaService) {}

  // Клиент создаётся при первом запросе; ключ — ANTHROPIC_API_KEY в переменных Railway.
  private getClient() {
    return (this.client ??= new Anthropic())
  }

  async getIdeasQuota(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new BadRequestException()
    const limit = ideasDailyLimit(user)
    const usedToday = user.ideasUsedDate && user.ideasUsedDate >= startOfTodayUtc() ? user.ideasUsedCount : 0
    return {
      limit,
      used: usedToday,
      remaining: limit === null ? null : Math.max(0, limit - usedToday),
      creditPrice: IDEAS_CREDIT_PRICE,
      // Сколько ещё можно купить за кредиты сегодня (без учёта баланса)
      paidRemaining: limit === null ? null : Math.max(0, IDEAS_DAILY_CAP - Math.max(usedToday, limit)),
      balance: user.balance,
    }
  }

  async generateIdeas(userId: number, niche: string, payWithCredits = false) {
    const topic = (niche ?? '').trim()
    if (topic.length < 2) throw new BadRequestException('Укажи нишу или тему')

    const quota = await this.getIdeasQuota(userId)
    const today = startOfTodayUtc()
    const isFree = quota.remaining === null || quota.remaining > 0
    const countData = quota.used === 0
      ? { ideasUsedDate: new Date(), ideasUsedCount: 1 }
      : { ideasUsedDate: new Date(), ideasUsedCount: { increment: 1 } }
    // Условие «сегодня ещё не превышен лимит N» для атомарного резерва попытки.
    const underLimit = (n: number) => ({ OR: [{ ideasUsedDate: null }, { ideasUsedDate: { lt: today } }, { ideasUsedCount: { lt: n } }] })

    if (isFree) {
      // Резервируем бесплатную попытку до запроса к Claude, чтобы её нельзя было обойти параллельными запросами.
      const reserved = await this.prisma.user.updateMany({
        where: { id: userId, ...(quota.limit === null ? {} : underLimit(quota.limit)) },
        data: countData,
      })
      if (reserved.count === 0) throw new HttpException('Бесплатная генерация на сегодня уже использована', HttpStatus.TOO_MANY_REQUESTS)
    } else {
      if (!payWithCredits) {
        throw new HttpException(
          `Бесплатная генерация на сегодня использована. Ещё одна — за ${IDEAS_CREDIT_PRICE} ₢`,
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }
      if (!quota.paidRemaining) {
        throw new HttpException('На сегодня генерации закончились — приходи завтра', HttpStatus.TOO_MANY_REQUESTS)
      }
      if (quota.balance < IDEAS_CREDIT_PRICE) {
        throw new BadRequestException(`Нужно ${IDEAS_CREDIT_PRICE} ₢ — выполни пару заданий и возвращайся`)
      }
      // Списываем кредиты и резервируем попытку одной атомарной операцией.
      const charged = await this.prisma.$transaction(async tx => {
        const res = await tx.user.updateMany({
          where: { id: userId, balance: { gte: IDEAS_CREDIT_PRICE }, ...underLimit(IDEAS_DAILY_CAP) },
          data: { ...countData, balance: { decrement: IDEAS_CREDIT_PRICE } },
        })
        if (res.count === 0) return false
        await tx.transaction.create({
          data: { userId, amount: -IDEAS_CREDIT_PRICE, type: 'SPEND', description: 'ИИ-генерация идей для Reels' },
        })
        return true
      })
      if (!charged) throw new BadRequestException('Не получилось списать кредиты — обнови страницу и попробуй ещё раз')
    }

    try {
      const result = await this.askClaude(topic.slice(0, 200))
      const after = await this.getIdeasQuota(userId)
      return { ...result, remaining: after.remaining, paidRemaining: after.paidRemaining, balance: after.balance, creditPrice: IDEAS_CREDIT_PRICE }
    } catch (error) {
      // Не получилось — возвращаем попытку и, если платили, кредиты.
      await this.prisma.$transaction(async tx => {
        await tx.user.update({
          where: { id: userId },
          data: { ideasUsedCount: { decrement: 1 }, ...(isFree ? {} : { balance: { increment: IDEAS_CREDIT_PRICE } }) },
        })
        if (!isFree) {
          await tx.transaction.create({
            data: { userId, amount: IDEAS_CREDIT_PRICE, type: 'REFUND', description: 'Возврат: ИИ-генерация не удалась' },
          })
        }
      }).catch(() => undefined)
      if (error instanceof HttpException) throw error
      this.logger.error('Claude API error', error instanceof Anthropic.APIError ? `${error.status} ${error.message}` : error)
      throw new BadGatewayException('Сервис идей временно недоступен, попробуй позже')
    }
  }

  private async askClaude(niche: string): Promise<IdeasResult> {
    const response = await this.getClient().messages.create({
      // Haiku 5.5: быстрый и дешёвый, для коротких идей хватает.
      model: 'claude-haiku-5-5',
      max_tokens: 4000,
      // Задача простая — минимум размышлений, быстрее ответ и меньше затрат.
      output_config: { effort: 'low' },
      messages: [{
        role: 'user',
        content: `Ты помогаешь начинающему блогеру придумать контент для Instagram Reels.

Ниша/тема блогера: "${niche}"

Придумай 3 РАЗНЫЕ концепции коротких видео (Reels) для этой ниши. Для каждой:
- hook — первая фраза/кадр, который цепляет за первые 2-3 секунды
- structure — краткое описание структуры ролика по шагам (2-4 шага)
- cta — призыв к действию в конце (лайк/подписка/сохранение/комментарий)

Также придумай:
- caption — готовую подпись под один из этих роликов (2-4 предложения, живым языком, без канцелярита)
- hashtags — 8-12 релевантных хэштегов на русском и английском вперемешку (с символом #)

Ответь СТРОГО в виде JSON, без markdown-разметки, без пояснений до или после:
{
  "ideas": [
    {"hook": "...", "structure": "...", "cta": "..."},
    {"hook": "...", "structure": "...", "cta": "..."},
    {"hook": "...", "structure": "...", "cta": "..."}
  ],
  "caption": "...",
  "hashtags": ["#...", "#..."]
}`,
      }],
    })

    if (response.stop_reason === 'refusal') {
      throw new BadRequestException('Не получилось придумать идеи для этой темы — попробуй сформулировать иначе')
    }
    // У Haiku 5.5 размышления включены по умолчанию: первым блоком может идти thinking.
    const text = response.content.find(b => b.type === 'text')?.text ?? ''
    try {
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim()) as IdeasResult
      if (!Array.isArray(parsed.ideas) || !Array.isArray(parsed.hashtags)) throw new Error('bad shape')
      return parsed
    } catch {
      throw new BadGatewayException('Не удалось сгенерировать идеи, попробуй ещё раз')
    }
  }
}
