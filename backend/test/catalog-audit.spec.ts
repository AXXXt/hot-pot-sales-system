import { Prisma } from '@prisma/client'
import { auditStorage } from '../src/audit/audit-context'
import { catalogSnapshot, writeCatalogAudit } from '../src/audit/catalog-audit'

it('whitelists SKU changes and excludes nested user/product credentials and arbitrary input', () => {
  expect(catalogSnapshot('product_sku', { id: 7, tenantId: 4, basePrice: new Prisma.Decimal('19.90'), status: 'active',
    packagingUnits: [{ unit: '箱', factor: 11 }], product: { name: 'nested' }, user: { openid: 'private' }, token: 'private', password: 'private' })).toEqual({
    id: 7, tenantId: 4, basePrice: '19.9', status: 'active', packagingUnits: [{ unit: '箱', factor: 11 }]
  })
})

it('uses explicit tenant and real operator, with before/after values inside the supplied transaction', async () => {
  const tx: any = { auditLog: { create: jest.fn() } }
  await auditStorage.run({ requestId: 'catalog-request-123', tenantId: 4, userId: 8 }, () => writeCatalogAudit(tx, {
    kind: 'brand', tenantId: 4, action: 'update', id: 12, before: { name: '原品牌', logoUrl: '/old.png' }, after: { name: '新品牌', logoUrl: null }
  }))
  expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: 4, operatorId: 8, requestId: 'catalog-request-123',
    targetType: 'brand', targetId: '12', beforeData: { name: '原品牌', logoUrl: '/old.png' }, afterData: { name: '新品牌', logoUrl: null } }) })
})

it('rejects a mismatching authenticated tenant before creating an audit row', async () => {
  const tx: any = { auditLog: { create: jest.fn() } }
  await expect(auditStorage.run({ requestId: 'catalog-request-456', tenantId: 4, userId: 8 }, () => writeCatalogAudit(tx, { kind: 'brand', tenantId: 5, action: 'update', id: 12 }))).rejects.toThrow('租户')
  expect(tx.auditLog.create).not.toHaveBeenCalled()
})

it('does not swallow storage failures because mutation and audit must roll back together', async () => {
  const tx: any = { auditLog: { create: jest.fn().mockRejectedValue(new Error('storage unavailable')) } }
  await expect(writeCatalogAudit(tx, { kind: 'product_category', tenantId: 4, operatorId: 8, action: 'delete', id: 12, before: { id: 12 } })).rejects.toThrow('storage unavailable')
})
