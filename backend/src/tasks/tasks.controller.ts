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

  @Post('report')
  @UseGuards(JwtAuthGuard)
  report(@Request() req: any, @Body() body: { campaignId: number }) {
    return this.tasksService.reportTask(req.user.sub, Number(body?.campaignId))
  }

  @Post('open')
  @UseGuards(JwtAuthGuard)
  open(@Request() req: any, @Body() body: { campaignId: number }) {
    return this.tasksService.startTask(req.user.sub, Number(body?.campaignId))
  }

  @Post('complete')
  @UseGuards(JwtAuthGuard)
  complete(
    @Request() req: any,
    @Body() body: { campaignId: number; comment?: string; reelsUrl: string },
  ) {
    return this.tasksService.completeTask(req.user.sub, body.campaignId, body.comment, body.reelsUrl)
  }
}
