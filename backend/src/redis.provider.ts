import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { Injectable, OnApplicationShutdown } from '@nestjs/common'

export const REDIS = Symbol('REDIS')

@Injectable()
export class RedisConnection implements OnApplicationShutdown {
  readonly client: Redis

  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null
    })
  }

  async ping(): Promise<string> {
    try {
      if (this.client.status === 'wait') await this.client.connect()
      return await this.client.ping()
    } catch {
      return 'DOWN'
    }
  }

  async onApplicationShutdown() {
    if (this.client.status !== 'end') {
      await this.client.quit().catch(() => this.client.disconnect())
    }
  }
}

export const redisProvider = {
  provide: REDIS,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    return new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: false,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 200, 3000)
    })
  }
}
