import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { CreateCustomerDto, UpdateCustomerDto, CreateCustomerLevelDto, UpdateCustomerLevelDto, CreatePriceRuleDto, CreateRepaymentDto } from './dto/create-customer.dto'
import { UpdateProductVisibilityDto } from './dto/update-product-visibility.dto'
import { AuditService } from '../audit/audit.service'
import { StaffActor } from '../auth/staff-access.service'
import { presentProduct } from '../product/product-presentation'
import { registrationDecisionWhere, reviewStatusFromState } from '../auth/registration-review'
import { getAuditContext } from '../audit/audit-context'
import { randomUUID } from 'node:crypto'

@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  /** HTTP入口必须传入数据库重读的员工身份；内部旧调用保留默认租户兼容。 */
  private scope(actor?: StaffActor): Prisma.CustomerWhereInput {
    return { tenantId: actor?.tenantId ?? 1, ...(actor?.customerIds ? { id: { in: actor.customerIds } } : {}) }
  }

  private async checkCustomer(id: number, actor?: StaffActor) {
    if (!actor) return
    if (!await this.prisma.customer.findFirst({ where: { AND: [this.scope(actor), { id }] }, select: { id: true } })) {
      throw new NotFoundException({ message: '客户不存在或不可访问', errorCode: 'CUS_1001' })
    }
  }

  private productScope(actor?: StaffActor): Prisma.ProductWhereInput {
    return { tenantId: actor?.tenantId ?? 1, ...(actor && !actor.superAdmin ? { brandId: { in: actor.brandIds } } : {}) }
  }

  private async checkBrand(brandId: number, actor?: StaffActor) {
    if (!actor) return
    if ((!actor.superAdmin && !actor.brandIds.includes(brandId)) || !await this.prisma.brand.findFirst({ where: { id: brandId, tenantId: actor.tenantId } })) {
      throw new NotFoundException('品牌不存在或不可访问')
    }
  }

  private async checkRelations(dto: CreateCustomerDto | UpdateCustomerDto, actor?: StaffActor) {
    if (!actor) return
    if (dto.customerLevelId && !await this.prisma.customerLevel.findFirst({ where: { id: dto.customerLevelId, tenantId: actor.tenantId, status: 'active' } })) {
      throw new BadRequestException('客户等级不存在或已停用')
    }
    if (dto.salesOwnerId) {
      if (!await this.prisma.user.findFirst({ where: { id: dto.salesOwnerId, tenantId: actor.tenantId, status: 'active', userType: { in: ['sales', 'admin', 'super_admin'] } } })) throw new BadRequestException('销售负责人不存在或已停用')
    }
    if (actor.customerIds !== null && dto.salesOwnerId !== undefined && dto.salesOwnerId !== actor.id) throw new ForbiddenException('不可更改客户负责人范围')
  }

  private auditActor(actor?: StaffActor) { return actor ? { tenantId: actor.tenantId, operatorId: actor.id } : {} }

  /** 审核状态与账号启停分开；只查询当前页、当前租户，不按每行重复读取审计。 */
  private async withReviewStatus<T extends { id: number; tenantId: number; status: string; users?: { status: string }[] }>(items: T[], actor?: StaffActor, client: Pick<Prisma.TransactionClient, 'auditLog'> = this.prisma) {
    const disabledIds = items.filter(item => item.status !== 'active').map(item => String(item.id))
    const decisions = disabledIds.length ? await client.auditLog.findMany({
      where: {
        ...registrationDecisionWhere(actor?.tenantId ?? items[0].tenantId, items[0].id),
        targetId: { in: disabledIds }
      },
      select: { targetId: true, afterData: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    }) : []
    const latest = new Map<string, string | undefined>()
    for (const decision of decisions) {
      if (!decision.targetId || latest.has(decision.targetId)) continue
      const data = decision.afterData
      const action = data && typeof data === 'object' && !Array.isArray(data) ? data.action : undefined
      latest.set(decision.targetId, typeof action === 'string' ? action : undefined)
    }
    return items.map(item => {
      const { users, ...customer } = item
      return { ...customer, reviewStatus: reviewStatusFromState({
        userStatus: !users?.length || users.some(user => user.status === 'active') ? 'active' : 'disabled',
        customerStatus: item.status,
        lastAction: latest.get(String(item.id))
      }) }
    })
  }

  async list(query: { keyword?: string; status?: string; page: number; pageSize: number }, actor?: StaffActor) {
    const { keyword, status, page, pageSize } = query
    if (page < 1 || pageSize < 1 || pageSize > 500) throw new BadRequestException('分页参数无效')
    const where: Prisma.CustomerWhereInput = this.scope(actor)
    if (keyword) {
      where.OR = [
        { customerName: { contains: keyword } },
        { contactPhone: { contains: keyword } },
        { contactName: { contains: keyword } }
      ]
    }
    if (status && status !== 'all') {
      if (status !== 'active' && status !== 'disabled') throw new BadRequestException('客户状态无效')
      where.status = status
    }

    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        include: { level: { select: { id: true, name: true, discountRate: true } }, users: { where: { tenantId: actor?.tenantId ?? 1 }, select: { status: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.customer.count({ where })
    ])
    return { items: await this.withReviewStatus(items, actor), page, pageSize, total }
  }

  async create(dto: CreateCustomerDto, actor?: StaffActor) {
    await this.checkRelations(dto, actor)
    const customer = await this.prisma.customer.create({
      data: {
        tenantId: actor?.tenantId ?? 1,
        customerName: dto.customerName,
        customerType: dto.customerType,
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
        address: dto.address,
        customerLevelId: dto.customerLevelId,
        salesOwnerId: actor && actor.customerIds !== null ? actor.id : dto.salesOwnerId
      },
      include: { level: { select: { id: true, name: true, discountRate: true } } }
    })
    await this.audit.write({ ...this.auditActor(actor), action: 'create', module: 'customer', targetType: 'customer', targetId: customer.id, afterData: dto })
    return customer
  }

  async detail(id: number, actor?: StaffActor) {
    await this.checkCustomer(id, actor)
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        users: { where: { tenantId: actor?.tenantId ?? 1 }, select: { status: true } },
        level: { select: { id: true, name: true, discountRate: true } },
        priceRules: {
          where: { status: 'active', ...(actor ? { tenantId: actor.tenantId, sku: { product: this.productScope(actor) } } : {}) },
          include: { sku: { select: { id: true, skuCode: true, name: true, specText: true } } },
          orderBy: { createdAt: 'desc' }
        }
      }
    })
    if (!customer) throw new NotFoundException({ message: '客户不存在', errorCode: 'CUS_1001' })
    return (await this.withReviewStatus([customer], actor))[0]
  }

  async getProductVisibility(id: number, actor?: StaffActor) {
    await this.checkCustomer(id, actor)
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true, tenantId: true, productVisibilityMode: true }
    })
    if (!customer) throw new NotFoundException({ message: '客户不存在', errorCode: 'CUS_1001' })

    const selected = await this.prisma.customerVisibleProduct.findMany({
      where: { tenantId: customer.tenantId, customerId: id, ...(actor ? { product: this.productScope(actor) } : {}) },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            subtitle: true,
            status: true,
            category: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    })

    const countWhere: any = { ...(actor ? this.productScope(actor) : { tenantId: customer.tenantId }), status: 'active' }
    if (customer.productVisibilityMode === 'factory') {
      countWhere.isFactoryProduct = true
    } else if (customer.productVisibilityMode === 'custom') {
      countWhere.visibleToCustomers = { some: { customerId: id } }
    }
    const visibleProductCount = await this.prisma.product.count({ where: countWhere })
    const products = selected.map(item => presentProduct(item.product))

    return {
      mode: customer.productVisibilityMode,
      productIds: products.map(product => product.id),
      products,
      visibleProductCount
    }
  }

  async updateProductVisibility(id: number, dto: UpdateProductVisibilityDto, actor?: StaffActor) {
    await this.checkCustomer(id, actor)
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true, tenantId: true }
    })
    if (!customer) throw new NotFoundException({ message: '客户不存在', errorCode: 'CUS_1001' })

    if (actor && !actor.superAdmin) {
      const outside = { tenantId: actor.tenantId, brandId: { notIn: actor.brandIds } }
      const existingOutside = await this.prisma.customerVisibleProduct.count({ where: { customerId: id, product: outside } })
      const grantsOutside = dto.mode !== 'custom' && await this.prisma.product.count({ where: { ...outside, status: 'active', ...(dto.mode === 'factory' ? { isFactoryProduct: true } : {}) } })
      if (existingOutside || grantsOutside) throw new ForbiddenException('商品范围包含未授权品牌，请由有权管理员配置')
    }

    const productIds = dto.productIds || []
    if (dto.mode === 'custom') {
      if (!productIds.length) {
        throw new BadRequestException({ message: '自定义模式至少选择一个商品', errorCode: 'CUS_1002' })
      }
      if (new Set(productIds).size !== productIds.length) {
        throw new BadRequestException({ message: '自定义商品不能重复', errorCode: 'CUS_1003' })
      }

      const products = await this.prisma.product.findMany({
        where: { ...(actor ? this.productScope(actor) : { tenantId: customer.tenantId }), id: { in: productIds } },
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
      ...this.auditActor(actor),
      action: 'update',
      module: 'customer',
      targetType: 'customer',
      targetId: id,
      afterData: { productVisibilityMode: dto.mode, productIds }
    })
    return this.getProductVisibility(id, actor)
  }

  async update(id: number, dto: UpdateCustomerDto, actor?: StaffActor) {
    await this.checkCustomer(id, actor)
    await this.checkRelations(dto, actor)
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true, tenantId: true }
    })
    if (!customer) throw new NotFoundException({ message: '客户不存在', errorCode: 'CUS_1001' })

    if (dto.status) {
      const status = dto.status
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM customers WHERE id = ${id} FOR UPDATE`)
        const current = await tx.customer.findUnique({ where: { id }, select: { id: true, tenantId: true } })
        if (!current || (actor && current.tenantId !== actor.tenantId)) throw new NotFoundException({ message: '客户不存在', errorCode: 'CUS_1001' })
        await tx.customer.update({ where: { id }, data: dto })
        await tx.user.updateMany({
          where: { customerId: id, tenantId: current.tenantId },
          data: { status }
        })
        await this.writeStatusAudit(tx, current, dto as Prisma.InputJsonValue, actor)
      })
    } else {
      await this.prisma.customer.update({ where: { id }, data: dto })
    }
    if (!dto.status) await this.audit.write({ ...this.auditActor(actor), action: 'update', module: 'customer', targetType: 'customer', targetId: id, afterData: dto })
    return this.detail(id, actor)
  }

  async approve(id: number, actor?: StaffActor) {
    await this.review(id, 'approve', undefined, actor)
    return { id, status: 'active', message: '审核通过' }
  }

  async reject(id: number, reason?: string, actor?: StaffActor) {
    await this.review(id, 'reject', reason, actor)
    const message = reason ? `已驳回并禁用：${reason}` : '已驳回并禁用'
    return { id, status: 'disabled', message }
  }

  private async review(id: number, action: 'approve' | 'reject', reason: string | undefined, actor?: StaffActor) {
    await this.checkCustomer(id, actor)
    await this.prisma.$transaction(async tx => {
      // The latest review decision must be read after acquiring the shared customer row lock.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM customers WHERE id = ${id} FOR UPDATE`)
      const customer = await tx.customer.findUnique({
        where: { id }, include: { users: { select: { status: true, tenantId: true } } }
      })
      if (!customer || (actor && customer.tenantId !== actor.tenantId)) throw new NotFoundException({ message: '客户不存在', errorCode: 'CUS_1001' })
      const scoped = { ...customer, users: customer.users.filter(user => user.tenantId === customer.tenantId) }
      const [candidate] = await this.withReviewStatus([scoped], actor, tx)
      if (candidate.reviewStatus !== 'pending') throw new BadRequestException('仅待审核的注册申请可进行审核，请在客户详情管理启停状态')
      const status = action === 'approve' ? 'active' : 'disabled'
      await tx.customer.update({ where: { id }, data: { status } })
      await tx.user.updateMany({
        where: { customerId: id, tenantId: customer.tenantId }, data: { status }
      })
      await this.writeStatusAudit(tx, customer, { status, action, ...(action === 'reject' ? { reason: reason || '' } : {}) }, actor)
    })
  }

  private async writeStatusAudit(tx: Prisma.TransactionClient, customer: { id: number; tenantId: number }, afterData: Prisma.InputJsonValue, actor?: StaffActor) {
    const context = getAuditContext()
    await tx.auditLog.create({ data: {
      tenantId: customer.tenantId,
      operatorId: actor?.id ?? (context?.tenantId === customer.tenantId ? context.userId : undefined),
      action: 'update', module: 'customer', targetType: 'customer', targetId: String(customer.id), afterData,
      requestId: context?.requestId ?? `customer-status-${randomUUID()}`, ipAddress: context?.ip, userAgent: context?.userAgent
    } })
  }

  async levels(brandId?: number, actor?: StaffActor, includeDisabled = false) {
    // 等级是客户表单共享元数据；读取限定租户，写入仍校验品牌管理范围。
    if (brandId !== undefined && actor && !await this.prisma.brand.findFirst({ where: { id: brandId, tenantId: actor.tenantId } })) throw new NotFoundException('品牌不存在')
    return this.prisma.customerLevel.findMany({
      where: { tenantId: actor?.tenantId ?? 1, ...(!includeDisabled ? { status: 'active' } : {}), ...(brandId !== undefined ? { brandId } : {}) },
      include: { _count: { select: { customers: true } }, brand: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' }
    })
  }

  async levelReadiness(actor: StaffActor) {
    const defaults = await this.prisma.customerLevel.findMany({
      where: { tenantId: actor.tenantId, code: 'normal', status: 'active' }, orderBy: { id: 'asc' },
      select: { id: true, name: true, brandId: true }
    })
    return { registrationReady: defaults.length > 0, defaultLevel: defaults[0] || null,
      warning: defaults.length === 0 ? '缺少启用的 normal 等级，新客户无法提交注册申请'
        : defaults.length > 1 ? '存在多个 normal 等级，新注册按最早创建的启用记录分配，请核对配置' : '' }
  }

  async salesOwners(actor: StaffActor) {
    const canAssign = actor.customerIds === null
    const items = await this.prisma.user.findMany({ where: { tenantId: actor.tenantId, status: 'active',
      userType: { in: ['sales', 'admin', 'super_admin'] }, ...(canAssign ? {} : { id: actor.id }) },
      select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] })
    return { canAssign, items }
  }

  private levelData(dto: CreateCustomerLevelDto | UpdateCustomerLevelDto) {
    const name = dto.name?.trim()
    if (dto.name !== undefined && !name) throw new BadRequestException('等级名称不能为空')
    if (dto.discountRate !== undefined && (!/^\d+(?:\.\d{1,4})?$/.test(dto.discountRate) || Number(dto.discountRate) <= 0 || Number(dto.discountRate) > 1)) {
      throw new BadRequestException('折扣率须大于0且不超过1，最多4位小数')
    }
    return { ...(name !== undefined ? { name } : {}), ...(dto.discountRate !== undefined ? { discountRate: dto.discountRate } : {}),
      ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
      ...('status' in dto && dto.status !== undefined ? { status: dto.status } : {}) }
  }

  async createLevel(dto: CreateCustomerLevelDto, actor?: StaffActor) {
    await this.checkBrand(dto.brandId, actor)
    const data = this.levelData(dto), tenantId = actor?.tenantId ?? 1
    try {
      return await this.prisma.$transaction(async tx => {
        const level = await tx.customerLevel.create({ data: { tenantId, brandId: dto.brandId, name: data.name!, code: dto.code, ...data } })
        await tx.auditLog.create({ data: { tenantId, operatorId: actor?.id, action: 'create', module: 'customer', targetType: 'customer_level', targetId: String(level.id),
          afterData: { code: level.code, status: level.status }, requestId: `level-${randomUUID()}` } })
        return level
      })
    } catch (error: any) { if (error?.code === 'P2002') throw new ConflictException('同品牌等级编码或名称已存在'); throw error }
  }

  async updateLevel(id: number, dto: UpdateCustomerLevelDto, actor?: StaffActor) {
    if (actor) {
      const level = await this.prisma.customerLevel.findFirst({ where: { id, tenantId: actor.tenantId } })
      if (!level) throw new NotFoundException('客户等级不存在')
      await this.checkBrand(level.brandId, actor)
    }
    const data = this.levelData(dto), tenantId = actor?.tenantId ?? 1
    try {
      return await this.prisma.$transaction(async tx => {
        const level = await tx.customerLevel.findFirst({ where: { id, tenantId } })
        if (!level) throw new NotFoundException('客户等级不存在')
        const result = await tx.customerLevel.update({ where: { id }, data })
        await tx.auditLog.create({ data: { tenantId, operatorId: actor?.id, action: 'update', module: 'customer', targetType: 'customer_level', targetId: String(id),
          beforeData: { name: level.name, status: level.status }, afterData: { name: result.name, status: result.status }, requestId: `level-${randomUUID()}` } })
        return result
      })
    } catch (error: any) { if (error?.code === 'P2002') throw new ConflictException('同品牌等级名称已存在'); throw error }
  }

  async myPriceRules(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { customerId: true, tenantId: true }
    })
    if (!user?.customerId) {
      throw new BadRequestException({ message: '当前账号未关联客户', errorCode: 'CUS_1001' })
    }

    const now = new Date()
    const rules = await this.prisma.customerPriceRule.findMany({
      where: {
        tenantId: user.tenantId,
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
        product: { select: { id: true, name: true, subtitle: true } }
      },
      orderBy: { updatedAt: 'desc' }
    })
    return rules.map(rule => ({ ...rule, product: rule.product ? presentProduct(rule.product) : null }))
  }

  async priceRules(customerId: number, actor?: StaffActor) {
    await this.checkCustomer(customerId, actor)
    const rules = await this.prisma.customerPriceRule.findMany({
      where: { tenantId: actor?.tenantId ?? 1, customerId, status: 'active', ...(actor && !actor.superAdmin ? { brandId: { in: actor.brandIds } } : {}) },
      include: {
        sku: { select: { id: true, skuCode: true, name: true, specText: true, basePrice: true } },
        product: { select: { id: true, name: true, subtitle: true } }
      },
      orderBy: { updatedAt: 'desc' }
    })
    return rules.map(rule => ({ ...rule, product: rule.product ? presentProduct(rule.product) : null }))
  }

  async createPriceRule(dto: CreatePriceRuleDto, actor?: StaffActor) {
    await this.checkCustomer(dto.customerId, actor)
    const startAt = dto.startAt ? new Date(dto.startAt) : null
    const endAt = dto.endAt ? new Date(dto.endAt) : null
    if ((startAt && !Number.isFinite(startAt.getTime())) || (endAt && !Number.isFinite(endAt.getTime()))
      || (startAt && endAt && endAt <= startAt)) {
      throw new BadRequestException('协议价结束时间必须晚于开始时间')
    }
    const price = Number(dto.price)
    if (!Number.isFinite(price) || price <= 0) {
      throw new BadRequestException({ message: '协议价必须大于 0', errorCode: 'CUS_1004' })
    }

    const [customer, sku] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: dto.customerId, tenantId: actor?.tenantId ?? 1 },
        select: { id: true }
      }),
      this.prisma.productSku.findFirst({
        where: {
          id: dto.skuId,
          tenantId: actor?.tenantId ?? 1,
          status: 'active',
          product: { is: { ...(actor ? this.productScope(actor) : {}), status: 'active' } }
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
          tenantId: actor?.tenantId ?? 1,
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
        startAt,
        endAt
      },
      create: {
        tenantId: actor?.tenantId ?? 1,
        brandId: sku.product.brandId,
        customerId: dto.customerId,
        productId: sku.productId,
        skuId: dto.skuId,
        priceType: 'agreement',
        price: dto.price,
        status: 'active',
        startAt,
        endAt
      }
    })

    await this.audit.write({
      ...this.auditActor(actor),
      action: 'price_change',
      module: 'customer',
      targetType: 'customer_price_rule',
      targetId: rule.id,
      afterData: { customerId: dto.customerId, skuId: dto.skuId, price: dto.price, priceType: 'agreement', startAt: startAt?.toISOString() ?? null, endAt: endAt?.toISOString() ?? null }
    })
    return rule
  }

  async deletePriceRule(id: number, actor?: StaffActor) {
    const rule = await this.prisma.customerPriceRule.findFirst({
      where: { id, tenantId: actor?.tenantId ?? 1, ...(actor ? { customer: this.scope(actor), ...(actor.superAdmin ? {} : { brandId: { in: actor.brandIds } }) } : {}) },
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
      ...this.auditActor(actor),
      action: 'price_change',
      module: 'customer',
      targetType: 'customer_price_rule',
      targetId: id,
      beforeData: { status: 'active' },
      afterData: { status: 'disabled' }
    })
    return updated
  }

  async repayments(customerId: number, actor?: StaffActor) {
    await this.checkCustomer(customerId, actor)
    return this.prisma.customerRepayment.findMany({
      where: { tenantId: actor?.tenantId ?? 1, customerId },
      orderBy: { createdAt: 'desc' }
    })
  }

  async createRepayment(customerId: number, dto: CreateRepaymentDto, userId?: number, actor?: StaffActor) {
    await this.checkCustomer(customerId, actor)
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
      if (!current) throw new NotFoundException('客户不存在')
      const updated = await tx.customer.updateMany({
        where: { id: customerId, creditUsed: current.creditUsed },
        data: { creditUsed: nextCreditUsed.toFixed(2) }
      })
      if (updated.count !== 1) throw new BadRequestException('账期余额已变化，请刷新后重试')
      return tx.customerRepayment.create({
        data: {
          tenantId: actor?.tenantId ?? 1,
          customerId,
          amount: dto.amount,
          method: dto.method || 'transfer',
          note: dto.note,
          operatorId: userId ?? null
        }
      })
    })

    await this.audit.write({
      ...this.auditActor(actor),
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
