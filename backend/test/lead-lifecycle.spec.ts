import { LeadService } from '../src/lead/lead.service'
import { LEGAL_VERSION } from '../src/legal/legal-consent'
import { randomUUID } from 'node:crypto'

const input = () => ({ phone: '13900001111', storeName: 'Synthetic store', requestId: randomUUID(), consentAccepted: true, consentVersion: LEGAL_VERSION, consentChannel: 'official_site' as const })

function fixture() {
  let record: any = null
  const lead = {
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn(async ({ where }) => record?.submissionKey === where.submissionKey ? record : null),
    create: jest.fn(async ({ data }) => { record = { ...data, id: 10 }; return record })
  }
  const database: any = { lead, $queryRaw: jest.fn().mockResolvedValue([]), legalConsent: { createMany: jest.fn().mockResolvedValue({ count: 1 }) } }
  const accepted = new Map<string, any>()
  database.leadSubmission = { findUnique: jest.fn(async ({ where }) => accepted.get(where.key) || null), create: jest.fn(async ({ data }) => { accepted.set(data.key, data); return data }) }
  database.$transaction = jest.fn(async callback => callback(database))
  const redis = { eval: jest.fn().mockResolvedValue(1) }
  return { lead, database, redis, service: new LeadService(database, {} as any, redis) }
}

it('returns the original accepted submission after response loss without a second row, consent or rate increment', async () => {
  const f = fixture(), dto = input()
  expect(await f.service.submitPublicLead(dto, '127.0.0.1', 'local')).toEqual({ success: true, id: 10 })
  expect(await f.service.submitPublicLead(dto, '127.0.0.1', 'local')).toEqual({ success: true, id: 10 })
  expect(f.lead.create).toHaveBeenCalledTimes(1)
  expect(f.database.legalConsent.createMany).toHaveBeenCalledTimes(1)
  expect(f.redis.eval).toHaveBeenCalledTimes(2)
})

it('rejects a reused request key with different normalized content before another write', async () => {
  const f = fixture(), dto = input()
  await f.service.submitPublicLead(dto, '127.0.0.1', 'local')
  await expect(f.service.submitPublicLead({ ...dto, storeName: 'Different store' }, '127.0.0.1', 'local')).rejects.toMatchObject({ response: { errorCode: 'LEAD_IDEMPOTENCY_CONFLICT' } })
  expect(f.lead.create).toHaveBeenCalledTimes(1)
})

it('accepts harmless whitespace normalization in a retried submission', async () => {
  const f = fixture(), dto = input()
  await f.service.submitPublicLead(dto, '127.0.0.1', 'local')
  expect(await f.service.submitPublicLead({ ...dto, storeName: ` ${dto.storeName} ` }, '127.0.0.1', 'local')).toEqual({ success: true, id: 10 })
  expect(f.lead.create).toHaveBeenCalledTimes(1)
})

it('uses the committed winning request after a unique-key race rather than exposing a database failure', async () => {
  const f = fixture(), dto = input()
  const originalCreate = f.lead.create.getMockImplementation()!
  f.lead.create.mockImplementationOnce(async args => { await originalCreate(args); throw { code: 'P2002' } })
  expect(await f.service.submitPublicLead(dto, '127.0.0.1', 'local')).toEqual({ success: true, id: 10 })
  expect(f.database.legalConsent.createMany).not.toHaveBeenCalled()
})

it('rejects a missing request nonce before rate counters and keeps the honeypot silently ignored', async () => {
  const f = fixture()
  await expect(f.service.submitPublicLead({ ...input(), requestId: undefined }, '127.0.0.1', 'local')).rejects.toMatchObject({ response: { errorCode: 'LEAD_REQUEST_ID_REQUIRED' } })
  expect(await f.service.submitPublicLead({ phone: '13900001111', website: 'filled honeypot' }, '127.0.0.1', 'local')).toEqual({ success: true })
  expect(f.redis.eval).not.toHaveBeenCalled()
  expect(f.lead.create).not.toHaveBeenCalled()
})

it('checks equal recent consultations inside the tenant lock even when the browser created another nonce', async () => {
  const f = fixture(), dto = input()
  await f.service.submitPublicLead(dto, '127.0.0.1', 'local')
  f.lead.findFirst.mockResolvedValue({ id: 10, submissionDigest: f.lead.create.mock.calls[0][0].data.submissionDigest })
  expect(await f.service.submitPublicLead({ ...dto, requestId: randomUUID() }, '127.0.0.2', 'local')).toEqual({ success: true, id: 10 })
  expect(f.database.$queryRaw).toHaveBeenCalledTimes(2)
  expect(f.lead.create).toHaveBeenCalledTimes(1)
  expect(f.database.legalConsent.createMany).toHaveBeenCalledTimes(1)
})
