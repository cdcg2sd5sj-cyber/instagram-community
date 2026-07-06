import { Controller, Post, Body } from '@nestjs/common'
import { AuthService } from './auth.service'

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  login(@Body() body: { initData: string; instagramUsername?: string }) {
    return this.authService.loginOrRegister(body.initData, body.instagramUsername)
  }
}
