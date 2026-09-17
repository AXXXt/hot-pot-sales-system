import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'

const FACTORY_SCOPE: Prisma.ProductWhereInput = {
  status: 'active',
  isFactoryProduct: true
}

@Injectable()
export class ProductVisibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async whereForCustomer(customerId: number): Promise<Prisma.ProductWhereInput> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, productVisibilityMode: true }
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
        customer: {
          select: { id: true, productVisibilityMode: true }
        }
      }
    })

    if (!actor) return { ...FACTORY_SCOPE }
    if (actor.userType !== 'customer_user') return {}
    if (!actor.customer) return { ...FACTORY_SCOPE }

    return this.scopeForCustomer(actor.customer)
  }

  private scopeForCustomer(
    customer: { id: number; productVisibilityMode: string }
  ): Prisma.ProductWhereInput {
    if (customer.productVisibilityMode === 'all') {
      return { status: 'active' }
    }
    if (customer.productVisibilityMode === 'custom') {
      return {
        status: 'active',
        visibleToCustomers: { some: { customerId: customer.id } }
      }
    }
    return { ...FACTORY_SCOPE }
  }

  async assertVisible(productId: number, userId?: number): Promise<void> {
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
  }
}
