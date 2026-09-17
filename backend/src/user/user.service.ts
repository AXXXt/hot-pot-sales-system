import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { CreateUserDto, UpdateUserDto, CreateRoleDto, UpdateRoleDto, AssignPermissionsDto } from './dto/user.dto'
import { SmsService } from '../auth/sms.service'
import { AuditService } from '../audit/audit.service'

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly audit: AuditService
  ) {}

  async listUsers(page: number, pageSize: number) {
    const where: any = { tenantId: 1 }
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { userRoles: { include: { role: { select: { id: true, name: true, code: true } } } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.user.count({ where })
    ])
    const mapped = items.map((u: any) => ({
      ...u,
      roles: u.userRoles.map((ur: any) => ur.role)
    }))
    return { items: mapped, page, pageSize, total }
  }

  async createUser(dto: CreateUserDto) {
    // Verify SMS code
    const valid = await this.sms.verifyCode(dto.phone, dto.code)
    if (!valid) {
      throw new BadRequestException({ message: '验证码错误', errorCode: 'AUTH_3002' })
    }

    // Check existing
    const existing = await this.prisma.user.findUnique({ where: { phone: dto.phone } })
    if (existing) {
      throw new BadRequestException({ message: '该手机号已注册', errorCode: 'USR_1002' })
    }

    const user = await this.prisma.user.create({
      data: {
        tenantId: 1,
        phone: dto.phone,
        name: dto.name,
        userType: dto.userType as any,
        customerId: dto.customerId
      }
    })
    if (dto.roleIds?.length) {
      await this.prisma.userRole.createMany({
        data: dto.roleIds.map(rid => ({ tenantId: 1, userId: user.id, roleId: rid }))
      })
    }
    await this.audit.write({
      action: 'create',
      module: 'user',
      targetType: 'user',
      targetId: user.id,
      afterData: { phone: dto.phone, name: dto.name, userType: dto.userType, customerId: dto.customerId ?? null, roleIds: dto.roleIds ?? [] }
    })
    return this.getUser(user.id)
  }

  async getUser(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { userRoles: { include: { role: true } } }
    })
    if (!user) throw new NotFoundException({ message: '用户不存在', errorCode: 'USR_1001' })
    const roles = user.userRoles.map((ur: any) => ur.role)
    return { id: user.id, tenantId: user.tenantId, phone: user.phone, name: user.name, userType: user.userType, status: user.status, customerId: user.customerId, roles, createdAt: user.createdAt, updatedAt: user.updatedAt, lastLoginAt: user.lastLoginAt }
  }

  async updateUser(id: number, dto: UpdateUserDto) {
    const { roleIds, ...userData } = dto
    await this.prisma.user.update({ where: { id }, data: userData as any })
    if (roleIds !== undefined) {
      await this.prisma.userRole.deleteMany({ where: { userId: id } })
      if (roleIds.length) {
        await this.prisma.userRole.createMany({ data: roleIds.map(rid => ({ tenantId: 1, userId: id, roleId: rid })) })
      }
    }
    await this.audit.write({
      action: 'update',
      module: 'user',
      targetType: 'user',
      targetId: id,
      afterData: { ...userData, roleIds: roleIds ?? undefined }
    })
    return this.getUser(id)
  }

  async listRoles() {
    return this.prisma.role.findMany({
      where: { tenantId: 1 },
      include: { _count: { select: { userRoles: true } } },
      orderBy: { createdAt: 'asc' }
    })
  }

  async createRole(dto: CreateRoleDto) {
    const role = await this.prisma.role.create({ data: { tenantId: 1, name: dto.name, code: dto.code, description: dto.description } })
    await this.audit.write({
      action: 'create',
      module: 'user',
      targetType: 'role',
      targetId: role.id,
      afterData: { name: dto.name, code: dto.code, description: dto.description ?? null }
    })
    return role
  }

  async updateRole(id: number, dto: UpdateRoleDto) {
    const role = await this.prisma.role.update({ where: { id }, data: dto })
    await this.audit.write({
      action: 'role_change',
      module: 'user',
      targetType: 'role',
      targetId: id,
      afterData: { ...dto }
    })
    return role
  }

  async assignPermissions(roleId: number, dto: AssignPermissionsDto) {
    await this.prisma.rolePermission.deleteMany({ where: { roleId } })
    if (dto.permissionIds.length) {
      await this.prisma.rolePermission.createMany({
        data: dto.permissionIds.map(pid => ({ tenantId: 1, roleId, permissionId: pid }))
      })
    }
    await this.audit.write({
      action: 'permission_change',
      module: 'user',
      targetType: 'role',
      targetId: roleId,
      afterData: { permissionIds: dto.permissionIds }
    })
    return this.prisma.rolePermission.findMany({ where: { roleId }, include: { permission: true } })
  }

  async listPermissions() {
    return this.prisma.permission.findMany({
      where: { status: 'active' },
      orderBy: [{ parentId: 'asc' }, { code: 'asc' }]
    })
  }
}