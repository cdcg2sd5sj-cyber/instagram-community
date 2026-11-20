import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { CampaignsModule } from './campaigns/campaigns.module'
import { TasksModule } from './tasks/tasks.module'
import { NotificationsModule } from './notifications/notifications.module'
import { LeaderboardModule } from './leaderboard/leaderboard.module'
import { AiModule } from './ai/ai.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    CampaignsModule,
    TasksModule,
    NotificationsModule,
    LeaderboardModule,
    AiModule,
  ],
})
export class AppModule {}
