import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'

export interface StaffActor {
  id: number
  tenantId: number
  userType: string
  superAdmin: boolean
  permissions: Set<string>
  brandIds: number[]
  customerIds: number[] | null
  leadIds: number[] | null
  fingerprint: string
}

/** 从数据库重新读取身份与有效角色；工具参数不能提供可信权限上下文。 */
@Injectable()
export class StaffAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async actor(userId: number): Promise<StaffActor> {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new ForbiddenException('账号无效')
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenant: { select: { status: true } },
        brandAccess: { where: { brand: { status: 'active' } }, select: { brandId: true } },
        userRoles: {
          where: { role: { status: 'active' } },
          include: { role: { include: { permissions: { include: { permission: true } } } } }
        }
      }
    })
    if (!user || user.status !== 'active' || user.tenant.status !== 'active' || user.userType === 'customer_user') {
      throw new ForbiddenException('仅有效的运营人员账号可使用此功能')
    }
    const permissions = new Set<string>()
    for (const link of user.userRoles) {
      if (link.tenantId !== user.tenantId || link.role.tenantId !== user.tenantId) continue
      for (const grant of link.role.permissions) {
        if (grant.tenantId === user.tenantId && grant.permission.status === 'active') permissions.add(grant.permission.code)
      }
    }
    const restricted = user.userType === 'sales'
    const [customers, leads] = restricted ? await Promise.all([
      this.prisma.customer.findMany({ where: { tenantId: user.tenantId, salesOwnerId: user.id }, select: { id: true }, orderBy: { id: 'asc' } }),
      this.prisma.lead.findMany({ where: { tenantId: user.tenantId, assignedToId: user.id }, select: { id: true }, orderBy: { id: 'asc' } })
    ]) : [null, null]
    const scope = {
      id: user.id, tenantId: user.tenantId, userType: user.userType,
      superAdmin: user.userType === 'super_admin',
      brandIds: user.brandAccess.map(x => x.brandId).sort((a, b) => a - b),
      customerIds: customers?.map(x => x.id) ?? null,
      leadIds: leads?.map(x => x.id) ?? null
    }
    return { ...scope, permissions, fingerprint: createHash('sha256').update(JSON.stringify({ ...scope, permissions: [...permissions].sort() })).digest('hex') }
  }

  has(actor: StaffActor, permission: string) { return actor.superAdmin || actor.permissions.has(permission) }

  require(actor: StaffActor, ...permissions: string[]) {
    if (!permissions.length || permissions.some(code => !this.has(actor, code))) throw new ForbiddenException('当前账号没有执行此操作的权限')
  }

  productWhere(actor: StaffActor): Prisma.ProductWhereInput {
    return { tenantId: actor.tenantId, ...(actor.superAdmin ? {} : { brandId: { in: actor.brandIds } }) }
  }

  orderWhere(actor: StaffActor): Prisma.OrderWhereInput {
    return { tenantId: actor.tenantId, ...(actor.superAdmin ? {} : { brandId: { in: actor.brandIds } }), ...(actor.customerIds === null ? {} : { customerId: { in: actor.customerIds } }) }
  }

  customerWhere(actor: StaffActor): Prisma.CustomerWhereInput {
    return { tenantId: actor.tenantId, ...(actor.customerIds === null ? {} : { id: { in: actor.customerIds } }) }
  }

  leadWhere(actor: StaffActor): Prisma.LeadWhereInput {
    return { tenantId: actor.tenantId, ...(actor.leadIds === null ? {} : { id: { in: actor.leadIds } }) }
  }

  async product(actor: StaffActor, id: number) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new NotFoundException('商品不存在或不可访问')
    const product = await this.prisma.product.findFirst({ where: { AND: [this.productWhere(actor), { id }] } })
    if (!product) throw new NotFoundException('商品不存在或不可访问')
    return product
  }
}
