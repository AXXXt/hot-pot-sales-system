import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { AuthModule } from '../auth/auth.module'
import { redisProvider } from '../redis.provider'
import { MetricsService } from './metrics.service'
import { MetricsInterceptor } from './metrics.interceptor'
import { MonitorController } from './monitor.controller'

@Module({
  imports: [AuthModule],
  controllers: [MonitorController],
  providers: [
    redisProvider,
    MetricsService,
    MetricsInterceptor,
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }
  ],
  exports: [MetricsService]
})
export class MetricsModule {}