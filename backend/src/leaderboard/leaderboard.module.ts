import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { LeaderboardService } from './leaderboard.service'
import { LeaderboardController } from './leaderboard.controller'

@Module({
  imports: [AuthModule],
  controllers: [LeaderboardController],
  providers: [LeaderboardService],
})
export class LeaderboardModule {}
