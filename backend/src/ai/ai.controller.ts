import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common'
import { AiService } from './ai.service'
import { JwtAuthGuard } from '../common/jwt-auth.guard'

@Controller('ai')
export class AiController {
  constructor(private aiService: AiService) {}

  @Get('ideas/quota')
  @UseGuards(JwtAuthGuard)
  getQuota(@Request() req: any) {
    return this.aiService.getIdeasQuota(req.user.sub)
  }

  @Post('ideas')
  @UseGuards(JwtAuthGuard)
  generate(@Request() req: any, @Body() body: { niche: string }) {
    return this.aiService.generateIdeas(req.user.sub, body?.niche)
  }
}
