import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { REDIS } from '../redis.provider'

export type MonitorAlertType = 'api_error_rate' | 'order_failure_rate' | 'inventory_failure'

export interface MonitorAlert {
  id: string
  type: MonitorAlertType
  severity: 'warning' | 'critical'
  message: string
  value: number
  threshold: number
  createdAt: string
}

interface RedisLike {
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
  get(key: string): Promise<string | null>
  exists(...keys: string[]): Promise<number>
  set(key: string, value: string, mode: 'EX', duration: number): Promise<'OK' | null>
  lpush(key: string, value: string): Promise<number>
  ltrim(key: string, start: number, stop: number): Promise<'OK'>
  lrange(key: string, start: number, stop: number): Promise<string[]>
}

const ALERT_LIST_KEY = 'monitor:alerts'
const ALERT_HISTORY_LIMIT = 100
const WINDOW_MINUTES = 5

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name)
  private evaluator?: NodeJS.Timeout

  constructor(
    @Inject(REDIS) private readonly redis: RedisLike,
    private readonly config: ConfigService
  ) {}

  onModuleInit() {
    const intervalMs = Math.max(10, this.getNumber('MONITOR_INTERVAL_SECONDS', 60)) * 1000
    this.evaluator = setInterval(() => {
      void this.evaluateOnce()
    }, intervalMs)
  }

  onModuleDestroy() {
    if (this.evaluator) clearInterval(this.evaluator)
  }

  async recordApi(status: number): Promise<void> {
    const bucket = this.currentBucket()
    const total = this.key('api', bucket, 'total')
    await this.safeIncr(total)
    if (status >= 500) {
      await this.safeIncr(this.key('api', bucket, 'server_errors'))
    }
  }

  async recordOrderAttempt(): Promise<void> {
    await this.safeIncr(this.key('order', this.currentBucket(), 'attempts'))
  }

  async recordOrderFailure(): Promise<void> {
    await this.safeIncr(this.key('order', this.currentBucket(), 'failures'))
  }

  async recordInventoryFailure(reason = '库存扣减失败'): Promise<void> {
    await this.safeIncr(this.key('inventory', this.currentBucket(), 'failures'))
    await this.createAlert('inventory_failure', reason, 1, 1, 'warning')
  }

  async getSummary(): Promise<{
    windowMinutes: number
    api: { requests: number; serverErrors: number; errorRate: number }
    order: { attempts: number; failures: number; failureRate: number }
    inventory: { failures: number }
    thresholds: Record<string, number>
  }> {
    const metrics = await this.readWindow()
    const apiErrorRate = this.rate(metrics.api.serverErrors, metrics.api.requests)
    const orderFailureRate = this.rate(metrics.order.failures, metrics.order.attempts)
    return {
      windowMinutes: WINDOW_MINUTES,
      api: { ...metrics.api, errorRate: apiErrorRate },
      order: { ...metrics.order, failureRate: orderFailureRate },
      inventory: metrics.inventory,
      thresholds: this.thresholds()
    }
  }

  async getAlerts(limit = 20): Promise<MonitorAlert[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 100)
    try {
      const rows = await this.redis.lrange(ALERT_LIST_KEY, 0, safeLimit - 1)
      return rows.map(row => JSON.parse(row) as MonitorAlert).filter(item => item && item.type)
    } catch (error) {
      this.logger.warn(`读取告警历史失败: ${this.errorMessage(error)}`)
      return []
    }
  }

  async evaluateOnce(): Promise<Array<MonitorAlert>> {
    const summary = await this.getSummary()
    const threshold = this.thresholds()
    const alerts: MonitorAlert[] = []

    if (summary.api.requests >= threshold.minApiRequests && summary.api.errorRate > threshold.apiErrorRate) {
      const alert = await this.createAlert(
        'api_error_rate',
        `API 5xx 错误率 ${summary.api.errorRate}% 超过阈值 ${threshold.apiErrorRate}%`,
        summary.api.errorRate,
        threshold.apiErrorRate,
        'critical'
      )
      if (alert) alerts.push(alert)
    }

    if (summary.order.attempts >= threshold.minOrderAttempts && summary.order.failureRate > threshold.orderFailureRate) {
      const alert = await this.createAlert(
        'order_failure_rate',
        `订单失败率 ${summary.order.failureRate}% 超过阈值 ${threshold.orderFailureRate}%`,
        summary.order.failureRate,
        threshold.orderFailureRate,
        'critical'
      )
      if (alert) alerts.push(alert)
    }

    return alerts
  }

  private async createAlert(
    type: MonitorAlertType,
    message: string,
    value: number,
    threshold: number,
    severity: MonitorAlert['severity']
  ): Promise<MonitorAlert | null> {
    const cooldownSeconds = Math.max(10, this.getNumber('MONITOR_ALERT_COOLDOWN_SECONDS', 600))
    const cooldownKey = `monitor:cooldown:${type}`
    const alert: MonitorAlert = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      type,
      severity,
      message,
      value,
      threshold,
      createdAt: new Date().toISOString()
    }

    try {
      const cooling = await this.redis.exists(cooldownKey)
      if (cooling) return null

      await this.redis.set(cooldownKey, alert.id, 'EX', cooldownSeconds)
      await this.redis.lpush(ALERT_LIST_KEY, JSON.stringify(alert))
      await this.redis.ltrim(ALERT_LIST_KEY, 0, ALERT_HISTORY_LIMIT - 1)
      this.logger.error(`[MONITOR_ALERT] ${type}: ${message}`)
    } catch (error) {
      this.logger.warn(`写入告警失败: ${this.errorMessage(error)}`)
    }
    return alert
  }

  private async readWindow() {
    const buckets = Array.from({ length: WINDOW_MINUTES }, (_, index) => this.bucketAt(index))
    const names = buckets.flatMap(bucket => [
      this.key('api', bucket, 'total'),
      this.key('api', bucket, 'server_errors'),
      this.key('order', bucket, 'attempts'),
      this.key('order', bucket, 'failures'),
      this.key('inventory', bucket, 'failures')
    ])

    try {
      const values = await Promise.all(names.map(name => this.redis.get(name)))
      const valueAt = (index: number) => Number(values[index] || 0)
      return buckets.reduce((acc, _, bucketIndex) => {
        const offset = bucketIndex * 5
        acc.api.requests += valueAt(offset)
        acc.api.serverErrors += valueAt(offset + 1)
        acc.order.attempts += valueAt(offset + 2)
        acc.order.failures += valueAt(offset + 3)
        acc.inventory.failures += valueAt(offset + 4)
        return acc
      }, {
        api: { requests: 0, serverErrors: 0 },
        order: { attempts: 0, failures: 0 },
        inventory: { failures: 0 }
      })
    } catch (error) {
      this.logger.warn(`读取监控指标失败: ${this.errorMessage(error)}`)
      return {
        api: { requests: 0, serverErrors: 0 },
        order: { attempts: 0, failures: 0 },
        inventory: { failures: 0 }
      }
    }
  }

  private thresholds() {
    return {
      apiErrorRate: this.getNumber('MONITOR_API_ERROR_RATE', 5),
      minApiRequests: this.getNumber('MONITOR_MIN_API_REQUESTS', 20),
      orderFailureRate: this.getNumber('MONITOR_ORDER_FAILURE_RATE', 20),
      minOrderAttempts: this.getNumber('MONITOR_MIN_ORDER_ATTEMPTS', 10)
    }
  }

  private rate(value: number, total: number) {
    if (total <= 0) return 0
    return Math.round((value / total) * 10000) / 100
  }

  private safeIncr(key: string): Promise<void> {
    return (async () => {
      await this.redis.incr(key)
      await this.redis.expire(key, 600)
    })().catch(error => {
      this.logger.warn(`写入监控指标失败: ${this.errorMessage(error)}`)
    })
  }

  private key(metric: string, bucket: string, name: string) {
    return `monitor:${metric}:${bucket}:${name}`
  }

  private currentBucket() {
    return this.bucketAt(0)
  }

  private bucketAt(minutesAgo: number) {
    const time = new Date(Date.now() - minutesAgo * 60_000)
    return `${time.getUTCFullYear()}${String(time.getUTCMonth() + 1).padStart(2, '0')}${String(time.getUTCDate()).padStart(2, '0')}${String(time.getUTCHours()).padStart(2, '0')}${String(time.getUTCMinutes()).padStart(2, '0')}`
  }

  private getNumber(key: string, defaultValue: number) {
    const value = Number(this.config.get<string | number>(key))
    return Number.isFinite(value) && value > 0 ? value : defaultValue
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
}