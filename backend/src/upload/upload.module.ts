import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { productImageClientProvider } from './product-image-client.provider'
import { ProductImageStorageService } from './product-image-storage.service'
import { UploadController } from './upload.controller'
import { PrismaService } from '../prisma.service'

@Module({
  imports: [AuthModule],
  controllers: [UploadController],
  providers: [productImageClientProvider, ProductImageStorageService, PrismaService]
})
export class UploadModule {}
