import {
  BadRequestException,
  Controller,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { ImportService } from './import.service'

const MAX_BYTES = 5 * 1024 * 1024

@ApiTags('imports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('imports')
export class ImportController {
  constructor(private readonly service: ImportService) {}

  @Post('products')
  @RequirePermissions('product:update')
  @ApiOperation({ summary: 'Excel 批量导入商品（品牌/商品/SKU/协议价）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } }
    }
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async importProducts(
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Req() req: any,
    @Query('customerPhone') customerPhone?: string
  ) {
    if (!file?.buffer) {
      throw new BadRequestException({ message: '请上传 Excel 文件', errorCode: 'IMP_1002' })
    }
    return this.service.importProducts(file.buffer, req.user?.tenantId || 1, customerPhone)
  }
}