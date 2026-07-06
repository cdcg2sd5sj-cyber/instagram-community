import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
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
    const tgUser = this.validateTelegramData(initData)

    // Telegram deep-link referral code comes via start_param
    const params = new URLSearchParams(initData)
    const startParam = params.get('start_param')

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

      let referrerId: number | null = null
      if (startParam) {
        const referrer = await this.prisma.user.findUnique({
          where: { referralCode: startParam.toUpperCase() },
        })
        if (referrer) referrerId = referrer.id
      }

      user = await this.prisma.user.create({
        data: {
          telegramId: String(tgUser.id),
          firstName: tgUser.first_name,
          username: tgUser.username,
          instagramUsername: instagramUsername.replace('@', ''),
          instagramVerified: true,
          instagramTrustScore: igCheck.score,
          balance: 10,
          referralCode: this.generateReferralCode(),
          referredById: referrerId,
        },
      })

      if (referrerId) {
        await this.prisma.$transaction([
          this.prisma.user.update({
            where: { id: user.id },
            data: { balance: { increment: 20 } },
          }),
          this.prisma.user.update({
            where: { id: referrerId },
            data: { balance: { increment: 20 } },
          }),
          this.prisma.transaction.create({
            data: { userId: user.id, amount: 20, type: 'BONUS', description: 'Реферальный бонус — вступил по приглашению' },
          }),
          this.prisma.transaction.create({
            data: { userId: referrerId, amount: 20, type: 'BONUS', description: 'Реферальный бонус — пригласил друга' },
          }),
        ])
      }
    }

    const token = this.jwtService.sign({ sub: user.id, tgId: user.telegramId })
    return { token, user }
  }

  private async checkInstagram(username: string) {
    if (process.env.SKIP_INSTAGRAM_CHECK === 'true') {
      return { valid: true, reason: null, score: 100 }
    }

    try {
      const clean = username.replace('@', '')
      const body = new URLSearchParams({ username_or_url: clean, data: 'basic' })
      const response = await axios.post(
        'https://instagram-scraper-stable-api.p.rapidapi.com/ig_get_fb_profile.php',
        body.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-rapidapi-key': process.env.RAPIDAPI_KEY!,
            'x-rapidapi-host': 'instagram-scraper-stable-api.p.rapidapi.com',
          },
        },
      )

      const data = response.data
      if (!data || data.error) return { valid: false, reason: 'Аккаунт не найден', score: 0 }
      if (data.is_private) return { valid: false, reason: 'Аккаунт закрытый', score: 0 }
      if ((data.follower_count ?? 0) < 100) return { valid: false, reason: 'Менее 100 подписчиков', score: 0 }
      if ((data.media_count ?? 0) < 5) return { valid: false, reason: 'Менее 5 публикаций', score: 0 }

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
