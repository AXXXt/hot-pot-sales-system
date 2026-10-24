import { BadRequestException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { ConsentChannel, ConsentInputDto } from './consent.dto'
import { currentLegalPolicy } from './legal-policy'

export const LEGAL_VERSION = currentLegalPolicy.version
export const LEGAL_DOCUMENT_HASH = createHash('sha256').update(JSON.stringify(currentLegalPolicy)).digest('hex')
export const ACCOUNT_CONSENT_CHANNELS: ConsentChannel[] = ['mini', 'buyer_web', 'admin_web']

export function assertLegalConsent(input: ConsentInputDto | undefined, channels: ConsentChannel[] = ACCOUNT_CONSENT_CHANNELS): void {
  if (input?.consentAccepted !== true || !input.consentChannel || !channels.includes(input.consentChannel)) {
    throw new BadRequestException({ message: '请先阅读并同意用户协议和隐私政策', errorCode: 'LEGAL_CONSENT_REQUIRED' })
  }
  if (input.consentVersion !== LEGAL_VERSION) {
    throw new BadRequestException({ message: '协议版本已更新，请刷新页面或更新小程序后重新阅读并同意', errorCode: 'LEGAL_VERSION_CHANGED' })
  }
}

interface ConsentWriter {
  legalConsent: {
    createMany(args: { data: Array<{ tenantId: number; userId?: number; leadId?: number; version: string; documentHash: string; channel: string }>; skipDuplicates: boolean }): Promise<unknown>
  }
}

/** 只接受服务端核验的主体ID，不记录客户端时间、原始手机号或伪造的历史同意。 */
export async function recordLegalConsent(client: ConsentWriter, input: ConsentInputDto, subject: { tenantId: number; userId?: number; leadId?: number }): Promise<void> {
  assertLegalConsent(input, subject.leadId ? ['official_site'] : ACCOUNT_CONSENT_CHANNELS)
  const userSubject = Number.isSafeInteger(subject.userId) && Number(subject.userId) > 0
  const leadSubject = Number.isSafeInteger(subject.leadId) && Number(subject.leadId) > 0
  if (!Number.isSafeInteger(subject.tenantId) || subject.tenantId < 1 || userSubject === leadSubject) throw new Error('Verified legal consent subject required')
  await client.legalConsent.createMany({
    data: [{ tenantId: subject.tenantId, userId: subject.userId, leadId: subject.leadId, version: LEGAL_VERSION,
      documentHash: LEGAL_DOCUMENT_HASH, channel: input.consentChannel! }], skipDuplicates: true
  })
}
