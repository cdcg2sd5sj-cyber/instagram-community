import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { CampaignsService } from './campaigns.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CreateCampaignDto } from './dto/create-campaign.dto'

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(private campaignsService: CampaignsService) {}

  @Post()
  async create(@CurrentUser('id') userId: number, @Body() dto: CreateCampaignDto) {
    return this.campaignsService.createCampaign(userId, dto.reelsUrl, dto.totalSlots)
  }

  @Get('mine')
  async mine(@CurrentUser('id') userId: number) {
    return this.campaignsService.getUserCampaigns(userId)
  }
}
