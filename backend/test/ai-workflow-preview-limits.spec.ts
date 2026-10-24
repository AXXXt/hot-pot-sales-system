import { AiWorkflowsService } from '../src/ai/ai-workflows.service'

describe('AI 50-row preview connection bounds', () => {
  it('prepares all 50 rows in input order with at most five concurrent database previews', async () => {
    let active = 0, peak = 0
    const prepare = jest.fn(async (_actor, line) => {
      active++; peak = Math.max(peak, active)
      await new Promise<void>(resolve => setImmediate(resolve))
      active--
      return line
    })
    const service = new AiWorkflowsService({} as any, { require: jest.fn() } as any, { prepare } as any, {} as any, {} as any)
    const result = await service.prepare({} as any, 'inventory.batch', { mode: 'increase', lines: Array.from({ length: 50 }, (_, index) => ({ skuId: index + 1, quantity: 1, unit: '袋' })) })
    expect(peak).toBe(5)
    expect(prepare).toHaveBeenCalledTimes(50)
    expect(result.lines.map((line: { skuId: number }) => line.skuId)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1))
  })

  it('rejects a failed preview rather than returning a truncated or partly prepared draft', async () => {
    const prepare = jest.fn(async (_actor, line) => {
      if (line.skuId === 50) throw Error('local final-line preparation failure')
      return line
    })
    const service = new AiWorkflowsService({} as any, { require: jest.fn() } as any, { prepare } as any, {} as any, {} as any)
    await expect(service.prepare({} as any, 'inventory.batch', { mode: 'increase', lines: Array.from({ length: 50 }, (_, index) => ({ skuId: index + 1, quantity: 1, unit: '袋' })) })).rejects.toThrow('local final-line preparation failure')
    expect(prepare).toHaveBeenCalledTimes(50)
  })
})
