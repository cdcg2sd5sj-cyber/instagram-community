import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const authHeader: string | undefined = request.headers['authorization']

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Токен авторизации отсутствует')
    }

    const token = authHeader.slice('Bearer '.length)

    try {
      const payload = this.jwtService.verify(token)
      // sub = внутренний id пользователя в БД (см. auth.service.ts)
      request.user = { id: payload.sub, telegramId: payload.tgId }
      return true
    } catch {
      throw new UnauthorizedException('Токен недействителен или истёк')
    }
  }
}
