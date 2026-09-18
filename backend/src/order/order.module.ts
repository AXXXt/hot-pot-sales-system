import { Module } from '@nestjs/common'
import { OrderController } from './order.controller'
import { OrderService } from './order.service'
import { PrismaService } from '../prisma.service'
import { AuthModule } from '../auth/auth.module'
import { ProductModule } from '../product/product.module'
import { AuditModule } from '../audit/audit.module'
import { NotifyModule } from '../notify/notify.module'
import { LogisticsModule } from '../logistics/logistics.module'

@Module({
  imports: [AuthModule, ProductModule, AuditModule, NotifyModule, LogisticsModule],
  controllers: [OrderController],
  providers: [OrderService, PrismaService],
  exports: [OrderService]
})
export class OrderModule {}