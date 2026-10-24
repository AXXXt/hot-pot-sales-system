import { createHash, randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { AuthService } from '../src/auth/auth.service'
import { LEGAL_VERSION } from '../src/legal/legal-consent'
import { sessionMemory } from './helpers/session-memory'

function fixture() {
  const jwt = new JwtService(), secret = randomUUID()
  const config = new ConfigService({ JWT_ACCESS_SECRET: secret, JWT_REFRESH_SECRET: secret })
  const { redis, values } = sessionMemory()
  const input = { phone: '13911112222', code: '123456', consentAccepted: true, consentVersion: LEGAL_VERSION, consentChannel: 'mini' as const }
  const user = { id: 7, tenantId: 3, customerId: 2, userType: 'customer_user', status: 'disabled', tenant: { status: 'active' }, customer: { id: 2, tenantId: 3, customerName: 'Private fixture store', status: 'disabled' } }
  const db = {
    user: { findUnique: jest.fn(async () => user) },
    auditLog: { findFirst: jest.fn(async () => ({ afterData: { action: 'submit_registration' } })) },
    legalConsent: { createMany: jest.fn() }
  }
  const sms = { verifyCode: jest.fn(async () => true) }
  const auth = new AuthService(db as any, jwt, config, sms as any, {} as any, redis)
  return { jwt, secret, redis, values, input, user, db, sms, auth }
}

it('returns the same generic response for every unverified phone and never reads accounts', async () => {
  const { auth, db, redis } = fixture()
  for (const phone of ['13911112222', '13800000000']) await expect(auth.checkStatus(phone)).resolves.toEqual({ verificationRequired: true })
  expect(db.user.findUnique).not.toHaveBeenCalled()
  expect(redis.get).not.toHaveBeenCalled()
  expect(redis.eval).not.toHaveBeenCalled()
})

it('restores pending application access only after fresh SMS and consent and emits no login tokens', async () => {
  const { auth, input, jwt, sms, db } = fixture()
  const result = await auth.registrationStatus(input)
  expect(result).toMatchObject({ exists: true, reviewStatus: 'pending', customerName: 'Private fixture store' })
  expect(result).not.toHaveProperty('accessToken')
  expect(result).not.toHaveProperty('refreshToken')
  expect(sms.verifyCode).toHaveBeenCalledWith(input.phone, input.code)
  expect(db.legalConsent.createMany).toHaveBeenCalledTimes(1)
  expect(jwt.decode(result.statusTicket!)).toMatchObject({ sub: 7, tenantId: 3, tokenUse: 'registration_status' })
  expect(JSON.stringify(jwt.decode(result.statusTicket!))).not.toContain(input.phone)
  await expect(auth.checkStatus(input.phone, result.statusTicket!)).resolves.toMatchObject({ reviewStatus: 'pending' })
})

it('does not consume SMS or read identities when legal consent is missing', async () => {
  const { auth, input, sms, db } = fixture()
  await expect(auth.registrationStatus({ ...input, consentAccepted: false })).rejects.toMatchObject({ status: 400 })
  expect(sms.verifyCode).not.toHaveBeenCalled()
  expect(db.user.findUnique).not.toHaveBeenCalled()
})

it('does not disclose accounts on invalid SMS or a wrong phone/tampered ticket', async () => {
  const { auth, input, sms, db } = fixture()
  sms.verifyCode.mockResolvedValueOnce(false)
  await expect(auth.registrationStatus(input)).rejects.toMatchObject({ status: 401 })
  expect(db.user.findUnique).not.toHaveBeenCalled()
  const result = await auth.registrationStatus(input)
  db.user.findUnique.mockClear()
  await expect(auth.checkStatus('13800000000', result.statusTicket!)).rejects.toMatchObject({ status: 401 })
  await expect(auth.checkStatus(input.phone, result.statusTicket! + 'tamper')).rejects.toMatchObject({ status: 401 })
  expect(db.user.findUnique).not.toHaveBeenCalled()
})

it('rejects expired tickets and access tokens used as tickets', async () => {
  const { auth, input, jwt, secret, db } = fixture()
  const payload = { sub: 7, tenantId: 3, ph: createHash('sha256').update(input.phone).digest('hex') }
  for (const ticket of [jwt.sign({ ...payload, tokenUse: 'registration_status' }, { secret, expiresIn: -1 }), jwt.sign({ ...payload, tokenUse: 'access' }, { secret, expiresIn: '1h' })]) {
    await expect(auth.checkStatus(input.phone, ticket)).rejects.toMatchObject({ status: 401, response: { errorCode: 'AUTH_STATUS_TICKET_EXPIRED' } })
  }
  expect(db.user.findUnique).not.toHaveBeenCalled()
})

it('does not follow a ticket across changed user or tenant identity', async () => {
  const { auth, input, user } = fixture()
  const result = await auth.registrationStatus(input)
  user.tenantId = 4
  await expect(auth.checkStatus(input.phone, result.statusTicket!)).resolves.toEqual({ exists: false, userStatus: null, customerStatus: null, customerName: null, reviewStatus: 'not_registered' })
})

it('caps authenticated application polling and fails closed on rate-store errors', async () => {
  const { auth, input, values, redis, db } = fixture()
  const result = await auth.registrationStatus(input)
  const rateKey = `auth:status-rate:${createHash('sha256').update(result.statusTicket!).digest('hex')}`
  values.set(rateKey, '120')
  db.user.findUnique.mockClear()
  await expect(auth.checkStatus(input.phone, result.statusTicket!)).rejects.toMatchObject({ status: 429 })
  expect(db.user.findUnique).not.toHaveBeenCalled()
  redis.eval.mockRejectedValueOnce(new Error('private connection'))
  await expect(auth.checkStatus(input.phone, result.statusTicket!)).rejects.toMatchObject({ status: 503, response: { errorCode: 'AUTH_STATUS_UNAVAILABLE' } })
})

it('never issues registration tickets for staff accounts', async () => {
  const { auth, input, user, db } = fixture()
  user.userType = 'admin'
  await expect(auth.registrationStatus(input)).rejects.toMatchObject({ status: 403 })
  expect(db.legalConsent.createMany).not.toHaveBeenCalled()
})
