import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common'
import { CampaignsService } from './campaigns.service'
import { JwtAuthGuard } from '../common/jwt-auth.guard'

@Controller('campaigns')
export class CampaignsController {
  constructor(private campaignsService: CampaignsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(
    @Request() req: any,
    @Body() body: { reelsUrl: string; totalSlots: number },
  ) {
    return this.campaignsService.createCampaign(req.user.sub, body.reelsUrl, body.totalSlots)
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  getMine(@Request() req: any) {
    return this.campaignsService.getUserCampaigns(req.user.sub)
  }
}
