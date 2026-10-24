import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { CreateUserDto, UpdateUserDto, CreateRoleDto, UpdateRoleDto, AssignPermissionsDto } from './dto/user.dto'
import { SmsService } from '../auth/sms.service'
import { AuditService } from '../audit/audit.service'
import { StaffActor } from '../auth/staff-access.service'

// 后台响应只包含管理所需字段，不序列化微信身份或密码凭据。
const userSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true, tenantId: true, phone: true, name: true, userType: true, status: true,
  customerId: true, createdAt: true, updatedAt: true, lastLoginAt: true,
  userRoles: { select: { role: { select: { id: true, name: true, code: true } } } }
})
const selectedUser = (actor: StaffActor) => ({ ...userSelect, userRoles: {
  where: { tenantId: actor.tenantId, role: { tenantId: actor.tenantId } }, select: userSelect.userRoles.select
} })

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService, private readonly sms: SmsService, private readonly audit: AuditService) {}

  private present(user: any) {
    const { userRoles, brandAccess, ...fields } = user
    return { ...fields, roles: userRoles.map((link: any) => link.role), ...(brandAccess ? { brandIds: brandAccess.map((link: any) => link.brandId) } : {}) }
  }

  private async relations(db: Prisma.TransactionClient, actor: StaffActor, roleIds?: number[], customerId?: number) {
    const ids = roleIds === undefined ? undefined : [...new Set(roleIds)]
    if (ids && await db.role.count({ where: { id: { in: ids }, tenantId: actor.tenantId, status: 'active' } }) !== ids.length) throw new BadRequestException('角色不存在、已停用或不属于当前租户')
    if (customerId != null && !await db.customer.findFirst({ where: { id: customerId, tenantId: actor.tenantId } })) throw new BadRequestException('关联客户不存在或不属于当前租户')
    return ids
  }

  /** Serialize recovery-critical changes and reject a caller whose rights changed while waiting. */
  private async recoveryActor(db: Prisma.TransactionClient, actor: StaffActor) {
    await db.$queryRaw(Prisma.sql`SELECT id FROM tenants WHERE id = ${actor.tenantId} FOR UPDATE`)
    const current = await db.user.findFirst({ where: { id: actor.id, tenantId: actor.tenantId }, select: { id: true, userType: true, status: true } })
    if (!current || current.status !== 'active' || current.userType === 'customer_user') throw new ForbiddenException('操作账号状态已变化，请重新登录')
    if (current.userType !== 'super_admin' && !await db.userRole.count({ where: {
      userId: current.id, tenantId: actor.tenantId,
      role: { tenantId: actor.tenantId, status: 'active', permissions: { some: { tenantId: actor.tenantId, permission: { code: 'role:manage', status: 'active' } } } }
    } })) throw new ForbiddenException('用户与角色管理权限已变化，请重新登录')
    return current
  }

  private async protectRecovery(db: Prisma.TransactionClient, target: { id: number; tenantId: number; userType: string; status: string; customerId: number | null }, dto: UpdateUserDto, actor: StaffActor, superAdmin: boolean, ids?: number[]) {
    if (!superAdmin && (target.userType === 'super_admin' || dto.userType === 'super_admin')) throw new ForbiddenException('仅超级管理员可管理超级管理员账号')
    const changesCustomer = dto.customerId != null && dto.customerId !== target.customerId
    if (target.id === actor.id && (dto.status === 'disabled' || (dto.userType !== undefined && dto.userType !== target.userType) || changesCustomer)) throw new ForbiddenException('不能停用本人、修改本人账号类型或为本人新增客户关联，请由其他管理员操作')
    const futureCustomerId = dto.customerId === undefined ? target.customerId : dto.customerId
    if ((dto.userType ?? target.userType) === 'super_admin' && futureCustomerId != null
      && (changesCustomer || target.userType !== 'super_admin')) throw new ForbiddenException('超级管理员不可新增客户关联，关联客户的员工须先解除关联再提升')
    if (target.userType === 'super_admin' && target.status === 'active'
      && (dto.status === 'disabled' || (dto.userType !== undefined && dto.userType !== 'super_admin') || changesCustomer)) {
      const remaining = await db.user.count({ where: { tenantId: actor.tenantId, id: { not: target.id }, userType: 'super_admin', status: 'active', customerId: null } })
      if (!remaining) throw new ForbiddenException('须保留至少一个有效且未关联客户的超级管理员')
    }
    if (target.id === actor.id && !superAdmin && ids !== undefined) {
      const retained = ids.length && await db.role.count({ where: {
        id: { in: ids }, tenantId: actor.tenantId, status: 'active',
        permissions: { some: { tenantId: actor.tenantId, permission: { code: 'role:manage', status: 'active' } } }
      } })
      if (!retained) throw new ForbiddenException('不能撤销本人最后的用户与角色管理权限，请由其他管理员操作')
    }
  }

  async listUsers(page: number, pageSize: number, actor: StaffActor) {
    if (page < 1 || pageSize < 1 || pageSize > 500) throw new BadRequestException('分页参数无效')
    const where = { tenantId: actor.tenantId }
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, select: selectedUser(actor), orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }), this.prisma.user.count({ where })
    ])
    return { items: items.map(user => this.present(user)), page, pageSize, total }
  }

  async createUser(dto: CreateUserDto, actor: StaffActor) {
    if (dto.userType === 'super_admin' && !actor.superAdmin) throw new ForbiddenException('仅超级管理员可新增超级管理员')
    if (dto.userType === 'super_admin' && dto.customerId != null) throw new BadRequestException('超级管理员不可关联客户')
    // 先校验关系以免配置错误消耗验证码，写入时在事务内再次核验。
    await this.relations(this.prisma, actor, dto.roleIds, dto.customerId)
    if (await this.prisma.user.findUnique({ where: { phone: dto.phone } })) throw new ConflictException({ message: '该手机号已注册', errorCode: 'USR_1002' })
    if (!await this.sms.verifyCode(dto.phone, dto.code)) throw new BadRequestException({ message: '验证码错误', errorCode: 'AUTH_3002' })
    let user
    try {
      user = await this.prisma.$transaction(async db => {
        const operator = await this.recoveryActor(db, actor)
        if (dto.userType === 'super_admin' && operator.userType !== 'super_admin') throw new ForbiddenException('仅超级管理员可新增超级管理员')
        const ids = await this.relations(db, actor, dto.roleIds, dto.customerId)
        const created = await db.user.create({ data: { tenantId: actor.tenantId, phone: dto.phone, name: dto.name, userType: dto.userType as any, customerId: dto.customerId } })
        if (ids?.length) await db.userRole.createMany({ data: ids.map(roleId => ({ tenantId: actor.tenantId, userId: created.id, roleId })) })
        return created
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('该手机号已注册')
      throw error
    }
    await this.audit.write({ tenantId: actor.tenantId, operatorId: actor.id, action: 'create', module: 'user', targetType: 'user', targetId: user.id,
      afterData: { phone: dto.phone, name: dto.name, userType: dto.userType, customerId: dto.customerId ?? null, roleIds: [...new Set(dto.roleIds || [])] } })
    return this.getUser(user.id, actor)
  }

  async getUser(id: number, actor: StaffActor) {
    // Brand grants are managed by the existing AI authorization API. Expose only its
    // manageable scope, and only to callers meeting the same two permissions.
    const brandsAllowed = actor.superAdmin || (actor.permissions.has('role:manage') && actor.permissions.has('ai:configure'))
    const user = await this.prisma.user.findFirst({ where: { id, tenantId: actor.tenantId }, select: {
      ...selectedUser(actor),
      ...(brandsAllowed ? { brandAccess: { where: { tenantId: actor.tenantId, brand: { tenantId: actor.tenantId, status: 'active' as const,
        ...(actor.superAdmin ? {} : { id: { in: actor.brandIds } }) } }, select: { brandId: true } } } : {})
    } })
    if (!user) throw new NotFoundException({ message: '用户不存在', errorCode: 'USR_1001' })
    return this.present(user)
  }

  async updateUser(id: number, dto: UpdateUserDto, actor: StaffActor) {
    const { roleIds, ...userData } = dto
    await this.prisma.$transaction(async db => {
      const operator = await this.recoveryActor(db, actor)
      const target = await db.user.findFirst({ where: { id, tenantId: actor.tenantId }, select: { id: true, tenantId: true, userType: true, status: true, customerId: true } })
      if (!target) throw new NotFoundException('用户不存在')
      const ids = await this.relations(db, actor, roleIds, dto.customerId)
      await this.protectRecovery(db, target, dto, actor, operator.userType === 'super_admin', ids)
      await db.user.update({ where: { id, tenantId: actor.tenantId }, data: userData as any })
      if (ids !== undefined) {
        await db.userRole.deleteMany({ where: { userId: id, tenantId: actor.tenantId } })
        if (ids.length) await db.userRole.createMany({ data: ids.map(roleId => ({ tenantId: actor.tenantId, userId: id, roleId })) })
      }
    })
    await this.audit.write({ tenantId: actor.tenantId, operatorId: actor.id, action: 'update', module: 'user', targetType: 'user', targetId: id, afterData: { ...userData, roleIds } })
    return this.getUser(id, actor)
  }

  async listRoles(actor: StaffActor) {
    return this.prisma.role.findMany({ where: { tenantId: actor.tenantId }, include: {
      permissions: { where: { tenantId: actor.tenantId }, select: { permissionId: true, permission: { select: { id: true, code: true, name: true, status: true } } } },
      _count: { select: { userRoles: { where: { tenantId: actor.tenantId, user: { tenantId: actor.tenantId } } } } }
    }, orderBy: { createdAt: 'asc' } })
  }

  async createRole(dto: CreateRoleDto, actor: StaffActor) {
    let role
    try { role = await this.prisma.role.create({ data: { tenantId: actor.tenantId, name: dto.name, code: dto.code, description: dto.description } }) }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('角色编码已存在')
      throw error
    }
    await this.audit.write({ tenantId: actor.tenantId, operatorId: actor.id, action: 'create', module: 'user', targetType: 'role', targetId: role.id, afterData: dto })
    return role
  }

  async updateRole(id: number, dto: UpdateRoleDto, actor: StaffActor) {
    if (!await this.prisma.role.findFirst({ where: { id, tenantId: actor.tenantId } })) throw new NotFoundException('角色不存在')
    const role = await this.prisma.role.update({ where: { id, tenantId: actor.tenantId }, data: dto })
    await this.audit.write({ tenantId: actor.tenantId, operatorId: actor.id, action: 'role_change', module: 'user', targetType: 'role', targetId: id, afterData: dto })
    return role
  }

  async assignPermissions(roleId: number, dto: AssignPermissionsDto, actor: StaffActor) {
    const ids = [...new Set(dto.permissionIds)]
    const result = await this.prisma.$transaction(async db => {
      const operator = await this.recoveryActor(db, actor)
      if (!await db.role.findFirst({ where: { id: roleId, tenantId: actor.tenantId } })) throw new NotFoundException('角色不存在')
      if (await db.permission.count({ where: { id: { in: ids }, status: 'active' } }) !== ids.length) throw new BadRequestException('权限不存在或已停用')
      if (operator.userType !== 'super_admin') {
        const links = await db.userRole.findMany({
          where: { userId: actor.id, tenantId: actor.tenantId, role: { tenantId: actor.tenantId, status: 'active' } },
          include: { role: { include: { permissions: { where: { tenantId: actor.tenantId, permission: { status: 'active', code: 'role:manage' } } } } } }
        })
        const replacement = ids.length ? await db.permission.count({ where: { id: { in: ids }, code: 'role:manage', status: 'active' } }) : 0
        if (!links.some(link => link.roleId === roleId ? replacement > 0 : link.role.permissions.length > 0)) throw new ForbiddenException('不能撤销本人最后的用户与角色管理权限，请由其他管理员操作')
      }
      await db.rolePermission.deleteMany({ where: { roleId, tenantId: actor.tenantId } })
      if (ids.length) await db.rolePermission.createMany({ data: ids.map(permissionId => ({ tenantId: actor.tenantId, roleId, permissionId })) })
      return db.rolePermission.findMany({ where: { roleId, tenantId: actor.tenantId }, include: { permission: true } })
    })
    await this.audit.write({ tenantId: actor.tenantId, operatorId: actor.id, action: 'permission_change', module: 'user', targetType: 'role', targetId: roleId, afterData: { permissionIds: ids } })
    return result
  }

  async listPermissions() {
    return this.prisma.permission.findMany({ where: { status: 'active' }, orderBy: [{ parentId: 'asc' }, { code: 'asc' }] })
  }
}
