import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PrismaService } from '../prisma.service'
import { PERMISSIONS_KEY } from './require-permissions.decorator'

/**
 * 接口级权限守卫：校验当前用户（经 JwtAuthGuard 验证）是否拥有接口声明的权限码。
 * - 未声明权限码的接口直接放行（保持与客户小程序共用接口的兼容）
 * - super_admin 拥有全部权限
 * - 权限来源：User -> UserRole -> Role -> RolePermission -> Permission.code
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handlerRequired = this.reflector.get<string[]>(PERMISSIONS_KEY, context.getHandler()) || []
    const classRequired = this.reflector.get<string[]>(PERMISSIONS_KEY, context.getClass()) || []
    const required = [...new Set([...handlerRequired, ...classRequired])]
    if (required.length === 0) return true

    const request = context.switchToHttp().getRequest()
    const user = request.user
    if (!user) {
      throw new ForbiddenException({ message: '未登录', errorCode: 'AUTH_3005' })
    }

    const userId = Number(user.sub)
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { userType: true }
    })
    if (!actor) {
      throw new ForbiddenException({ message: '账号不存在或已禁用', errorCode: 'AUTH_3005' })
    }
    if (actor.userType === 'super_admin') return true

    const tenantId = Number(user.tenantId || 1)
    const roles = await this.prisma.userRole.findMany({
      where: { userId, tenantId },
      include: {
        role: {
          include: {
            permissions: {
              where: { permission: { status: 'active' } },
              include: { permission: { select: { code: true } } }
            }
          }
        }
      }
    })

    const granted = new Set<string>()
    roles.forEach((ur) => ur.role.permissions.forEach((rp) => granted.add(rp.permission.code)))

    const missing = required.filter((code) => !granted.has(code))
    if (missing.length > 0) {
      throw new ForbiddenException({
        message: '当前账号没有执行此操作的权限',
        errorCode: 'AUTH_3006'
      })
    }
    return true
  }
}