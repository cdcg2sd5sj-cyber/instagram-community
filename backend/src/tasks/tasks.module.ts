import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { CampaignsModule } from '../campaigns/campaigns.module'
import { TasksService } from './tasks.service'
import { TasksController } from './tasks.controller'

@Module({
  imports: [AuthModule, NotificationsModule, CampaignsModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
