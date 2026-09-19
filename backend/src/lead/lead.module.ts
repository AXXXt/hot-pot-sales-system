import { Module } from '@nestjs/common'
import { LeadController } from './lead.controller'
import { LeadService } from './lead.service'
import { AuditModule } from '../audit/audit.module'
import { AuthModule } from '../auth/auth.module'
import { PrismaService } from '../prisma.service'
import { redisProvider } from '../redis.provider'

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [LeadController],
  providers: [LeadService, PrismaService, redisProvider]
})
export class LeadModule {}
