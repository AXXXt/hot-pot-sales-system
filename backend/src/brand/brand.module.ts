import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PrismaService } from '../prisma.service'
import { BrandController } from './brand.controller'
import { BrandService } from './brand.service'

@Module({
  imports: [AuthModule],
  controllers: [BrandController],
  providers: [BrandService, PrismaService],
  exports: [BrandService]
})
export class BrandModule {}
