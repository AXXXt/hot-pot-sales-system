import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { tap } from 'rxjs'
import { MetricsService } from './metrics.service'

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp()
    const request = http.getRequest<{ originalUrl?: string; url?: string }>()
    const response = http.getResponse<{ statusCode?: number }>()
    const url = request.originalUrl || request.url || ''

    if (!url.startsWith('/api/')) return next.handle()

    return next.handle().pipe(tap({
      next: () => {
        void this.metrics.recordApi(Number(response.statusCode || 200))
      },
      error: (error: unknown) => {
        const status = typeof error === 'object' && error && 'getStatus' in error
          ? (error as { getStatus: () => number }).getStatus()
          : 500
        void this.metrics.recordApi(status)
      }
    }))
  }
}