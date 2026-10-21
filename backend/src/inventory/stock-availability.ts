import { Prisma } from '@prisma/client'
import { businessDate } from './stock-ledger'

export async function stockAvailability(db: Prisma.TransactionClient, skus: Array<{ id: number; stockNum?: number; reservedNum?: number; batchTracking?: boolean }>) {
  const tracked = skus.filter(x => x.batchTracking).map(x => x.id)
  const expired = tracked.length ? await db.stockBatch.groupBy({ by: ['skuId'], where: { skuId: { in: tracked }, expiryDate: { lte: businessDate() }, quantity: { gt: 0 } }, _sum: { quantity: true } }) : []
  return new Map(skus.map(x => [x.id, Math.max(0, (x.stockNum || 0) - (x.reservedNum || 0) - (expired.find(batch => batch.skuId === x.id)?._sum.quantity || 0))]))
}
