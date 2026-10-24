import { Controller, Get, Patch, Param, ParseIntPipe, Query, Req, UseGuards } from '@nestjs/common'
import { Type } from 'class-transformer'
import { IsInt, Max, Min } from 'class-validator'
import { JwtAuthGuard } from '../auth/auth.guard'
import { OrderNotificationService } from './order-notification.service'

class NotificationQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000)
  page = 1

  @Type(() => Number) @IsInt() @Min(1) @Max(50)
  pageSize = 20
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notifications: OrderNotificationService) {}

  @Get()
  list(@Req() req: any, @Query() query: NotificationQuery) {
    return this.notifications.list(Number(req.user.sub), query.page, query.pageSize)
  }

  @Patch('read-all')
  readAll(@Req() req: any) { return this.notifications.readAll(Number(req.user.sub)) }

  @Patch(':id/read')
  read(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.notifications.read(Number(req.user.sub), id)
  }
}
