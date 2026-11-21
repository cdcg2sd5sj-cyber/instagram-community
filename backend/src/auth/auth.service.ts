import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import * as crypto from 'crypto'
import axios from 'axios'

// Хватает ровно на пакет «Мини», чтобы новичок сразу мог запустить свой Reels.
const STARTING_BALANCE = 50
// Требования к аккаунту минимальные — приложение для тех, кто только начинает:
// открытый профиль и хотя бы одна публикация (её же человек и будет продвигать).
const MIN_POSTS = 1
import { rapidApiExhausted, recordRapidApiQuota, saveAvatarFromUrl } from '../common/instagram-avatar'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private notifications: NotificationsService,
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

      // Сначала проверяем, не занят ли ник, — это бесплатно и бережёт лимит RapidAPI.
      const cleanUsername = instagramUsername.trim().replace(/^@/, '')
      const taken = await this.prisma.user.findFirst({
        where: { instagramUsername: { equals: cleanUsername, mode: 'insensitive' } },
        select: { id: true },
      })
      if (taken) {
        return { igError: 'Этот Instagram уже зарегистрирован в приложении' }
      }

      const igCheck = await this.checkInstagram(instagramUsername)
      if (!igCheck.valid) {
        return { igError: igCheck.reason }
      }

      let referrerId: number | null = null
      let referrerTelegramId: string | null = null
      if (startParam) {
        const referrer = await this.prisma.user.findUnique({
          where: { referralCode: startParam.toUpperCase() },
        })
        if (referrer) {
          referrerId = referrer.id
          referrerTelegramId = referrer.telegramId
        }
      }

      user = await this.prisma.user.create({
        data: {
          telegramId: String(tgUser.id),
          firstName: tgUser.first_name,
          username: tgUser.username,
          instagramUsername: instagramUsername.trim().replace(/^@/, '').toLowerCase(),
          instagramVerified: true,
          instagramTrustScore: igCheck.score,
          profilePicUrl: igCheck.profilePicUrl,
          balance: STARTING_BALANCE,
          referralCode: this.generateReferralCode(),
          referredById: referrerId,
        },
      })

      // Сохраняем саму картинку сразу: ссылка Instagram потом протухнет.
      await saveAvatarFromUrl(this.prisma, user.id, igCheck.profilePicUrl)

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

        if (referrerTelegramId) {
          await this.notifications.sendNotification(
            referrerTelegramId,
            '🎉 Твой друг зарегистрировался по твоей ссылке! Начислено +20₢',
          )
        }
      }
    }

    const token = this.jwtService.sign({ sub: user.id, tgId: user.telegramId })
    return { token, user }
  }

  /**
   * Проверка аккаунта через RapidAPI — обязательна. Если сервис недоступен
   * (кончился месячный лимит, ошибка, таймаут), регистрацию не пропускаем.
   */
  private async checkInstagram(username: string): Promise<{
    valid: boolean; reason: string | null; score: number; profilePicUrl: string | null
  }> {
    const clean = username.trim().replace(/^@/, '').toLowerCase()
    if (!/^[a-z0-9._]{1,30}$/.test(clean)) {
      return { valid: false, reason: 'Проверь username — только латинские буквы, цифры, точки и _', score: 0, profilePicUrl: null }
    }
    if (process.env.SKIP_INSTAGRAM_CHECK === 'true') return { valid: true, reason: null, score: 100, profilePicUrl: null }
    const unavailable = { valid: false, reason: 'Проверка аккаунта временно недоступна — попробуй чуть позже', score: 0, profilePicUrl: null }
    if (rapidApiExhausted()) {
      this.logger.error('RapidAPI: месячный лимит исчерпан — новые пользователи не могут зарегистрироваться')
      return unavailable
    }

    let data: any
    try {
      const body = new URLSearchParams({ username_or_url: clean, data: 'basic' })
      const response = await axios.post(
        'https://instagram-scraper-stable-api.p.rapidapi.com/ig_get_fb_profile.php',
        body.toString(),
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'x-rapidapi-key': process.env.RAPIDAPI_KEY!,
            'x-rapidapi-host': 'instagram-scraper-stable-api.p.rapidapi.com',
          },
        },
      )
      recordRapidApiQuota(response.headers)
      data = response.data
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) recordRapidApiQuota(error.response.headers)
      const status = axios.isAxiosError(error) ? error.response?.status : undefined
      this.logger.error(`Проверка Instagram недоступна (${status ?? 'нет ответа'}) — регистрация @${clean} отклонена`)
      return unavailable
    }

    if (!data || data.error) {
      return { valid: false, reason: 'Не нашли такой аккаунт — проверь, правильно ли написан username', score: 0, profilePicUrl: null }
    }
    if (data.is_private) {
      return { valid: false, reason: 'Аккаунт закрытый — открой его в настройках Instagram и попробуй снова', score: 0, profilePicUrl: null }
    }
    if ((data.media_count ?? 0) < MIN_POSTS) {
      return { valid: false, reason: 'Нужна хотя бы одна публикация в аккаунте', score: 0, profilePicUrl: null }
    }

    const score = Math.min(100, Math.floor((data.follower_count ?? 0) / 10))
    return { valid: true, reason: null, score, profilePicUrl: data.profile_pic_url || null }
  }


  private generateReferralCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
  }
}
