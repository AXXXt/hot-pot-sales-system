import { validate } from 'class-validator'
import { CreateSkuDto, UpdateSkuDto } from '../src/product/dto/create-sku.dto'
import { ProductService } from '../src/product/product.service'

describe('catalog regression safety', () => {
  it.each(['-1', 'NaN', 'Infinity', '12.345', '10000000000000000'])('rejects invalid SKU price %s', async basePrice => {
    const dto = Object.assign(new UpdateSkuDto(), { basePrice })
    expect((await validate(dto)).some(error => error.property === 'basePrice')).toBe(true)
  })

  it('allows free prices while rejecting empty specifications and invalid minimum quantities', async () => {
    expect(await validate(Object.assign(new UpdateSkuDto(), { basePrice: '0', minOrderQty: 1 }))).toEqual([])
    const dto = Object.assign(new CreateSkuDto(), { skuCode: '', specText: ' ', saleUnit: '', basePrice: '29.90', minOrderQty: 0, stockNum: -1 })
    expect((await validate(dto)).map(error => error.property)).toEqual(expect.arrayContaining(['skuCode', 'specText', 'saleUnit', 'minOrderQty', 'stockNum']))
  })

  it('sorts by current agreement prices before pagination, including zero prices', async () => {
    const prisma = {
      product: { findMany: jest.fn().mockResolvedValue([
        { id: 1, skus: [{ id: 11, basePrice: '50' }] },
        { id: 2, skus: [{ id: 21, basePrice: '100' }, { id: 22, basePrice: '120' }] }
      ]), count: jest.fn().mockResolvedValue(2) },
      user: { findUnique: jest.fn().mockResolvedValue({ customerId: 3 }) },
      customerPriceRule: { findMany: jest.fn().mockResolvedValue([{ skuId: 22, price: { toString: () => '0' } }]) }
    }
    const service = new ProductService(prisma as any, {} as any, { whereForUser: async () => ({ tenantId: 1, status: 'active' }) } as any, {} as any)
    const result = await service.list({ page: 1, pageSize: 1, sortBy: 'price_asc' }, 3)
    expect(result.items.map(item => item.id)).toEqual([2])
    expect(result.items[0].skus.find(sku => sku.id === 22)).toMatchObject({ customerPrice: '0' })
  })

  it('hides disabled SKUs in customer detail but keeps them editable by staff', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 1, skus: [] })
    const whereForUser = jest.fn().mockResolvedValue({ tenantId: 1, status: 'active' })
    const service = new ProductService({ product: { findFirst } } as any, {} as any, { whereForUser } as any, {} as any)
    await service.detail(1)
    expect(findFirst.mock.calls[0][0].include.skus.where).toEqual({ status: 'active' })
    whereForUser.mockResolvedValue({ tenantId: 1 })
    await service.detail(1)
    expect(findFirst.mock.calls[1][0].include.skus.where).toBeUndefined()
  })
})
