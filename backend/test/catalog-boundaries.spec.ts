import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { BrandService } from '../src/brand/brand.service'
import { StaffActor } from '../src/auth/staff-access.service'
import { ProductService } from '../src/product/product.service'
import { ProductMutationGuard } from '../src/product/product-mutation.guard'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateSkuDto, UpdateSkuDto } from '../src/product/dto/create-sku.dto'
import { UpdateProductDto } from '../src/product/dto/create-product.dto'

const actor = { id: 7, tenantId: 2, superAdmin: false, brandIds: [5] } as StaffActor
const context = (request: object) => ({ switchToHttp: () => ({ getRequest: () => request }) }) as any
function fixture() {
  const prisma: any = {
    auditLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    brand: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn() },
    unit: { findFirst: jest.fn().mockResolvedValue(null) },
    productCategory: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    product: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), create: jest.fn(), update: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([])
  }
  prisma.$transaction = jest.fn(callback => callback(prisma))
  return prisma
}
const products = (prisma: any) => new ProductService(prisma, {} as any, {} as any, { write: jest.fn() } as any)

describe('catalog management data boundaries', () => {
  it('applies assigned brand scope to both list and counts, including disabled assignments', async () => {
    const prisma = fixture()
    await new BrandService(prisma).list(2, 'disabled', actor)
    const scope = { tenantId: 2, userAccess: { some: { tenantId: 2, userId: 7 } } }
    expect(prisma.brand.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ...scope, status: 'disabled' } }))
    expect(prisma.product.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 2, brand: scope } }))
  })

  it('limits the shared brand catalog to assigned staff brands without changing guest/customer semantics', async () => {
    const prisma = fixture()
    prisma.user = { findUnique: jest.fn().mockResolvedValue({ tenantId: 2, userType: 'sales' }) }
    const service = products(prisma)
    await service.brands(7)
    expect(prisma.brand.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { tenantId: 2, status: 'active', userAccess: { some: { tenantId: 2, userId: 7 } } } }))
    prisma.user.findUnique.mockResolvedValue({ tenantId: 2, userType: 'customer_user' })
    await service.brands(8)
    expect(prisma.brand.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { tenantId: 2, status: 'active' } }))
    await service.brands()
    expect(prisma.brand.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { tenantId: 1, status: 'active' } }))
  })

  it.each(['update', 'delete', 'restore'] as const)('rejects unassigned or foreign brand %s without mutation', async method => {
    const prisma = fixture()
    prisma.brand.findFirst.mockResolvedValue(null)
    const service = new BrandService(prisma)
    const result = method === 'update' ? service.update(2, 99, { name: 'Unauthorized' }, actor) : service[method](2, 99, actor)
    await expect(result).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.brand.findFirst).toHaveBeenCalledWith({ where: { tenantId: 2, id: 99, userAccess: { some: { tenantId: 2, userId: 7 } } } })
    expect(prisma.brand.update).not.toHaveBeenCalled()
  })

  it('does not let restricted staff create a new brand outside their assigned range', async () => {
    const prisma = fixture()
    await expect(new BrandService(prisma).create(2, { name: 'New brand' }, actor)).rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.brand.create).not.toHaveBeenCalled()
  })

  it.each([2, 99])('rejects invalid unit %s before allocating a product identity', async unitId => {
    const prisma = fixture()
    await expect(products(prisma).create({ brandId: 5, categoryId: 3, unitId }, 2)).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.unit.findFirst).toHaveBeenCalledWith({ where: { id: unitId, tenantId: 2, status: 'active' }, select: { id: true } })
    expect(prisma.brand.findFirst).not.toHaveBeenCalled()
    expect(prisma.product.create).not.toHaveBeenCalled()
  })

  it('rejects a foreign or disabled unit when editing a product', async () => {
    const prisma = fixture()
    prisma.product.findUnique.mockResolvedValue({ id: 6, tenantId: 2, brandId: 5, categoryId: 3 })
    await expect(products(prisma).update(6, { unitId: 99 })).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.product.update).not.toHaveBeenCalled()
  })

  it('rejects a foreign or disabled parent category before creating a category', async () => {
    const prisma = fixture()
    prisma.productCategory.findFirst.mockResolvedValue(null)
    await expect(products(prisma).createCategory({ name: 'Child', code: 'CHILD', parentId: 99 }, 2)).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.productCategory.findFirst).toHaveBeenCalledWith({ where: { id: 99, tenantId: 2, status: 'active' }, select: { id: true, parentId: true } })
    expect(prisma.productCategory.create).not.toHaveBeenCalled()
  })

  it.each([3, 4])('rejects direct and indirect category cycles via parent %s', async parentId => {
    const prisma = fixture()
    prisma.productCategory.findFirst.mockImplementation(async ({ where }: any) => where.status ? { id: 4, parentId: 3 } : { id: 3, tenantId: 2, name: 'Parent' })
    await expect(products(prisma).updateCategory(3, { parentId }, 2)).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(prisma.productCategory.update).not.toHaveBeenCalled()
  })

  it('disables a parent with children instead of issuing a foreign-key failure', async () => {
    const prisma = fixture()
    prisma.productCategory.findFirst.mockResolvedValue({ id: 3, _count: { children: 1 } })
    await expect(products(prisma).deleteCategory(3, 2)).resolves.toEqual({ id: 3, deletionMode: 'disabled', linkedProductCount: 0 })
    expect(prisma.productCategory.delete).not.toHaveBeenCalled()
    expect(prisma.productCategory.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { status: 'disabled' } })
  })

  it.each([{ name: '  ' }, { code: '' }, { name: null }, { code: 'x'.repeat(65) }])('rejects invalid category text %p before writes', async dto => {
    const prisma = fixture()
    await expect(products(prisma).updateCategory(3, dto as any, 2)).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('requires an active staff actor for category management even when no product id exists', async () => {
    const access = { actor: jest.fn().mockRejectedValue(new ForbiddenException()) }
    const guard = new ProductMutationGuard(access as any, {} as any)
    await expect(guard.canActivate(context({ method: 'POST', route: { path: '/product-categories' }, user: { sub: 7, tenantId: 2 } }))).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('validates every selected product before allowing a mixed-scope bulk mutation', async () => {
    const access = { actor: jest.fn().mockResolvedValue(actor), product: jest.fn().mockResolvedValueOnce({ id: 1 }).mockRejectedValueOnce(new NotFoundException()) }
    const guard = new ProductMutationGuard(access as any, {} as any)
    await expect(guard.canActivate(context({ method: 'PATCH', route: { path: '/products/batch-status' }, params: {}, user: { sub: 7, tenantId: 2 }, body: { productIds: [1, 99], status: 'disabled' } }))).rejects.toBeInstanceOf(NotFoundException)
    expect(access.product).toHaveBeenNthCalledWith(2, actor, 99)
  })

  it.each(['basePrice', 'specText', 'saleUnit', 'minOrderQty', 'batchTracking', 'lowStockThreshold', 'leadTimeDays', 'safetyStock'])('rejects null for non-nullable optional SKU field %s', async field => {
    expect(await validate(plainToInstance(UpdateSkuDto, { [field]: null }))).toEqual(expect.arrayContaining([expect.objectContaining({ property: field })]))
  })

  it('rejects out-of-range SKU quantity values before reaching MySQL', async () => {
    expect(await validate(plainToInstance(CreateSkuDto, { specText: '袋', saleUnit: '袋', basePrice: '10', minOrderQty: 2147483648 }))).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'minOrderQty' })]))
    expect(await validate(plainToInstance(UpdateSkuDto, { minOrderQty: 1, basePrice: '0.00', name: null, imageUrl: null }))).toEqual([])
  })

  it.each(['categoryId', 'isFactoryProduct', 'supportSample', 'isRecommended', 'isNew', 'isHot'])('rejects null for non-nullable product field %s', async field => {
    expect(await validate(plainToInstance(UpdateProductDto, { [field]: null }))).toEqual(expect.arrayContaining([expect.objectContaining({ property: field })]))
  })

  it('records create and update audits in the actual product tenant', async () => {
    const prisma = fixture(), write = jest.fn()
    prisma.brand.findFirst.mockResolvedValue({ id: 5, name: '品牌', code: 'BRAND' })
    prisma.productCategory.findFirst.mockResolvedValue({ id: 3, name: '分类' })
    prisma.productCategory.update.mockResolvedValue({ productSequence: 1 })
    prisma.product.findFirst = jest.fn().mockResolvedValueOnce(null).mockResolvedValue({ id: 6, tenantId: 5, name: '标签', skus: [] })
    prisma.product.findUnique.mockResolvedValue({ id: 6, tenantId: 5, brandId: 5, categoryId: 3 })
    prisma.product.create.mockResolvedValue({ id: 6, tenantId: 5, name: '标签' })
    const service = new ProductService(prisma, {} as any, { whereForUser: async () => ({ tenantId: 5 }) } as any, { write } as any)
    await service.create({ brandId: 5, categoryId: 3 }, 5)
    await service.update(6, { subtitle: '真实名' }, 7)
    expect(write.mock.calls.map(([input]) => input.tenantId)).toEqual([5, 5])
  })

  it.each(['status', 'batch-status', 'archive', 'batch-archive'])('records %s audits in the actual product tenant', async method => {
    const prisma = fixture(), write = jest.fn()
    prisma.product.update.mockResolvedValue({ id: 6, tenantId: 5, status: 'archived' })
    prisma.product.findUnique.mockResolvedValue({ id: 6, tenantId: 5, status: 'active' })
    prisma.product.findMany.mockResolvedValue([{ id: 6, tenantId: 5 }])
    prisma.product.updateMany = jest.fn().mockResolvedValue({ count: 1 })
    const service = new ProductService(prisma, {} as any, {} as any, { write } as any)
    if (method === 'status') await service.updateStatus(6, 'disabled')
    if (method === 'batch-status') await service.batchUpdateStatus([6], 'disabled')
    if (method === 'archive') await service.archiveProduct(6)
    if (method === 'batch-archive') await service.batchArchiveProducts([6])
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 5 }))
  })

  it('rejects mixed-tenant service bulk writes even when invoked without an HTTP guard', async () => {
    const prisma = fixture()
    prisma.product.findMany.mockResolvedValue([{ id: 6, tenantId: 5 }, { id: 7, tenantId: 8 }])
    prisma.product.updateMany = jest.fn()
    await expect(products(prisma).batchArchiveProducts([6, 7])).rejects.toBeInstanceOf(BadRequestException)
    await expect(products(prisma).batchUpdateStatus([6, 7], 'disabled')).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.product.updateMany).not.toHaveBeenCalled()
  })
})
