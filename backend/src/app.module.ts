import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HealthController } from './health.controller'
import { AppController } from './app.controller'
import { validateEnv } from './config/env.validation'
import { PrismaService } from './prisma.service'
import { redisProvider } from './redis.provider'
import { minioProvider } from './minio.provider'
import { AuthModule } from './auth/auth.module'
import { ProductModule } from './product/product.module'
import { DashboardModule } from './dashboard/dashboard.module'
import { CustomerModule } from './customer/customer.module'
import { OrderModule } from './order/order.module'
import { UserModule } from './user/user.module'
import { AuditModule } from './audit/audit.module'
import { SystemModule } from './system/system.module'
import { UploadModule } from './upload/upload.module'
import { BrandModule } from './brand/brand.module'
import { ExportModule } from './export/export.module'
import { ImportModule } from './import/import.module'
import { MetricsModule } from './monitor/monitor.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv
    }),
    AuthModule,
    ProductModule,
    DashboardModule,
    CustomerModule,
    OrderModule,
    UserModule,
    AuditModule,
    SystemModule,
    UploadModule,
    BrandModule,
    ExportModule,
    ImportModule,
    MetricsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [PrismaService, redisProvider, minioProvider]
})
export class AppModule {}
