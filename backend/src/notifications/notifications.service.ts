import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)

  async sendNotification(telegramId: string, text: string): Promise<void> {
    try {
      await axios.post(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        { chat_id: telegramId, text },
      )
    } catch (error) {
      this.logger.error(`Не удалось отправить Telegram-уведомление (chatId=${telegramId})`, error instanceof Error ? error.stack : error)
    }
  }
}
