import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'
import { Response } from 'express'

@Catch()
export class AppFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<Response>()
    const req = ctx.getRequest<{ requestId?: string }>()
    const requestId = req.requestId || 'unknown'

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR
    const response = exception instanceof HttpException ? exception.getResponse() : null

    let message: string
    if (typeof response === 'object' && response && 'message' in response) {
      const msg = (response as any).message
      message = Array.isArray(msg) ? msg.join('; ') : String(msg)
    } else if (typeof response === 'string') {
      message = response
    } else if (exception instanceof Error) {
      message = exception.message
    } else {
      message = 'Internal server error'
    }

    const errorCode = typeof response === 'object' && response && 'errorCode' in response
      ? (response as any).errorCode
      : 'SYS_0001'

    res.status(status).json({
      code: status >= 400 ? status : 1,
      message,
      errorCode,
      data: null,
      requestId,
    })
  }
}
