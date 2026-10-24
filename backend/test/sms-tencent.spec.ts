import { SmsService } from '../src/auth/sms.service'
import { buildTencentSmsHeaders, TencentSmsClient, TencentSmsError } from '../src/auth/tencent-sms.client'
import { validateEnv } from '../src/config/env.validation'

const tencentSettings = {
  secretId: 'AKID-test',
  secretKey: 'secret-test',
  sdkAppId: '1401211787',
  signName: '河南唯哆鲜食品有限公司',
  loginTemplateId: '2746507',
  registerTemplateId: '2746506',
  region: 'ap-guangzhou'
}

describe('Tencent Cloud SMS', () => {
  function redisMock() {
    return {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(0)
    }
  }

  function serviceWith(send: jest.Mock) {
    const redis = redisMock()
    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        const values: Record<string, string> = {
          SMS_PROVIDER: 'tencentcloud',
          TENCENT_SMS_SECRET_ID: tencentSettings.secretId,
          TENCENT_SMS_SECRET_KEY: tencentSettings.secretKey,
          TENCENT_SMS_SDK_APP_ID: tencentSettings.sdkAppId,
          TENCENT_SMS_SIGN_NAME: tencentSettings.signName,
          TENCENT_SMS_LOGIN_TEMPLATE_ID: tencentSettings.loginTemplateId,
          TENCENT_SMS_REGISTER_TEMPLATE_ID: tencentSettings.registerTemplateId,
          TENCENT_SMS_REGION: tencentSettings.region
        }
        return values[key] ?? fallback
      })
    }
    const service = new SmsService(config as any, redis as any)
    ;(service as any).tencentClient = { send }
    return { service, redis }
  }

  it('uses the login template and saves the code for five minutes', async () => {
    const send = jest.fn().mockResolvedValue({ requestId: 'r', serialNo: 's' })
    const { service, redis } = serviceWith(send)
    await service.sendCode('13800000000', '127.0.0.1', 'login')

    const [phone, code, purpose] = send.mock.calls[0]
    expect(phone).toBe('13800000000')
    expect(code).toMatch(/^\d{6}$/)
    expect(purpose).toBe('login')
    expect(redis.set).toHaveBeenCalledWith('sms:code:13800000000', code, 'EX', 300)
    expect(redis.set).toHaveBeenCalledWith('sms:rate:13800000000', '1', 'EX', 60)
  })

  it('uses the registration template for registration codes', async () => {
    const send = jest.fn().mockResolvedValue({ requestId: 'r', serialNo: 's' })
    const { service } = serviceWith(send)
    await service.sendCode('13800000000', '127.0.0.1', 'register')
    expect(send.mock.calls[0][2]).toBe('register')
  })

  it('does not save or rate-limit a code when Tencent rejects the send', async () => {
    const send = jest.fn().mockRejectedValue(new TencentSmsError('quota', 'LimitExceeded'))
    const { service, redis } = serviceWith(send)
    await expect(service.sendCode('13800000000', '127.0.0.1')).rejects.toMatchObject({
      status: 502,
      response: { errorCode: 'SMS_PROVIDER_ERROR' }
    })
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('does not accept a cached experience code in Tencent mode', async () => {
    const send = jest.fn().mockResolvedValue({ requestId: 'r', serialNo: 's' })
    const { service } = serviceWith(send)
    await expect(service.verifyCode('13800000000', '123456')).resolves.toBe(false)
  })
})

describe('Tencent SMS client request', () => {
  it('sends the correct application, signature and template payload', async () => {
    const transport = jest.fn().mockResolvedValue({
      Response: { SendStatusSet: [{ Code: 'Ok', SerialNo: 'serial' }], RequestId: 'request' }
    })
    const client = new TencentSmsClient(tencentSettings, transport)
    const result = await client.send('13800000000', '654321', 'register')

    expect(result).toEqual({ requestId: 'request', serialNo: 'serial' })
    expect(transport).toHaveBeenCalledWith({
      PhoneNumberSet: ['+8613800000000'],
      SmsSdkAppId: '1401211787',
      SignName: '河南唯哆鲜食品有限公司',
      TemplateId: '2746506',
      TemplateParamSet: ['654321', '5']
    }, tencentSettings)
  })

  it('builds the TC3 authorization without exposing the secret', () => {
    const body = { PhoneNumberSet: ['+8613800000000'] }
    const signed = buildTencentSmsHeaders(body, tencentSettings, 1_700_000_000)

    expect(signed.headers.Authorization).toMatch(/^TC3-HMAC-SHA256 Credential=AKID-test\/\d{4}-\d{2}-\d{2}\/sms\/tc3_request, SignedHeaders=content-type;host, Signature=[a-f0-9]{64}$/)
    expect(JSON.stringify(signed.headers)).not.toContain('secret-test')
  })

  it('rejects a provider status other than Ok', async () => {
    const transport = jest.fn().mockResolvedValue({
      Response: { SendStatusSet: [{ Code: 'FailedOperation', Message: 'failed' }], RequestId: 'request' }
    })
    const client = new TencentSmsClient(tencentSettings, transport)
    await expect(client.send('13800000000', '654321', 'login')).rejects.toMatchObject({
      code: 'FailedOperation'
    })
  })
})

describe('Tencent SMS environment validation', () => {
  function productionEnv() {
    return {
      NODE_ENV: 'production',
      PORT: '3000',
      DATABASE_URL: 'mysql://db',
      REDIS_URL: 'redis://redis',
      JWT_ACCESS_SECRET: 'production-access-secret',
      JWT_REFRESH_SECRET: 'production-refresh-secret',
      CORS_ORIGIN: 'https://weiduoxian.cn',
      MINIO_ENDPOINT: 'minio',
      MINIO_PORT: '9000',
      MINIO_ACCESS_KEY: 'access',
      MINIO_SECRET_KEY: 'secret',
      MINIO_BUCKET: 'bucket',
      MINIO_PUBLIC_URL: 'https://weiduoxian.cn',
      SMS_PROVIDER: 'tencentcloud',
      TENCENT_SMS_SECRET_ID: tencentSettings.secretId,
      TENCENT_SMS_SECRET_KEY: tencentSettings.secretKey,
      TENCENT_SMS_SDK_APP_ID: tencentSettings.sdkAppId,
      TENCENT_SMS_SIGN_NAME: tencentSettings.signName,
      TENCENT_SMS_LOGIN_TEMPLATE_ID: tencentSettings.loginTemplateId,
      TENCENT_SMS_REGISTER_TEMPLATE_ID: tencentSettings.registerTemplateId
    }
  }

  it('accepts complete Tencent settings', () => {
    expect(validateEnv(productionEnv())).toMatchObject({ SMS_PROVIDER: 'tencentcloud' })
  })

  it.each([
    'TENCENT_SMS_SECRET_ID',
    'TENCENT_SMS_SECRET_KEY',
    'TENCENT_SMS_SDK_APP_ID',
    'TENCENT_SMS_SIGN_NAME',
    'TENCENT_SMS_LOGIN_TEMPLATE_ID',
    'TENCENT_SMS_REGISTER_TEMPLATE_ID'
  ])('fails closed when %s is missing', key => {
    const env = productionEnv()
    delete (env as any)[key]
    expect(() => validateEnv(env)).toThrow('Tencent SMS configuration is incomplete')
  })
})
