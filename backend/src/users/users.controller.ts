import { Controller, Get, UseGuards, Request } from '@nestjs/common'
import { UsersService } from './users.service'
import { JwtAuthGuard } from '../common/jwt-auth.guard'

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@Request() req: any) {
    return this.usersService.getProfile(req.user.sub)
  }
}
