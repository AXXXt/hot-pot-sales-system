import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { StaffAccessService } from '../auth/staff-access.service'
import { PrismaService } from '../prisma.service'

/** 普通商品入口与AI共用范围约束，阻止SKU编辑绕过库存和价格权限。 */
@Injectable()
export class ProductMutationGuard implements CanActivate {
  constructor(private readonly access: StaffAccessService, private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest()
    const route = String(req.route?.path || '')
    if (route.includes('cart-validation')) return true
    const actor = await this.access.actor(Number(req.user?.sub))
    if (actor.tenantId !== Number(req.user?.tenantId)) throw new BadRequestException('登录租户与账号不一致')
    if (req.method === 'GET' || route.includes('categories')) return true
    const body = req.body ?? {}
    if (body.brandId !== undefined) {
      const brand = await this.prisma.brand.findFirst({ where: { id: Number(body.brandId), tenantId: actor.tenantId, status: 'active', ...(actor.superAdmin ? {} : { id: { in: actor.brandIds.filter(id => id === Number(body.brandId)) } }) }, select: { id: true } })
      if (!brand) throw new BadRequestException('品牌不可操作')
    }
    if (route.includes('/skus/:id') || route.startsWith('skus/:id')) {
      if (body.stockNum !== undefined) throw new BadRequestException('库存请通过库存管理创建出入库单调整')
      const sku = await this.prisma.productSku.findFirst({ where: { id: Number(req.params.id), tenantId: actor.tenantId, product: this.access.productWhere(actor) }, select: { id: true } })
      if (!sku) throw new BadRequestException('规格不可操作')
      if (body.basePrice !== undefined) this.access.require(actor, 'product:price:update')
    } else if (req.params.id) {
      await this.access.product(actor, Number(req.params.id))
      if (route.endsWith('/skus')) {
        if (body.stockNum !== undefined && body.stockNum !== 0) throw new BadRequestException('初始库存请通过出入库单录入')
        this.access.require(actor, 'product:price:update')
      }
    }
    if (Array.isArray(body.productIds)) {
      if (body.productIds.length > 100) throw new BadRequestException('一次最多操作100个商品')
      for (const id of body.productIds) await this.access.product(actor, Number(id))
    }
    return true
  }
}
