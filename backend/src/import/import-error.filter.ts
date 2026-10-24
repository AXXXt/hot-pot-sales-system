import { ArgumentsHost, Catch, HttpException } from '@nestjs/common'
import { AppFilter } from '../app.filter'

/** 只为本导入接口返回受控行错误，不放宽全局异常数据输出。 */
@Catch(HttpException)
export class ImportErrorFilter extends AppFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const body = exception.getResponse() as { message?: string; errorCode?: string; errors?: Array<{ row: number; message: string }>; errorCount?: number }
    if (!body || !['IMP_1002', 'IMP_1003'].includes(body.errorCode || '') || !Array.isArray(body.errors)) return super.catch(exception, host)
    const errors = body.errors.filter(error => Number.isSafeInteger(error.row) && error.row > 0 && typeof error.message === 'string')
      .slice(0, 20).map(error => ({ row: error.row, message: error.message.slice(0, 255) }))
    const ctx = host.switchToHttp(), request = ctx.getRequest<{ requestId?: string }>()
    ctx.getResponse().status(exception.getStatus()).json({ code: exception.getStatus(), message: body.message || '导入失败', errorCode: body.errorCode,
      data: { errors, errorCount: Number.isSafeInteger(body.errorCount) ? body.errorCount : errors.length }, requestId: request.requestId || 'unknown' })
  }
}
