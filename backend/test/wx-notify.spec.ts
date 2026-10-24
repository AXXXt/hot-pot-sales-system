import { WxService } from '../src/notify/wx.service'
import { SHIPMENT_TEMPLATE_ID } from '../src/notify/shipment-template'

describe('Wechat provider safety', () => {
  const values: Record<string, string> = { WX_APPID: 'wx0000000000000000', WX_SECRET: 'test-server-secret', WX_MINIPROGRAM_STATE: 'trial' }
  const fixture = (settings = values) => {
    const config = { get: (key: string, fallback?: string) => settings[key] ?? fallback }
    const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn() }
    return { service: new WxService(config as any, redis as any), redis }
  }
  afterEach(() => jest.restoreAllMocks())

  it('defaults to the confirmed template but exposes no ready capability without credentials', () => {
    const { service } = fixture({})
    expect(service.orderTemplateId).toBe(SHIPMENT_TEMPLATE_ID)
    expect(service.subscriptionReady).toBe(false)
  })

  it('uses the configured mini environment, caches token, and never retries a send implicitly', async () => {
    const { service, redis } = fixture()
    redis.get.mockResolvedValue('cached-token')
    const request = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ errcode: 0 }) } as any)
    await expect(service.sendSubscribeMessage({ openid: 'private-user', templateId: SHIPMENT_TEMPLATE_ID, data: {}, page: 'pages/order-detail/order-detail?id=1' })).resolves.toBe(true)
    expect(request).toHaveBeenCalledTimes(1)
    const body = JSON.parse(request.mock.calls[0][1]!.body as string)
    expect(body.miniprogram_state).toBe('trial')
    expect(body.touser).toBe('private-user')
  })

  it('does not disclose credentials or openid through network exception logs', async () => {
    const { service } = fixture()
    const logger = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {})
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('request url contains test-server-secret private-user'))
    await expect(service.codeToOpenid('private-code')).resolves.toBeNull()
    await expect(service.sendSubscribeMessage({ openid: 'private-user', templateId: SHIPMENT_TEMPLATE_ID, data: {} })).resolves.toBe(false)
    expect(JSON.stringify(logger.mock.calls)).not.toMatch(/test-server-secret|private-user|private-code/)
  })

  it('records quota rejection and an uncertain network outcome separately', async () => {
    const { service, redis } = fixture()
    redis.get.mockResolvedValue('cached-token')
    const request = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ errcode: 43101 }) } as any)
    const input = { openid: 'private-user', templateId: SHIPMENT_TEMPLATE_ID, data: {} }
    await expect(service.sendSubscribeMessageResult(input)).resolves.toEqual({ status: 'rejected', errorCode: 43101 })
    request.mockRejectedValueOnce(new Error('timeout'))
    await expect(service.sendSubscribeMessageResult(input)).resolves.toEqual({ status: 'unknown' })
    expect(request).toHaveBeenCalledTimes(2)
  })
})
