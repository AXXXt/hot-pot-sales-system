import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditAction } from '@prisma/client'
import { customAlphabet } from 'nanoid'
import { PrismaService } from '../prisma.service'
import { AuditService } from '../audit/audit.service'
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
      select: { userType: true }
    })
    if (!actor || actor.userType === 'customer_user') {
      throw new ForbiddenException({
        message: '仅管理端人员可执行此操作',
        errorCode: 'INV_1004'
      })
    }
  }

  async stock(query: StockQuery) {
    const { keyword, brandId, categoryId, lowStock, lowStockThreshold, page, pageSize } = query
    const where: any = { tenantId: 1 }
    if (keyword) {
      where.OR = [
        { skuCode: { contains: keyword } },
        { product: { name: { contains: keyword } } },
        { product: { code: { contains: keyword } } }
      ]
    }
    if (brandId) where.product = { ...(where.product || {}), brandId }
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

    return {
      items: skus.map((sku: any) => ({
        id: sku.id,
        skuId: sku.id,
        skuCode: sku.skuCode,
        specText: sku.specText,
        saleUnit: sku.saleUnit,
        stockNum: sku.stockNum,
        minOrderQty: sku.minOrderQty,
        status: sku.status,
        productId: sku.productId,
        productName: sku.product?.name,
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

  async movements(query: MovementQuery) {
    const { skuId, type, sourceType, dateFrom, dateTo, page, pageSize } = query
    const where: any = { tenantId: 1 }
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
              product: { select: { id: true, name: true, code: true } }
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
        productName: m.sku?.product?.name,
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

  async adjustments(page = 1, pageSize = 10) {
    const where = { tenantId: 1 }
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

  async adjustmentDetail(id: number) {
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
                product: { select: { id: true, name: true, code: true } }
              }
            }
          },
          orderBy: { id: 'asc' }
        }
      }
    })
    if (!item) throw new NotFoundException({ message: '出入库单不存在', errorCode: 'INV_1002' })
    return item
  }

  async createAdjustment(dto: CreateAdjustmentDto, userId?: number) {
    await this.assertStaffActor(userId)
    const created = await this.prisma.$transaction(async (tx) => {
      const adjustment = await tx.stockAdjustment.create({
        data: {
          tenantId: 1,
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
          include: { product: { select: { name: true, status: true } } }
        })
        if (!sku || sku.status !== 'active' || sku.product?.status !== 'active') {
          throw new BadRequestException({ message: 'SKU不存在或已停用', errorCode: 'INV_1003' })
        }
        const before = sku.stockNum
        const changeQty = dto.type === 'manual_in' ? item.quantity : -item.quantity
        if (dto.type === 'manual_out' && before < item.quantity) {
          throw new BadRequestException({
            message: `库存不足：${sku.product?.name || ''} ${sku.specText} 当前库存 ${before}`,
            errorCode: 'INV_1001'
          })
        }
        const after = before + changeQty
        await tx.productSku.update({ where: { id: item.skuId }, data: { stockNum: after } })
        const movement = await tx.stockMovement.create({
          data: {
            tenantId: 1,
            skuId: item.skuId,
            productId: sku.productId,
            changeQty,
            beforeQty: before,
            afterQty: after,
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

  async stocktakes(page = 1, pageSize = 10) {
    const where = { tenantId: 1 }
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

  async stocktakeDetail(id: number) {
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
                product: { select: { id: true, name: true, code: true } }
              }
            }
          },
          orderBy: { id: 'asc' }
        }
      }
    })
    if (!item) throw new NotFoundException({ message: '盘点单不存在', errorCode: 'INV_1005' })
    return item
  }

  async createStocktake(dto: CreateStocktakeDto, userId?: number) {
    await this.assertStaffActor(userId)
    const skuWhere: any = { tenantId: 1, status: 'active', product: { status: 'active' } }
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
          tenantId: 1,
          stocktakeNo: this.nextNo('PD'),
          remark: dto.remark,
          operatorId: userId
        }
      })
      await tx.stocktakeItem.createMany({
        data: skus.map((sku) => ({
          tenantId: 1,
          stocktakeId: created.id,
          skuId: sku.id,
          systemQty: sku.stockNum
        }))
      })
      return created
    })

    await this.audit.write({
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
    await this.assertStaffActor(userId)
    const stocktake = await this.prisma.stocktake.findUnique({
      where: { id },
      include: { items: true }
    })
    if (!stocktake) throw new NotFoundException({ message: '盘点单不存在', errorCode: 'INV_1005' })
    if (stocktake.status !== 'draft') throw new BadRequestException({ message: '仅草稿盘点单可填写实盘数', errorCode: 'INV_1008' })

    await this.prisma.$transaction(async (tx) => {
      for (const input of dto.items) {
        const item = stocktake.items.find((entry) => entry.skuId === input.skuId)
        if (!item) throw new BadRequestException({ message: `SKU ${input.skuId} 不在盘点单中`, errorCode: 'INV_1009' })
        await tx.stocktakeItem.update({
          where: { id: item.id },
          data: {
            countedQty: input.countedQty,
            diffQty: input.countedQty - item.systemQty,
            remark: input.remark
          }
        })
      }
    })
    return this.stocktakeDetail(id)
  }

  async completeStocktake(id: number, dto: CompleteStocktakeDto, userId?: number) {
    await this.assertStaffActor(userId)
    const stocktake = await this.prisma.stocktake.findUnique({
      where: { id },
      include: { items: true }
    })
    if (!stocktake) throw new NotFoundException({ message: '盘点单不存在', errorCode: 'INV_1005' })
    if (stocktake.status !== 'draft') throw new BadRequestException({ message: '仅草稿盘点单可完成', errorCode: 'INV_1008' })

    const inputs = new Map(dto.items.map((item) => [item.skuId, item]))
    for (const item of stocktake.items) {
      if (!inputs.has(item.skuId)) {
        throw new BadRequestException({ message: `SKU ${item.skuId} 未填写实盘数`, errorCode: 'INV_1010' })
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const input of dto.items) {
        const item = stocktake.items.find((entry) => entry.skuId === input.skuId)
        if (!item) continue
        await tx.stocktakeItem.update({
          where: { id: item.id },
          data: { countedQty: input.countedQty, remark: input.remark }
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
          await tx.productSku.update({ where: { id: item.skuId }, data: { stockNum: after } })
          await tx.stockMovement.create({
            data: {
              tenantId: 1,
              skuId: item.skuId,
              productId: sku.productId,
              changeQty: diff,
              beforeQty: before,
              afterQty: after,
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

      await tx.stocktake.update({
        where: { id },
        data: { status: 'completed', reviewedBy: userId, completedAt: new Date() }
      })
    })

    await this.audit.write({
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
    await this.assertStaffActor(userId)
    const stocktake = await this.prisma.stocktake.findUnique({ where: { id } })
    if (!stocktake) throw new NotFoundException({ message: '盘点单不存在', errorCode: 'INV_1005' })
    if (stocktake.status !== 'draft') throw new BadRequestException({ message: '仅草稿盘点单可取消', errorCode: 'INV_1011' })

    const updated = await this.prisma.stocktake.update({
      where: { id },
      data: { status: 'cancelled', reviewedBy: userId }
    })
    await this.audit.write({
      action: AuditAction.inventory_adjust,
      module: 'inventory',
      targetType: 'stocktake',
      targetId: id,
      afterData: { stocktakeNo: stocktake.stocktakeNo, status: 'cancelled' },
      operatorId: userId
    })
    return updated
  }
}