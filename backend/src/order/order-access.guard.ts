import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PrismaService } from '../prisma.service'
import { PERMISSIONS_KEY } from '../auth/require-permissions.decorator'
import { StaffAccessService } from '../auth/staff-access.service'
import { Prisma } from '@prisma/client'

export interface OrderScope {
  tenantId: number
  customerId?: number
  brandIds?: number[]
  customerIds?: number[]
}

/** Keep row assignments separate from optional client filters so a filter cannot widen access. */
export function orderScopeWhere(scope: OrderScope): Prisma.OrderWhereInput {
  return {
    tenantId: scope.tenantId,
    ...(scope.brandIds ? { brandId: { in: scope.brandIds } } : {}),
    ...(scope.customerId ? { customerId: scope.customerId }
      : scope.customerIds ? { customerId: { in: scope.customerIds } } : {})
  }
}

export async function getOrderScope(prisma: PrismaService, userId: number, permission = 'order:read'): Promise<OrderScope> {
  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { tenantId: true, customerId: true, userType: true }
  })
  if (!actor) throw new ForbiddenException('账号不存在')
  if (actor.userType === 'customer_user') {
    if (!actor.customerId) throw new ForbiddenException('账号未绑定客户')
    return { tenantId: actor.tenantId, customerId: actor.customerId }
  }
  if (actor.userType !== 'super_admin') {
    const role = await prisma.userRole.findFirst({
      where: {
        userId, tenantId: actor.tenantId,
        role: { status: 'active', permissions: { some: { permission: { code: permission, status: 'active' } } } }
      }
    })
    if (!role) throw new ForbiddenException('当前账号没有执行此操作的权限')
    // The existing helper is also used by storage operations outside the HTTP guard.
    const access = new StaffAccessService(prisma)
    const staff = await access.actor(userId)
    access.require(staff, permission)
    return {
      tenantId: staff.tenantId, brandIds: staff.brandIds,
      ...(staff.customerIds === null ? {} : { customerIds: staff.customerIds })
    }
  }
  return { tenantId: actor.tenantId }
}

@Injectable()
export class OrderAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest()
    const permission = req.method === 'GET' ? 'order:read' : 'order:confirm'
    const scope = await getOrderScope(this.prisma, Number(req.user.sub), permission)
    const staffOnly = this.reflector.get<string[]>(PERMISSIONS_KEY, context.getHandler()) || []
    if ('customerId' in scope && staffOnly.length) throw new ForbiddenException('仅管理端可执行此操作')
    if (req.params.id) {
      const id = Number(req.params.id)
      if (!Number.isSafeInteger(id) || id <= 0) throw new NotFoundException('订单不存在')
      const order = await this.prisma.order.findFirst({ where: { ...orderScopeWhere(scope), id }, select: { id: true } })
      if (!order) throw new NotFoundException('订单不存在')
    }
    req.orderScope = scope
    return true
  }
}
