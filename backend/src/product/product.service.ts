import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { REDIS } from '../redis.provider'
import { Inject } from '@nestjs/common'
import { CreateProductDto, UpdateProductDto } from './dto/create-product.dto'
import { CreateSkuDto, UpdateSkuDto } from './dto/create-sku.dto'
import { CreateCategoryDto, UpdateCategoryDto } from './dto/create-category.dto'
import { ProductVisibilityService } from './product-visibility.service'
import { AuditService } from '../audit/audit.service'
import { buildProductCode, toCategorySegment } from './product-code'
import { normalizeProductTitle, presentProduct, productDisplayName } from './product-presentation'
import { imageUpdate } from './product-images'
import { nextSkuCode } from './sku-code'
import { skuOptions } from './sku-options'
import { stockAvailability } from '../inventory/stock-availability'
import { writeCatalogAudit } from '../audit/catalog-audit'

const PRODUCT_LIST_INCLUDE = Prisma.validator<Prisma.ProductInclude>()({
  category: { select: { id: true, name: true } },
  unit: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true } },
  skus: {
    where: { status: 'active' },
    select: {
      id: true,
      skuCode: true,
      name: true,
      specText: true,
      saleUnit: true,
      basePrice: true,
      minOrderQty: true,
      stockNum: true, reservedNum: true, imageUrl: true, packagingUnits: true, batchTracking: true
    },
    orderBy: { basePrice: 'asc' }
  }
})

interface ListParams {
  brandId?: number
  categoryId?: number
  keyword?: string
  feed?: string
  sortBy?: string
  inStock?: boolean
  includeDisabled?: boolean
  page: number
  pageSize: number
}

@Injectable()
export class ProductService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: { get: (key: string) => Promise<string | null>; set: (key: string, value: string, mode?: string, ttl?: number) => Promise<'OK' | null> },
    private readonly visibility: ProductVisibilityService,
    private readonly audit: AuditService
  ) {}

  async list(params: ListParams, userId?: number) {
    const { brandId, categoryId, keyword, feed, sortBy, inStock, includeDisabled, page, pageSize } = params
    const accessWhere = await this.visibility.whereForUser(userId)
    const where: any = { status: includeDisabled ? { not: 'archived' } : 'active', ...accessWhere }
    if (brandId) {
      if (accessWhere.brandId) where.AND = [{ brandId }]
      else where.brandId = brandId
    }
    if (categoryId) where.categoryId = categoryId
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { code: { contains: keyword } },
        { subtitle: { contains: keyword } },
        { brand: { name: { contains: keyword } } },
        { skus: { some: { status: 'active', specText: { contains: keyword } } } }
      ]
    }
    if (feed === 'new') where.isNew = true
    if (feed === 'hot') where.isHot = true
    if (inStock) {
      where.skus = { some: { status: 'active', stockNum: { gt: 0 } } }
    }

    if (feed === 'frequent') {
      return this.frequentList(where, brandId, page, userId, Boolean(accessWhere.status))
    }

    const priceSort = sortBy === 'price_asc' || sortBy === 'price_desc'
    const itemPromise = this.prisma.product.findMany({
      where,
      include: PRODUCT_LIST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      ...(priceSort || inStock ? {} : {
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    })

    const [items, total] = await Promise.all([
      itemPromise,
      this.prisma.product.count({ where })
    ])

    let pricedItems = (await this.applyAgreementPrices(items, userId, Boolean(accessWhere.status))).map(product => ({
      ...product,
      skus: [...product.skus].sort((left, right) => (
        Number(left.customerPrice ?? left.basePrice) - Number(right.customerPrice ?? right.basePrice)
      ))
    }))
    if (inStock) pricedItems = pricedItems.filter(product => product.skus.some(sku => sku.availableNum >= ((sku as any).minOrderQty || 1)))
    const pageItems = priceSort
      ? this.sortByPrice(pricedItems, sortBy).slice((page - 1) * pageSize, page * pageSize)
      : inStock ? pricedItems.slice((page - 1) * pageSize, page * pageSize) : pricedItems

    return { items: pageItems, page, pageSize, total: inStock ? pricedItems.length : total }
  }

  async create(dto: CreateProductDto, tenantId: number = 1) {
    const subtitle = normalizeProductTitle(dto.subtitle)
    const gallery = imageUpdate(dto)
    if (!dto.brandId) {
      throw new BadRequestException({ message: '请选择品牌', errorCode: 'BRD_1003' })
    }

    const product = await this.prisma.$transaction(async (transaction) => {
      await this.assertUnit(transaction, tenantId, dto.unitId)
      const identity = await this.allocateProductIdentity(transaction, tenantId, dto.brandId!, dto.categoryId)
      return transaction.product.create({
        data: {
          tenantId,
          brandId: identity.brand.id,
          categoryId: identity.category.id,
          unitId: dto.unitId,
          code: identity.code,
          name: identity.name,
          subtitle,
          baseSpec: dto.baseSpec,
          ...gallery,
          description: dto.description,
          deliveryText: dto.deliveryText,
          isRecommended: dto.isRecommended ?? false,
          isNew: dto.isNew ?? false,
          isHot: dto.isHot ?? false,
          isFactoryProduct: dto.isFactoryProduct ?? false,
          supportSample: dto.supportSample ?? false
        },
        include: { category: { select: { id: true, name: true } }, brand: { select: { id: true, name: true } } }
      })
    })

    await this.audit.write({
      tenantId: product.tenantId,
      action: 'create',
      module: 'product',
      targetType: 'product',
      targetId: product.id,
      afterData: { code: product.code, name: product.name, brandId: product.brandId, categoryId: product.categoryId }
    })
    return presentProduct(product)
  }

  async allocateProductIdentity(
    transaction: Prisma.TransactionClient,
    tenantId: number,
    brandId: number,
    categoryId: number
  ) {
    const brand = await transaction.brand.findFirst({
      where: { id: brandId, tenantId, status: 'active' },
      select: { id: true, name: true, code: true }
    })
    const category = await transaction.productCategory.findFirst({
      where: { id: categoryId, tenantId, status: 'active' },
      select: { id: true, name: true }
    })

    if (!brand) {
      throw new BadRequestException({ message: '品牌不存在或已停用', errorCode: 'BRD_1003' })
    }
    if (!category) {
      throw new BadRequestException({ message: '分类不存在或已停用', errorCode: 'CAT_1003' })
    }

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const sequence = await transaction.productCategory.update({
        where: { id: category.id },
        data: { productSequence: { increment: 1 } },
        select: { productSequence: true }
      })
      const code = buildProductCode(brand.code, category.name, sequence.productSequence)
      if (code.length > 64) {
        throw new BadRequestException({ message: '自动生成的商品编码超过 64 个字符', errorCode: 'PRO_1004' })
      }
      const collision = await transaction.product.findFirst({ where: { tenantId, code }, select: { id: true } })
      if (!collision) {
        return { brand, category, name: `${brand.name}${category.name}`, code }
      }
    }

    throw new ConflictException({ message: '无法分配唯一商品编码', errorCode: 'PRO_1005' })
  }

  async detail(id: number, userId?: number) {
    const accessWhere = await this.visibility.whereForUser(userId)
    const product = await this.prisma.product.findFirst({
      where: { id, ...accessWhere },
      include: {
        category: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        skus: {
          ...(accessWhere.status ? { where: { status: 'active' as const } } : {}),
          select: { id: true, skuCode: true, name: true, specText: true, saleUnit: true, basePrice: true, minOrderQty: true, stockNum: true, reservedNum: true, imageUrl: true, packagingUnits: true, lowStockThreshold: true, leadTimeDays: true, safetyStock: true, batchTracking: true, status: true },
          orderBy: { basePrice: 'asc' }
        }
      }
    })
    if (!product) throw new NotFoundException({ message: '商品不存在', errorCode: 'PRO_1001' })
    return this.applyAgreementPrice(product, userId, Boolean(accessWhere.status))
  }

  async update(id: number, dto: UpdateProductDto, userId?: number) {
    const subtitle = normalizeProductTitle(dto.subtitle)
    const current = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.product.findUnique({
        where: { id },
        select: { id: true, tenantId: true, brandId: true, categoryId: true, images: true, mainImageUrl: true }
      })
      if (!current) {
        throw new NotFoundException({ message: '商品不存在', errorCode: 'PRO_1001' })
      }
      await this.assertUnit(transaction, current.tenantId, dto.unitId)

      const nextBrandId = dto.brandId ?? current.brandId
      const nextCategoryId = dto.categoryId ?? current.categoryId
      const identityChanged = nextBrandId !== current.brandId || nextCategoryId !== current.categoryId
      const updateData: Record<string, unknown> = { ...dto }
      delete updateData.brandId
      delete updateData.categoryId
      delete updateData.name
      delete updateData.code
      if (subtitle !== undefined) updateData.subtitle = subtitle
      Object.assign(updateData, imageUpdate(dto, current))

      if (identityChanged) {
        if (!nextCategoryId) {
          throw new BadRequestException({ message: '请选择分类', errorCode: 'CAT_1003' })
        }
        const identity = await this.allocateProductIdentity(transaction, current.tenantId, nextBrandId, nextCategoryId)
        Object.assign(updateData, {
          brandId: identity.brand.id,
          categoryId: identity.category.id,
          name: identity.name,
          code: identity.code
        })
      }

      await transaction.product.update({ where: { id }, data: updateData })
      if (Array.isArray(updateData.images)) await transaction.productSku.updateMany({ where: { productId: id, imageUrl: { notIn: updateData.images as string[] } }, data: { imageUrl: null } })
      return current
    })
    await this.audit.write({
      tenantId: current.tenantId,
      action: 'update',
      module: 'product',
      targetType: 'product',
      targetId: id,
      afterData: { ...dto },
      operatorId: userId
    })
    return this.detail(id, userId)
  }

  async updateStatus(id: number, status: string) {
    if (!['active', 'disabled'].includes(status)) {
      throw new BadRequestException({ message: '无效状态', errorCode: 'PRO_1002' })
    }
    const product = await this.prisma.product.update({ where: { id }, data: { status: status as any }, select: { tenantId: true } })
    await this.audit.write({
      tenantId: product.tenantId,
      action: 'update',
      module: 'product',
      targetType: 'product',
      targetId: id,
      afterData: { status }
    })
    return { id, status }
  }

  async batchUpdateStatus(productIds: number[], status: string) {
    if (!productIds.length || productIds.some(id => !Number.isInteger(id) || id <= 0)) {
      throw new BadRequestException({ message: '请选择有效商品', errorCode: 'PRO_1004' })
    }
    if (!['active', 'disabled'].includes(status)) {
      throw new BadRequestException({ message: '无效状态', errorCode: 'PRO_1002' })
    }

    const uniqueProductIds = [...new Set(productIds)]
    const tenantId = await this.batchTenantId(uniqueProductIds)
    const result = await this.prisma.product.updateMany({
      where: { tenantId, id: { in: uniqueProductIds } },
      data: { status: status as any }
    })
    await this.audit.write({
      tenantId,
      action: 'update',
      module: 'product',
      targetType: 'product',
      targetId: uniqueProductIds.join(','),
      afterData: { productIds: uniqueProductIds, status, updatedCount: result.count }
    })
    return {
      productIds: uniqueProductIds,
      status,
      updatedCount: result.count
    }
  }

  async archiveProduct(id: number) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException({ message: '请选择有效商品', errorCode: 'PRO_1004' })
    }

    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true, tenantId: true, status: true }
    })
    if (!product) {
      throw new NotFoundException({ message: '商品不存在', errorCode: 'PRO_1001' })
    }
    if (product.status === 'archived') return { id: product.id, status: product.status }

    const updated = await this.prisma.product.update({
      where: { id },
      data: { status: 'archived' },
      select: { id: true, status: true }
    })
    await this.audit.write({
      tenantId: product.tenantId,
      action: 'delete',
      module: 'product',
      targetType: 'product',
      targetId: id,
      beforeData: { status: product.status },
      afterData: { status: 'archived' }
    })
    return updated
  }

  async batchArchiveProducts(productIds: number[]) {
    if (!productIds.length || productIds.some(id => !Number.isInteger(id) || id <= 0)) {
      throw new BadRequestException({ message: '请选择有效商品', errorCode: 'PRO_1004' })
    }

    const uniqueProductIds = [...new Set(productIds)]
    const tenantId = await this.batchTenantId(uniqueProductIds)
    const result = await this.prisma.product.updateMany({
      where: { tenantId, id: { in: uniqueProductIds }, status: { not: 'archived' } },
      data: { status: 'archived' }
    })
    await this.audit.write({
      tenantId,
      action: 'delete',
      module: 'product',
      targetType: 'product',
      targetId: uniqueProductIds.join(','),
      afterData: { productIds: uniqueProductIds, status: 'archived', updatedCount: result.count }
    })
    return {
      productIds: uniqueProductIds,
      status: 'archived',
      updatedCount: result.count
    }
  }

  private async batchTenantId(productIds: number[]) {
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, tenantId: true } })
    if (products.length !== productIds.length) throw new NotFoundException('部分商品不存在或不可访问')
    const tenantId = products[0].tenantId
    if (products.some(product => product.tenantId !== tenantId)) throw new BadRequestException('不能跨租户批量操作商品')
    return tenantId
  }

  async skus(productId: number, userId?: number) {
    const scope = await this.visibility.assertVisible(productId, userId)
    const skus = await this.prisma.productSku.findMany({
      where: { productId, status: 'active' },
      orderBy: { basePrice: 'asc' }
    })
    return this.applySkuAgreementPrices(skus, userId, Boolean(scope?.status))
  }

  async validateCart(skuIds: number[], userId: number) {
    const accessWhere = await this.visibility.whereForUser(userId)
    const skus = await this.prisma.productSku.findMany({
      where: {
        id: { in: skuIds },
        status: 'active',
        product: { is: accessWhere }
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            subtitle: true,
            brandId: true,
            brand: { select: { name: true } }
          }
        }
      }
    })
    const pricedSkus = await this.applySkuAgreementPrices(skus, userId, Boolean(accessWhere.status))
    const foundIds = new Set(pricedSkus.map(sku => sku.id))

    return {
      items: pricedSkus.map(sku => ({
        skuId: sku.id,
        productId: sku.productId,
        brandId: sku.product.brandId,
        brandName: sku.product.brand?.name || '',
        name: productDisplayName(sku.product),
        spec: sku.specText,
        unit: sku.saleUnit,
        price: sku.customerPrice ?? sku.basePrice.toString(),
        customerPrice: sku.customerPrice,
        basePrice: sku.basePrice.toString(),
        minOrderQty: sku.minOrderQty,
        stockNum: sku.availableNum,
        available: sku.availableNum >= sku.minOrderQty,
        unavailableReason: sku.availableNum >= sku.minOrderQty ? null : '该规格已售罄'
      })),
      invalidSkuIds: skuIds.filter(skuId => !foundIds.has(skuId))
    }
  }

  async createSku(productId: number, dto: CreateSkuDto, userId?: number) {
    return this.prisma.$transaction(async tx => {
      // 同一商品并发新增规格时串行分配，不采用客户端预览值。
      await tx.$queryRaw(Prisma.sql`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`)
      const product = await tx.product.findUnique({ where: { id: productId } })
      if (!product) throw new NotFoundException({ message: '商品不存在', errorCode: 'PRO_1001' })
      const existing = await tx.productSku.findMany({ where: { productId }, select: { skuCode: true } })
      const codes = existing.map(sku => sku.skuCode)
      let skuCode = nextSkuCode(product.code, codes)
      for (let attempts = 0; await tx.productSku.findUnique({ where: { tenantId_skuCode: { tenantId: product.tenantId, skuCode } }, select: { id: true } }); attempts++) {
        if (attempts >= 100) throw new ConflictException('规格编码冲突，请检查历史规格')
        codes.push(skuCode)
        skuCode = nextSkuCode(product.code, codes)
      }
      const created = await tx.productSku.create({ data: {
        tenantId: product.tenantId,
        productId,
        skuCode,
        name: dto.name,
        specText: dto.specText,
        saleUnit: dto.saleUnit,
        basePrice: dto.basePrice,
        minOrderQty: dto.minOrderQty,
        ...skuOptions(dto, product)
      } })
      await writeCatalogAudit(tx, { kind: 'product_sku', tenantId: product.tenantId, operatorId: userId, action: 'create', id: created.id, after: created })
      return created
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
  }

  async updateSku(id: number, dto: UpdateSkuDto, userId?: number) {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM product_skus WHERE id = ${id} FOR UPDATE`)
      const current = await tx.productSku.findUnique({ where: { id }, include: { product: true } })
      if (!current) throw new NotFoundException('规格不存在')
      const data = { ...dto }
      delete data.stockNum
      if (dto.stockNum !== undefined) throw new BadRequestException('库存必须通过出入库或盘点调整')
      const updated = await tx.productSku.update({ where: { id }, data: { ...data, ...skuOptions(dto, current.product, current) } })
      if (!current.batchTracking && dto.batchTracking && current.stockNum > 0) await tx.stockBatch.create({ data: { tenantId: current.tenantId, skuId: current.id, batchNo: '__LEGACY__', quantity: current.stockNum } })
      await writeCatalogAudit(tx, { kind: 'product_sku', tenantId: current.tenantId, operatorId: userId, action: 'update', id, before: current, after: updated })
    })
    return this.prisma.productSku.findUnique({ where: { id } })
  }

  async updateSkuStatus(id: number, status: string, userId?: number) {
    if (!['active', 'disabled'].includes(status)) {
      throw new BadRequestException({ message: '无效状态', errorCode: 'PRO_1002' })
    }
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM product_skus WHERE id = ${id} FOR UPDATE`)
      const current = await tx.productSku.findUnique({ where: { id } })
      if (!current) throw new NotFoundException('规格不存在')
      const updated = await tx.productSku.update({ where: { id }, data: { status: status as any } })
      await writeCatalogAudit(tx, { kind: 'product_sku', tenantId: current.tenantId, operatorId: userId, action: 'update', id, before: current, after: updated })
      return updated
    })
  }

  private async catalogTenantId(userId?: number) {
    if (!userId) return 1
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { tenantId: true } })
    return user?.tenantId ?? -1
  }

  async categories(userId?: number) {
    const categories = await this.prisma.productCategory.findMany({
      where: { tenantId: await this.catalogTenantId(userId), status: 'active' },
      orderBy: { sortOrder: 'asc' }
    })
    return categories.map((category) => ({
      ...category,
      codeSegment: toCategorySegment(category.name)
    }))
  }

  async managedCategories(tenantId: number) {
    const [categories, productCounts] = await Promise.all([
      this.prisma.productCategory.findMany({
        where: { tenantId, status: { in: ['active', 'disabled'] } },
        include: { _count: { select: { products: true } } },
        orderBy: { sortOrder: 'asc' }
      }),
      this.prisma.product.groupBy({
        by: ['categoryId', 'status'],
        where: { tenantId, categoryId: { not: null } },
        _count: { _all: true }
      })
    ])
    const countByCategory = new Map<number, { current: number; archived: number }>()
    for (const productCount of productCounts) {
      if (productCount.categoryId == null) continue
      const counts = countByCategory.get(productCount.categoryId) || { current: 0, archived: 0 }
      const value = productCount._count._all
      if (productCount.status === 'archived') counts.archived += value
      else counts.current += value
      countByCategory.set(productCount.categoryId, counts)
    }
    return categories.map((category) => ({
      ...category,
      codeSegment: toCategorySegment(category.name),
      currentProductCount: countByCategory.get(category.id)?.current || 0,
      archivedProductCount: countByCategory.get(category.id)?.archived || 0,
      historicalProductCount: category._count.products
    }))
  }

  async createCategory(dto: CreateCategoryDto, tenantId = 1, userId?: number) {
    this.assertCategoryText(dto)
    try {
      return await this.prisma.$transaction(async transaction => {
        await this.assertCategoryParent(transaction, tenantId, dto.parentId)
        const created = await transaction.productCategory.create({
          data: { tenantId, code: dto.code.trim(), name: dto.name.trim(), sortOrder: dto.sortOrder || 0, parentId: dto.parentId }
        })
        await writeCatalogAudit(transaction, { kind: 'product_category', tenantId, operatorId: userId, action: 'create', id: created.id, after: created })
        return created
      })
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw new ConflictException({ message: '分类名称已存在', errorCode: 'CAT_1002' })
      }
      throw error
    }
  }

  async updateCategory(id: number, dto: UpdateCategoryDto, tenantId: number, userId?: number) {
    this.assertCategoryText(dto)
    try {
      return await this.prisma.$transaction(async (transaction) => {
        // 所有父级改动先锁本租户分类树，防止并发 A→B、B→A 形成环。
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM product_categories WHERE tenant_id = ${tenantId} ORDER BY id FOR UPDATE`)
        const current = await transaction.productCategory.findFirst({ where: { id, tenantId } })
        if (!current) {
          throw new NotFoundException({ message: '分类不存在', errorCode: 'CAT_1001' })
        }

        await this.assertCategoryParent(transaction, tenantId, dto.parentId, id, true)
        const data = { ...dto, ...(dto.name !== undefined ? { name: dto.name.trim() } : {}), ...(dto.code !== undefined ? { code: dto.code.trim() } : {}) }
        const updated = await transaction.productCategory.update({ where: { id }, data })
        if (data.name !== undefined && data.name !== current.name) {
          const products = await transaction.product.findMany({
            where: { tenantId, categoryId: id },
            select: { id: true, brand: { select: { name: true } } }
          })
          await Promise.all(products.map((product) => transaction.product.update({
            where: { id: product.id },
            data: { name: `${product.brand.name}${data.name}` }
          })))
        }
        await writeCatalogAudit(transaction, { kind: 'product_category', tenantId, operatorId: userId, action: 'update', id, before: current, after: updated })
        return updated
      })
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw new ConflictException({ message: '分类名称已存在', errorCode: 'CAT_1002' })
      }
      throw error
    }
  }

  async deleteCategory(id: number, tenantId: number, userId?: number) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM product_categories WHERE tenant_id = ${tenantId} ORDER BY id FOR UPDATE`)
      const category = await transaction.productCategory.findFirst({ where: { id, tenantId }, include: { _count: { select: { children: true } } } })
      if (!category) {
        throw new NotFoundException({ message: '分类不存在', errorCode: 'CAT_1001' })
      }

      const linkedProductCount = await transaction.product.count({ where: { tenantId, categoryId: id } })
      if (linkedProductCount === 0 && !category._count?.children) {
        await transaction.productCategory.delete({ where: { id } })
        await writeCatalogAudit(transaction, { kind: 'product_category', tenantId, operatorId: userId, action: 'delete', id, before: category })
        return { id, deletionMode: 'physical' as const, linkedProductCount }
      }

      const updated = await transaction.productCategory.update({ where: { id }, data: { status: 'disabled' } })
      await writeCatalogAudit(transaction, { kind: 'product_category', tenantId, operatorId: userId, action: 'update', id, before: category, after: updated })
      return { id, deletionMode: 'disabled' as const, linkedProductCount }
    })
  }

  async restoreCategory(id: number, tenantId: number, userId?: number) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM product_categories WHERE tenant_id = ${tenantId} ORDER BY id FOR UPDATE`)
      const category = await tx.productCategory.findFirst({ where: { id, tenantId } })
      if (!category) throw new NotFoundException({ message: '分类不存在', errorCode: 'CAT_1001' })
      const updated = await tx.productCategory.update({ where: { id }, data: { status: 'active' } })
      await writeCatalogAudit(tx, { kind: 'product_category', tenantId, operatorId: userId, action: 'update', id, before: category, after: updated })
      return updated
    })
  }

  private async assertUnit(transaction: Prisma.TransactionClient, tenantId: number, unitId?: number | null) {
    if (unitId == null) return
    const unit = await transaction.unit.findFirst({ where: { id: unitId, tenantId, status: 'active' }, select: { id: true } })
    if (!unit) throw new BadRequestException('计量单位不存在或已停用')
  }

  private assertCategoryText(dto: CreateCategoryDto | UpdateCategoryDto) {
    for (const [key, max] of [['name', 100], ['code', 64]] as const) {
      const value = dto[key]
      if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > max)) throw new BadRequestException(`分类${key === 'name' ? '名称' : '编码'}格式不正确`)
    }
  }

  private async assertCategoryParent(transaction: Prisma.TransactionClient, tenantId: number, parentId?: number | null, categoryId?: number, locked = false) {
    if (parentId == null) return
    if (!locked) await transaction.$queryRaw(Prisma.sql`SELECT id FROM product_categories WHERE tenant_id = ${tenantId} FOR UPDATE`)
    const visited = new Set<number>(categoryId === undefined ? [] : [categoryId])
    let nextId: number | null = parentId
    while (nextId != null) {
      if (visited.has(nextId)) throw new BadRequestException('分类父级不能指向自身或下级分类')
      visited.add(nextId)
      const parent: { id: number; parentId: number | null } | null = await transaction.productCategory.findFirst({ where: { id: nextId, tenantId, status: 'active' }, select: { id: true, parentId: true } })
      if (!parent) throw new BadRequestException('父级分类不存在或已停用')
      nextId = parent.parentId
    }
  }

  async brands(userId?: number) {
    const user = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { tenantId: true, userType: true } }) : null
    if (userId && !user) return []
    const tenantId = user?.tenantId ?? 1
    const restrictedStaff = user && user.userType !== 'customer_user' && user.userType !== 'super_admin'
    return this.prisma.brand.findMany({
      where: { tenantId, status: 'active', ...(restrictedStaff ? { userAccess: { some: { tenantId, userId } } } : {}) },
      select: { id: true, name: true, code: true, logoUrl: true, description: true },
      orderBy: { sortOrder: 'asc' }
    })
  }

  private async frequentList(where: any, brandId: number | undefined, page: number, userId?: number, customerView = false) {
    const pageSize = 5
    if (!userId) return { items: [], page, pageSize, total: 0 }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { customerId: true }
    })
    if (!user?.customerId) return { items: [], page, pageSize, total: 0 }

    const orderWhere: any = {
      customerId: user.customerId,
      status: { notIn: ['draft', 'cancelled'] }
    }
    if (brandId) orderWhere.brandId = brandId

    const purchases = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        productId: { not: null },
        order: orderWhere
      },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: pageSize
    })
    const productIds = purchases
      .map(item => item.productId)
      .filter((productId): productId is number => productId != null)
    if (!productIds.length) return { items: [], page, pageSize, total: 0 }

    const products = await this.prisma.product.findMany({
      where: { ...where, id: { in: productIds } },
      include: PRODUCT_LIST_INCLUDE
    })
    const productMap = new Map(products.map(product => [product.id, product]))
    const orderedProducts = productIds
      .map(productId => productMap.get(productId))
      .filter((product): product is NonNullable<typeof product> => Boolean(product))

    return {
      items: await this.applyAgreementPrices(orderedProducts, userId, customerView),
      page,
      pageSize,
      total: orderedProducts.length
    }
  }

  private sortByPrice<T extends { skus: Array<{ basePrice: unknown; customerPrice?: string | null }> }>(items: T[], sortBy?: string) {
    const direction = sortBy === 'price_desc' ? -1 : 1
    const priceOf = (item: T) => item.skus.length
      ? Math.min(...item.skus.map(sku => Number(sku.customerPrice ?? sku.basePrice)))
      : null
    return [...items].sort((left, right) => {
      const leftPrice = priceOf(left)
      const rightPrice = priceOf(right)
      if (leftPrice == null) return rightPrice == null ? 0 : 1
      if (rightPrice == null) return -1
      return (leftPrice - rightPrice) * direction
    })
  }

  private async agreementPriceMap(userId: number | undefined, skuIds: number[]) {
    if (!userId || !skuIds.length) return new Map<number, string>()
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { customerId: true }
    })
    if (!user?.customerId) return new Map<number, string>()

    const now = new Date()
    const rules = await this.prisma.customerPriceRule.findMany({
      where: {
        customerId: user.customerId,
        skuId: { in: skuIds },
        status: 'active',
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { OR: [{ endAt: null }, { endAt: { gte: now } }] }
        ]
      },
      select: { skuId: true, price: true }
    })
    return new Map(rules.filter(rule => rule.skuId != null).map(rule => [rule.skuId!, rule.price.toString()]))
  }

  private async applySkuAgreementPrices<T extends { id: number }>(skus: T[], userId?: number, customerView = false) {
    const prices = await this.agreementPriceMap(userId, skus.map(sku => sku.id))
    const available = await stockAvailability(this.prisma, skus)
    return skus.map(sku => ({ ...sku, ...(customerView ? { stockNum: available.get(sku.id) || 0 } : {}), availableNum: available.get(sku.id) || 0, customerPrice: prices.get(sku.id) ?? null }))
  }

  private async applyAgreementPrices<T extends { name?: string | null; subtitle?: string | null; skus: Array<{ id: number }> }>(products: T[], userId?: number, customerView = false) {
    const skus = products.flatMap(product => product.skus)
    const prices = await this.agreementPriceMap(userId, skus.map(sku => sku.id))
    const available = await stockAvailability(this.prisma, skus)
    return products.map(product => ({
      ...presentProduct(product),
      skus: product.skus.map(sku => ({ ...sku, ...(customerView ? { stockNum: available.get(sku.id) || 0 } : {}), availableNum: available.get(sku.id) || 0, customerPrice: prices.get(sku.id) ?? null }))
    }))
  }

  private async applyAgreementPrice<T extends { name?: string | null; subtitle?: string | null; skus: Array<{ id: number }> }>(product: T, userId?: number, customerView = false) {
    const [result] = await this.applyAgreementPrices([product], userId, customerView)
    return result
  }
}
