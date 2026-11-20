import { BadGatewayException, BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import Anthropic from '@anthropic-ai/sdk'
import { PrismaService } from '../prisma/prisma.service'

// Сколько генераций идей в день доступно пользователю.
// Пока у всех бесплатный тариф; платные (Pro / Max) добавятся здесь же.
export function ideasDailyLimit(_user: { id: number }): number | null {
  return 1 // null = без ограничений
}

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
    return { limit, used: usedToday, remaining: limit === null ? null : Math.max(0, limit - usedToday) }
  }

  async generateIdeas(userId: number, niche: string): Promise<IdeasResult & { remaining: number | null }> {
    const topic = (niche ?? '').trim()
    if (topic.length < 2) throw new BadRequestException('Укажи нишу или тему')

    // Резервируем попытку до запроса к Claude, чтобы нельзя было обойти лимит параллельными запросами.
    const quota = await this.getIdeasQuota(userId)
    if (quota.limit !== null && quota.used >= quota.limit) {
      throw new HttpException(
        'На сегодня генерации закончились — новая будет доступна завтра. В платных тарифах лимит больше.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
    const today = startOfTodayUtc()
    const reserved = await this.prisma.user.updateMany({
      where: {
        id: userId,
        ...(quota.limit === null
          ? {}
          : { OR: [{ ideasUsedDate: null }, { ideasUsedDate: { lt: today } }, { ideasUsedCount: { lt: quota.limit } }] }),
      },
      data: quota.used === 0
        ? { ideasUsedDate: new Date(), ideasUsedCount: 1 }
        : { ideasUsedDate: new Date(), ideasUsedCount: { increment: 1 } },
    })
    if (reserved.count === 0) {
      throw new HttpException('На сегодня генерации закончились — новая будет доступна завтра.', HttpStatus.TOO_MANY_REQUESTS)
    }

    try {
      const result = await this.askClaude(topic.slice(0, 200))
      return { ...result, remaining: quota.remaining === null ? null : quota.remaining - 1 }
    } catch (error) {
      // Не получилось — возвращаем попытку.
      await this.prisma.user.update({
        where: { id: userId },
        data: { ideasUsedCount: { decrement: 1 } },
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
