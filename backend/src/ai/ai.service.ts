import { BadGatewayException, BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import Anthropic from '@anthropic-ai/sdk'
import { PrismaService } from '../prisma/prisma.service'

// ИИ-инструменты. У каждого: сколько бесплатно в день, цена сверх бесплатных
// (в ₢, 1 задание = 5 ₢) и дневной потолок (бесплатные + платные), чтобы не сжечь бюджет на Claude.
// Платные тарифы (Pro / Max) будут менять бесплатный лимит в freeLimit().
export const AI_TOOLS = {
  ideas: { free: 1, price: 10, cap: 10, label: 'ИИ-генерация идей для Reels' },
  hooks: { free: 1, price: 10, cap: 10, label: 'ИИ: хуки для Reels' },
  caption: { free: 1, price: 10, cap: 10, label: 'ИИ: улучшение подписи' },
  check: { free: 0, price: 25, cap: 5, label: 'ИИ: проверка перед публикацией' },
} as const
export type AiTool = keyof typeof AI_TOOLS

function freeLimit(tool: AiTool, _user: { id: number }): number {
  return AI_TOOLS[tool].free
}

export interface IdeasResult {
  ideas: { hook: string; structure: string; cta: string }[]
  caption: string
  hashtags: string[]
}
export interface HooksResult { hooks: string[] }
export interface CaptionResult { captions: string[]; tip: string }
export interface CheckResult {
  score: number
  firstImpression: string
  strengths: string[]
  fixes: string[]
}

export interface CheckImage { data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' }

const MAX_IMAGES = 3
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024

const startOfTodayUtc = () => {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

const JSON_ONLY = 'Ответь СТРОГО в виде JSON, без markdown-разметки, без пояснений до или после.'

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)
  private client: Anthropic | null = null

  constructor(private prisma: PrismaService) {}

  // Клиент создаётся при первом запросе; ключ — ANTHROPIC_API_KEY в переменных Railway.
  private getClient() {
    return (this.client ??= new Anthropic())
  }

  // ---------- Лимиты и оплата ----------

  async getQuota(userId: number, tool: AiTool) {
    const [user, usage] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, balance: true } }),
      this.prisma.aiUsage.findUnique({ where: { userId_tool_day: { userId, tool, day: startOfTodayUtc() } } }),
    ])
    if (!user) throw new BadRequestException()
    const free = freeLimit(tool, user)
    const used = usage?.count ?? 0
    const { price, cap } = AI_TOOLS[tool]
    return {
      limit: free,
      used,
      remaining: Math.max(0, free - used),
      paidRemaining: Math.max(0, cap - Math.max(used, free)),
      creditPrice: price,
      balance: user.balance,
    }
  }

  async getAllQuotas(userId: number) {
    const tools = Object.keys(AI_TOOLS) as AiTool[]
    const quotas = await Promise.all(tools.map(t => this.getQuota(userId, t)))
    return Object.fromEntries(tools.map((t, i) => [t, quotas[i]]))
  }

  /**
   * Резервирует попытку (бесплатную или за кредиты) до запроса к Claude — атомарно,
   * чтобы лимит нельзя было обойти параллельными запросами. Если Claude не ответил,
   * попытка и кредиты возвращаются.
   */
  private async runTool<T extends object>(userId: number, tool: AiTool, payWithCredits: boolean, work: () => Promise<T>) {
    const quota = await this.getQuota(userId, tool)
    const { price, cap, label } = AI_TOOLS[tool]
    const day = startOfTodayUtc()
    const key = { userId_tool_day: { userId, tool, day } }
    await this.prisma.aiUsage.upsert({ where: key, create: { userId, tool, day }, update: {} })

    const isFree = quota.remaining > 0
    if (isFree) {
      const res = await this.prisma.aiUsage.updateMany({
        where: { userId, tool, day, count: { lt: quota.limit } },
        data: { count: { increment: 1 } },
      })
      if (res.count === 0) throw new HttpException('Бесплатная попытка на сегодня уже использована', HttpStatus.TOO_MANY_REQUESTS)
    } else {
      if (!payWithCredits) {
        throw new HttpException(`Бесплатные попытки на сегодня закончились. Ещё одна — за ${price} ₢`, HttpStatus.TOO_MANY_REQUESTS)
      }
      if (quota.paidRemaining <= 0) {
        throw new HttpException('На сегодня лимит исчерпан — приходи завтра', HttpStatus.TOO_MANY_REQUESTS)
      }
      if (quota.balance < price) {
        throw new BadRequestException(`Нужно ${price} ₢ — выполни пару заданий и возвращайся`)
      }
      try {
        await this.prisma.$transaction(async tx => {
          const slot = await tx.aiUsage.updateMany({
            where: { userId, tool, day, count: { lt: cap } },
            data: { count: { increment: 1 } },
          })
          const paid = await tx.user.updateMany({
            where: { id: userId, balance: { gte: price } },
            data: { balance: { decrement: price } },
          })
          if (slot.count === 0 || paid.count === 0) throw new Error('charge failed')
          await tx.transaction.create({ data: { userId, amount: -price, type: 'SPEND', description: label } })
        })
      } catch {
        throw new BadRequestException('Не получилось списать кредиты — обнови страницу и попробуй ещё раз')
      }
    }

    try {
      const result = await work()
      const after = await this.getQuota(userId, tool)
      return {
        ...result,
        remaining: after.remaining,
        paidRemaining: after.paidRemaining,
        balance: after.balance,
        creditPrice: after.creditPrice,
      }
    } catch (error) {
      await this.prisma.$transaction(async tx => {
        await tx.aiUsage.updateMany({ where: { userId, tool, day, count: { gt: 0 } }, data: { count: { decrement: 1 } } })
        if (!isFree) {
          await tx.user.update({ where: { id: userId }, data: { balance: { increment: price } } })
          await tx.transaction.create({ data: { userId, amount: price, type: 'REFUND', description: `Возврат: ${label} не удалась` } })
        }
      }).catch(() => undefined)
      if (error instanceof HttpException) throw error
      this.logger.error(`Claude API error (${tool})`, error instanceof Anthropic.APIError ? `${error.status} ${error.message}` : error)
      throw new BadGatewayException('ИИ временно недоступен, попробуй позже')
    }
  }

  // ---------- Инструменты ----------

  async generateIdeas(userId: number, niche: string, payWithCredits = false) {
    const topic = (niche ?? '').trim().slice(0, 200)
    if (topic.length < 2) throw new BadRequestException('Укажи нишу или тему')
    return this.runTool(userId, 'ideas', payWithCredits, async () => {
      const r = await this.askHaiku<IdeasResult>(`Ты помогаешь начинающему блогеру придумать контент для Instagram Reels.

Ниша/тема блогера: "${topic}"

Придумай 3 РАЗНЫЕ концепции коротких видео (Reels) для этой ниши. Для каждой:
- hook — первая фраза/кадр, который цепляет за первые 2-3 секунды
- structure — краткое описание структуры ролика по шагам (2-4 шага)
- cta — призыв к действию в конце (лайк/подписка/сохранение/комментарий)

Также придумай:
- caption — готовую подпись под один из этих роликов (2-4 предложения, живым языком, без канцелярита)
- hashtags — 8-12 релевантных хэштегов на русском и английском вперемешку (с символом #)

${JSON_ONLY}
{"ideas": [{"hook": "...", "structure": "...", "cta": "..."}], "caption": "...", "hashtags": ["#..."]}`)
      if (!Array.isArray(r.ideas) || !Array.isArray(r.hashtags) || typeof r.caption !== 'string') throw new BadGatewayException('Не удалось сгенерировать идеи, попробуй ещё раз')
      return r
    })
  }

  async generateHooks(userId: number, topicRaw: string, payWithCredits = false) {
    const topic = (topicRaw ?? '').trim().slice(0, 300)
    if (topic.length < 2) throw new BadRequestException('Опиши, о чём ролик')
    return this.runTool(userId, 'hooks', payWithCredits, async () => {
      const r = await this.askHaiku<HooksResult>(`Ты сценарист коротких вертикальных видео (Instagram Reels).
О чём ролик: "${topic}"

Придумай 10 разных хуков — первых фраз ролика (то, что говорят или пишут на экране в первые 2-3 секунды),
чтобы зритель не пролистал. Разные приёмы: вопрос, интрига, смелое утверждение, ошибка, цифра, «я попробовал».
Каждый хук — одна короткая фраза до 12 слов, живым разговорным русским языком, без эмодзи и кавычек.

${JSON_ONLY}
{"hooks": ["...", "..."]}`)
      if (!Array.isArray(r.hooks) || r.hooks.length === 0) throw new BadGatewayException('Не удалось придумать хуки, попробуй ещё раз')
      return { hooks: r.hooks.filter(h => typeof h === 'string').slice(0, 10) }
    })
  }

  async improveCaption(userId: number, textRaw: string, payWithCredits = false) {
    const text = (textRaw ?? '').trim().slice(0, 1500)
    if (text.length < 5) throw new BadRequestException('Вставь свою подпись или опиши ролик')
    return this.runTool(userId, 'caption', payWithCredits, async () => {
      const r = await this.askHaiku<CaptionResult>(`Ты редактор подписей для Instagram Reels.
Черновик подписи или описание ролика от автора:
"""
${text}
"""

Сделай 3 улучшенных варианта подписи: цепляющая первая строка, живой разговорный язык, 2-5 предложений,
в конце призыв к действию (сохранить, написать в комментариях, подписаться). Сохрани смысл и голос автора,
не выдумывай фактов. Добавь 3-6 уместных хэштегов в конце каждого варианта.
Также дай один короткий совет (tip), как автору писать подписи лучше.

${JSON_ONLY}
{"captions": ["...", "...", "..."], "tip": "..."}`)
      if (!Array.isArray(r.captions) || r.captions.length === 0) throw new BadGatewayException('Не удалось улучшить подпись, попробуй ещё раз')
      return { captions: r.captions.filter(c => typeof c === 'string').slice(0, 3), tip: typeof r.tip === 'string' ? r.tip : '' }
    })
  }

  async checkBeforePublish(userId: number, images: CheckImage[], descriptionRaw: string | undefined, payWithCredits = false) {
    if (!Array.isArray(images) || images.length === 0) throw new BadRequestException('Загрузи хотя бы один кадр или обложку')
    if (images.length > MAX_IMAGES) throw new BadRequestException(`Не больше ${MAX_IMAGES} изображений`)
    for (const img of images) {
      if (!img || typeof img.data !== 'string' || !['image/jpeg', 'image/png', 'image/webp'].includes(img.mediaType)) {
        throw new BadRequestException('Поддерживаются только картинки JPEG, PNG или WebP')
      }
      if (Buffer.byteLength(img.data, 'base64') > MAX_IMAGE_BYTES) {
        throw new BadRequestException('Картинка слишком большая — до 1,5 МБ')
      }
    }
    const description = (descriptionRaw ?? '').trim().slice(0, 500)

    return this.runTool(userId, 'check', payWithCredits, async () => {
      const response = await this.getClient().beta.messages.create({
        // Sonnet 5.5 хорошо понимает изображения; оценка кадров — его задача.
        model: 'claude-sonnet-5-5',
        max_tokens: 8000,
        output_config: { effort: 'medium' },
        // Если модель откажет по соображениям безопасности, запрос сам повторится на запасной модели.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        messages: [{
          role: 'user',
          content: [
            ...images.map(img => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: img.mediaType, data: img.data },
            })),
            {
              type: 'text' as const,
              text: `Это кадры или обложка будущего Instagram Reels (по порядку).${description ? `\nАвтор пишет о ролике: "${description}"` : ''}

Оцени как опытный продюсер коротких видео, удержит ли это зрителя в первые секунды:
- score — оценка от 1 до 10
- firstImpression — 1-2 предложения: что видит зритель в первую секунду и захочет ли досмотреть
- strengths — 2-4 сильные стороны
- fixes — 3-5 конкретных правок (текст на экране, читаемость, кадрирование, свет, первый кадр, обложка)
Пиши по-русски, коротко и по делу, без воды.

${JSON_ONLY}
{"score": 7, "firstImpression": "...", "strengths": ["..."], "fixes": ["..."]}`,
            },
          ],
        }],
      })
      if (response.stop_reason === 'refusal') {
        throw new BadRequestException('Не получилось оценить эти изображения — попробуй другие кадры')
      }
      const r = this.parseJson<CheckResult>(response.content.find(b => b.type === 'text')?.text)
      if (!r || typeof r.score !== 'number' || !Array.isArray(r.fixes)) throw new BadGatewayException('Не удалось проверить ролик, попробуй ещё раз')
      return {
        score: Math.max(1, Math.min(10, Math.round(r.score))),
        firstImpression: String(r.firstImpression ?? ''),
        strengths: Array.isArray(r.strengths) ? r.strengths.map(String) : [],
        fixes: r.fixes.map(String),
      }
    })
  }

  // ---------- Claude ----------

  private async askHaiku<T>(prompt: string): Promise<T> {
    const response = await this.getClient().messages.create({
      // Haiku 5.5: быстрый и дешёвый, для текстовых инструментов хватает.
      model: 'claude-haiku-5-5',
      max_tokens: 4000,
      // Задачи простые — минимум размышлений, быстрее ответ и меньше затрат.
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: prompt }],
    })
    if (response.stop_reason === 'refusal') {
      throw new BadRequestException('Не получилось обработать эту тему — попробуй сформулировать иначе')
    }
    // У Haiku 5.5 размышления включены по умолчанию: первым блоком может идти thinking.
    const parsed = this.parseJson<T>(response.content.find(b => b.type === 'text')?.text)
    if (!parsed) throw new BadGatewayException('ИИ ответил непонятно, попробуй ещё раз')
    return parsed
  }

  private parseJson<T>(text: string | undefined): T | null {
    if (!text) return null
    try {
      return JSON.parse(text.replace(/```json|```/g, '').trim()) as T
    } catch {
      return null
    }
  }
}
