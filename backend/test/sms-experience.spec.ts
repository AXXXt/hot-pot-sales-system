import { ConfigService } from '@nestjs/config'
import { SmsService } from '../src/auth/sms.service'
import { validateEnv } from '../src/config/env.validation'

describe('temporary experience SMS', () => {
  const phone = '13937802005'
  const now = Date.parse('2026-10-02T00:00:00Z')
  const settings = {
    SMS_PROVIDER: 'experience',
    SMS_TEST_PHONES: `18137222005, ${phone},15890322005,13060070064`,
    SMS_TEST_EXPIRES_AT: '2026-10-08T00:00:00Z'
  }

  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now) })
  afterEach(() => jest.useRealTimers())

  function setup(overrides: Record<string, string | undefined> = {}) {
    const values = new Map<string, { value: string; expiresAt: number }>()
    const redis = {
      get: jest.fn(async (key: string) => {
        const entry = values.get(key)
        return entry && entry.expiresAt > Date.now() ? entry.value : null
      }),
      set: jest.fn(async (key: string, value: string, _mode?: string, ttl = 300) => {
        values.set(key, { value, expiresAt: Date.now() + ttl * 1000 })
        return 'OK' as const
      }),
      del: jest.fn(async (key: string) => Number(values.delete(key)))
    }
    const config = new ConfigService({ ...settings, ...overrides })
    return { service: new SmsService(config, redis), redis }
  }

  test('requires requesting a code and accepts 123456 only once', async () => {
    const { service, redis } = setup()
    await expect(service.verifyCode(phone, '123456')).resolves.toBe(false)
    await service.sendCode(phone, '127.0.0.1')
    expect(redis.set).toHaveBeenCalledWith(`sms:experience:code:${phone}`, '123456', 'EX', 300)
    await expect(service.verifyCode(phone, '000000')).resolves.toBe(false)
    await expect(service.verifyCode(phone, '123456')).resolves.toBe(true)
    await expect(service.verifyCode(phone, '123456')).resolves.toBe(false)
  })

  test.each(['18137222005', '15890322005', '13060070064'])('allows the configured phone %s', async allowed => {
    const { service } = setup()
    await service.sendCode(allowed, '127.0.0.1')
    await expect(service.verifyCode(allowed, '123456')).resolves.toBe(true)
  })

  test('blocks sending and verifying for unlisted phones before Redis access', async () => {
    const { service, redis } = setup()
    await expect(service.sendCode('13800000000', '127.0.0.1')).rejects.toMatchObject({ status: 403 })
    await expect(service.verifyCode('13800000000', '123456')).rejects.toMatchObject({ status: 403 })
    expect(redis.get).not.toHaveBeenCalled()
    expect(redis.set).not.toHaveBeenCalled()
  })

  test.each([
    { SMS_TEST_PHONES: '' },
    { SMS_TEST_PHONES: '*' },
    { SMS_TEST_EXPIRES_AT: '' },
    { SMS_TEST_EXPIRES_AT: 'invalid' }
  ])('fails closed with missing, malformed or expired settings %j', async overrides => {
    const { service } = setup(overrides)
    await expect(service.sendCode(phone, '127.0.0.1')).rejects.toMatchObject({ status: 503 })
    await expect(service.verifyCode(phone, '123456')).rejects.toMatchObject({ status: 503 })
    expect(() => validateEnv({ ...settings, ...overrides })).toThrow('Experience SMS requires')
  })

  test('runtime expiry prevents previously issued codes being used', async () => {
    const { service } = setup({ SMS_TEST_EXPIRES_AT: new Date(now + 60_000).toISOString() })
    await service.sendCode(phone, '127.0.0.1')
    jest.advanceTimersByTime(60_000)
    await expect(service.verifyCode(phone, '123456')).rejects.toMatchObject({ status: 503 })
    await expect(service.sendCode(phone, '127.0.0.1')).rejects.toMatchObject({ status: 503 })
  })

  test('an expired window blocks SMS but lets the backend restart', async () => {
    const expired = { ...settings, SMS_TEST_EXPIRES_AT: '2026-10-01T00:00:00Z' }
    expect(() => validateEnv(expired)).not.toThrow()
    const { service } = setup(expired)
    await expect(service.sendCode(phone, '127.0.0.1')).rejects.toMatchObject({ status: 503 })
    await expect(service.verifyCode(phone, '123456')).rejects.toMatchObject({ status: 503 })
  })

  test('a requested code expires after five minutes', async () => {
    const { service } = setup()
    await service.sendCode(phone, '127.0.0.1')
    jest.advanceTimersByTime(300_000)
    await expect(service.verifyCode(phone, '123456')).resolves.toBe(false)
  })

  test('retains production phone/IP limits and wrong-attempt lockout', async () => {
    const { service, redis } = setup()
    await service.sendCode(phone, '127.0.0.1')
    expect(redis.set).toHaveBeenCalledWith(`sms:rate:${phone}`, '1', 'EX', 60)
    expect(redis.set).toHaveBeenCalledWith('sms:rate:ip:127.0.0.1', '1', 'EX', 60)
    await expect(service.sendCode(phone, '127.0.0.1')).rejects.toMatchObject({ status: 429 })
    await expect(service.sendCode('18137222005', '127.0.0.1')).rejects.toMatchObject({ status: 429 })
    for (let i = 0; i < 5; i++) await expect(service.verifyCode(phone, '000000')).resolves.toBe(false)
    await expect(service.verifyCode(phone, '123456')).rejects.toMatchObject({ status: 429 })
  })

  test.each(['get', 'set', 'del'] as const)('does not fall back to memory when Redis %s fails', async method => {
    const { service, redis } = setup()
    if (method === 'del') await service.sendCode(phone, '127.0.0.1')
    redis[method].mockRejectedValue(new Error('offline'))
    const request = () => method === 'del' ? service.verifyCode(phone, '123456') : service.sendCode(phone, '127.0.0.1')
    await expect(request()).rejects.toMatchObject({ status: 503 })
    await expect(request()).rejects.toMatchObject({ status: 503 })
  })

  test('switching to a real provider never accepts cached experience codes', async () => {
    const { service, redis } = setup()
    await service.sendCode(phone, '127.0.0.1')
    const realService = new SmsService(new ConfigService({ SMS_PROVIDER: 'tencentcloud' }), redis)
    await expect(realService.verifyCode(phone, '123456')).resolves.toBe(false)
    const disabled = new SmsService(new ConfigService({ SMS_PROVIDER: 'disabled' }), redis)
    await expect(disabled.verifyCode(phone, '123456')).resolves.toBe(false)
  })

  test('production accepts bounded experience mode but still rejects development mode', () => {
    const production = { ...validateEnv({}), NODE_ENV: 'production', CORS_ORIGIN: 'https://weiduoxian.cn',
      JWT_ACCESS_SECRET: 'test-access-secret', JWT_REFRESH_SECRET: 'test-refresh-secret' }
    expect(validateEnv({ ...production, ...settings })).toMatchObject({ SMS_PROVIDER: 'experience' })
    expect(() => validateEnv({ ...production, SMS_PROVIDER: 'development' })).toThrow('Production SMS_PROVIDER')
    expect(() => validateEnv({ ...production, ...settings, SMS_TEST_EXPIRES_AT: '2026-10-10T00:00:00Z' })).toThrow('Experience SMS requires')
  })
})
