import { Controller, Get, UseGuards, Request, Param, ParseIntPipe, Res, NotFoundException } from '@nestjs/common'
import { Response } from 'express'
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

  // Публичный: <img> не умеет слать токен. Отдаём только фото профиля, которое и так публично в Instagram.
  @Get(':id/avatar')
  async getAvatar(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const avatar = await this.usersService.getAvatar(id)
    if (!avatar?.avatarImage) throw new NotFoundException()
    res.set({
      'Content-Type': avatar.avatarContentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=604800',
    })
    res.send(Buffer.from(avatar.avatarImage))
  }
}
