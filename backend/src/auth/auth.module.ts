import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { SmsService } from './sms.service'
import { JwtAuthGuard, OptionalJwtAuthGuard } from './auth.guard'
import { PermissionsGuard } from './permissions.guard'
import { NotifyModule } from '../notify/notify.module'
import { redisProvider } from '../redis.provider'
import { StaffAccessService } from './staff-access.service'

@Module({
  imports: [JwtModule.register({}), NotifyModule],
  controllers: [AuthController],
  providers: [AuthService, SmsService, JwtAuthGuard, OptionalJwtAuthGuard, PermissionsGuard, StaffAccessService, redisProvider],
  exports: [JwtAuthGuard, OptionalJwtAuthGuard, PermissionsGuard, StaffAccessService, AuthService, SmsService, JwtModule]
})
export class AuthModule {}
