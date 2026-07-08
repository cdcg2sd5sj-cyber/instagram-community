import { Controller, Get, Query, Req } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { LeaderboardService, LeaderboardPeriod } from './leaderboard.service'

@Controller('leaderboard')
export class LeaderboardController {
  constructor(
    private leaderboardService: LeaderboardService,
    private jwtService: JwtService,
  ) {}

  @Get()
  getLeaderboard(@Query('period') period: string, @Req() req: any) {
    const validPeriod: LeaderboardPeriod =
      period === 'week' || period === 'month' || period === 'all' ? period : 'week'

    return this.leaderboardService.getLeaderboard(validPeriod, this.getUserIdIfAuthenticated(req))
  }

  private getUserIdIfAuthenticated(req: any): number | undefined {
    const authHeader: string | undefined = req.headers['authorization']
    if (!authHeader?.startsWith('Bearer ')) return undefined

    try {
      const payload = this.jwtService.verify(authHeader.slice('Bearer '.length))
      return payload.sub
    } catch {
      return undefined
    }
  }
}
