import { MetricsService } from '../src/monitor/metrics.service'
import { OrderService } from '../src/order/order.service'
import { BadRequestException } from '@nestjs/common'

describe('MetricsService', () => {
  function createSubject(options: { apiErrorRate?: number; minApiRequests?: number } = {}) {
    const store = new Map<string, string>()
    const redis = {
      incr: jest.fn(async (key: string) => {
        const next = Number(store.get(key) || 0) + 1
        store.set(key, String(next))
        return next
      }),
      expire: jest.fn(async () => 1),
      get: jest.fn(async (key: string) => store.get(key) || null),
      exists: jest.fn(async (key: string) => (store.has(key) ? 1 : 0)),
      set: jest.fn(async (key: string, value: string) => {
        store.set(key, value)
        return 'OK' as const
      }),
      lpush: jest.fn(async () => 1),
      ltrim: jest.fn(async () => 'OK' as const),
      lrange: jest.fn(async () => [])
    }
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'MONITOR_API_ERROR_RATE') return options.apiErrorRate
        if (key === 'MONITOR_MIN_API_REQUESTS') return options.minApiRequests
        return undefined
      })
    }
    return {
      redis,
      store,
      service: new MetricsService(redis as any, config as any)
    }
  }

  it('records API totals and only counts HTTP 5xx as server errors', async () => {
    const { redis, service } = createSubject()

    await service.recordApi(200)
    await service.recordApi(404)
    await service.recordApi(502)

    expect(redis.incr).toHaveBeenCalledTimes(4)
    expect(redis.expire).toHaveBeenCalledTimes(4)
    const summary = await service.getSummary()
    expect(summary.api).toMatchObject({ requests: 3, serverErrors: 1, errorRate: 33.33 })
  })

  it('raises an API error-rate alert once within the cooldown window', async () => {
    const { redis, service } = createSubject({ apiErrorRate: 5, minApiRequests: 1 })

    await service.recordApi(200)
    await service.recordApi(500)
    const first = await service.evaluateOnce()
    const second = await service.evaluateOnce()

    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ type: 'api_error_rate', severity: 'critical' })
    expect(second).toHaveLength(0)
    expect(redis.lpush).toHaveBeenCalledWith('monitor:alerts', expect.stringContaining('api_error_rate'))
    expect(redis.ltrim).toHaveBeenCalledWith('monitor:alerts', 0, 99)
  })

  it('records every inventory deduction failure and immediately creates an alert', async () => {
    const { redis, service } = createSubject()

    await service.recordInventoryFailure('库存不足：牛肉卷')

    expect(redis.incr).toHaveBeenCalledWith(expect.stringContaining('inventory'))
    expect(redis.lpush).toHaveBeenCalledWith('monitor:alerts', expect.stringContaining('inventory_failure'))
  })
})

describe('OrderService monitoring hooks', () => {
  const metrics = {
    recordApi: jest.fn(),
    recordOrderAttempt: jest.fn(),
    recordOrderFailure: jest.fn(),
    recordInventoryFailure: jest.fn()
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('counts both failed order creation attempts', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ customerId: 3, userType: 'customer_user' }) },
      customer: { findUnique: jest.fn().mockResolvedValue({ id: 3, status: 'active' }) },
      productSku: { findMany: jest.fn().mockResolvedValue([]) }
    }
    const service = new OrderService(
      prisma as any,
      { whereForCustomer: jest.fn().mockResolvedValue({}) } as any,
      { write: jest.fn() } as any,
      {} as any,
      {} as any,
      metrics as any
    )

    await expect(service.create({ customerId: 3, items: [{ skuId: 1, quantity: 1 }] }, 9))
      .rejects.toBeInstanceOf(BadRequestException)

    expect(metrics.recordOrderAttempt).toHaveBeenCalledTimes(1)
    expect(metrics.recordOrderFailure).toHaveBeenCalledTimes(1)
  })

  it('counts a stock deduction failure during finance approval', async () => {
    const order = { id: 100, status: 'pending_finance', items: [{ skuId: 11, quantity: 3, productName: '牛肉卷' }] }
    const tx = {
      productSku: { findUnique: jest.fn().mockResolvedValue({ id: 11, stockNum: 1 }) },
      order: { update: jest.fn() }
    }
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ userType: 'admin' }) },
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      $transaction: jest.fn(async (callback: any) => callback(tx))
    }
    const service = new OrderService(
      prisma as any,
      {} as any,
      { write: jest.fn() } as any,
      {} as any,
      {} as any,
      metrics as any
    )

    await expect(service.approveFinance(100, 9)).rejects.toBeInstanceOf(BadRequestException)
    expect(metrics.recordInventoryFailure).toHaveBeenCalledTimes(1)
  })
})