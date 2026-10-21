import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { StaffAccessService } from '../auth/staff-access.service'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { InventoryPlanningService } from './inventory-planning.service'
import { BatchReceiptDto } from './dto/inventory.dto'

class PlanItemDto { @IsInt() @Min(1) skuId: number; @IsInt() @Min(1) @Max(2147483647) quantity: number }
class PlanDto { @IsUUID('4') requestId: string; @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => PlanItemDto) items: PlanItemDto[] }
class PlanStatusDto { @IsIn(['ordered', 'closed', 'cancelled']) status: string; @IsString() updatedAt: string }
class AssignBatchDto extends BatchReceiptDto { @IsInt() @Min(1) fromBatchId: number; @IsInt() @Min(1) @Max(2147483647) quantity: number }

@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryPlanningController {
  constructor(private readonly service: InventoryPlanningService, private readonly access: StaffAccessService) {}
  @Get('planning') @RequirePermissions('inventory:read')
  async overview(@Req() req: any, @Query('keyword') keyword?: string) { return this.service.overview(await this.access.actor(req.user.sub), keyword) }
  @Get('batches') @RequirePermissions('inventory:read')
  async batches(@Req() req: any, @Query('skuId', new ParseIntPipe({ optional: true })) skuId?: number) { return this.service.batches(await this.access.actor(req.user.sub), skuId) }
  @Post('batches/assign') @RequirePermissions('inventory:adjust')
  async assign(@Req() req: any, @Body() dto: AssignBatchDto) { return this.service.assignBatch(await this.access.actor(req.user.sub), dto) }
  @Get('replenishment-plans') @RequirePermissions('inventory:read')
  async plans(@Req() req: any) { return this.service.plans(await this.access.actor(req.user.sub)) }
  @Post('replenishment-plans') @RequirePermissions('inventory:adjust')
  async create(@Req() req: any, @Body() dto: PlanDto) { return this.service.createPlan(await this.access.actor(req.user.sub), dto) }
  @Patch('replenishment-plans/:id') @RequirePermissions('inventory:adjust')
  async update(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() dto: PlanStatusDto) { return this.service.updatePlan(await this.access.actor(req.user.sub), id, dto.status, dto.updatedAt) }
}
