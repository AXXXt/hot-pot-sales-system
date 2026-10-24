import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseFilters,
  UseInterceptors
} from '@nestjs/common'
import { Response } from 'express'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { RequirePermissions } from '../auth/require-permissions.decorator'
import { ImportService } from './import.service'
import { StaffAccessService } from '../auth/staff-access.service'
import { ImportErrorFilter } from './import-error.filter'

const MAX_BYTES = 5 * 1024 * 1024

@ApiTags('imports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('imports')
export class ImportController {
  constructor(private readonly service: ImportService, private readonly access: StaffAccessService) {}

  @Get('products/template')
  @RequirePermissions('product:update')
  @ApiOperation({ summary: '下载标准商品导入xlsx模板（空表头与说明）' })
  async template(@Req() req: any, @Res() res: Response) {
    const buffer = await this.service.productTemplate(await this.access.actor(Number(req.user?.sub)))
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="weiduoxian-products-template.xlsx"')
    res.setHeader('Cache-Control', 'no-store')
    res.send(buffer)
  }

  @Post('products')
  @UseFilters(new ImportErrorFilter())
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
    @Query('customerPhone') customerPhone?: string,
    @Query('customerId') customerId?: string
  ) {
    if (!file?.buffer) {
      throw new BadRequestException({ message: '请上传 Excel 文件', errorCode: 'IMP_1002' })
    }
    if (customerId !== undefined && !/^[1-9]\d*$/.test(customerId)) throw new BadRequestException('客户ID须为正整数')
    return this.service.importProducts(file.buffer, await this.access.actor(Number(req.user?.sub)), customerPhone, customerId === undefined ? undefined : Number(customerId))
  }
}
