import { AiModelService } from '../src/ai/ai-model.service'

describe('AI quota fail-closed boundary', () => {
  it.each([null, undefined, 0, -1, 'invalid', [1], 1.5])('never calls a model or decrypts a key for an invalid quota response %p', async result => {
    const fetch = jest.spyOn(global, 'fetch').mockRejectedValue(Error('No external provider allowed'))
    try {
      const settings = { configFor: async () => ({ enabled: true, encryptedKey: 'synthetic', dailyRequests: 3 }), decrypt: jest.fn() }
      const usage = { create: jest.fn() }
      const service = new AiModelService(settings as any, { aiUsageRecord: usage } as any, { eval: async () => result } as any)
      await expect(service.complete({ tenantId: 7, id: 8 } as any, [], [])).rejects.toMatchObject({ response: { errorCode: 'AI_QUOTA_UNAVAILABLE' } })
      expect(fetch).not.toHaveBeenCalled(); expect(settings.decrypt).not.toHaveBeenCalled(); expect(usage.create).not.toHaveBeenCalled()
    } finally { fetch.mockRestore() }
  })

  it('does not expose a Redis connection failure in its readable error', async () => {
    const settings = { configFor: async () => ({ enabled: true, encryptedKey: 'synthetic', dailyRequests: 3 }) }
    const service = new AiModelService(settings as any, {} as any, { eval: async () => { throw Error('redis://private-credential@internal.invalid') } } as any)
    try { await service.complete({ tenantId: 7, id: 8 } as any, [], []); throw Error('Unexpected success') }
    catch (error: any) { expect(error.response.errorCode).toBe('AI_QUOTA_UNAVAILABLE'); expect(JSON.stringify(error.response)).not.toContain('private-credential') }
  })
})
