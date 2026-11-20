import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common'
import { AiService, CheckImage } from './ai.service'
import { JwtAuthGuard } from '../common/jwt-auth.guard'

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private aiService: AiService) {}

  // Лимиты и цены всех инструментов на сегодня
  @Get('quota')
  getAllQuotas(@Request() req: any) {
    return this.aiService.getAllQuotas(req.user.sub)
  }

  // Оставлено для старых версий приложения
  @Get('ideas/quota')
  getIdeasQuota(@Request() req: any) {
    return this.aiService.getQuota(req.user.sub, 'ideas')
  }

  @Post('ideas')
  ideas(@Request() req: any, @Body() body: { niche: string; payWithCredits?: boolean }) {
    return this.aiService.generateIdeas(req.user.sub, body?.niche, body?.payWithCredits === true)
  }

  @Post('hooks')
  hooks(@Request() req: any, @Body() body: { topic: string; payWithCredits?: boolean }) {
    return this.aiService.generateHooks(req.user.sub, body?.topic, body?.payWithCredits === true)
  }

  @Post('caption')
  caption(@Request() req: any, @Body() body: { text: string; payWithCredits?: boolean }) {
    return this.aiService.improveCaption(req.user.sub, body?.text, body?.payWithCredits === true)
  }

  @Post('check')
  check(@Request() req: any, @Body() body: { images: CheckImage[]; description?: string; payWithCredits?: boolean }) {
    return this.aiService.checkBeforePublish(req.user.sub, body?.images, body?.description, body?.payWithCredits === true)
  }
}
