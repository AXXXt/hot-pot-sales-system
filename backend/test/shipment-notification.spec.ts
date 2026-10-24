import { Prisma } from '@prisma/client'
import { OrderService } from '../src/order/order.service'
import { ShipmentNotificationService } from '../src/notify/shipment-notification.service'
import { SHIPMENT_TEMPLATE_ID, shipmentTemplateData } from '../src/notify/shipment-template'

function fixture(overrides: any = {}) {
  const order = {
    id: 12, tenantId: 7, customerId: 8, userId: 9, orderNo: 'OD202610220001', status: 'shipped',
    logisticsType: 'cold-chain', customer: { status: 'active' },
    user: { id: 9, tenantId: 7, customerId: 8, status: 'active', userType: 'customer_user', openid: 'test-openid' },
    items: [{ productName: '爆汁牛筋丸' }, { productName: '鸭血' }],
    statusLogs: [{ createdAt: new Date('2026-10-22T06:03:00Z') }], ...overrides
  }
  const records = new Map<string, any>()
  const prisma = {
    order: { findUnique: jest.fn(async () => order) },
    auditLog: {
      create: jest.fn(async ({ data }) => {
        if (records.has(data.requestId)) throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6' })
        records.set(data.requestId, data)
        return data
      }),
      update: jest.fn(async ({ where, data }) => records.set(where.requestId, { ...records.get(where.requestId), ...data }))
    }
  }
  const wx = { subscriptionReady: true, orderTemplateId: SHIPMENT_TEMPLATE_ID, sendSubscribeMessageResult: jest.fn().mockResolvedValue({ status: 'sent' }) }
  return { prisma, wx, records, service: new ShipmentNotificationService(prisma as any, wx as any) }
}

describe('shipment template and notification safety', () => {
  it('uses all five actual template fields, order item snapshots and Shanghai shipment time', async () => {
    const f = fixture()
    await f.service.notify(12)
    expect(f.wx.sendSubscribeMessageResult).toHaveBeenCalledWith({
      openid: 'test-openid', templateId: SHIPMENT_TEMPLATE_ID,
      page: 'pages/order-detail/order-detail?id=12',
      data: {
        character_string1: { value: 'OD202610220001' }, time2: { value: '2026-10-22 14:03' },
        phrase5: { value: '已发货' }, thing8: { value: '爆汁牛筋丸等2款' }, thing6: { value: '冷链配送，请留意收货' }
      }
    })
    expect([...f.records.values()][0]).toMatchObject({ tenantId: 7, afterData: { status: 'sent' } })
    expect(JSON.stringify([...f.records.values()])).not.toContain('test-openid')
  })

  it('claims the durable unique record before sending across concurrent instances and retries', async () => {
    const f = fixture(), second = new ShipmentNotificationService(f.prisma as any, f.wx as any)
    await Promise.all([f.service.notify(12), second.notify(12)])
    await second.notify(12)
    expect(f.wx.sendSubscribeMessageResult).toHaveBeenCalledTimes(1)
    expect(f.records.size).toBe(1)
  })

  it.each(['pending_confirm', 'pending_shipment', 'completed', 'cancelled'])('does not consume subscription for %s', async status => {
    const f = fixture({ status })
    await f.service.notify(12)
    expect(f.wx.sendSubscribeMessageResult).not.toHaveBeenCalled()
    const notifier = { notify: jest.fn() }
    const orders = new OrderService({} as any, {} as any, {} as any, f.wx as any, {} as any, undefined, notifier as any)
    await (orders as any).notifyOrderStatus({ id: 12, orderNo: 'test', userId: 9 }, status)
    expect(notifier.notify).not.toHaveBeenCalled()
  })

  it.each([
    { user: null }, { customer: { status: 'disabled' } }, { statusLogs: [] },
    { user: { openid: 'x', status: 'disabled' } },
    { user: { openid: 'x', status: 'active', userType: 'super_admin', tenantId: 7, customerId: 8 } },
    { user: { openid: 'x', status: 'active', userType: 'customer_user', tenantId: 99, customerId: 8 } },
    { user: { openid: 'x', status: 'active', userType: 'customer_user', tenantId: 7, customerId: 99 } }
  ])('does not notify another tenant/customer, a staff creator or an inactive buyer', async overrides => {
    const f = fixture(overrides)
    await f.service.notify(12)
    expect(f.wx.sendSubscribeMessageResult).not.toHaveBeenCalled()
    expect(f.records.size).toBe(0)
  })

  it('leaves business success intact on provider failure and records failure without automatic duplicate retry', async () => {
    const f = fixture()
    f.wx.sendSubscribeMessageResult.mockRejectedValue(new Error('uncertain network result'))
    await expect(f.service.notify(12)).resolves.toBeUndefined()
    expect([...f.records.values()][0].afterData.status).toBe('unknown')
    await f.service.notify(12)
    expect(f.wx.sendSubscribeMessageResult).toHaveBeenCalledTimes(1)
  })

  it('does not send when durable deduplication cannot be persisted', async () => {
    const f = fixture()
    f.prisma.auditLog.create.mockRejectedValue(new Error('database unavailable'))
    await f.service.notify(12)
    expect(f.wx.sendSubscribeMessageResult).not.toHaveBeenCalled()
  })

  it('does no business read or send when credentials are not ready', async () => {
    const f = fixture()
    f.wx.subscriptionReady = false
    await f.service.notify(12)
    expect(f.prisma.order.findUnique).not.toHaveBeenCalled()
  })

  it('bounds template text by Unicode characters and preserves the order number instead of truncating it', () => {
    const data = shipmentTemplateData({ orderNo: 'OD1', shippedAt: new Date('2026-10-21T16:00:00Z'), productNames: ['牛🐮'.repeat(30)] })
    expect(Array.from(data.thing8.value)).toHaveLength(20)
    expect(data.time2.value).toBe('2026-10-22 00:00')
    expect(() => shipmentTemplateData({ orderNo: '1'.repeat(33), shippedAt: new Date(), productNames: [] })).toThrow()
  })
})
