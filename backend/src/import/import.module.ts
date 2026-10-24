import { Module } from '@nestjs/common'
import { ImportController } from './import.controller'
import { ImportService } from './import.service'
import { AuthModule } from '../auth/auth.module'
import { ProductModule } from '../product/product.module'

@Module({
  imports: [AuthModule, ProductModule],
  controllers: [ImportController],
  providers: [ImportService]
})
export class ImportModule {}
