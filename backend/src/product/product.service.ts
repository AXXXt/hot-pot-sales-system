import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { REDIS } from '../redis.provider'
import { Inject } from '@nestjs/common'
import { CreateProductDto, UpdateProductDto } from './dto/create-product.dto'
import { CreateSkuDto, UpdateSkuDto } from './dto/create-sku.dto'
import { CreateCategoryDto, UpdateCategoryDto } from './dto/create-category.dto'
import { ProductVisibilityService } from './product-visibility.service'
import { buildProductCode, toCategorySegment } from './product-code'

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
      stockNum: true
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
    private readonly visibility: ProductVisibilityService
  ) {}

  async list(params: ListParams, userId?: number) {
    const { brandId, categoryId, keyword, feed, sortBy, inStock, includeDisabled, page, pageSize } = params
    const accessWhere = await this.visibility.whereForUser(userId)
    const where: any = { status: includeDisabled ? { not: 'archived' } : 'active', ...accessWhere }
    if (brandId) where.brandId = brandId
    if (categoryId) where.categoryId = categoryId
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { code: { contains: keyword } }
      ]
    }
    if (feed === 'new') where.isNew = true
    if (feed === 'hot') where.isHot = true
    if (inStock) {
      where.skus = { some: { status: 'active', stockNum: { gt: 0 } } }
    }

    if (feed === 'frequent') {
      return this.frequentList(where, brandId, page, userId)
    }

    const priceSort = sortBy === 'price_asc' || sortBy === 'price_desc'
    const itemPromise = this.prisma.product.findMany({
      where,
      include: PRODUCT_LIST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      ...(priceSort ? {} : {
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    })

    const [items, total] = await Promise.all([
      itemPromise,
      this.prisma.product.count({ where })
    ])

    const pageItems = priceSort
      ? this.sortByPrice(items, sortBy).slice((page - 1) * pageSize, page * pageSize)
      : items

    return { items: await this.applyAgreementPrices(pageItems, userId), page, pageSize, total }
  }

  async create(dto: CreateProductDto, tenantId: number = 1) {
    if (!dto.brandId) {
      throw new BadRequestException({ message: '请选择品牌', errorCode: 'BRD_1003' })
    }

    return this.prisma.$transaction(async (transaction) => {
      const identity = await this.allocateProductIdentity(transaction, tenantId, dto.brandId!, dto.categoryId)
      return transaction.product.create({
        data: {
          tenantId,
          brandId: identity.brand.id,
          categoryId: identity.category.id,
          unitId: dto.unitId,
          code: identity.code,
          name: identity.name,
          subtitle: dto.subtitle,
          baseSpec: dto.baseSpec,
          mainImageUrl: dto.mainImageUrl,
          images: dto.images || [],
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
  }

  private async allocateProductIdentity(
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
          select: { id: true, skuCode: true, name: true, specText: true, saleUnit: true, basePrice: true, minOrderQty: true, stockNum: true, status: true },
          orderBy: { basePrice: 'asc' }
        }
      }
    })
    if (!product) throw new NotFoundException({ message: '商品不存在', errorCode: 'PRO_1001' })
    return this.applyAgreementPrice(product, userId)
  }

  async update(id: number, dto: UpdateProductDto, userId?: number) {
    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.product.findUnique({
        where: { id },
        select: { id: true, tenantId: true, brandId: true, categoryId: true }
      })
      if (!current) {
        throw new NotFoundException({ message: '商品不存在', errorCode: 'PRO_1001' })
      }

      const nextBrandId = dto.brandId ?? current.brandId
      const nextCategoryId = dto.categoryId ?? current.categoryId
      const identityChanged = nextBrandId !== current.brandId || nextCategoryId !== current.categoryId
      const updateData: Record<string, unknown> = { ...dto }
      delete updateData.brandId
      delete updateData.categoryId
      delete updateData.name
      delete updateData.code

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
    })
    return this.detail(id, userId)
  }

  async updateStatus(id: number, status: string) {
    if (!['active', 'disabled'].includes(status)) {
      throw new BadRequestException({ message: '无效状态', errorCode: 'PRO_1002' })
    }
    await this.prisma.product.update({ where: { id }, data: { status: status as any } })
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
    const result = await this.prisma.product.updateMany({
      where: { id: { in: uniqueProductIds } },
      data: { status: status as any }
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
      select: { id: true, status: true }
    })
    if (!product) {
      throw new NotFoundException({ message: '商品不存在', errorCode: 'PRO_1001' })
    }
    if (product.status === 'archived') return product

    return this.prisma.product.update({
      where: { id },
      data: { status: 'archived' },
      select: { id: true, status: true }
    })
  }

  async batchArchiveProducts(productIds: number[]) {
    if (!productIds.length || productIds.some(id => !Number.isInteger(id) || id <= 0)) {
      throw new BadRequestException({ message: '请选择有效商品', errorCode: 'PRO_1004' })
    }

    const uniqueProductIds = [...new Set(productIds)]
    const result = await this.prisma.product.updateMany({
      where: { id: { in: uniqueProductIds }, status: { not: 'archived' } },
      data: { status: 'archived' }
    })
    return {
      productIds: uniqueProductIds,
      status: 'archived',
      updatedCount: result.count
    }
  }

  async skus(productId: number, userId?: number) {
    await this.visibility.assertVisible(productId, userId)
    const skus = await this.prisma.productSku.findMany({
      where: { productId, status: 'active' },
      orderBy: { basePrice: 'asc' }
    })
    return this.applySkuAgreementPrices(skus, userId)
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
            brandId: true,
            brand: { select: { name: true } }
          }
        }
      }
    })
    const pricedSkus = await this.applySkuAgreementPrices(skus, userId)
    const foundIds = new Set(pricedSkus.map(sku => sku.id))

    return {
      items: pricedSkus.map(sku => ({
        skuId: sku.id,
        productId: sku.productId,
        brandId: sku.product.brandId,
        brandName: sku.product.brand?.name || '',
        name: sku.product.name,
        spec: sku.specText,
        unit: sku.saleUnit,
        price: sku.customerPrice ?? sku.basePrice.toString(),
        customerPrice: sku.customerPrice,
        basePrice: sku.basePrice.toString(),
        minOrderQty: sku.minOrderQty,
        stockNum: sku.stockNum,
        available: sku.stockNum > 0,
        unavailableReason: sku.stockNum > 0 ? null : '该规格已售罄'
      })),
      invalidSkuIds: skuIds.filter(skuId => !foundIds.has(skuId))
    }
  }

  async createSku(productId: number, dto: CreateSkuDto) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } })
    if (!product) throw new NotFoundException({ message: '商品不存在', errorCode: 'PRO_1001' })
    return this.prisma.productSku.create({
      data: {
        tenantId: product.tenantId,
        productId,
        skuCode: dto.skuCode,
        name: dto.name,
        specText: dto.specText,
        saleUnit: dto.saleUnit,
        basePrice: dto.basePrice,
        minOrderQty: dto.minOrderQty
      }
    })
  }

  async updateSku(id: number, dto: UpdateSkuDto) {
    await this.prisma.productSku.update({ where: { id }, data: dto })
    return this.prisma.productSku.findUnique({ where: { id } })
  }

  async updateSkuStatus(id: number, status: string) {
    if (!['active', 'disabled'].includes(status)) {
      throw new BadRequestException({ message: '无效状态', errorCode: 'PRO_1002' })
    }
    return this.prisma.productSku.update({ where: { id }, data: { status: status as any } })
  }

  async categories(_userId?: number) {
    const categories = await this.prisma.productCategory.findMany({
      where: { status: 'active' },
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

  async createCategory(dto: CreateCategoryDto, tenantId = 1) {
    try {
      return await this.prisma.productCategory.create({
        data: { tenantId, code: dto.code, name: dto.name, sortOrder: dto.sortOrder || 0, parentId: dto.parentId }
      })
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw new ConflictException({ message: '分类名称已存在', errorCode: 'CAT_1002' })
      }
      throw error
    }
  }

  async updateCategory(id: number, dto: UpdateCategoryDto, tenantId: number) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.productCategory.findFirst({ where: { id, tenantId } })
        if (!current) {
          throw new NotFoundException({ message: '分类不存在', errorCode: 'CAT_1001' })
        }

        const updated = await transaction.productCategory.update({ where: { id }, data: dto })
        if (dto.name !== undefined && dto.name !== current.name) {
          const products = await transaction.product.findMany({
            where: { categoryId: id },
            select: { id: true, brand: { select: { name: true } } }
          })
          await Promise.all(products.map((product) => transaction.product.update({
            where: { id: product.id },
            data: { name: `${product.brand.name}${dto.name}` }
          })))
        }
        return updated
      })
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw new ConflictException({ message: '分类名称已存在', errorCode: 'CAT_1002' })
      }
      throw error
    }
  }

  async deleteCategory(id: number, tenantId: number) {
    return this.prisma.$transaction(async (transaction) => {
      const category = await transaction.productCategory.findFirst({ where: { id, tenantId } })
      if (!category) {
        throw new NotFoundException({ message: '分类不存在', errorCode: 'CAT_1001' })
      }

      const linkedProductCount = await transaction.product.count({ where: { categoryId: id } })
      if (linkedProductCount === 0) {
        await transaction.productCategory.delete({ where: { id } })
        return { id, deletionMode: 'physical' as const, linkedProductCount }
      }

      await transaction.productCategory.update({ where: { id }, data: { status: 'disabled' } })
      return { id, deletionMode: 'disabled' as const, linkedProductCount }
    })
  }

  async restoreCategory(id: number, tenantId: number) {
    const category = await this.prisma.productCategory.findFirst({ where: { id, tenantId } })
    if (!category) {
      throw new NotFoundException({ message: '分类不存在', errorCode: 'CAT_1001' })
    }
    return this.prisma.productCategory.update({ where: { id }, data: { status: 'active' } })
  }

  async brands() {
    return this.prisma.brand.findMany({
      where: { status: 'active' },
      select: { id: true, name: true, code: true, logoUrl: true, description: true },
      orderBy: { sortOrder: 'asc' }
    })
  }

  private async frequentList(where: any, brandId: number | undefined, page: number, userId?: number) {
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
      items: await this.applyAgreementPrices(orderedProducts, userId),
      page,
      pageSize,
      total: orderedProducts.length
    }
  }

  private sortByPrice<T extends { skus: Array<{ basePrice: unknown }> }>(items: T[], sortBy?: string) {
    const direction = sortBy === 'price_desc' ? -1 : 1
    return [...items].sort((left, right) => {
      const leftPrice = left.skus.length ? Number(left.skus[0].basePrice) : null
      const rightPrice = right.skus.length ? Number(right.skus[0].basePrice) : null
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

  private async applySkuAgreementPrices<T extends { id: number }>(skus: T[], userId?: number) {
    const prices = await this.agreementPriceMap(userId, skus.map(sku => sku.id))
    return skus.map(sku => ({ ...sku, customerPrice: prices.get(sku.id) ?? null }))
  }

  private async applyAgreementPrices<T extends { skus: Array<{ id: number }> }>(products: T[], userId?: number) {
    const skus = products.flatMap(product => product.skus)
    const prices = await this.agreementPriceMap(userId, skus.map(sku => sku.id))
    return products.map(product => ({
      ...product,
      skus: product.skus.map(sku => ({ ...sku, customerPrice: prices.get(sku.id) ?? null }))
    }))
  }

  private async applyAgreementPrice<T extends { skus: Array<{ id: number }> }>(product: T, userId?: number) {
    const [result] = await this.applyAgreementPrices([product], userId)
    return result
  }
}
