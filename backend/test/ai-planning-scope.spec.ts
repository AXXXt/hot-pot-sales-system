import { AiDataService } from '../src/ai/ai-data.service'

it('describes both the 500-SKU scan boundary and the 30-card limit without calling it a full inventory report', async () => {
  const planning = { overview: async () => ({ total: 501, truncated: true, note: '仅为后台提示。', items: Array.from({ length: 500 }, (_, index) => ({ skuId: index + 1, productId: 1, productName: '验收丸', sold28: null, lowStock: true })) }) }
  const data = new AiDataService({} as any, { require: jest.fn() } as any, planning as any)
  const result = await data.lowStock({} as any)
  expect(result.items).toHaveLength(30)
  expect(result).toMatchObject({ total: 501, scanned: 500, truncated: true })
  expect(result.note).toContain('最多展示30条预警')
  expect(result.note).toContain('当前前500个可见规格（当前权限共501个）')
})

it('can calculate a recovered weekly report from its original scheduled date rather than this week', async () => {
  const aggregate = jest.fn(async (_args: unknown) => ({ _sum: { payableAmount: null }, _count: { id: 0 } }))
  const db = { order: { aggregate }, orderItem: { groupBy: async () => [] } }
  const access = { require: jest.fn(), orderWhere: () => ({ tenantId: 1 }) }
  const data = new AiDataService(db as any, access as any)
  const result = await data.metrics({ tenantId: 1 } as any, 'last_week', new Date('2026-01-05T01:00:00Z'))
  expect(result.start.toISOString()).toBe('2025-12-28T16:00:00.000Z')
  expect(result.end.toISOString()).toBe('2026-01-04T16:00:00.000Z')
  expect(aggregate.mock.calls[0][0]).toMatchObject({ where: { AND: [{ tenantId: 1 }, { createdAt: { gte: result.start, lt: result.end } }] } })
})
