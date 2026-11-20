import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { JwtAuthGuard } from '../common/jwt-auth.guard'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  imports: [
    JwtModule.register({
      // Обязателен: проверка при старте в main.ts — без него сервер не запустится.
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '30d' },
    }),
    NotificationsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtAuthGuard, JwtModule],
})
export class AuthModule {}
