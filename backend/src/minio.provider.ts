import { ConfigService } from '@nestjs/config'

export const MINIO = Symbol('MINIO')

export const minioProvider = {
  provide: MINIO,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const protocol = config.get<string>('MINIO_USE_SSL') === 'true' ? 'https' : 'http'
    const endpoint = config.getOrThrow<string>('MINIO_ENDPOINT')
    const port = config.getOrThrow<string>('MINIO_PORT')
    const healthUrl = `${protocol}://${endpoint}:${port}/minio/health/live`

    return {
      endpoint,
      health: async () => {
        try {
          const response = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) })
          return response.ok
        } catch {
          return false
        }
      }
    }
  }
}
