import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common'
import { TasksService } from './tasks.service'
import { JwtAuthGuard } from '../common/jwt-auth.guard'

@Controller('tasks')
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @Get('next')
  @UseGuards(JwtAuthGuard)
  getNext(@Request() req: any) {
    return this.tasksService.getNextTask(req.user.sub)
  }

  @Post('complete')
  @UseGuards(JwtAuthGuard)
  complete(
    @Request() req: any,
    @Body() body: { campaignId: number; comment: string; reelsUrl: string },
  ) {
    return this.tasksService.completeTask(req.user.sub, body.campaignId, body.comment, body.reelsUrl)
  }
}
