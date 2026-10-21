import { Module } from '@nestjs/common'
import { LeadController } from './lead.controller'
import { LeadService } from './lead.service'
import { AuditModule } from '../audit/audit.module'
import { AuthModule } from '../auth/auth.module'
import { redisProvider } from '../redis.provider'

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [LeadController],
  providers: [LeadService, redisProvider]
})
export class LeadModule {}
