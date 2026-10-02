export const EXPERIENCE_SMS_CODE = '123456'

export function experienceSmsSettings(config: { get(key: string, fallback?: string): unknown }) {
  const phones = String(config.get('SMS_TEST_PHONES', '')).split(',').map(phone => phone.trim()).filter(Boolean)
  const expiresAt = Date.parse(String(config.get('SMS_TEST_EXPIRES_AT', '')))
  const valid = phones.length > 0 && phones.every(phone => /^1[3-9]\d{9}$/.test(phone)) && Number.isFinite(expiresAt)
  return { phones, expiresAt, valid, active: valid && Date.now() < expiresAt }
}
