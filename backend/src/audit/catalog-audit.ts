import { BadRequestException } from '@nestjs/common'
import { AuditAction, Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { getAuditContext } from './audit-context'

const FIELDS = {
  brand: ['id', 'tenantId', 'name', 'code', 'status', 'sortOrder', 'logoUrl', 'description'],
  product_category: ['id', 'tenantId', 'name', 'code', 'status', 'sortOrder', 'parentId'],
  product_sku: ['id', 'tenantId', 'productId', 'skuCode', 'name', 'specText', 'saleUnit', 'basePrice', 'minOrderQty', 'status', 'imageUrl', 'packagingUnits', 'unitId', 'batchTracking', 'lowStockThreshold', 'leadTimeDays', 'safetyStock', 'stockNum', 'reservedNum']
} as const
type Kind = keyof typeof FIELDS

/** Whitelist business fields; nested product/user relations and credentials never enter this log. */
export function catalogSnapshot(kind: Kind, row: any): Prisma.InputJsonValue | undefined {
  if (!row) return undefined
  return JSON.parse(JSON.stringify(Object.fromEntries(FIELDS[kind].filter(key => row[key] !== undefined).map(key => [key, row[key]])))) as Prisma.InputJsonValue
}

/** A failed catalog audit aborts the same transaction, including propagated labels/legacy batches. */
export async function writeCatalogAudit(tx: Prisma.TransactionClient, input: {
  kind: Kind; tenantId: number; operatorId?: number; action: AuditAction; id: number; before?: any; after?: any
}) {
  const ctx = getAuditContext()
  if (ctx?.tenantId && ctx.tenantId !== input.tenantId) throw new BadRequestException('审计租户与当前操作不一致')
  const operatorId = input.operatorId ?? ctx?.userId ?? null
  if (operatorId !== null && (!Number.isSafeInteger(operatorId) || operatorId <= 0)) throw new BadRequestException('审计操作人无效')
  if (ctx?.userId && input.operatorId !== undefined && ctx.userId !== input.operatorId) throw new BadRequestException('审计操作人与当前账号不一致')
  await tx.auditLog.create({ data: {
    tenantId: input.tenantId, operatorId, action: input.action, module: 'product', targetType: input.kind, targetId: String(input.id),
    beforeData: catalogSnapshot(input.kind, input.before), afterData: catalogSnapshot(input.kind, input.after),
    requestId: ctx?.requestId || `catalog-${randomUUID()}`, ipAddress: ctx?.ip ?? null, userAgent: ctx?.userAgent ?? null
  } })
}
