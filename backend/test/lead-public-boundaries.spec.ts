import { HttpException } from '@nestjs/common'
import { LeadService } from '../src/lead/lead.service'
import { LEGAL_VERSION } from '../src/legal/legal-consent'
const leadConsent = { consentAccepted: true, consentVersion: LEGAL_VERSION, consentChannel: 'official_site' as const, requestId: '11111111-1111-4111-8111-111111111111' }

const fictionalPhone = '13800001111'
function fixture() {
  const lead = { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 900001 }) }
  const counters = new Map<string, number>()
  const ttls = new Map<string, number>()
  const increment = (key: string) => { const count = (counters.get(key) || 0) + 1; counters.set(key, count); return count }
  const redis = { incr: jest.fn(async (key: string) => increment(key)), expire: jest.fn(async (key: string, ttl: number) => { ttls.set(key, ttl); return 1 }),
    eval: jest.fn(async (_script: string, _keys: number, key: string, ttl: number): Promise<unknown> => { const count = increment(key); if (!ttls.has(key)) ttls.set(key, ttl); return count }) }
  const database: any = { lead, $queryRaw: jest.fn().mockResolvedValue([]), legalConsent: { createMany: jest.fn().mockResolvedValue({ count: 1 }) } }
  database.leadSubmission = { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) }
  database.$transaction = jest.fn(async callback => callback(database))
  return { lead, redis, counters, ttls, service: new LeadService(database, {} as any, redis) }
}

describe('public lead isolated boundaries', () => {
  it('trims optional fields, records the public source and bounds user-agent metadata', async () => {
    const { service, lead } = fixture()
    await service.submitPublicLead({ ...leadConsent, phone: fictionalPhone, name: ' Fictional contact ', storeName: ' Synthetic store ', storeScale: ' 1-3家 ', interestedItems: ' 丸滑 ' }, '127.0.0.1', 'x'.repeat(1000))
    expect(lead.create).toHaveBeenCalledWith({ data: { tenantId: 1, submissionKey: expect.stringMatching(/^[a-f0-9]{64}$/), submissionDigest: expect.stringMatching(/^[a-f0-9]{64}$/), phone: fictionalPhone, name: 'Fictional contact', storeName: 'Synthetic store', storeScale: '1-3家', interestedItems: '丸滑', source: 'official_site', status: 'new', ipAddress: '127.0.0.1', userAgent: 'x'.repeat(250) } })
  })

  it('drops a filled honeypot before counters or database writes', async () => {
    const { service, lead, redis } = fixture()
    expect(await service.submitPublicLead({ ...leadConsent, phone: fictionalPhone, website: 'https://example.invalid/bot' }, '127.0.0.1', 'synthetic')).toEqual({ success: true })
    expect(redis.eval).not.toHaveBeenCalled()
    expect(lead.create).not.toHaveBeenCalled()
  })

  it('limits a phone at its fourth attempt even when each request uses a different source IP', async () => {
    const { service, lead, redis } = fixture()
    for (const ip of ['127.0.0.1', '127.0.0.2', '127.0.0.3']) await service.submitPublicLead({ ...leadConsent, phone: fictionalPhone }, ip, 'synthetic')
    await expect(service.submitPublicLead({ ...leadConsent, phone: fictionalPhone }, '127.0.0.4', 'synthetic')).rejects.toMatchObject({ status: 429 })
    expect(lead.create).toHaveBeenCalledTimes(3)
    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining("redis.call('TTL'"), 1, 'lead:rate:phone:' + fictionalPhone, 3600)
  })

  it('rejects new public leads with a readable503 while Redis is unavailable', async () => {
    const { service, lead, redis } = fixture()
    redis.incr.mockRejectedValue(new Error('synthetic Redis outage'))
    redis.eval.mockRejectedValue(new Error('synthetic Redis outage'))
    try { await service.submitPublicLead({ ...leadConsent, phone: fictionalPhone }, '127.0.0.9', 'synthetic'); throw new Error('Unexpected success') } catch (error) {
      expect(error).toBeInstanceOf(HttpException)
      expect((error as HttpException).getStatus()).toBe(503)
      expect((error as Error).message).toContain('暂不可用')
    }
    expect(lead.create).not.toHaveBeenCalled()
  })

  it('repairs an existing exhausted IP key without a TTL before rejecting the attempt', async () => {
    const { service, lead, counters, ttls } = fixture()
    counters.set('lead:rate:ip:127.0.0.1', 5)
    await expect(service.submitPublicLead({ ...leadConsent, phone: fictionalPhone }, '127.0.0.1', 'synthetic')).rejects.toMatchObject({ status: 429 })
    expect(ttls.get('lead:rate:ip:127.0.0.1')).toBe(3600)
    expect(lead.create).not.toHaveBeenCalled()
  })

  it('does not swallow an expiry command failure or create a lead without a bounded rate key', async () => {
    const { service, lead, redis } = fixture()
    redis.expire.mockRejectedValue(new Error('synthetic expiry failure'))
    redis.eval.mockRejectedValue(new Error('synthetic expiry failure'))
    await expect(service.submitPublicLead({ ...leadConsent, phone: fictionalPhone }, '127.0.0.1', 'synthetic')).rejects.toMatchObject({ status: 503 })
    expect(lead.create).not.toHaveBeenCalled()
  })

  it.each([null, 0, -1, 'not-a-counter', [1]])('rejects an invalid atomic counter result %p before writing', async reply => {
    const { service, lead, redis } = fixture()
    redis.eval.mockResolvedValue(reply)
    await expect(service.submitPublicLead({ ...leadConsent, phone: fictionalPhone }, '127.0.0.1', 'synthetic')).rejects.toMatchObject({ status: 503 })
    expect(lead.create).not.toHaveBeenCalled()
  })
})
