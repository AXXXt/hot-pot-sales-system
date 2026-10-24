import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { OrderNotificationService } from '../src/notify/order-notification.service'
import { configuredOrderTemplate, orderNoticeData, QUOTE_FIELDS, QUOTE_TEMPLATE_ID } from '../src/notify/order-notification-template'
import { WxService } from '../src/notify/wx.service'

const quote = configuredOrderTemplate('order.quoted', '报价完成', QUOTE_TEMPLATE_ID, JSON.stringify(QUOTE_FIELDS))!
function fixture(status = 'pending_confirm', overrides = {}) {
  const records = new Map<string, any>()
  const order = { id: 12, tenantId: 1, customerId: 8, userId: 9, orderNo: 'OD001', status,
    payableAmount: new Prisma.Decimal('19.90'), paymentMethod: 'credit', customer: { status: 'active' },
    user: { id: 9, tenantId: 1, customerId: 8, userType: 'customer_user', status: 'active', openid: 'private-openid' },
    items: [{ productName: '牛筋丸' }], statusLogs: [{ id: 31, createdAt: new Date('2026-10-22T08:00:00Z') }], ...overrides }
  const prisma: any = {
    order: { findUnique: jest.fn(async () => order) }, user: { findUnique: jest.fn(async () => ({ ...order.user, customer: order.customer })) },
    customerNotification: { create: jest.fn(), findMany: jest.fn(async () => []), count: jest.fn(async () => 0), updateMany: jest.fn(async () => ({ count: 0 })) },
    auditLog: {
      create: jest.fn(async ({ data }) => { if (records.has(data.requestId)) throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6' }); records.set(data.requestId, data) }),
      update: jest.fn(async ({ where, data }) => { records.set(where.requestId, { ...records.get(where.requestId), ...data }) })
    }
  }
  const wx: any = { orderNoticeTemplates: [quote], sendSubscribeMessageResult: jest.fn(async () => ({ status: 'sent' })) }
  return { prisma, wx, order, records, service: new OrderNotificationService(prisma, wx) }
}

describe('key order notifications and inbox isolation', () => {
  it('uses the four actual inquiry template fields and the committed quote amount and time', async () => {
    const f = fixture()
    await f.service.notify(12, 'pending_confirm')
    expect(f.wx.sendSubscribeMessageResult).toHaveBeenCalledWith(expect.objectContaining({
      templateId: QUOTE_TEMPLATE_ID, page: 'pages/order-detail/order-detail?id=12',
      data: { character_string1: { value: 'OD001' }, thing2: { value: '牛筋丸' }, amount4: { value: '19.90' }, time5: { value: '2026-10-22 16:00' } }
    }))
    expect(JSON.stringify([...f.records.values()])).not.toContain('private-openid')
  })

  it('deduplicates concurrent instances and preserves provider rejection without retry', async () => {
    const f = fixture()
    f.wx.sendSubscribeMessageResult.mockResolvedValue({ status: 'rejected', errorCode: 43101 })
    await Promise.all([f.service.notify(12, 'pending_confirm'), new OrderNotificationService(f.prisma, f.wx).notify(12, 'pending_confirm')])
    await f.service.notify(12, 'pending_confirm')
    expect(f.wx.sendSubscribeMessageResult).toHaveBeenCalledTimes(1)
    expect([...f.records.values()][0].afterData).toMatchObject({ status: 'rejected', errorCode: 43101 })
  })

  it.each(['pending_quote', 'pending_finance', 'shipped', 'completed', 'cancelled'])('keeps %s in the inbox without consuming a key message grant', async status => {
    const f = fixture(status)
    await f.service.record(f.prisma, 12, status, f.order.statusLogs[0])
    expect(f.prisma.customerNotification.create).toHaveBeenCalledTimes(1)
    await f.service.notify(12, status)
    expect(f.wx.sendSubscribeMessageResult).not.toHaveBeenCalled()
  })

  it('records inbox messages without an openid, and does not label credit approval as payment received', async () => {
    const f = fixture('pending_shipment')
    f.order.user.openid = ''
    await f.service.record(f.prisma, 12, 'pending_shipment', f.order.statusLogs[0])
    const saved = f.prisma.customerNotification.create.mock.calls[0][0].data
    expect(saved.title).toBe('订单审核通过')
    expect(saved.content).not.toMatch(/到账|收款|付款成功/)
    await f.service.notify(12, 'pending_shipment')
    expect(f.wx.sendSubscribeMessageResult).not.toHaveBeenCalled()
  })

  it.each([{ user: null }, { user: { userType: 'super_admin' } }, { user: { userType: 'customer_user', tenantId: 99 } }, { customer: { status: 'disabled' } }])('does not send or persist for another recipient scope', async overrides => {
    const f = fixture('pending_confirm', overrides)
    await f.service.record(f.prisma, 12, 'pending_confirm', f.order.statusLogs[0])
    await f.service.notify(12, 'pending_confirm')
    expect(f.prisma.customerNotification.create).not.toHaveBeenCalled()
    expect(f.wx.sendSubscribeMessageResult).not.toHaveBeenCalled()
  })

  it('scopes both listing and read operations by current user, tenant, customer and order owner', async () => {
    const f = fixture()
    await f.service.list(9, 2, 20)
    expect(f.prisma.customerNotification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 1, userId: 9, order: { tenantId: 1, userId: 9, customerId: 8 } }, skip: 20
    }))
    await expect(f.service.read(9, 999)).rejects.toThrow('消息不存在')
    expect(f.prisma.customerNotification.updateMany.mock.calls[0][0].where).toMatchObject({ id: 999, tenantId: 1, userId: 9 })
  })

  it('omits unconfigured approval and rejects invalid mappings instead of guessing field numbers', () => {
    const wx = new WxService(new ConfigService({ WX_APPID: 'wx09cca054a9642d35', WX_SECRET: 'fixture-secret' }), {} as any)
    expect(wx.orderNoticeTemplates.map(t => t.event)).toEqual(['order.quoted', 'order.shipped'])
    expect(configuredOrderTemplate('order.approved', '审核通过')).toBeNull()
    expect(() => configuredOrderTemplate('order.quoted', '报价', 'unknown-template')).toThrow()
    expect(() => configuredOrderTemplate('order.quoted', '报价', QUOTE_TEMPLATE_ID, '{"thing2":"orderNo"}')).toThrow()
    expect(() => orderNoticeData(quote, { orderNo: 'X'.repeat(33), eventTime: new Date(), productNames: [], amount: '1.00' })).toThrow()
  })

  it('formats the selected confirmation template with the actual approval time and credit wording', () => {
    const approved = configuredOrderTemplate('order.approved', '审核通过',
      'fK5PEF0WvqWeXdR9P3SPtuBFNGa6k5c7MOe4H39D3yg',
      JSON.stringify({ character_string1: 'orderNo', time2: 'eventTime', phrase3: 'state', thing4: 'remark' }))!
    expect(orderNoticeData(approved, { orderNo: 'OD001', eventTime: new Date('2026-10-22T08:10:00Z'),
      productNames: ['牛筋丸'], amount: '19.90', paymentMethod: 'credit' })).toEqual({
      character_string1: { value: 'OD001' }, time2: { value: '2026-10-22 16:10' },
      phrase3: { value: '审核通过' }, thing4: { value: '账期审核通过，请等待发货' }
    })
  })
})
