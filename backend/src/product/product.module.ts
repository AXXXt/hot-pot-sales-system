import { Module } from '@nestjs/common'
import { ProductController } from './product.controller'
import { ProductService } from './product.service'
import { redisProvider } from '../redis.provider'
import { AuthModule } from '../auth/auth.module'
import { AuditModule } from '../audit/audit.module'
import { ProductVisibilityService } from './product-visibility.service'
import { ProductMutationGuard } from './product-mutation.guard'

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [ProductController],
  providers: [ProductService, ProductVisibilityService, ProductMutationGuard, redisProvider],
  exports: [ProductService, ProductVisibilityService]
})
export class ProductModule {}
