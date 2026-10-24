import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/auth.guard'
import { ServiceRequestService } from './service-request.service'
import { CreateServiceRequestDto, ProcessServiceRequestDto, ServiceOrderQuery, ServiceRequestQuery } from './service-request.dto'

@Controller('service-requests')
@UseGuards(JwtAuthGuard)
export class ServiceRequestController {
  constructor(private readonly service: ServiceRequestService) {}
  @Get('order-options') orderOptions(@Req() req: any, @Query() query: ServiceOrderQuery) { return this.service.orderOptions(Number(req.user.sub), query) }
  @Get('mine') mine(@Req() req: any, @Query() query: ServiceRequestQuery) { return this.service.mine(Number(req.user.sub), query) }
  @Get('mine/:id') myDetail(@Req() req: any, @Param('id', ParseIntPipe) id: number) { return this.service.myDetail(Number(req.user.sub), id) }
  @Post('mine') create(@Req() req: any, @Body() dto: CreateServiceRequestDto) { return this.service.create(Number(req.user.sub), dto) }
  @Get() list(@Req() req: any, @Query() query: ServiceRequestQuery) { return this.service.management(Number(req.user.sub), query) }
  @Get(':id') detail(@Req() req: any, @Param('id', ParseIntPipe) id: number) { return this.service.managementDetail(Number(req.user.sub), id) }
  @Patch(':id') process(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() dto: ProcessServiceRequestDto) { return this.service.process(Number(req.user.sub), id, dto) }
}
