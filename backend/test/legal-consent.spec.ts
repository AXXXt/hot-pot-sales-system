import { BadRequestException } from '@nestjs/common'
import { assertLegalConsent, LEGAL_DOCUMENT_HASH, LEGAL_VERSION, recordLegalConsent } from '../src/legal/legal-consent'
import { currentLegalPolicy } from '../src/legal/legal-policy'

const accepted = { consentAccepted: true, consentVersion: LEGAL_VERSION, consentChannel: 'mini' as const }

describe('versioned legal consent boundaries', () => {
  it.each([undefined, {}, { ...accepted, consentAccepted: false }, { ...accepted, consentAccepted: 'true' },
    { ...accepted, consentChannel: 'official_site' }, { ...accepted, consentChannel: 'forged' }])('rejects missing, implicit or wrong-channel account consent: %p', value => {
    expect(() => assertLegalConsent(value as any)).toThrow(BadRequestException)
  })

  it('rejects an obsolete document without accepting a client hash or timestamp', async () => {
    const client = { legalConsent: { createMany: jest.fn() } }
    await expect(recordLegalConsent(client, { ...accepted, consentVersion: 'obsolete' }, { tenantId: 1, userId: 7 })).rejects.toMatchObject({ response: { errorCode: 'LEGAL_VERSION_CHANGED' } })
    expect(client.legalConsent.createMany).not.toHaveBeenCalled()
  })

  it('records the verified account and current full-document digest, with database time and first-consent deduplication', async () => {
    const client = { legalConsent: { createMany: jest.fn().mockResolvedValue({ count: 1 }) } }
    await recordLegalConsent(client, { ...accepted, acceptedAt: '2000-01-01', phone: 'private-phone', documentHash: 'forged' } as any, { tenantId: 1, userId: 7 })
    expect(client.legalConsent.createMany).toHaveBeenCalledWith({ data: [{ tenantId: 1, userId: 7, leadId: undefined,
      version: LEGAL_VERSION, documentHash: LEGAL_DOCUMENT_HASH, channel: 'mini' }], skipDuplicates: true })
    expect(LEGAL_DOCUMENT_HASH).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(client.legalConsent.createMany.mock.calls)).not.toContain('private-phone')
    expect(JSON.stringify(client.legalConsent.createMany.mock.calls)).not.toContain('2000-01-01')
  })

  it('only accepts official-site consent for a verified lead and propagates a failed write', async () => {
    const client = { legalConsent: { createMany: jest.fn().mockRejectedValue(new Error('synthetic persistence error')) } }
    await expect(recordLegalConsent(client, accepted, { tenantId: 1, leadId: 9 })).rejects.toMatchObject({ response: { errorCode: 'LEGAL_CONSENT_REQUIRED' } })
    await expect(recordLegalConsent(client, { ...accepted, consentChannel: 'official_site' }, { tenantId: 1, leadId: 9 })).rejects.toThrow('synthetic persistence error')
    expect(client.legalConsent.createMany).toHaveBeenCalledTimes(1)
  })

  it('retains draft status and owner-confirmed facts while unresolved operating facts remain explicit', () => {
    expect(currentLegalPolicy.operator).toBe('河南唯哆鲜食品有限公司')
    expect(currentLegalPolicy.phone).toBe('13937802005')
    expect(currentLegalPolicy.readiness.status).toBe('draft')
    expect(currentLegalPolicy.readiness.pending.join(' ')).toContain('保存期限')
    expect(currentLegalPolicy.notice).toContain('审阅稿')
  })
})
