import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { SmsService } from './sms.service'
import { JwtAuthGuard, OptionalJwtAuthGuard } from './auth.guard'
import { PrismaService } from '../prisma.service'
import { redisProvider } from '../redis.provider'

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, SmsService, JwtAuthGuard, OptionalJwtAuthGuard, PrismaService, redisProvider],
  exports: [JwtAuthGuard, OptionalJwtAuthGuard, AuthService, SmsService, JwtModule, PrismaService]
})
export class AuthModule {}
