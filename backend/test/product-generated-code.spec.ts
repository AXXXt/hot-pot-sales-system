import { ProductService } from '../src/product/product.service'

function createPrismaMock() {
  const prisma: any = {
    brand: { findFirst: jest.fn() },
    productCategory: { findFirst: jest.fn(), update: jest.fn() },
    product: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    }
  }
  prisma.$transaction = jest.fn(async (callback: (transaction: any) => unknown) => callback(prisma))
  return prisma
}

function createService(prisma: any) {
  return new ProductService(
    prisma,
    { get: jest.fn(), set: jest.fn() } as any,
    { whereForUser: jest.fn().mockResolvedValue({}) } as any
  )
}

describe('ProductService generated identity', () => {
  it('creates 德品鸭血 with DEPIN-YaXue-001 and ignores client identity', async () => {
    const prisma = createPrismaMock()
    prisma.brand.findFirst.mockResolvedValue({ id: 4, name: '德品', code: 'DEPIN' })
    prisma.productCategory.findFirst.mockResolvedValue({ id: 8, name: '鸭血' })
    prisma.productCategory.update.mockResolvedValue({ productSequence: 1 })
    prisma.product.findFirst.mockResolvedValue(null)
    prisma.product.create.mockImplementation(async ({ data }: any) => ({ id: 21, ...data }))
    const service = createService(prisma)

    const product = await service.create({
      brandId: 4,
      categoryId: 8,
      name: '伪造名称',
      code: 'MANUAL'
    }, 1)

    expect(product).toMatchObject({ name: '德品鸭血', code: 'DEPIN-YaXue-001' })
    expect(prisma.product.create.mock.calls[0][0].data).toMatchObject({
      tenantId: 1,
      brandId: 4,
      categoryId: 8,
      name: '德品鸭血',
      code: 'DEPIN-YaXue-001'
    })
  })

  it('shares category sequence across different brands', async () => {
    const prisma = createPrismaMock()
    let sequence = 0
    prisma.brand.findFirst.mockImplementation(async ({ where }: any) => where.id === 4
      ? { id: 4, name: '德品', code: 'DEPIN' }
      : { id: 5, name: '美味', code: 'MEIWEI' })
    prisma.productCategory.findFirst.mockResolvedValue({ id: 8, name: '鸭血' })
    prisma.productCategory.update.mockImplementation(async () => ({ productSequence: ++sequence }))
    prisma.product.findFirst.mockResolvedValue(null)
    prisma.product.create.mockImplementation(async ({ data }: any) => ({ id: sequence, ...data }))
    const service = createService(prisma)

    const first = await service.create({ brandId: 4, categoryId: 8, name: '', code: '' }, 1)
    const second = await service.create({ brandId: 5, categoryId: 8, name: '', code: '' }, 1)

    expect(first.code).toBe('DEPIN-YaXue-001')
    expect(second.code).toBe('MEIWEI-YaXue-002')
  })

  it('skips an already-used generated code and advances the category counter', async () => {
    const prisma = createPrismaMock()
    prisma.brand.findFirst.mockResolvedValue({ id: 4, name: '德品', code: 'DEPIN' })
    prisma.productCategory.findFirst.mockResolvedValue({ id: 8, name: '鸭血' })
    prisma.productCategory.update
      .mockResolvedValueOnce({ productSequence: 1 })
      .mockResolvedValueOnce({ productSequence: 2 })
    prisma.product.findFirst
      .mockResolvedValueOnce({ id: 99 })
      .mockResolvedValueOnce(null)
    prisma.product.create.mockImplementation(async ({ data }: any) => ({ id: 22, ...data }))
    const service = createService(prisma)

    const product = await service.create({ brandId: 4, categoryId: 8, name: '', code: '' }, 1)

    expect(product.code).toBe('DEPIN-YaXue-002')
    expect(prisma.productCategory.update).toHaveBeenCalledTimes(2)
  })

  it('keeps code when brand and category do not change', async () => {
    const prisma = createPrismaMock()
    prisma.product.findUnique.mockResolvedValue({
      id: 21,
      tenantId: 1,
      brandId: 4,
      categoryId: 8,
      name: '德品鸭血',
      code: 'DEPIN-YaXue-001'
    })
    prisma.product.update.mockResolvedValue({ id: 21 })
    prisma.product.findFirst.mockResolvedValue({
      id: 21,
      brandId: 4,
      categoryId: 8,
      subtitle: '新副标题',
      name: '德品鸭血',
      code: 'DEPIN-YaXue-001',
      skus: []
    })
    const service = createService(prisma)

    await service.update(21, {
      brandId: 4,
      categoryId: 8,
      name: '伪造名称',
      code: 'MANUAL',
      subtitle: '新副标题'
    }, 1)

    expect(prisma.productCategory.update).not.toHaveBeenCalled()
    const updateData = prisma.product.update.mock.calls[0][0].data
    expect(updateData).toEqual({ subtitle: '新副标题' })
    expect(updateData).not.toHaveProperty('name')
    expect(updateData).not.toHaveProperty('code')
  })

  it('allocates a new code when brand changes', async () => {
    const prisma = createPrismaMock()
    prisma.product.findUnique.mockResolvedValue({ id: 21, tenantId: 1, brandId: 4, categoryId: 8 })
    prisma.brand.findFirst.mockResolvedValue({ id: 5, name: '美味', code: 'MEIWEI' })
    prisma.productCategory.findFirst.mockResolvedValue({ id: 8, name: '鸭血' })
    prisma.productCategory.update.mockResolvedValue({ productSequence: 2 })
    prisma.product.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 21, name: '美味鸭血', code: 'MEIWEI-YaXue-002', skus: [] })
    prisma.product.update.mockResolvedValue({ id: 21 })
    const service = createService(prisma)

    await service.update(21, { brandId: 5 }, 1)

    expect(prisma.product.update.mock.calls[0][0].data).toMatchObject({
      brandId: 5,
      categoryId: 8,
      name: '美味鸭血',
      code: 'MEIWEI-YaXue-002'
    })
  })

  it('searches by product name or product code', async () => {
    const prisma = createPrismaMock()
    prisma.product.findMany.mockResolvedValue([])
    prisma.product.count.mockResolvedValue(0)
    const service = createService(prisma)

    await service.list({ keyword: 'DEPIN-YaXue-001', page: 1, pageSize: 20 })

    expect(prisma.product.findMany.mock.calls[0][0].where.OR).toEqual([
      { name: { contains: 'DEPIN-YaXue-001' } },
      { code: { contains: 'DEPIN-YaXue-001' } }
    ])
  })
})
