import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags
} from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { ProductImageStorageService } from './product-image-storage.service'
import {
  PRODUCT_IMAGE_MAX_BYTES,
  ProductImageFile,
  validatePaymentProof,
  validateProductImageContent
} from './product-image.validation'

@ApiTags('Uploads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('uploads')
export class UploadController {
  constructor(private readonly storage: ProductImageStorageService) {}

  @Get('payment-proof-url')
  @ApiOperation({ summary: '获取转账凭证签名访问地址（私有读）' })
  @ApiQuery({ name: 'key', required: true, description: '凭证 objectKey 或完整地址' })
  async paymentProofUrl(@Query('key') key: string, @Req() req: any) {
    return this.storage.getPaymentProofSignedUrl(key, Number(req.user.sub))
  }

  @Post('payment-proof')
  @ApiOperation({ summary: '上传转账凭证' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'JPG、PNG 或 WebP，最大 5MB'
        }
      }
    }
  })
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: PRODUCT_IMAGE_MAX_BYTES }
  }))
  async uploadPaymentProof(@Req() req: any, @UploadedFile() file?: ProductImageFile) {
    const image = await validatePaymentProof(file)
    return this.storage.uploadPaymentProof(file!.buffer, image.mimetype, image.extension, Number(req.user.sub))
  }

  @Post('product-image')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('product:update')
  @ApiOperation({ summary: '上传商品主图' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'JPG、PNG 或 WebP，最大 5MB'
        }
      }
    }
  })
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: PRODUCT_IMAGE_MAX_BYTES }
  }))
  async uploadProductImage(@UploadedFile() file?: ProductImageFile) {
    const image = await validateProductImageContent(file)
    return this.storage.uploadProductImage(file!.buffer, image.mimetype, image.extension)
  }
}
