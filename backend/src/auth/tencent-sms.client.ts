import { createHash, createHmac } from 'crypto'
import { request as httpsRequest } from 'https'

export type SmsPurpose = 'login' | 'register'

export interface TencentSmsSettings {
  secretId: string
  secretKey: string
  sdkAppId: string
  signName: string
  loginTemplateId: string
  registerTemplateId: string
  region: string
  endpoint?: string
}

interface TencentSmsStatus {
  Code?: string
  Message?: string
  SerialNo?: string
  PhoneNumber?: string
}

interface TencentSmsResponse {
  Response?: {
    SendStatusSet?: TencentSmsStatus[]
    Error?: { Code?: string; Message?: string }
    RequestId?: string
  }
}

export class TencentSmsError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'TencentSmsError'
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

export function buildTencentSmsHeaders(
  body: Record<string, unknown>,
  settings: TencentSmsSettings,
  timestamp = Math.floor(Date.now() / 1000)
) {
  const endpoint = new URL(settings.endpoint || 'https://sms.tencentcloudapi.com')
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const payload = JSON.stringify(body)
  const canonicalRequest = [
    'POST',
    '/',
    '',
    'content-type:application/json; charset=utf-8',
    `host:${endpoint.host}`,
    '',
    'content-type;host',
    sha256(payload)
  ].join('\n')
  const scope = `${date}/sms/tc3_request`
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    scope,
    sha256(canonicalRequest)
  ].join('\n')
  const secretDate = hmac(`TC3${settings.secretKey}`, date)
  const secretService = hmac(secretDate, 'sms')
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = createHmac('sha256', secretSigning).update(stringToSign).digest('hex')

  return {
    endpoint,
    payload,
    headers: {
      Authorization: `TC3-HMAC-SHA256 Credential=${settings.secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
      'Content-Type': 'application/json; charset=utf-8',
      Host: endpoint.host,
      'X-TC-Action': 'SendSms',
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': '2021-01-11',
      'X-TC-Region': settings.region
    }
  }
}

function requestTencentSms(
  body: Record<string, unknown>,
  settings: TencentSmsSettings
): Promise<TencentSmsResponse> {
  const signed = buildTencentSmsHeaders(body, settings)
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      protocol: signed.endpoint.protocol,
      hostname: signed.endpoint.hostname,
      port: signed.endpoint.port || 443,
      path: signed.endpoint.pathname || '/',
      method: 'POST',
      headers: signed.headers,
      timeout: 10_000
    }, response => {
      let raw = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        raw += chunk
        if (raw.length > 64 * 1024) req.destroy(new Error('Tencent SMS response is too large'))
      })
      response.on('end', () => {
        const statusCode = response.statusCode || 0
        if (statusCode < 200 || statusCode >= 300) {
          reject(new TencentSmsError('Tencent SMS HTTP request failed', `HTTP_${statusCode}`))
          return
        }
        try { resolve(JSON.parse(raw) as TencentSmsResponse) }
        catch { reject(new TencentSmsError('Tencent SMS returned invalid JSON', 'INVALID_RESPONSE')) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('Tencent SMS request timed out')))
    req.on('error', reject)
    req.end(signed.payload)
  })
}

export class TencentSmsClient {
  constructor(
    private readonly settings: TencentSmsSettings,
    private readonly transport = requestTencentSms
  ) {}

  async send(phone: string, code: string, purpose: SmsPurpose) {
    const templateId = purpose === 'register'
      ? this.settings.registerTemplateId
      : this.settings.loginTemplateId
    const body = {
      PhoneNumberSet: [`+86${phone}`],
      SmsSdkAppId: this.settings.sdkAppId,
      SignName: this.settings.signName,
      TemplateId: templateId,
      TemplateParamSet: [code, '5']
    }
    const result = await this.transport(body, this.settings)
    const response = result.Response
    if (!response) throw new TencentSmsError('Tencent SMS response is missing', 'INVALID_RESPONSE')
    if (response.Error) {
      throw new TencentSmsError(response.Error.Message || 'Tencent SMS rejected the request',
        response.Error.Code || 'PROVIDER_ERROR')
    }
    const status = response.SendStatusSet?.[0]
    if (!status || status.Code !== 'Ok') {
      throw new TencentSmsError(status?.Message || 'Tencent SMS was not accepted',
        status?.Code || 'PROVIDER_ERROR')
    }
    return {
      requestId: response.RequestId || '',
      serialNo: status.SerialNo || ''
    }
  }
}

export function tencentSmsSettings(config: {
  get<T = string>(key: string, fallback?: T): T
}): TencentSmsSettings {
  return {
    secretId: config.get<string>('TENCENT_SMS_SECRET_ID', ''),
    secretKey: config.get<string>('TENCENT_SMS_SECRET_KEY', ''),
    sdkAppId: config.get<string>('TENCENT_SMS_SDK_APP_ID', ''),
    signName: config.get<string>('TENCENT_SMS_SIGN_NAME', ''),
    loginTemplateId: config.get<string>('TENCENT_SMS_LOGIN_TEMPLATE_ID', ''),
    registerTemplateId: config.get<string>('TENCENT_SMS_REGISTER_TEMPLATE_ID', ''),
    region: config.get<string>('TENCENT_SMS_REGION', 'ap-guangzhou')
  }
}
