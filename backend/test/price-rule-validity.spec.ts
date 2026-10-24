import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CustomerService } from '../src/customer/customer.service'
import { CreatePriceRuleDto } from '../src/customer/dto/create-customer.dto'

function fixture() {
  const db: any = {
    customer: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
    productSku: { findFirst: jest.fn().mockResolvedValue({ id: 2, productId: 3, product: { brandId: 4 } }) },
    customerPriceRule: { upsert: jest.fn().mockResolvedValue({ id: 5 }) }
  }
  const audit = { write: jest.fn() }
  return { db, audit, service: new CustomerService(db, audit as any) }
}

describe('agreement price validity configuration', () => {
  it('persists explicit timezone dates on both create and replace and records their normalized instants', async () => {
    const { service, db, audit } = fixture()
    await service.createPriceRule({ customerId: 1, skuId: 2, price: '8.80', startAt: '2026-10-24T08:00:00+08:00', endAt: '2026-10-25T08:00:00+08:00' })
    const change = db.customerPriceRule.upsert.mock.calls[0][0]
    for (const key of ['create', 'update']) {
      expect(change[key].startAt.toISOString()).toBe('2026-10-24T00:00:00.000Z')
      expect(change[key].endAt.toISOString()).toBe('2026-10-25T00:00:00.000Z')
    }
    expect(audit.write.mock.calls[0][0].afterData).toMatchObject({ startAt: '2026-10-24T00:00:00.000Z', endAt: '2026-10-25T00:00:00.000Z' })
  })
  it.each([
    ['2026-10-25T00:00:00Z', '2026-10-24T00:00:00Z'],
    ['2026-10-24T00:00:00Z', '2026-10-24T00:00:00Z'],
    ['invalid', null], [null, 'invalid']
  ])('rejects an invalid window before writing (%s, %s)', async (startAt, endAt) => {
    const { service, db, audit } = fixture()
    await expect(service.createPriceRule({ customerId: 1, skuId: 2, price: '8.80', startAt, endAt })).rejects.toThrow('时间')
    expect(db.customerPriceRule.upsert).not.toHaveBeenCalled(); expect(audit.write).not.toHaveBeenCalled()
  })
  it('supports clearing both dates to explicitly restore an unlimited window', async () => {
    const { service, db } = fixture()
    await service.createPriceRule({ customerId: 1, skuId: 2, price: '8.80', startAt: null, endAt: null })
    expect(db.customerPriceRule.upsert.mock.calls[0][0]).toMatchObject({ update: { startAt: null, endAt: null }, create: { startAt: null, endAt: null } })
  })
  it.each(['2026-10-24', '2026-10-24T08:00:00', '2026-02-30T08:00:00+08:00', 'not-a-date'])('requires a real ISO datetime with an explicit timezone (%s)', async startAt => {
    const dto = plainToInstance(CreatePriceRuleDto, { customerId: 1, skuId: 2, price: '8.80', startAt })
    expect((await validate(dto)).length).toBeGreaterThan(0)
  })
})
