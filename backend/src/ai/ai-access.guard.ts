import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PERMISSIONS_KEY } from '../auth/require-permissions.decorator'
import { StaffAccessService } from '../auth/staff-access.service'

@Injectable()
export class AiAccessGuard implements CanActivate {
  constructor(private readonly access: StaffAccessService, private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext) {
    const required = this.reflector.get<string[]>(PERMISSIONS_KEY, context.getHandler()) ?? []
    if (!required.length) throw new ForbiddenException('此助手接口未声明授权策略')
    const request = context.switchToHttp().getRequest()
    const actor = await this.access.actor(Number(request.user?.sub))
    if (actor.tenantId !== Number(request.user?.tenantId)) throw new ForbiddenException('登录租户与当前账号不一致')
    this.access.require(actor, ...required)
    request.actor = actor
    return true
  }
}
