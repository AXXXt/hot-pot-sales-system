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
import { PasswordController } from './password.controller'
import { PasswordService } from './password.service'
import { AuditService } from '../audit/audit.service'
import { NotificationController } from '../notify/notification.controller'
import { AuthSessionService } from './auth-session.service'

@Module({
  imports: [JwtModule.register({}), NotifyModule],
  controllers: [AuthController, PasswordController, NotificationController],
  providers: [AuthService, AuthSessionService, SmsService, PasswordService, AuditService, JwtAuthGuard, OptionalJwtAuthGuard, PermissionsGuard, StaffAccessService, redisProvider],
  exports: [JwtAuthGuard, OptionalJwtAuthGuard, PermissionsGuard, StaffAccessService, AuthService, SmsService, AuthSessionService, JwtModule]
})
export class AuthModule {}
