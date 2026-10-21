import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma.service'
import { StaffAccessService, StaffActor } from '../auth/staff-access.service'
import { AI_PERMISSIONS } from './ai.types'

@Injectable()
export class AiAuthorizationService {
  constructor(private readonly prisma: PrismaService, private readonly access: StaffAccessService) {}
  private authorize(actor: StaffActor) { this.access.require(actor, 'ai:configure', 'role:manage') }
  async list(actor: StaffActor) {
    this.authorize(actor)
    const [roles, users, brands] = await Promise.all([
      this.prisma.role.findMany({ where: { tenantId: actor.tenantId, status: 'active' }, include: { permissions: { include: { permission: { select: { code: true } } } } } }),
      this.prisma.user.findMany({ where: { tenantId: actor.tenantId, userType: { not: 'customer_user' }, status: 'active' }, select: { id: true, name: true, brandAccess: { select: { brandId: true } } }, take: 200 }),
      this.prisma.brand.findMany({ where: { tenantId: actor.tenantId, status: 'active', ...(actor.superAdmin ? {} : { id: { in: actor.brandIds } }) }, select: { id: true, name: true } })
    ])
    const manageable = AI_PERMISSIONS.filter(x => this.access.has(actor, x[0]))
    return { roles: roles.map(x => ({ id: x.id, name: x.name, codes: x.permissions.map(p => p.permission.code).filter(code => AI_PERMISSIONS.some(x => x[0] === code)) })),
      users: users.map(x => ({ id: x.id, name: x.name, brandIds: x.brandAccess.map(b => b.brandId).filter(id => actor.superAdmin || actor.brandIds.includes(id)) })), brands,
      permissions: manageable.map(([code, name]) => ({ code, name })) }
  }

  async role(actor: StaffActor, id: number, codes: string[]) {
    this.authorize(actor)
    const manageable = AI_PERMISSIONS.filter(x => this.access.has(actor, x[0])).map(x => x[0])
    if (codes.some(code => !manageable.includes(code as any))) throw new BadRequestException('不能分配未获授权的能力')
    return this.prisma.$transaction(async tx => {
      if (!await tx.role.findFirst({ where: { id, tenantId: actor.tenantId, status: 'active' } })) throw new NotFoundException('角色不可管理')
      const permissions = await tx.permission.findMany({ where: { code: { in: [...new Set(codes)] }, status: 'active' }, select: { id: true } })
      if (permissions.length !== new Set(codes).size) throw new BadRequestException('权限尚未注册，请先应用数据库迁移')
      await tx.rolePermission.deleteMany({ where: { tenantId: actor.tenantId, roleId: id, permission: { code: { in: manageable } } } })
      if (permissions.length) await tx.rolePermission.createMany({ data: permissions.map(p => ({ tenantId: actor.tenantId, roleId: id, permissionId: p.id })), skipDuplicates: true })
      await tx.auditLog.create({ data: { tenantId: actor.tenantId, operatorId: actor.id, action: 'permission_change', module: 'ai', targetType: 'role', targetId: String(id), requestId: `ai-grant-${randomUUID()}`, afterData: { codes } } })
      return { updated: true }
    })
  }

  async brands(actor: StaffActor, userId: number, brandIds: number[]) {
    this.authorize(actor)
    return this.prisma.$transaction(async tx => {
      if (!await tx.user.findFirst({ where: { id: userId, tenantId: actor.tenantId, userType: { not: 'customer_user' } } })) throw new NotFoundException('人员不可管理')
      const allowed = await tx.brand.findMany({ where: { tenantId: actor.tenantId, status: 'active', ...(actor.superAdmin ? {} : { id: { in: actor.brandIds } }) }, select: { id: true } })
      const allowedIds = allowed.map(x => x.id)
      if (brandIds.some(id => !allowedIds.includes(id))) throw new BadRequestException('品牌不在当前可授权范围')
      await tx.userBrandAccess.deleteMany({ where: { tenantId: actor.tenantId, userId, brandId: { in: allowedIds } } })
      if (brandIds.length) await tx.userBrandAccess.createMany({ data: [...new Set(brandIds)].map(brandId => ({ tenantId: actor.tenantId, userId, brandId })) })
      await tx.auditLog.create({ data: { tenantId: actor.tenantId, operatorId: actor.id, action: 'permission_change', module: 'ai', targetType: 'user_brand_access', targetId: String(userId), requestId: `ai-scope-${randomUUID()}`, afterData: { brandIds } } })
      return { updated: true }
    })
  }
}
