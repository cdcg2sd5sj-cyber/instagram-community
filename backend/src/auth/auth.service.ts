import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import * as crypto from 'crypto'
import axios from 'axios'

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  validateTelegramData(initData: string): Record<string, string> {
    const params = new URLSearchParams(initData)
    const hash = params.get('hash')
    params.delete('hash')

    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(process.env.TELEGRAM_BOT_TOKEN!)
      .digest()

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex')

    if (calculatedHash !== hash) {
      throw new UnauthorizedException('Неверные данные Telegram')
    }

    const user = JSON.parse(params.get('user') || '{}')
    return user
  }

  async loginOrRegister(initData: string, instagramUsername?: string) {
    const params = new URLSearchParams(initData)
    const tgUser = this.validateTelegramData(initData)
    const startParam = params.get('start_param') || undefined

    let user = await this.prisma.user.findUnique({
      where: { telegramId: String(tgUser.id) },
    })

    if (!user) {
      if (!instagramUsername) {
        return { needsInstagram: true }
      }

      const igCheck = await this.checkInstagram(instagramUsername)
      if (!igCheck.valid) {
        return { igError: igCheck.reason }
      }

      let referredBy: { id: number } | null = null
      if (startParam) {
        referredBy = await this.prisma.user.findUnique({
          where: { referralCode: startParam },
          select: { id: true },
        })
      }

      const REFERRAL_BONUS = 20
      let createdNow = false

      try {
        user = await this.prisma.user.create({
          data: {
            telegramId: String(tgUser.id),
            firstName: tgUser.first_name,
            username: tgUser.username,
            instagramUsername: instagramUsername.replace('@', ''),
            instagramVerified: true,
            instagramTrustScore: igCheck.score,
            balance: referredBy ? 10 + REFERRAL_BONUS : 10,
            referralCode: this.generateReferralCode(),
            referredById: referredBy?.id,
          },
        })
        createdNow = true
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const target = ((err.meta?.target as string[] | string | undefined) || '').toString()
          if (target.includes('telegramId')) {
            // Двойной тап "Начать" — параллельный запрос уже создал этого же
            // пользователя (и уже начислил реферальный бонус, если он был).
            // Просто логиним, НЕ повторяя начисление бонуса ниже.
            user = await this.prisma.user.findUniqueOrThrow({
              where: { telegramId: String(tgUser.id) },
            })
          } else if (target.includes('instagramUsername')) {
            return { igError: 'Этот Instagram уже привязан к другому аккаунту' }
          } else {
            return { igError: 'Не удалось завершить регистрацию, попробуй ещё раз' }
          }
        } else {
          throw err
        }
      }

      if (createdNow && referredBy) {
        await this.prisma.$transaction([
          this.prisma.user.update({
            where: { id: referredBy.id },
            data: { balance: { increment: REFERRAL_BONUS } },
          }),
          this.prisma.transaction.create({
            data: {
              userId: referredBy.id,
              amount: REFERRAL_BONUS,
              type: 'BONUS',
              description: `Приглашённый друг зарегистрировался (@${user.instagramUsername})`,
            },
          }),
          this.prisma.transaction.create({
            data: {
              userId: user.id,
              amount: REFERRAL_BONUS,
              type: 'BONUS',
              description: 'Бонус за регистрацию по приглашению',
            },
          }),
        ])
      }
    }

    const token = this.jwtService.sign({ sub: user.id, tgId: user.telegramId })
    return { token, user }
  }

  private async checkInstagram(username: string) {
    // Проверка через RapidAPI временно отключена в проекте (см. заметки) —
    // включается через INSTAGRAM_CHECK_ENABLED=true, когда ключ будет готов.
    if (process.env.INSTAGRAM_CHECK_ENABLED !== 'true') {
      return { valid: true, reason: null, score: 100 }
    }

    try {
      const clean = username.replace('@', '')
      const response = await axios.get(
        `https://instagram-scraper-api2.p.rapidapi.com/v1/info?username_or_id_or_url=${clean}`,
        {
          headers: {
            'X-RapidAPI-Key': process.env.RAPIDAPI_KEY!,
            'X-RapidAPI-Host': 'instagram-scraper-api2.p.rapidapi.com',
          },
        },
      )

      const data = response.data?.data
      if (!data) return { valid: false, reason: 'Аккаунт не найден', score: 0 }
      if (data.is_private) return { valid: false, reason: 'Аккаунт закрытый', score: 0 }
      if (data.follower_count < 100) return { valid: false, reason: 'Менее 100 подписчиков', score: 0 }
      if (data.media_count < 5) return { valid: false, reason: 'Менее 5 публикаций', score: 0 }

      const score = Math.min(100, Math.floor(data.follower_count / 10))
      return { valid: true, reason: null, score }
    } catch {
      return { valid: false, reason: 'Не удалось проверить аккаунт', score: 0 }
    }
  }

  private generateReferralCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
  }
}
