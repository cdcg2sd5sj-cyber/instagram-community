import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'

async function bootstrap() {
  // Без секрета токены можно было бы подделать — лучше вообще не стартовать.
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'secret') {
    throw new Error('JWT_SECRET is not set (or is the insecure default). Refusing to start.')
  }

  const app = await NestFactory.create(AppModule)

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
