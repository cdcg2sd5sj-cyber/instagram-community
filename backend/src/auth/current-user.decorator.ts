import { createParamDecorator, ExecutionContext } from '@nestjs/common'

/** Использование: completeTask(@CurrentUser('id') userId: number) */
export const CurrentUser = createParamDecorator(
  (field: 'id' | 'telegramId' | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest()
    const user = request.user
    return field ? user?.[field] : user
  },
)
