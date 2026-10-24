import { Reflector } from '@nestjs/core'
import { OrderAccessGuard, getOrderScope } from '../src/order/order-access.guard'
import { OrderService } from '../src/order/order.service'
import { ProductImageStorageService } from '../src/upload/product-image-storage.service'

/** A staff role grants an operation, while brand/customer assignments bound its rows. */
function fixture() {
  const actor = {
    id: 7, tenantId: 2, userType: 'sales', status: 'active', customerId: null,
    tenant: { status: 'active' }, staffCredential: null,
    brandAccess: [{ brandId: 11 }],
    userRoles: [{ tenantId: 2, role: { tenantId: 2, permissions: ['order:read', 'order:confirm'].map(code => ({ tenantId: 2, permission: { code, status: 'active' } })) } }]
  }
  const orders = [
    { id: 100, tenantId: 2, brandId: 11, customerId: 21, paymentProof: 'https://assets.test/bucket/payment-proofs/2026/10/own.jpg' },
    { id: 101, tenantId: 2, brandId: 11, customerId: 22, paymentProof: 'https://assets.test/bucket/payment-proofs/2026/10/other-buyer.jpg' },
    { id: 102, tenantId: 2, brandId: 12, customerId: 21, paymentProof: 'https://assets.test/bucket/payment-proofs/2026/10/other-brand.jpg' }
  ]
  function match(order: any, where: any): boolean {
    if (where.AND && !where.AND.every((part: any) => match(order, part))) return false
    return Object.entries(where).filter(([key]) => key !== 'AND').every(([key, value]: any) => {
      if (value === undefined) return true
      if (value && typeof value === 'object' && 'in' in value) return value.in.includes(order[key])
      return order[key] === value
    })
  }
  const db: any = {
    user: { findUnique: jest.fn().mockResolvedValue(actor) },
    userRole: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
    customer: { findMany: jest.fn().mockResolvedValue([{ id: 21 }]) },
    lead: { findMany: jest.fn().mockResolvedValue([]) },
    order: {
      findFirst: jest.fn(async ({ where }) => orders.find(order => match(order, where)) || null),
      findMany: jest.fn(async ({ where }) => orders.filter(order => match(order, where)).map(order => ({ ...order, items: [] }))),
      count: jest.fn(async ({ where }) => orders.filter(order => match(order, where)).length)
    },
    file: { findFirst: jest.fn().mockResolvedValue(null) },
    customerPriceHistory: { findMany: jest.fn().mockResolvedValue([]) }
  }
  const service = new OrderService(db, {} as any, {} as any, {} as any, {} as any)
  const client = {
    bucketExists: jest.fn().mockResolvedValue(true),
    getBucketPolicy: jest.fn().mockResolvedValue('{"Statement":[]}'),
    setBucketPolicy: jest.fn(), presignedGetObject: jest.fn().mockResolvedValue('signed-url')
  }
  const storage = new ProductImageStorageService(client as any, { getOrThrow: (key: string) => key === 'MINIO_BUCKET' ? 'bucket' : 'https://assets.test' } as any, db)
  const context = (id: number, method = 'GET') => ({
    switchToHttp: () => ({ getRequest: () => ({ user: { sub: 7 }, params: { id }, method }) }),
    getHandler: () => () => {}
  }) as any
  return { db, service, client, storage, context }
}

describe('staff order and payment-proof assignment bounds', () => {
  it.each([101, 102])('hides order %i outside the sales customer or brand assignment', async id => {
    const { db, context } = fixture()
    const guard = new OrderAccessGuard(db, new Reflector())
    await expect(guard.canActivate(context(id))).rejects.toMatchObject({ status: 404 })
    await expect(guard.canActivate(context(id, 'POST'))).rejects.toMatchObject({ status: 404 })
  })

  it('filters the actual order list even if a different customer is requested', async () => {
    const { db, service } = fixture()
    const scope = await getOrderScope(db, 7)
    const own = await service.list({ ...scope, page: 1, pageSize: 10 })
    expect(own.items.map(item => item.id)).toEqual([100])
    const other = await service.list({ ...scope, customerId: 22, page: 1, pageSize: 10 })
    expect(other.items).toHaveLength(0)
    expect(other.total).toBe(0)
  })

  it.each(['other-buyer', 'other-brand'])('does not sign the %s proof for restricted staff', async key => {
    const { storage, client } = fixture()
    await expect(storage.getPaymentProofSignedUrl(`payment-proofs/2026/10/${key}.jpg`, 7)).rejects.toMatchObject({ status: 403 })
    expect(client.presignedGetObject).not.toHaveBeenCalled()
  })

  it('still signs a proof within the staff order assignments', async () => {
    const { storage } = fixture()
    await expect(storage.getPaymentProofSignedUrl('payment-proofs/2026/10/own.jpg', 7)).resolves.toMatchObject({ url: 'signed-url' })
  })
})
