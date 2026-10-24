import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditAction, Prisma } from '@prisma/client'
import { changeStock, receiptInput } from './stock-ledger'
import { stockAvailability } from './stock-availability'
import { convertQuantity } from './packaging'
import { customAlphabet } from 'nanoid'
import { PrismaService } from '../prisma.service'
import { AuditService } from '../audit/audit.service'
import { StaffActor } from '../auth/staff-access.service'
import { presentProduct, productDisplayName } from '../product/product-presentation'
import {
  CompleteStocktakeDto,
  CreateAdjustmentDto,
  CreateStocktakeDto,
  UpdateStocktakeItemsDto
} from './dto/inventory.dto'

const no = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 8)

export interface StockQuery {
  keyword?: string
  brandId?: number
  categoryId?: number
  lowStock?: boolean
  lowStockThreshold?: number
  page: number
  pageSize: number
}

export interface MovementQuery {
  skuId?: number
  type?: string
  sourceType?: string
  dateFrom?: string
  dateTo?: string
  page: number
  pageSize: number
}

const SKU_INCLUDE = {
  product: {
    select: {
      id: true,
      name: true,
      subtitle: true,
      code: true,
      status: true,
      brand: { select: { id: true, name: true, code: true } },
      category: { select: { id: true, name: true } }
    }
  }
} as const

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  private nextNo(prefix: string): string {
    return `${prefix}${Date.now().toString(36).toUpperCase()}${no()}`
  }

  private async assertStaffActor(userId?: number) {
    if (!userId) return
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { userType: true, tenantId: true, brandAccess: { where: { brand: { status: 'active' } }, select: { brandId: true } } }
    })
    if (!actor || actor.userType === 'customer_user') {
      throw new ForbiddenException({
        message: '仅管理端人员可执行此操作',
        errorCode: 'INV_1004'
      })
    }
    return actor
  }


  private async assertDocumentScope(actor: any, document: any) {
    if (!actor?.tenantId) return
    if (document.tenantId !== actor.tenantId) throw new ForbiddenException('库存单据不在当前租户范围')
    if (actor.userType !== 'super_admin') {
      const ids = [...new Set(document.items.map((x: any) => x.skuId))] as number[]
      const brandIds = actor.brandIds ?? actor.brandAccess.map((x: any) => x.brandId)
      const count = await this.prisma.productSku.count({ where: { id: { in: ids }, tenantId: actor.tenantId, product: { brandId: { in: brandIds } } } })
      if (count !== ids.length) throw new ForbiddenException('库存单据包含未授权品牌')
    }
  }

  private skuScope(actor?: StaffActor) {
    return { tenantId: actor?.tenantId || 1, ...(actor && !actor.superAdmin
      ? { product: { tenantId: actor.tenantId, brandId: { in: actor.brandIds } } } : {}) }
  }

  async stock(query: StockQuery, actor?: StaffActor) {
    const { keyword, brandId, categoryId, lowStock, lowStockThreshold, page, pageSize } = query
    const where: any = this.skuScope(actor)
    if (keyword) {
      where.OR = [
        { skuCode: { contains: keyword } },
        { product: { name: { contains: keyword } } },
        { product: { subtitle: { contains: keyword } } },
        { product: { code: { contains: keyword } } }
      ]
    }
    if (brandId) where.AND = [{ product: { brandId } }]
    if (categoryId) where.product = { ...(where.product || {}), categoryId }
    if (lowStock) where.stockNum = { lte: lowStockThreshold ?? 10 }

    const [skus, total] = await Promise.all([
      this.prisma.productSku.findMany({
        where,
        include: SKU_INCLUDE,
        orderBy: [{ productId: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.productSku.count({ where })
    ])
    const available = await stockAvailability(this.prisma, skus)

    return {
      items: skus.map((sku: any) => ({
        id: sku.id,
        skuId: sku.id,
        skuCode: sku.skuCode,
        specText: sku.specText,
        saleUnit: sku.saleUnit,
        stockNum: sku.stockNum, reservedNum: sku.reservedNum || 0, availableNum: available.get(sku.id) || 0, packagingUnits: sku.packagingUnits || [], batchTracking: sku.batchTracking,
        minOrderQty: sku.minOrderQty,
        status: sku.status,
        productId: sku.productId,
        productName: sku.product ? productDisplayName(sku.product) : undefined,
        productCode: sku.product?.code,
        brandId: sku.product?.brand?.id,
        brandName: sku.product?.brand?.name,
        categoryId: sku.product?.category?.id,
        categoryName: sku.product?.category?.name
      })),
      total,
      page,
      pageSize
    }
  }

  async movements(query: MovementQuery, actor?: StaffActor) {
    const { skuId, type, sourceType, dateFrom, dateTo, page, pageSize } = query
    const where: any = { tenantId: actor?.tenantId || 1, ...(actor ? { sku: this.skuScope(actor) } : {}) }
    if (skuId) where.skuId = skuId
    if (type) where.type = type
    if (sourceType) where.sourceType = sourceType
    if (dateFrom) {
      const parsed = new Date(dateFrom)
      if (!Number.isNaN(parsed.getTime())) where.createdAt = { ...(where.createdAt || {}), gte: parsed }
    }
    if (dateTo) {
      const parsed = new Date(dateTo)
      if (!Number.isNaN(parsed.getTime())) where.createdAt = { ...(where.createdAt || {}), lte: parsed }
    }

    const [items, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        include: {
          sku: {
            select: {
              id: true,
              skuCode: true,
              specText: true,
              saleUnit: true,
              product: { select: { id: true, name: true, subtitle: true, code: true } }
            }
          },
          operator: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.stockMovement.count({ where })
    ])

    return {
      items: items.map((m: any) => ({
        ...m,
        productName: m.sku?.product ? productDisplayName(m.sku.product) : undefined,
        productCode: m.sku?.product?.code,
        skuCode: m.sku?.skuCode,
        specText: m.sku?.specText,
        saleUnit: m.sku?.saleUnit,
        operatorName: m.operator?.name
      })),
      total,
      page,
      pageSize
    }
  }

  async adjustments(page = 1, pageSize = 10, actor?: StaffActor) {
    const where = { tenantId: actor?.tenantId || 1, ...(actor && !actor.superAdmin
      ? { movements: { some: {}, every: { sku: this.skuScope(actor) } } } : {}) }
    const [items, total] = await Promise.all([
      this.prisma.stockAdjustment.findMany({
        where,
        include: {
          operator: { select: { id: true, name: true } },
          movements: {
            select: { id: true, skuId: true, changeQty: true, beforeQty: true, afterQty: true, type: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.stockAdjustment.count({ where })
    ])
    return {
      items: items.map((item: any) => ({
        ...item,
        operatorName: item.operator?.name,
        itemCount: item.movements?.length || 0,
        totalChange: item.movements?.reduce((sum: number, m: any) => sum + Number(m.changeQty), 0) || 0
      })),
      total,
      page,
      pageSize
    }
  }

  async adjustmentDetail(id: number, actor?: StaffActor) {
    const item = await this.prisma.stockAdjustment.findUnique({
      where: { id },
      include: {
        operator: { select: { id: true, name: true } },
        movements: {
          include: {
            sku: {
              select: {
                id: true,
                skuCode: true,
                specText: true,
                saleUnit: true,
                product: { select: { id: true, name: true, subtitle: true, code: true } }
              }
            }
          },
          orderBy: { id: 'asc' }
        }
      }
    })
    if (!item) throw new NotFoundException({ message: '出入库单不存在', errorCode: 'INV_1002' })
    await this.assertDocumentScope(actor, { ...item, items: item.movements })
    return { ...item, movements: item.movements.map(movement => ({
      ...movement,
      sku: movement.sku ? { ...movement.sku, product: presentProduct(movement.sku.product) } : movement.sku
    })) }
  }

  async createAdjustment(dto: CreateAdjustmentDto, userId?: number) {
    const actor = await this.assertStaffActor(userId)
    const tenantId = actor?.tenantId || 1
    const created = await this.prisma.$transaction(async (tx) => {
      const adjustment = await tx.stockAdjustment.create({
        data: {
          tenantId,
          adjustmentNo: this.nextNo('ADJ'),
          type: dto.type,
          reason: dto.reason,
          operatorId: userId
        }
      })
      const movements = []
      for (const item of dto.items) {
        const sku = await tx.productSku.findUnique({
          where: { id: item.skuId },
          include: { product: { select: { name: true, subtitle: true, status: true, brandId: true } } }
        })
        if (!sku || sku.status !== 'active' || sku.product?.status !== 'active') {
          throw new BadRequestException({ message: 'SKU不存在或已停用', errorCode: 'INV_1003' })
        }
        if (actor?.tenantId && (sku.tenantId !== actor.tenantId || (actor.userType !== 'super_admin' && !actor.brandAccess.some(x => x.brandId === sku.product.brandId)))) throw new ForbiddenException('规格不在当前授权范围')
        const before = sku.stockNum
        const quantity = item.unit ? convertQuantity(sku, item.quantity, item.unit).baseQuantity : item.quantity
        const changeQty = dto.type === 'manual_in' ? quantity : -quantity
        if (dto.type === 'manual_out' && before < quantity) {
          throw new BadRequestException({
            message: `库存不足：${sku.product ? productDisplayName(sku.product) : ''} ${sku.specText} 当前库存 ${before}`,
            errorCode: 'INV_1001'
          })
        }
        const after = before + changeQty
        const batchAllocations = await changeStock(tx, sku, after, { receipt: item })
        const movement = await tx.stockMovement.create({
          data: {
            tenantId,
            skuId: item.skuId,
            productId: sku.productId,
            changeQty,
            beforeQty: before,
            afterQty: after, batchAllocations: batchAllocations as unknown as Prisma.InputJsonValue,
            type: dto.type,
            sourceType: 'adjustment',
            sourceId: adjustment.id,
            stockAdjustmentId: adjustment.id,
            operatorId: userId,
            remark: dto.reason
          }
        })
        movements.push(movement)
      }
      return { ...adjustment, movements }
    })

    await this.audit.write({
      tenantId,
      action: AuditAction.inventory_adjust,
      module: 'inventory',
      targetType: 'stock_adjustment',
      targetId: created.id,
      afterData: {
        adjustmentNo: created.adjustmentNo,
        type: dto.type,
        reason: dto.reason,
        items: dto.items
      },
      operatorId: userId
    })
    return created
  }

  async stocktakes(page = 1, pageSize = 10, actor?: StaffActor) {
    const where = { tenantId: actor?.tenantId || 1, ...(actor && !actor.superAdmin
      ? { items: { some: {}, every: { sku: this.skuScope(actor) } } } : {}) }
    const [items, total] = await Promise.all([
      this.prisma.stocktake.findMany({
        where,
        include: {
          operator: { select: { id: true, name: true } },
          reviewer: { select: { id: true, name: true } },
          _count: { select: { items: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.stocktake.count({ where })
    ])
    return {
      items: items.map((item: any) => ({
        ...item,
        operatorName: item.operator?.name,
        reviewerName: item.reviewer?.name,
        itemCount: item._count?.items || 0
      })),
      total,
      page,
      pageSize
    }
  }

  async stocktakeDetail(id: number, actor?: StaffActor) {
    const item = await this.prisma.stocktake.findUnique({
      where: { id },
      include: {
        operator: { select: { id: true, name: true } },
        reviewer: { select: { id: true, name: true } },
        items: {
          include: {
            sku: {
              select: {
                id: true,
                skuCode: true,
                specText: true,
                saleUnit: true,
                stockNum: true,
                batchTracking: true,
                product: { select: { id: true, name: true, subtitle: true, code: true } }
              }
            }
          },
          orderBy: { id: 'asc' }
        }
      }
    })
    if (!item) throw new NotFoundException({ message: '盘点单不存在', errorCode: 'INV_1005' })
    await this.assertDocumentScope(actor, item)
    return { ...item, items: item.items.map(row => ({
      ...row,
      sku: row.sku ? { ...row.sku, product: presentProduct(row.sku.product) } : row.sku
    })) }
  }

  async createStocktake(dto: CreateStocktakeDto, userId?: number) {
    const actor = await this.assertStaffActor(userId)
    const tenantId = actor?.tenantId || 1
    const skuWhere: any = { tenantId, status: 'active', product: { status: 'active', ...(actor && actor.userType !== 'super_admin' && actor.brandAccess ? { brandId: { in: actor.brandAccess.map(x => x.brandId) } } : {}) } }
    if (dto.skuIds?.length) skuWhere.id = { in: dto.skuIds }

    const skus = await this.prisma.productSku.findMany({
      where: skuWhere,
      select: { id: true, stockNum: true }
    })
    if (!skus.length) throw new BadRequestException({ message: '没有可盘点的SKU', errorCode: 'INV_1006' })
    if (dto.skuIds?.length && skus.length !== dto.skuIds.length) {
      throw new BadRequestException({ message: '部分SKU不存在或已停用，请刷新后重试', errorCode: 'INV_1007' })
    }

    const stocktake = await this.prisma.$transaction(async (tx) => {
      const created = await tx.stocktake.create({
        data: {
          tenantId,
          stocktakeNo: this.nextNo('PD'),
          remark: dto.remark,
          operatorId: userId
        }
      })
      await tx.stocktakeItem.createMany({
        data: skus.map((sku) => ({
          tenantId,
          stocktakeId: created.id,
          skuId: sku.id,
          systemQty: sku.stockNum
        }))
      })
      return created
    })

    await this.audit.write({
      tenantId,
      action: AuditAction.inventory_adjust,
      module: 'inventory',
      targetType: 'stocktake',
      targetId: stocktake.id,
      afterData: { stocktakeNo: stocktake.stocktakeNo, remark: dto.remark, skuCount: skus.length },
      operatorId: userId
    })
    return this.stocktakeDetail(stocktake.id)
  }

  async updateStocktakeItems(id: number, dto: UpdateStocktakeItemsDto, userId?: number) {
    const actor = await this.assertStaffActor(userId)
    const stocktake = await this.prisma.stocktake.findUnique({
      where: { id },
      include: { items: true }
    })
    if (!stocktake) throw new NotFoundException({ message: '盘点单不存在', errorCode: 'INV_1005' })
    await this.assertDocumentScope(actor, stocktake)
    if (stocktake.status !== 'draft') throw new BadRequestException({ message: '仅草稿盘点单可填写实盘数', errorCode: 'INV_1008' })

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.stocktake.updateMany({
        where: { id, status: 'draft', updatedAt: stocktake.updatedAt },
        data: { updatedAt: new Date() }
      })
      if (claimed.count !== 1) throw new BadRequestException('盘点单已变化，请刷新后重试')
      for (const input of dto.items) {
        const item = stocktake.items.find((entry) => entry.skuId === input.skuId)
        if (!item) throw new BadRequestException({ message: `SKU ${input.skuId} 不在盘点单中`, errorCode: 'INV_1009' })
        await tx.stocktakeItem.update({
          where: { id: item.id },
          data: {
            countedQty: input.countedQty,
            diffQty: input.countedQty - item.systemQty,
            receiptBatch: receiptInput(input, item.receiptBatch),
            remark: input.remark
          }
        })
      }
    })
    return this.stocktakeDetail(id)
  }

  async completeStocktake(id: number, dto: CompleteStocktakeDto, userId?: number) {
    const actor = await this.assertStaffActor(userId)
    const stocktake = await this.prisma.stocktake.findUnique({
      where: { id },
      include: { items: true }
    })
    if (!stocktake) throw new NotFoundException({ message: '盘点单不存在', errorCode: 'INV_1005' })
    await this.assertDocumentScope(actor, stocktake)
    if (stocktake.status !== 'draft') throw new BadRequestException({ message: '仅草稿盘点单可完成', errorCode: 'INV_1008' })

    const inputs = new Map(dto.items.map((item) => [item.skuId, item]))
    if (inputs.size !== dto.items.length || inputs.size !== stocktake.items.length) {
      throw new BadRequestException('请为盘点单中的每个规格填写一次实盘数')
    }
    for (const item of stocktake.items) {
      if (!inputs.has(item.skuId)) {
        throw new BadRequestException({ message: `SKU ${item.skuId} 未填写实盘数`, errorCode: 'INV_1010' })
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.stocktake.updateMany({
        where: { id, status: 'draft', updatedAt: stocktake.updatedAt },
        data: { status: 'completed', reviewedBy: userId, completedAt: new Date() }
      })
      if (claimed.count !== 1) throw new BadRequestException('盘点单已变化，请刷新后重试')
      for (const input of dto.items) {
        const item = stocktake.items.find((entry) => entry.skuId === input.skuId)
        if (!item) continue
        await tx.stocktakeItem.update({
          where: { id: item.id },
          data: { countedQty: input.countedQty, remark: input.remark, receiptBatch: receiptInput(input, item.receiptBatch) }
        })
      }

      for (const input of dto.items) {
        const item = stocktake.items.find((entry) => entry.skuId === input.skuId)
        if (!item) continue
        const sku = await tx.productSku.findUnique({ where: { id: item.skuId } })
        if (!sku) throw new BadRequestException({ message: `SKU ${item.skuId} 不存在`, errorCode: 'INV_1003' })
        const before = sku.stockNum
        const after = input.countedQty
        const diff = after - before
        if (diff !== 0) {
          const batchAllocations = await changeStock(tx, sku, after, { receipt: receiptInput(input, item.receiptBatch) })
          await tx.stockMovement.create({
            data: {
              tenantId: stocktake.tenantId || 1,
              skuId: item.skuId,
              productId: sku.productId,
              changeQty: diff,
              beforeQty: before,
              afterQty: after, batchAllocations: batchAllocations as unknown as Prisma.InputJsonValue,
              type: diff > 0 ? 'stocktake_in' : 'stocktake_out',
              sourceType: 'stocktake',
              sourceId: stocktake.id,
              operatorId: userId,
              remark: input.remark
            }
          })
          await tx.stocktakeItem.update({
            where: { id: item.id },
            data: { diffQty: diff }
          })
        } else {
          await tx.stocktakeItem.update({
            where: { id: item.id },
            data: { diffQty: 0 }
          })
        }
      }

    })

    await this.audit.write({
      tenantId: stocktake.tenantId || 1,
      action: AuditAction.inventory_adjust,
      module: 'inventory',
      targetType: 'stocktake',
      targetId: id,
      afterData: { stocktakeNo: stocktake.stocktakeNo, itemCount: dto.items.length },
      operatorId: userId
    })
    return this.stocktakeDetail(id)
  }

  async cancelStocktake(id: number, userId?: number) {
    const actor = await this.assertStaffActor(userId)
    const stocktake = await this.prisma.stocktake.findUnique({ where: { id }, include: { items: true } })
    if (!stocktake) throw new NotFoundException({ message: '盘点单不存在', errorCode: 'INV_1005' })
    await this.assertDocumentScope(actor, stocktake)
    if (stocktake.status !== 'draft') throw new BadRequestException({ message: '仅草稿盘点单可取消', errorCode: 'INV_1011' })

    const updated = await this.prisma.stocktake.updateMany({
      where: { id, status: 'draft' },
      data: { status: 'cancelled', reviewedBy: userId }
    })
    if (updated.count !== 1) throw new BadRequestException('盘点单已变化，请刷新后重试')
    await this.audit.write({
      tenantId: stocktake.tenantId || 1,
      action: AuditAction.inventory_adjust,
      module: 'inventory',
      targetType: 'stocktake',
      targetId: id,
      afterData: { stocktakeNo: stocktake.stocktakeNo, status: 'cancelled' },
      operatorId: userId
    })
    return this.stocktakeDetail(id)
  }
}
