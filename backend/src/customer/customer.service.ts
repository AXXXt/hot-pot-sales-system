import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { CreateCustomerDto, UpdateCustomerDto, CreateCustomerLevelDto, UpdateCustomerLevelDto, CreatePriceRuleDto, CreateRepaymentDto } from './dto/create-customer.dto'
import { UpdateProductVisibilityDto } from './dto/update-product-visibility.dto'
import { AuditService } from '../audit/audit.service'

@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async list(query: { keyword?: string; status?: string; page: number; pageSize: number }) {
    const { keyword, status, page, pageSize } = query
    const where: any = { tenantId: 1 }
    if (keyword) {
      where.OR = [
        { customerName: { contains: keyword } },
        { contactPhone: { contains: keyword } },
        { contactName: { contains: keyword } }
      ]
    }
    if (status && status !== 'all') { where.status = status }

    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: { level: { select: { id: true, name: true, discountRate: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.customer.count({ where })
    ])
    return { items, page, pageSize, total }
  }

  async create(dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: {
        tenantId: 1,
        customerName: dto.customerName,
        customerType: dto.customerType,
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
        address: dto.address,
        customerLevelId: dto.customerLevelId,
        salesOwnerId: dto.salesOwnerId
      },
      include: { level: { select: { id: true, name: true, discountRate: true } } }
    })
  }

  async detail(id: number) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        level: { select: { id: true, name: true, discountRate: true } },
        priceRules: {
          where: { status: 'active' },
          include: { sku: { select: { id: true, skuCode: true, name: true, specText: true } } },
          orderBy: { createdAt: 'desc' }
        }
      }
    })
    if (!customer) throw new NotFoundException({ message: '客户不存在', errorCode: 'CUS_1001' })
    return customer
  }

  async getProductVisibility(id: number) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true, tenantId: true, productVisibilityMode: true }
    })
    if (!customer) throw new NotFoundException({ message: '客户不存在', errorCode: 'CUS_1001' })

    const selected = await this.prisma.customerVisibleProduct.findMany({
      where: { tenantId: customer.tenantId, customerId: id },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            status: true,
            category: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    })

    const countWhere: any = { tenantId: customer.tenantId, status: 'active' }
    if (customer.productVisibilityMode === 'factory') {
      countWhere.isFactoryProduct = true
    } else if (customer.productVisibilityMode === 'custom') {
      countWhere.visibleToCustomers = { some: { customerId: id } }
    }
    const visibleProductCount = await this.prisma.product.count({ where: countWhere })
    const products = selected.map(item => item.product)

    return {
      mode: customer.productVisibilityMode,
      productIds: products.map(product => product.id),
      products,
      visibleProductCount
    }
  }

  async updateProductVisibility(id: number, dto: UpdateProductVisibilityDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true, tenantId: true }
    })
    if (!customer) throw new NotFoundException({ message: '客户不存在', errorCode: 'CUS_1001' })

    const productIds = dto.productIds || []
    if (dto.mode === 'custom') {
      if (!productIds.length) {
        throw new BadRequestException({ message: '自定义模式至少选择一个商品', errorCode: 'CUS_1002' })
      }
      if (new Set(productIds).size !== productIds.length) {
        throw new BadRequestException({ message: '自定义商品不能重复', errorCode: 'CUS_1003' })
      }

      const products = await this.prisma.product.findMany({
        where: { id: { in: productIds }, tenantId: customer.tenantId },
        select: { id: true, tenantId: true, status: true }
      })
      const valid = products.length === productIds.length && products.every(product => (
        product.tenantId === customer.tenantId && product.status === 'active'
      ))
      if (!valid) {
        throw new BadRequestException({
          message: '自定义商品包含不存在、停用或无权访问的商品',
          errorCode: 'CUS_1004'
        })
      }
    }

    await this.prisma.$transaction(async tx => {
      await tx.customer.update({
        where: { id },
        data: { productVisibilityMode: dto.mode }
      })
      await tx.customerVisibleProduct.deleteMany({ where: { customerId: id } })
      if (dto.mode === 'custom') {
        await tx.customerVisibleProduct.createMany({
          data: productIds.map(productId => ({
            tenantId: customer.tenantId,
            customerId: id,
            productId
          }))
        })
      }
    })

    await this.audit.write({
      action: 'update',
      module: 'customer',
      targetType: 'customer',
      targetId: id,
      afterData: { productVisibilityMode: dto.mode, productIds }
    })
    return this.getProductVisibility(id)
  }

  async update(id: number, dto: UpdateCustomerDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true }
    })
    if (!customer) throw new NotFoundException({ message: '客户不存在', errorCode: 'CUS_1001' })

    if (dto.status) {
      const status = dto.status
      await this.prisma.$transaction(async tx => {
        await tx.customer.update({ where: { id }, data: dto })
        await tx.user.updateMany({
          where: { customerId: id },
          data: { status }
        })
      })
    } else {
      await this.prisma.customer.update({ where: { id }, data: dto })
    }
    return this.detail(id)
  }

  async approve(id: number) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true }
    })
    if (!customer) throw new NotFoundException({ message: '客户不存在', errorCode: 'CUS_1001' })

    await this.prisma.$transaction(async tx => {
      await tx.customer.update({ where: { id }, data: { status: 'active' } })
      await tx.user.updateMany({
        where: { customerId: id },
        data: { status: 'active' }
      })
    })
    await this.audit.write({
      action: 'update',
      module: 'customer',
      targetType: 'customer',
      targetId: id,
      afterData: { status: 'active', action: 'approve' }
    })
    return { id, status: 'active', message: '审核通过' }
  }

  async reject(id: number, reason?: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true }
    })
    if (!customer) throw new NotFoundException({ message: '客户不存在', errorCode: 'CUS_1001' })

    await this.prisma.$transaction(async tx => {
      await tx.customer.update({ where: { id }, data: { status: 'disabled' } })
      await tx.user.updateMany({
        where: { customerId: id },
        data: { status: 'disabled' }
      })
    })
    const message = reason ? `已驳回并禁用：${reason}` : '已驳回并禁用'
    await this.audit.write({
      action: 'update',
      module: 'customer',
      targetType: 'customer',
      targetId: id,
      afterData: { status: 'disabled', action: 'reject', reason: reason || '' }
    })
    return { id, status: 'disabled', message }
  }

  async levels(brandId: number) {
    return this.prisma.customerLevel.findMany({
      where: { brandId, status: 'active' },
      include: { _count: { select: { customers: true } } },
      orderBy: { createdAt: 'asc' }
    })
  }

  async createLevel(dto: CreateCustomerLevelDto) {
    return this.prisma.customerLevel.create({
      data: { tenantId: 1, brandId: dto.brandId, name: dto.name, code: dto.code, discountRate: dto.discountRate ?? undefined, description: dto.description }
    })
  }

  async updateLevel(id: number, dto: UpdateCustomerLevelDto) {
    return this.prisma.customerLevel.update({ where: { id }, data: dto as any })
  }

  async myPriceRules(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { customerId: true }
    })
    if (!user?.customerId) {
      throw new BadRequestException({ message: '当前账号未关联客户', errorCode: 'CUS_1001' })
    }

    const now = new Date()
    return this.prisma.customerPriceRule.findMany({
      where: {
        tenantId: 1,
        customerId: user.customerId,
        status: 'active',
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { OR: [{ endAt: null }, { endAt: { gte: now } }] }
        ]
      },
      include: {
        sku: {
          select: {
            id: true,
            skuCode: true,
            name: true,
            specText: true,
            saleUnit: true,
            basePrice: true
          }
        },
        product: { select: { id: true, name: true } }
      },
      orderBy: { updatedAt: 'desc' }
    })
  }

  async priceRules(customerId: number) {
    return this.prisma.customerPriceRule.findMany({
      where: { tenantId: 1, customerId, status: 'active' },
      include: {
        sku: { select: { id: true, skuCode: true, name: true, specText: true, basePrice: true } },
        product: { select: { id: true, name: true } }
      },
      orderBy: { updatedAt: 'desc' }
    })
  }

  async createPriceRule(dto: CreatePriceRuleDto) {
    const price = Number(dto.price)
    if (!Number.isFinite(price) || price <= 0) {
      throw new BadRequestException({ message: '协议价必须大于 0', errorCode: 'CUS_1004' })
    }

    const [customer, sku] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: dto.customerId, tenantId: 1 },
        select: { id: true }
      }),
      this.prisma.productSku.findFirst({
        where: {
          id: dto.skuId,
          tenantId: 1,
          status: 'active',
          product: { is: { status: 'active' } }
        },
        select: { id: true, productId: true, product: { select: { brandId: true } } }
      })
    ])
    if (!customer) {
      throw new NotFoundException({ message: '客户不存在', errorCode: 'CUS_1001' })
    }
    if (!sku) {
      throw new NotFoundException({ message: '商品规格不存在或已下架', errorCode: 'CUS_1005' })
    }

    const rule = await this.prisma.customerPriceRule.upsert({
      where: {
        tenantId_customerId_skuId: {
          tenantId: 1,
          customerId: dto.customerId,
          skuId: dto.skuId
        }
      },
      update: {
        brandId: sku.product.brandId,
        productId: sku.productId,
        priceType: 'agreement',
        price: dto.price,
        status: 'active',
        startAt: null,
        endAt: null
      },
      create: {
        tenantId: 1,
        brandId: sku.product.brandId,
        customerId: dto.customerId,
        productId: sku.productId,
        skuId: dto.skuId,
        priceType: 'agreement',
        price: dto.price,
        status: 'active'
      }
    })

    await this.audit.write({
      action: 'price_change',
      module: 'customer',
      targetType: 'customer_price_rule',
      targetId: rule.id,
      afterData: { customerId: dto.customerId, skuId: dto.skuId, price: dto.price, priceType: 'agreement' }
    })
    return rule
  }

  async deletePriceRule(id: number) {
    const rule = await this.prisma.customerPriceRule.findFirst({
      where: { id, tenantId: 1 },
      select: { id: true }
    })
    if (!rule) {
      throw new NotFoundException({ message: '协议价不存在', errorCode: 'CUS_1006' })
    }

    const updated = await this.prisma.customerPriceRule.update({
      where: { id },
      data: { status: 'disabled' }
    })
    await this.audit.write({
      action: 'price_change',
      module: 'customer',
      targetType: 'customer_price_rule',
      targetId: id,
      beforeData: { status: 'active' },
      afterData: { status: 'disabled' }
    })
    return updated
  }

  async repayments(customerId: number) {
    return this.prisma.customerRepayment.findMany({
      where: { tenantId: 1, customerId },
      orderBy: { createdAt: 'desc' }
    })
  }

  async createRepayment(customerId: number, dto: CreateRepaymentDto, userId?: number) {
    const amount = Number(dto.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException({ message: '还款金额必须大于 0', errorCode: 'CUS_1007' })
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, creditUsed: true }
    })
    if (!customer) throw new NotFoundException({ message: '客户不存在', errorCode: 'CUS_1001' })

    const repayment = await this.prisma.$transaction(async (tx) => {
      const current = await tx.customer.findUnique({
        where: { id: customerId },
        select: { creditUsed: true }
      })
      const nextCreditUsed = Math.max(0, Number(current?.creditUsed || 0) - amount)
      await tx.customer.update({
        where: { id: customerId },
        data: { creditUsed: nextCreditUsed.toFixed(2) }
      })
      return tx.customerRepayment.create({
        data: {
          tenantId: 1,
          customerId,
          amount: dto.amount,
          method: dto.method || 'transfer',
          note: dto.note,
          operatorId: userId ?? null
        }
      })
    })

    await this.audit.write({
      action: 'update',
      module: 'customer',
      targetType: 'customer_repayment',
      targetId: repayment.id,
      afterData: { customerId, amount: dto.amount, method: repayment.method, note: dto.note ?? null },
      operatorId: userId
    })
    return repayment
  }
}
