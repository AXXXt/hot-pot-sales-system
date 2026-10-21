import { Module } from '@nestjs/common'
import { UserController } from './user.controller'
import { UserService } from './user.service'
import { AuthModule } from '../auth/auth.module'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [UserController],
  providers: [UserService]
})
export class UserModule {}
