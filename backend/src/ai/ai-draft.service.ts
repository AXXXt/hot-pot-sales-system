import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { StaffAccessService, StaffActor } from '../auth/staff-access.service'
import { ProductService } from '../product/product.service'
import { ProductDraft } from './ai.types'
import { AiInventoryService, InventoryDraft, inventoryMissing, normalizeInventoryDraft } from './ai-inventory.service'
import { AiSettingsService, DEFAULT_FEATURES } from './ai-settings.service'
import { AiWorkflowsService, normalizeWorkflow, workflowMissing } from './ai-workflows.service'
import { toBrandPrefix } from '../product/product-code'
import { productDisplayName } from '../product/product-presentation'

export function normalizeProductDraft(input: any): ProductDraft {
  const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : ''
  const id = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null
  return {
    brandId: id(input?.brandId), categoryId: id(input?.categoryId),
    brandName: id(input?.brandId) ? '' : text(input?.brandName, 100).normalize('NFKC'),
    categoryName: id(input?.categoryId) ? '' : text(input?.categoryName, 100).normalize('NFKC'),
    subtitle: text(input?.subtitle, 200), description: text(input?.description, 2000),
    skus: (Array.isArray(input?.skus) ? input.skus : [{}]).slice(0, 20).map((x: any) => ({ specText: text(x?.specText, 255), saleUnit: text(x?.saleUnit, 50), basePrice: text(x?.basePrice, 30), minOrderQty: Number(x?.minOrderQty) || 1 })),
    attachmentIds: (Array.isArray(input?.attachmentIds) ? input.attachmentIds : []).filter((x: unknown) => typeof x === 'string').slice(0, 3),
    warnings: ['创建后默认下架，初始库存为0；包装照片仅用于识别，主图请在商品编辑页上传。']
  }
}

export function productMissing(payload: ProductDraft) {
  const missing: string[] = []
  if (!payload.brandId && !payload.brandName) missing.push('品牌名称或已有品牌')
  if (!payload.categoryId && !payload.categoryName) missing.push('分类名称或已有分类')
  if (!payload.subtitle) missing.push('商品名称')
  if (!payload.skus.length) missing.push('至少一个规格')
  payload.skus.forEach((x, i) => {
    if (!x.specText) missing.push(`规格${i + 1}描述`)
    if (!x.saleUnit) missing.push(`规格${i + 1}销售单位`)
    if (!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(x.basePrice) || new Prisma.Decimal(x.basePrice || 0).lte(0)) missing.push(`规格${i + 1}售价（需大于0且明确单位）`)
    if (!Number.isSafeInteger(x.minOrderQty) || x.minOrderQty < 1 || x.minOrderQty > 100000) missing.push(`规格${i + 1}起订量`)
  })
  return missing
}

@Injectable()
export class AiDraftService {
  constructor(private readonly prisma: PrismaService, private readonly access: StaffAccessService, private readonly products: ProductService, private readonly settings: AiSettingsService, private readonly inventory?: AiInventoryService, private readonly workflows?: AiWorkflowsService) {}

  private digest(action: string, payload: unknown, fingerprint: string) { return createHash('sha256').update(JSON.stringify({ action, payload, fingerprint })).digest('hex') }

  private normalize(action: string, value: any) {
    if (['inventory.batch', 'order.create'].includes(action)) return normalizeWorkflow(action, value)
    if (action === 'inventory.adjust') return normalizeInventoryDraft(value)
    if (action === 'product.create') return normalizeProductDraft(value)
    if (action === 'task.create') {
      const title = typeof value?.title === 'string' ? value.title.trim().slice(0, 200) : ''
      const dueAt = typeof value?.dueAt === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value.dueAt) ? new Date(value.dueAt) : new Date(NaN)
      if (!title || !Number.isFinite(dueAt.getTime()) || dueAt.getTime() <= Date.now() || dueAt.getTime() > Date.now() + 366 * 86400000) throw new BadRequestException('请填写事项和一年内的明确未来时间（上海时区）')
      return { title, dueAt: dueAt.toISOString() }
    }
    throw new BadRequestException('不支持的业务动作')
  }

  private authorize(actor: StaffActor, action: string) {
    if (['inventory.batch', 'order.create'].includes(action)) {
      if (!this.workflows) throw new BadRequestException('清单能力不可用')
      return this.workflows.authorize(actor, action)
    }
    if (action === 'inventory.adjust') this.access.require(actor, 'inventory:read')
    this.access.require(actor, 'ai:use', action === 'product.create' ? 'product:create' : action === 'task.create' ? 'task:manage_own' : action === 'inventory.adjust' ? 'inventory:adjust' : '__unknown_action__')
  }

  private async prepare(actor: StaffActor, action: string, value: unknown) {
    if (['inventory.batch', 'order.create'].includes(action)) return this.workflows!.prepare(actor, action, value)
    if (action === 'inventory.adjust') {
      if (!this.inventory) throw new BadRequestException('库存调整能力不可用')
      return this.inventory.prepare(actor, value)
    }
    const payload = this.normalize(action, value)
    if (action !== 'product.create') return payload
    const product = payload as ProductDraft
    // Reuse an exact authorized match before asking for permission to create new master data.
    if (!product.brandId && product.brandName) {
      const matches = await this.prisma.brand.findMany({ where: { tenantId: actor.tenantId, name: product.brandName, status: 'active', ...(actor.superAdmin ? {} : { id: { in: actor.brandIds } }) }, select: { id: true }, take: 2 })
      if (matches.length === 1) { product.brandId = matches[0].id; product.brandName = '' }
      if (matches.length > 1) throw new ConflictException('有多个同名品牌，请明确选择已有品牌')
    }
    if (!product.categoryId && product.categoryName) {
      const matches = await this.prisma.productCategory.findMany({ where: { tenantId: actor.tenantId, name: product.categoryName, status: 'active' }, select: { id: true }, take: 2 })
      if (matches.length === 1) { product.categoryId = matches[0].id; product.categoryName = '' }
      if (matches.length > 1) throw new ConflictException('有多个同名分类，请明确选择已有分类')
    }
    return product
  }

  async create(actor: StaffActor, conversationId: string, action: string, value: unknown) {
    this.authorize(actor, action)
    const conversation = await this.prisma.aiConversation.findFirst({ where: { id: conversationId, tenantId: actor.tenantId, ownerId: actor.id, archived: false, fingerprint: actor.fingerprint } })
    if (!conversation) throw new NotFoundException('会话不可访问，请新建会话')
    const payload = await this.prepare(actor, action, value)
    const draft = await this.prisma.aiActionDraft.create({ data: { tenantId: actor.tenantId, ownerId: actor.id, conversationId, action, payload: payload as unknown as Prisma.InputJsonValue,
      fingerprint: actor.fingerprint, digest: this.digest(action, payload, actor.fingerprint), expiresAt: new Date(Date.now() + 10 * 60000) } })
    return this.present(draft, actor)
  }

  present(draft: any, actor?: StaffActor) {
    const payload = draft.action === 'product.create' ? normalizeProductDraft(draft.payload) : null
    const missing = payload ? productMissing(payload) : draft.action === 'inventory.adjust' ? inventoryMissing(draft.payload as InventoryDraft) : ['inventory.batch', 'order.create'].includes(draft.action) ? workflowMissing(draft.action, draft.payload) : []
    if (actor && payload?.brandName && !this.access.has(actor, 'brand:manage')) missing.push('新建品牌需要品牌管理权限')
    if (actor && payload?.categoryName && !this.access.has(actor, 'product:update')) missing.push('新建分类需要商品维护权限')
    return { type: 'draft', ...draft, missing }
  }

  async get(actor: StaffActor, id: string, completedReplay = false) {
    const draft = await this.prisma.aiActionDraft.findFirst({ where: { id, tenantId: actor.tenantId, ownerId: actor.id, ...(completedReplay ? {} : { fingerprint: actor.fingerprint }) } })
    if (!draft) throw new NotFoundException('草稿不存在或权限范围已变化')
    if (draft.fingerprint !== actor.fingerprint && !(completedReplay && draft.status === 'succeeded')) throw new NotFoundException('草稿不存在或权限范围已变化')
    this.authorize(actor, draft.action)
    return draft
  }

  async update(actor: StaffActor, id: string, version: number, value: unknown) {
    const current = await this.get(actor, id)
    if (current.status === 'succeeded') throw new ConflictException('此草稿已执行，请新建草稿')
    const payload = await this.prepare(actor, current.action, value)
    const result = await this.prisma.aiActionDraft.updateMany({ where: { id, tenantId: actor.tenantId, ownerId: actor.id, version, status: 'draft' }, data: {
      payload: payload as unknown as Prisma.InputJsonValue, digest: this.digest(current.action, payload, actor.fingerprint), version: { increment: 1 }, expiresAt: new Date(Date.now() + 10 * 60000)
    } })
    if (result.count !== 1) throw new ConflictException('草稿已变化，请刷新后重试')
    return this.present(await this.get(actor, id), actor)
  }

  async confirm(actor: StaffActor, id: string, version: number, digest: string) {
    const draft = await this.get(actor, id, true)
    this.access.require(actor, 'ai:execute')
    const config = await this.settings.configFor(actor.tenantId)
    const feature = draft.action === 'product.create' ? 'products' : draft.action.startsWith('inventory.') ? 'inventory' : draft.action === 'order.create' ? 'orders' : 'tasks'
    const features = { ...DEFAULT_FEATURES, ...(config?.features as object ?? {}) }
    if (!config?.enabled || !config.allowWrites || features[feature] !== true) throw new BadRequestException('此业务写入能力尚未启用')
    if (draft.version !== version || draft.digest !== digest) throw new ConflictException('确认内容与当前草稿不一致')
    const existing = await this.prisma.aiActionExecution.findFirst({ where: { tenantId: actor.tenantId, ownerId: actor.id, draftId: id } })
    if (existing) {
      if (draft.fingerprint !== actor.fingerprint) {
        const result = existing.result as any
        if (!result.scopeChanged || !await this.prisma.product.findFirst({ where: { AND: [this.access.productWhere(actor), { id: result.id }] }, select: { id: true } })) throw new ConflictException('权限范围已变化，请在商品管理检查结果')
      }
      return existing
    }
    if (draft.expiresAt.getTime() < Date.now()) throw new ConflictException('确认已过期，请编辑检查后重新保存草稿')
    return this.prisma.$transaction(async tx => {
      const currentConfig = await tx.aiConfig.findUnique({ where: { tenantId: actor.tenantId } })
      if (!currentConfig?.enabled || !currentConfig.allowWrites || ({ ...DEFAULT_FEATURES, ...(currentConfig?.features as object ?? {}) })[feature] !== true) throw new ConflictException('助手写入开关已关闭')
      const locked = await tx.aiActionDraft.updateMany({ where: { id, tenantId: actor.tenantId, ownerId: actor.id, version, digest, status: 'draft', expiresAt: { gt: new Date() } }, data: { status: 'executing' } })
      if (!locked.count) {
        const done = await tx.aiActionExecution.findFirst({ where: { tenantId: actor.tenantId, ownerId: actor.id, draftId: id } })
        if (done) return done
        throw new ConflictException('草稿状态已变化，请刷新确认结果')
      }
      const payload: any = ['inventory.adjust', 'inventory.batch', 'order.create'].includes(draft.action) ? draft.payload : this.normalize(draft.action, draft.payload)
      let result: Record<string, unknown>
      if (draft.action === 'product.create') result = await this.createProduct(tx, actor, payload)
      else if (draft.action === 'inventory.adjust') {
        if (!this.inventory) throw new BadRequestException('库存调整能力不可用')
        result = await this.inventory.apply(tx, actor, payload, id)
      } else if (['inventory.batch', 'order.create'].includes(draft.action)) result = await this.workflows!.apply(tx, actor, draft.action, payload, id)
      else {
        const task = await tx.opsTask.create({ data: { tenantId: actor.tenantId, ownerId: actor.id, title: payload.title, dueAt: new Date(payload.dueAt) } })
        result = { id: task.id, title: task.title, dueAt: task.dueAt.toISOString(), type: 'task' }
      }
      const execution = await tx.aiActionExecution.create({ data: { tenantId: actor.tenantId, ownerId: actor.id, draftId: id, action: draft.action, result: result as Prisma.InputJsonValue } })
      await tx.aiActionDraft.update({ where: { id }, data: { status: 'succeeded' } })
      await tx.auditLog.create({ data: { tenantId: actor.tenantId, operatorId: actor.id, action: 'create', module: 'ai', targetType: draft.action, targetId: String(result.id), requestId: `ai-${execution.id}`, afterData: { executionId: execution.id, draftId: id, version, result: result as Prisma.InputJsonValue } } })
      return execution
    }, { timeout: 15000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
  }

  private async createProduct(tx: Prisma.TransactionClient, actor: StaffActor, payload: ProductDraft) {
    this.access.require(actor, 'product:create')
    const missing = productMissing(payload)
    if (missing.length) throw new BadRequestException(`请补充：${missing.join('、')}`)
    const catalog = await this.resolveCatalog(tx, actor, payload)
    const identity = await this.products.allocateProductIdentity(tx, actor.tenantId, catalog.brand.id, catalog.category.id)
    const duplicate = await tx.product.findFirst({ where: { tenantId: actor.tenantId, brandId: catalog.brand.id, categoryId: catalog.category.id, subtitle: payload.subtitle, status: { not: 'archived' } }, select: { id: true } })
    if (duplicate) throw new ConflictException('已有相同品牌、分类与副标题的商品，请先检查现有商品或补充规格')
    const product = await tx.product.create({ data: { tenantId: actor.tenantId, brandId: identity.brand.id, categoryId: identity.category.id, code: identity.code, name: identity.name, subtitle: payload.subtitle, description: payload.description, status: 'disabled',
      skus: { create: payload.skus.map((sku, i) => ({ tenantId: actor.tenantId, skuCode: `${identity.code}-${String(i + 1).padStart(2, '0')}`, name: sku.specText, specText: sku.specText, saleUnit: sku.saleUnit, basePrice: sku.basePrice, minOrderQty: sku.minOrderQty, stockNum: 0 })) }
    }, include: { skus: { select: { id: true } } } })
    return { type: 'product', id: product.id, name: productDisplayName(product), managementLabel: product.name, subtitle: product.subtitle, code: product.code, status: product.status, skuCount: product.skus.length,
      path: `/products/${product.id}/edit`, catalog, scopeChanged: catalog.brand.created && !actor.superAdmin }
  }

  private async resolveCatalog(tx: Prisma.TransactionClient, actor: StaffActor, payload: ProductDraft) {
    if (payload.brandId && !actor.superAdmin && !actor.brandIds.includes(payload.brandId)) throw new BadRequestException('该品牌不在可操作范围')
    if (payload.brandId && payload.categoryId) return { brand: { id: payload.brandId, created: false }, category: { id: payload.categoryId, created: false } }
    // Name uniqueness is not a schema constraint. Serialize AI master-data resolution per tenant.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM tenants WHERE id = ${actor.tenantId} AND status = 'active' FOR UPDATE`)
    let brand = payload.brandId ? { id: payload.brandId, name: '', created: false } : null
    let category = payload.categoryId ? { id: payload.categoryId, name: '', created: false } : null
    if (!brand) {
      const matches = await tx.brand.findMany({ where: { tenantId: actor.tenantId, name: payload.brandName }, select: { id: true, name: true, status: true }, take: 2 })
      if (matches.length) {
        if (matches.length !== 1 || matches[0].status !== 'active' || (!actor.superAdmin && !actor.brandIds.includes(matches[0].id))) throw new BadRequestException('该品牌不可使用，请选择已授权品牌或联系管理员处理')
        brand = { id: matches[0].id, name: matches[0].name, created: false }
      } else {
        this.access.require(actor, 'brand:manage')
        const prefix = toBrandPrefix(payload.brandName!).slice(0, 32)
        if (!prefix) throw new BadRequestException('品牌名称需包含可生成编码的文字或数字')
        let code = prefix
        for (let suffix = 2; await tx.brand.findFirst({ where: { tenantId: actor.tenantId, code }, select: { id: true } }); suffix++) {
          if (suffix > 100) throw new ConflictException('品牌编码冲突，请调整品牌名称')
          code = `${prefix}${suffix}`
        }
        const item = await tx.brand.create({ data: { tenantId: actor.tenantId, name: payload.brandName!, code, status: 'active' } })
        if (!actor.superAdmin) await tx.userBrandAccess.create({ data: { tenantId: actor.tenantId, userId: actor.id, brandId: item.id } })
        brand = { id: item.id, name: item.name, created: true }
        await tx.auditLog.create({ data: { tenantId: actor.tenantId, operatorId: actor.id, action: 'create', module: 'brand', targetType: 'brand', targetId: String(item.id), requestId: `ai-brand-${randomUUID()}`, afterData: { name: item.name, code, creatorAccess: !actor.superAdmin, source: 'ai_product_bundle' } } })
      }
    }
    if (!category) {
      const matches = await tx.productCategory.findMany({ where: { tenantId: actor.tenantId, name: payload.categoryName }, select: { id: true, name: true, status: true }, take: 2 })
      if (matches.length) {
        if (matches.length !== 1 || matches[0].status !== 'active') throw new BadRequestException('同名分类不可使用，请在分类管理中检查')
        category = { id: matches[0].id, name: matches[0].name, created: false }
      } else {
        this.access.require(actor, 'product:update')
        // The category manager uses the category name as its default code as well.
        const code = payload.categoryName!.slice(0, 64)
        if (await tx.productCategory.findFirst({ where: { tenantId: actor.tenantId, code }, select: { id: true } })) throw new ConflictException('分类编码冲突，请调整分类名称')
        const item = await tx.productCategory.create({ data: { tenantId: actor.tenantId, name: payload.categoryName!, code, status: 'active' } })
        category = { id: item.id, name: item.name, created: true }
        await tx.auditLog.create({ data: { tenantId: actor.tenantId, operatorId: actor.id, action: 'create', module: 'product', targetType: 'product_category', targetId: String(item.id), requestId: `ai-category-${randomUUID()}`, afterData: { name: item.name, code, source: 'ai_product_bundle' } } })
      }
    }
    return { brand, category }
  }
}
