import { Module } from '@nestjs/common'
import { InventoryController } from './inventory.controller'
import { InventoryService } from './inventory.service'
import { AuthModule } from '../auth/auth.module'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService]
})
export class InventoryModule {}
