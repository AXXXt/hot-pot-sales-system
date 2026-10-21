import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { BrandController } from './brand.controller'
import { BrandService } from './brand.service'

@Module({
  imports: [AuthModule],
  controllers: [BrandController],
  providers: [BrandService],
  exports: [BrandService]
})
export class BrandModule {}
