import { Module } from '@nestjs/common'
import { InventoryController } from './inventory.controller'
import { InventoryService } from './inventory.service'
import { AuthModule } from '../auth/auth.module'
import { AuditModule } from '../audit/audit.module'
import { InventoryPlanningController } from './inventory-planning.controller'
import { InventoryPlanningService } from './inventory-planning.service'

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [InventoryController, InventoryPlanningController],
  providers: [InventoryService, InventoryPlanningService],
  exports: [InventoryService, InventoryPlanningService]
})
export class InventoryModule {}
