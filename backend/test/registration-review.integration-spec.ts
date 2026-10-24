import { createHash } from 'node:crypto'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { AuthService } from '../src/auth/auth.service'

const url = process.env.TEST_DATABASE_URL
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Isolated TEST_DATABASE_URL required')
const db = new PrismaClient({ datasources: { db: { url } } })
const jwt = new JwtService(), statusSecret = randomUUID()
// This suite exercises real MySQL decisions; rate-store behavior has a separate Redis integration.
const service = new AuthService(db as any, jwt, new ConfigService({ JWT_REFRESH_SECRET: statusSecret }), {} as any, {} as any, { eval: async () => 1 } as any)
const status = () => service.checkStatus(phone, jwt.sign({ sub: userId, tenantId, ph: createHash('sha256').update(phone).digest('hex'), tokenUse: 'registration_status' }, { secret: statusSecret, expiresIn: '24h' }))
let tenantId: number, customerId: number, userId: number
const phone = 'R' + randomUUID().slice(0, 15)

beforeAll(async () => {
  tenantId = (await db.tenant.create({ data: { code: randomUUID(), name: 'Registration review fixture' } })).id
  customerId = (await db.customer.create({ data: { tenantId, customerName: 'QA审核门店', status: 'disabled' } })).id
  userId = (await db.user.create({ data: {
    tenantId, customerId, phone, name: 'QA审核员', userType: 'customer_user', status: 'disabled'
  } })).id
})

afterAll(async () => {
  if (tenantId) {
    await db.auditLog.deleteMany({ where: { tenantId } })
    await db.user.deleteMany({ where: { tenantId } })
    await db.customer.deleteMany({ where: { tenantId } })
    await db.tenant.delete({ where: { id: tenantId } })
  }
  await db.$disconnect()
})

const decision = (action: string, targetId = String(customerId)) => db.auditLog.create({ data: {
  tenantId, action: 'update', module: 'customer', targetType: 'customer', targetId,
  requestId: randomUUID(), afterData: { action }
} })

it('uses actual MySQL JSON decisions through pending, rejected, resubmitted, approved and disabled states', async () => {
  expect(await status()).toMatchObject({ reviewStatus: 'disabled' })
  await decision('submit_registration')
  expect(await status()).toMatchObject({ reviewStatus: 'pending' })
  await db.auditLog.create({ data: {
    tenantId, action: 'update', module: 'customer', targetType: 'customer', targetId: String(customerId),
    requestId: randomUUID(), afterData: { status: 'disabled' }
  } })
  expect(await status()).toMatchObject({ reviewStatus: 'disabled' })
  await decision('submit_registration')
  expect(await status()).toMatchObject({ reviewStatus: 'pending' })
  await decision('reject')
  await decision('update_product_visibility')
  await decision('approve', String(customerId + 1000000))
  expect(await status()).toMatchObject({ reviewStatus: 'rejected' })
  await decision('submit_registration')
  expect(await status()).toMatchObject({ reviewStatus: 'pending' })
  await db.$transaction([
    db.customer.update({ where: { id: customerId }, data: { status: 'active' } }),
    db.user.update({ where: { id: userId }, data: { status: 'active' } })
  ])
  await decision('approve')
  expect(await status()).toMatchObject({ reviewStatus: 'approved' })
  await db.user.update({ where: { id: userId }, data: { status: 'disabled' } })
  expect(await status()).toMatchObject({ reviewStatus: 'disabled' })
})
