import { HttpException } from '@nestjs/common'
import { LeadService } from '../src/lead/lead.service'

function createPrismaMock() {
  return {
    lead: {
      create: jest.fn().mockResolvedValue({ id: 11, phone: '13800001111', status: 'new' }),
      findFirst: jest.fn().mockResolvedValue({
        id: 11,
        tenantId: 1,
        phone: '13800001111',
        status: 'new',
        assignedToId: null,
        remark: null,
        nextFollowUpAt: null,
        lastContactAt: null
      }),
      update: jest.fn().mockImplementation((_args: any) => Promise.resolve({
        id: 11,
        status: 'contacted',
        lastContactAt: new Date('2026-09-19T08:00:00Z'),
        nextFollowUpAt: new Date('2026-09-21T08:00:00Z')
      })),
      groupBy: jest.fn().mockResolvedValue([
        { status: 'new', _count: { _all: 2 } },
        { status: 'contacted', _count: { _all: 1 } }
      ]),
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([])
    },
    leadFollowUp: {
      create: jest.fn().mockResolvedValue({ id: 5, leadId: 11, content: '电话沟通，发送报价单' }),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([])
    },
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 3, status: 'active' }),
      findMany: jest.fn().mockResolvedValue([{ id: 3, name: '销售A', userType: 'sales' }])
    },
    $transaction: jest.fn().mockResolvedValue([
      { id: 5, leadId: 11, content: '电话沟通，发送报价单' },
      { id: 11, status: 'contacted' }
    ])
  }
}

function createService(prisma: any) {
  const audit = { write: jest.fn().mockResolvedValue(undefined) }
  const redis = { incr: jest.fn().mockResolvedValue(1), expire: jest.fn().mockResolvedValue(1) }
  return { service: new LeadService(prisma, audit as any, redis as any), audit, redis }
}

describe('LeadService', () => {
  it('官网留资创建新线索并记录来源', async () => {
    const prisma = createPrismaMock()
    const { service } = createService(prisma)

    const result = await service.submitPublicLead(
      { phone: '13800001111', name: '张老板', storeScale: '3-5家', interestedItems: '毛肚、牛肉卷' },
      '127.0.0.1',
      'test-agent'
    )

    expect(result).toMatchObject({ success: true, id: 11 })
    expect(prisma.lead.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 1,
        phone: '13800001111',
        source: 'official_site',
        status: 'new'
      })
    }))
  })

  it('蜜罐字段命中时静默丢弃，不写库', async () => {
    const prisma = createPrismaMock()
    const { service } = createService(prisma)

    const result = await service.submitPublicLead(
      { phone: '13800001111', website: 'http://spam.example' },
      '127.0.0.1',
      'bot-agent'
    )

    expect(result).toEqual({ success: true })
    expect(prisma.lead.create).not.toHaveBeenCalled()
  })

  it('同一 IP 超过限流次数后拒绝提交', async () => {
    const prisma = createPrismaMock()
    const { service, redis } = createService(prisma)
    redis.incr.mockResolvedValue(6)

    await expect(service.submitPublicLead({ phone: '13800001111' }, '127.0.0.1', 'ua'))
      .rejects.toThrow(HttpException)
    expect(prisma.lead.create).not.toHaveBeenCalled()
  })

  it('添加跟进记录后新线索自动转为已联系', async () => {
    const prisma = createPrismaMock()
    const { service, audit } = createService(prisma)

    const updated = await service.addFollowUp(11, { content: '电话沟通，发送报价单' }, 3)

    expect(updated.status).toBe('contacted')
    expect(prisma.leadFollowUp.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leadId: 11, operatorId: 3 })
    }))
    expect(prisma.lead.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 11 },
      data: expect.objectContaining({ status: 'contacted' })
    }))
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ module: 'lead', action: 'create' }))
  })

  it('统计返回各状态与新线索数量', async () => {
    const prisma = createPrismaMock()
    const { service } = createService(prisma)

    const stats = await service.stats()

    expect(stats).toEqual({ total: 3, new: 2, contacted: 1, converted: 0, invalid: 0, newCount: 2 })
  })

  it('更新状态写入审计日志', async () => {
    const prisma = createPrismaMock()
    const { service, audit } = createService(prisma)

    await service.update(11, { status: 'invalid' }, 1)

    expect(prisma.lead.update).toHaveBeenCalled()
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ module: 'lead', action: 'update', targetId: 11 }))
  })
})
