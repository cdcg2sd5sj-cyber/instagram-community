import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { TasksService } from './tasks.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { CompleteTaskDto } from './dto/complete-task.dto'

@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @Get('next')
  async next(@CurrentUser('id') userId: number) {
    return this.tasksService.getNextTask(userId)
  }

  @Post('complete')
  async complete(@CurrentUser('id') userId: number, @Body() dto: CompleteTaskDto) {
    return this.tasksService.completeTask(userId, dto.campaignId, dto.comment)
  }
}
