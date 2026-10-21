import { Module } from '@nestjs/common'
import { CustomerController } from './customer.controller'
import { CustomerService } from './customer.service'
import { AuthModule } from '../auth/auth.module'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [CustomerController],
  providers: [CustomerService]
})
export class CustomerModule {}
