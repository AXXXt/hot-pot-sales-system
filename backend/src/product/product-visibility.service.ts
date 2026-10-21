import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'

const FACTORY_SCOPE: Prisma.ProductWhereInput = {
  tenantId: 1,
  status: 'active',
  isFactoryProduct: true
}

@Injectable()
export class ProductVisibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async whereForCustomer(customerId: number): Promise<Prisma.ProductWhereInput> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, tenantId: true, productVisibilityMode: true }
    })
    if (!customer) {
      throw new NotFoundException({
        message: '客户不存在',
        errorCode: 'CUS_1001'
      })
    }
    return this.scopeForCustomer(customer)
  }

  async whereForUser(userId?: number): Promise<Prisma.ProductWhereInput> {
    if (!userId) return { ...FACTORY_SCOPE }

    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        userType: true,
        tenantId: true,
        brandAccess: { select: { brandId: true } },
        customer: {
          select: { id: true, tenantId: true, productVisibilityMode: true }
        }
      }
    })

    if (!actor) return { id: { in: [] } }
    if (actor.userType !== 'customer_user') {
      return {
        tenantId: actor.tenantId,
        ...(actor.userType === 'super_admin' ? {} : {
          brandId: { in: actor.brandAccess.map(item => item.brandId) }
        })
      }
    }
    if (!actor.customer || actor.customer.tenantId !== actor.tenantId) {
      return { tenantId: actor.tenantId, status: 'active', id: { in: [] } }
    }

    return this.scopeForCustomer(actor.customer)
  }

  private scopeForCustomer(
    customer: { id: number; tenantId: number; productVisibilityMode: string }
  ): Prisma.ProductWhereInput {
    if (customer.productVisibilityMode === 'all') {
      return { tenantId: customer.tenantId, status: 'active' }
    }
    if (customer.productVisibilityMode === 'custom') {
      return {
        tenantId: customer.tenantId,
        status: 'active',
        visibleToCustomers: { some: { customerId: customer.id } }
      }
    }
    return { ...FACTORY_SCOPE, tenantId: customer.tenantId }
  }

  async assertVisible(productId: number, userId?: number): Promise<Prisma.ProductWhereInput> {
    const scope = await this.whereForUser(userId)
    const product = await this.prisma.product.findFirst({
      where: { id: productId, ...scope },
      select: { id: true }
    })
    if (!product) {
      throw new NotFoundException({
        message: '商品不存在或暂不可购买',
        errorCode: 'PRO_1001'
      })
    }
    return scope
  }
}
