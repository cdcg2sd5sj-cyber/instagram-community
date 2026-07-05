import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { TasksService } from './tasks.service'
import { TasksController } from './tasks.controller'

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
