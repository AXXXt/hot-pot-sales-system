import { HttpException } from '@nestjs/common'
import { SmsService } from '../src/auth/sms.service'

describe('SmsService 限流与 429', () => {
  const makeRedis = () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1)
  })
  const makeConfig = (provider: string) => ({
    get: jest.fn((key: string, defaultValue?: string) => (key === 'SMS_PROVIDER' ? provider : defaultValue))
  })

  it('开发模式下发送间隔放宽为 5 秒、IP 限流 10 秒', async () => {
    const redis = makeRedis()
    const svc = new SmsService(makeConfig('development') as any, redis as any)
    await svc.sendCode('13800000000', '127.0.0.1')
    expect(redis.set).toHaveBeenCalledWith('sms:code:13800000000', '123456', 'EX', 300)
    expect(redis.set).toHaveBeenCalledWith('sms:rate:13800000000', '1', 'EX', 5)
    expect(redis.set).toHaveBeenCalledWith('sms:rate:ip:127.0.0.1', '1', 'EX', 10)
  })

  it('生产模式限流窗口保持 60 秒', async () => {
    const redis = makeRedis()
    const svc = new SmsService(makeConfig('aliyun') as any, redis as any)
    await svc.sendCode('13800000000', '127.0.0.1')
    expect(redis.set).toHaveBeenCalledWith('sms:rate:13800000000', '1', 'EX', 60)
    expect(redis.set).toHaveBeenCalledWith('sms:rate:ip:127.0.0.1', '1', 'EX', 60)
  })

  it('手机号限流返回 429 + SMS_4290', async () => {
    const redis = makeRedis()
    redis.get.mockImplementation(async (key: string) => (key === 'sms:rate:13800000000' ? '1' : null))
    const svc = new SmsService(makeConfig('development') as any, redis as any)
    await expect(svc.sendCode('13800000000', '127.0.0.1')).rejects.toMatchObject({
      status: 429,
      response: { errorCode: 'SMS_4290' }
    })
  })

  it('IP 限流返回 429 + SMS_4291', async () => {
    const redis = makeRedis()
    redis.get.mockImplementation(async (key: string) => (key === 'sms:rate:ip:127.0.0.1' ? '1' : null))
    const svc = new SmsService(makeConfig('development') as any, redis as any)
    await expect(svc.sendCode('13800000000', '127.0.0.1')).rejects.toMatchObject({
      status: 429,
      response: { errorCode: 'SMS_4291' }
    })
  })

  it('验证码错误次数超限返回 429 + SMS_4292', async () => {
    const redis = makeRedis()
    redis.get.mockImplementation(async (key: string) => (key === 'sms:attempts:13800000000' ? '5' : null))
    const svc = new SmsService(makeConfig('development') as any, redis as any)
    await expect(svc.verifyCode('13800000000', '000000')).rejects.toBeInstanceOf(HttpException)
    await expect(svc.verifyCode('13800000000', '000000')).rejects.toMatchObject({
      status: 429,
      response: { errorCode: 'SMS_4292' }
    })
  })
})