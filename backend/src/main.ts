import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'

async function bootstrap() {
  // Без секрета токены можно было бы подделать — лучше вообще не стартовать.
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'secret') {
    throw new Error('JWT_SECRET is not set (or is the insecure default). Refusing to start.')
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  // Проверка перед публикацией присылает до 3 картинок в base64 — стандартных 100 КБ мало.
  app.useBodyParser('json', { limit: '8mb' })

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  )

  app.enableCors({
    origin: process.env.FRONTEND_URL || true,
    credentials: true,
  })

  await app.listen(process.env.PORT || 3000)
  console.log('Server running on port', process.env.PORT || 3000)
}
bootstrap()
