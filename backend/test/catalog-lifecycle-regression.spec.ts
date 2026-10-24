import { BadRequestException, ConflictException } from '@nestjs/common'
import { BrandService } from '../src/brand/brand.service'
import { ProductService } from '../src/product/product.service'
import { OrderService } from '../src/order/order.service'

describe('catalog lifecycle boundaries without a shared database', () => {
  it.each(['create', 'update'] as const)('returns a useful conflict for a normalized duplicate brand prefix during %s', async operation => {
    const prisma: any = { $queryRaw: jest.fn().mockResolvedValue([]), brand: { findFirst: jest.fn().mockResolvedValue({ id: 5, tenantId: 9, name: 'Original', code: 'ORIGINAL' }),
      create: jest.fn().mockRejectedValue({ code: 'P2002' }), update: jest.fn().mockRejectedValue({ code: 'P2002' }) }, product: { findMany: jest.fn(), update: jest.fn() } }
    prisma.$transaction = jest.fn(callback => callback(prisma))
    const service = new BrandService(prisma)
    const result = operation === 'create' ? service.create(9, { name: 'Duplicate', code: ' de-pin ' }) : service.update(9, 5, { name: 'Duplicate', code: ' de-pin ' })
    try { await result; throw new Error('Unexpected duplicate success') } catch (error) {
      expect(error).toBeInstanceOf(ConflictException)
      expect((error as ConflictException).getResponse()).toEqual({ message: '品牌编码前缀已存在', errorCode: 'BRD_1002' })
    }
    expect(prisma.brand[operation]).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ code: 'DEPIN' }) }))
    expect(prisma.product.findMany).not.toHaveBeenCalled()
    expect(prisma.product.update).not.toHaveBeenCalled()
  })

  it('archives a historically referenced product without mutating its order snapshot, SKU stock or relationships', async () => {
    const product = { id: 17, tenantId: 9, status: 'active', name: 'Management label', subtitle: 'Current name' }
    const historical = { id: 25, orderNo: 'SYNTHETIC-HISTORY', status: 'completed', items: [{ id: 1, productId: 17, skuId: 19,
      productName: 'Original order name', skuSpecText: '500克/袋', quantity: 2, unitPrice: '19.90', amount: '39.80', saleUnit: '袋' }], statusLogs: [], refunds: [] }
    const sku = { id: 19, productId: 17, skuCode: 'PRODUCT-01', stockNum: 22, reservedNum: 3, status: 'active' }
    const before = JSON.stringify({ historical, sku })
    const destructive = jest.fn(() => { throw new Error('Historical relationships must be retained') })
    const prisma: any = { product: { findUnique: jest.fn().mockResolvedValue(product), update: jest.fn(async ({ data }) => { Object.assign(product, data); return { id: product.id, status: product.status } }), delete: destructive },
      productSku: { delete: destructive, deleteMany: destructive, update: destructive }, order: { findUnique: jest.fn().mockResolvedValue(historical), deleteMany: destructive },
      orderItem: { deleteMany: destructive, updateMany: destructive } }
    const write = jest.fn()
    const products = new ProductService(prisma, {} as any, {} as any, { write } as any)
    expect(await products.archiveProduct(17)).toEqual({ id: 17, status: 'archived' })
    const orders = new OrderService(prisma, {} as any, {} as any, {} as any, {} as any)
    expect((await orders.detail(25)).items).toEqual(historical.items)
    expect(JSON.stringify({ historical, sku })).toBe(before)
    expect(destructive).not.toHaveBeenCalled()
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 9, action: 'delete', targetId: 17 }))
    await products.archiveProduct(17)
    expect(prisma.product.update).toHaveBeenCalledTimes(1)
  })

  it('copies allowed SKU settings with a fresh code and no client stock, reservations, status or identity', async () => {
    const product = { id: 17, tenantId: 9, code: 'PRODUCT', images: ['/a.jpg', '/b.jpg'] }
    const create = jest.fn(async ({ data }) => ({ id: 20, stockNum: 0, reservedNum: 0, status: 'active', ...data }))
    const prisma: any = { auditLog: { create: jest.fn() }, $queryRaw: jest.fn().mockResolvedValue([]), product: { findUnique: jest.fn().mockResolvedValue(product) },
      productSku: { findMany: jest.fn().mockResolvedValue([{ skuCode: 'PRODUCT-01' }, { skuCode: 'PRODUCT-09' }]), findUnique: jest.fn().mockResolvedValue(null), create } }
    prisma.$transaction = jest.fn(callback => callback(prisma))
    const input: any = { id: 19, skuCode: 'PRODUCT-01', status: 'disabled', stockNum: 999, reservedNum: 500, specText: '200克/袋', saleUnit: '袋', basePrice: '0',
      minOrderQty: 3, imageUrl: '/b.jpg', packagingUnits: [{ unit: '箱', factor: 20 }], lowStockThreshold: 0, leadTimeDays: 4, safetyStock: 0, batchTracking: true }
    const result = await new ProductService(prisma, {} as any, {} as any, {} as any).createSku(17, input)
    expect(result).toMatchObject({ id: 20, skuCode: 'PRODUCT-10', stockNum: 0, reservedNum: 0, status: 'active', basePrice: '0', minOrderQty: 3,
      imageUrl: '/b.jpg', packagingUnits: [{ unit: '箱', factor: 20 }], lowStockThreshold: 0, leadTimeDays: 4, safetyStock: 0, batchTracking: true })
    const data = create.mock.calls[0]![0].data
    for (const key of ['id', 'stockNum', 'reservedNum', 'status']) expect(data).not.toHaveProperty(key)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it('changes only the SKU state through disable and enable, preserving stock and outstanding reservations', async () => {
    const sku = { id: 19, tenantId: 9, status: 'active', stockNum: 22, reservedNum: 3, skuCode: 'PRODUCT-01' }
    const update = jest.fn(async ({ data }) => Object.assign(sku, data))
    const prisma: any = { $queryRaw: jest.fn().mockResolvedValue([]), productSku: { update, findUnique: jest.fn(async () => ({ ...sku })) }, auditLog: { create: jest.fn() } }
    prisma.$transaction = jest.fn((fn: any) => fn(prisma))
    const service = new ProductService(prisma, {} as any, {} as any, {} as any)
    await service.updateSkuStatus(19, 'disabled')
    expect(sku).toMatchObject({ status: 'disabled', stockNum: 22, reservedNum: 3, skuCode: 'PRODUCT-01' })
    await service.updateSkuStatus(19, 'active')
    expect(sku).toMatchObject({ status: 'active', stockNum: 22, reservedNum: 3 })
    expect(update.mock.calls.map(([arg]) => arg.data)).toEqual([{ status: 'disabled' }, { status: 'active' }])
    await expect(service.updateSkuStatus(19, 'archived')).rejects.toBeInstanceOf(BadRequestException)
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('excludes disabled SKUs from customer detail and cart, and exposes them again only after enabling', async () => {
    const sku = { id: 19, tenantId: 9, productId: 17, status: 'active', stockNum: 22, reservedNum: 3, minOrderQty: 1, basePrice: '19.90',
      specText: '500克/袋', saleUnit: '袋', product: { brandId: 4, name: 'Management', subtitle: 'Real name' } }
    const prisma: any = { $queryRaw: jest.fn().mockResolvedValue([]), auditLog: { create: jest.fn() }, productSku: { findUnique: jest.fn(async () => ({ ...sku })), update: jest.fn(async ({ data }) => Object.assign(sku, data)), findMany: jest.fn(async ({ where }) => where.status === sku.status ? [sku] : []) },
      product: { findFirst: jest.fn(async ({ include }) => ({ id: 17, name: 'Management', subtitle: 'Real name', skus: include.skus.where?.status === sku.status ? [sku] : [] })) } }
    prisma.$transaction = jest.fn((fn: any) => fn(prisma))
    const service = new ProductService(prisma, {} as any, { whereForUser: async () => ({ tenantId: 9, status: 'active' }) } as any, {} as any)
    await service.updateSkuStatus(19, 'disabled')
    expect((await service.detail(17)).skus).toEqual([])
    expect(await service.validateCart([19], undefined as any)).toEqual({ items: [], invalidSkuIds: [19] })
    await service.updateSkuStatus(19, 'active')
    expect((await service.detail(17)).skus.map(item => item.id)).toEqual([19])
    expect((await service.validateCart([19], undefined as any)).items[0]).toMatchObject({ skuId: 19, name: 'Real name', stockNum: 19, available: true })
  })
})
