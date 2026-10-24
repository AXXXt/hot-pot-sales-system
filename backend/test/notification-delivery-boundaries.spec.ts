import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { OrderNotificationService } from '../src/notify/order-notification.service'
import { ShipmentNotificationService } from '../src/notify/shipment-notification.service'
import { WxService } from '../src/notify/wx.service'
import { configuredOrderTemplate, QUOTE_FIELDS, QUOTE_TEMPLATE_ID } from '../src/notify/order-notification-template'
import { SHIPMENT_TEMPLATE_ID } from '../src/notify/shipment-template'

type EventKind = 'quoted' | 'approved' | 'shipped'
const kinds: EventKind[] = ['quoted', 'approved', 'shipped']
const statusFor = { quoted: 'pending_confirm', approved: 'pending_shipment', shipped: 'shipped' }
const approved = configuredOrderTemplate('order.approved', '审核通过',
  'fK5PEF0WvqWeXdR9P3SPtuBFNGa6k5c7MOe4H39D3yg',
  JSON.stringify({ character_string1: 'orderNo', time2: 'eventTime', phrase3: 'state', thing4: 'remark' }))!

function fixture(kind: EventKind) {
  const records = new Map<string, any>()
  const order = { id: 12, tenantId: 7, customerId: 8, userId: 9, orderNo: 'OD-FIXTURE', status: statusFor[kind],
    payableAmount: new Prisma.Decimal('19.90'), paymentMethod: 'credit', logisticsType: 'cold-chain',
    customer: { status: 'active' }, user: { id: 9, tenantId: 7, customerId: 8, status: 'active', userType: 'customer_user', openid: 'private-recipient-fixture' },
    items: [{ productName: '测试商品' }], statusLogs: [{ id: 31, createdAt: new Date('2026-10-24T00:00:00Z') }] }
  const prisma = { order: { findUnique: jest.fn().mockResolvedValue(order) },
    customerNotification: { create: jest.fn() },
    auditLog: {
      create: jest.fn(async ({ data }) => {
        if (records.has(data.requestId)) throw new Prisma.PrismaClientKnownRequestError('duplicate fixture', { code: 'P2002', clientVersion: '6' })
        records.set(data.requestId, data)
        return data
      }),
      update: jest.fn(async ({ where, data }) => { records.set(where.requestId, { ...records.get(where.requestId), ...data }) })
    } }
  const provider = { subscriptionReady: true, orderTemplateId: SHIPMENT_TEMPLATE_ID,
    orderNoticeTemplates: [configuredOrderTemplate('order.quoted', '报价完成', QUOTE_TEMPLATE_ID, JSON.stringify(QUOTE_FIELDS))!, approved],
    sendSubscribeMessageResult: jest.fn().mockResolvedValue({ status: 'unknown' }) }
  const inbox = new OrderNotificationService(prisma as any, provider as any)
  const create = () => kind === 'shipped' ? new ShipmentNotificationService(prisma as any, provider as any) : new OrderNotificationService(prisma as any, provider as any)
  const notify = async () => {
    const service = create()
    if (service instanceof ShipmentNotificationService) await service.notify(order.id)
    else await service.notify(order.id, statusFor[kind])
  }
  return { prisma, provider, order, records, inbox, notify }
}

describe.each(kinds)('%s notification delivery boundaries', kind => {
  it('claims the sending record before delivery and does not send again while the first result is unknown', async () => {
    const f = fixture(kind)
    let finish!: (value: { status: string }) => void
    f.provider.sendSubscribeMessageResult.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const first = f.notify()
    await new Promise(resolve => setImmediate(resolve))
    expect([...f.records.values()][0].afterData.status).toBe('sending')
    await f.notify()
    expect(f.provider.sendSubscribeMessageResult).toHaveBeenCalledTimes(1)
    finish({ status: 'unknown' })
    await first; await f.notify()
    expect(f.provider.sendSubscribeMessageResult).toHaveBeenCalledTimes(1)
    expect([...f.records.values()][0].afterData.status).toBe('unknown')
  })

  it('retains the durable claim after an uncertain provider exception without automatic retries', async () => {
    const f = fixture(kind)
    f.provider.sendSubscribeMessageResult.mockRejectedValue(new Error('provider fixture: outcome unknown'))
    await expect(f.notify()).resolves.toBeUndefined()
    await f.notify()
    expect(f.provider.sendSubscribeMessageResult).toHaveBeenCalledTimes(1)
    expect([...f.records.values()][0].afterData.status).toBe('unknown')
    expect(JSON.stringify([...f.records.values()])).not.toContain('private-recipient-fixture')
  })

  it('does not resend when the provider accepted delivery but saving its result failed', async () => {
    const f = fixture(kind)
    f.provider.sendSubscribeMessageResult.mockResolvedValue({ status: 'sent' })
    f.prisma.auditLog.update.mockRejectedValue(new Error('result persistence fixture failure'))
    await f.notify(); await f.notify()
    expect(f.provider.sendSubscribeMessageResult).toHaveBeenCalledTimes(1)
    expect([...f.records.values()][0].afterData.status).toBe('sending')
  })

  it.each(['super_admin', 'admin', 'sales', 'warehouse'])('never sends a customer reminder to a %s creator even with a matching customer and openid', async userType => {
    const f = fixture(kind)
    f.order.user.userType = userType
    await f.inbox.record(f.prisma as any, f.order.id, statusFor[kind], f.order.statusLogs[0])
    await f.notify()
    expect(f.provider.sendSubscribeMessageResult).not.toHaveBeenCalled()
    expect(f.prisma.customerNotification.create).not.toHaveBeenCalled()
    expect(f.records.size).toBe(0)
  })
})

describe('Wechat transport result classification with no live fetch or Redis', () => {
  afterEach(() => jest.restoreAllMocks())

  it.each(['timeout', 'invalid-json', 'unclassified-body'])('classifies %s as unknown and performs no internal resend', async outcome => {
    const service = new WxService(new ConfigService({ WX_APPID: 'fixture-app', WX_SECRET: 'fixture-only' }), {} as any)
    jest.spyOn(service, 'getAccessToken').mockResolvedValue('fixture-token')
    const fetch = jest.spyOn(global, 'fetch')
    if (outcome === 'timeout') fetch.mockRejectedValue(new Error('timeout fixture'))
    else fetch.mockResolvedValue({ ok: false, json: async () => {
      if (outcome === 'invalid-json') throw new Error('parse fixture')
      return { errmsg: 'unclassified fixture' }
    } } as Response)
    expect(await service.sendSubscribeMessageResult({ openid: 'fixture-recipient', templateId: 'fixture-template', data: {} })).toEqual({ status: 'unknown' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
