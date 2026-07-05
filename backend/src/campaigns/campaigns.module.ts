import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { CampaignsService } from './campaigns.service'
import { CampaignsController } from './campaigns.controller'

@Module({
  imports: [AuthModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
