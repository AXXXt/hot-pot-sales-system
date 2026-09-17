import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common'
import { PrismaService } from './prisma.service'
import { REDIS } from './redis.provider'
import { MINIO } from './minio.provider'

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: { ping: () => Promise<string> },
    @Inject(MINIO) private readonly minio: { health: () => Promise<boolean> }
  ) {}

  @Get('health')
  health() {
    return { status: 'ok' }
  }

  @Get('health/ready')
  async ready() {
    const checks = await Promise.allSettled([
      this.prisma.ping(),
      this.redis.ping(),
      this.minio.health()
    ])
    const db = checks[0].status === 'fulfilled' && checks[0].value
    const redis = checks[1].status === 'fulfilled' && checks[1].value === 'PONG'
    const minio = checks[2].status === 'fulfilled' && checks[2].value
    if (!db || !redis || !minio) {
      throw new ServiceUnavailableException({ message: 'ready check failed', errorCode: 'SYS_0002' })
    }
    return { status: 'ready', checks: { database: 'ok', redis: 'ok', minio: 'ok' } }
  }
}
