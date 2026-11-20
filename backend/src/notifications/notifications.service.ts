import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)

  /**
   * openAppButton — добавить под сообщением кнопку «Открыть приложение».
   * Нужна переменная MINI_APP_URL (адрес фронтенда); без неё кнопки просто не будет.
   */
  async sendNotification(telegramId: string, text: string, options: { openAppButton?: boolean } = {}): Promise<void> {
    const miniAppUrl = process.env.MINI_APP_URL
    const replyMarkup = options.openAppButton && miniAppUrl
      ? { inline_keyboard: [[{ text: '🚀 Открыть приложение', web_app: { url: miniAppUrl } }]] }
      : undefined
    try {
      await axios.post(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        { chat_id: telegramId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) },
      )
    } catch (error) {
      this.logger.error(`Не удалось отправить Telegram-уведомление (chatId=${telegramId})`, error instanceof Error ? error.stack : error)
    }
  }
}
