import { Module } from '@nestjs/common'
import { DashboardController } from './dashboard.controller'
import { DashboardService } from './dashboard.service'
import { AuthModule } from '../auth/auth.module'
import { InventoryModule } from '../inventory/inventory.module'

@Module({
  imports: [AuthModule, InventoryModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
