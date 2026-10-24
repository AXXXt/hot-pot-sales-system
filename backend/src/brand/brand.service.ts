import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { isValidBrandPrefix, normalizeBrandPrefix, toBrandPrefix } from '../product/product-code'
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto'
import { StaffActor } from '../auth/staff-access.service'
import { writeCatalogAudit } from '../audit/catalog-audit'

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

@Injectable()
export class BrandService {
  constructor(private readonly prisma: PrismaService) {}

  // 保留停用品牌的授权关系，授权员工才可以恢复自己管理的品牌。
  private scope(tenantId: number, actor?: StaffActor): Prisma.BrandWhereInput {
    if (actor && actor.tenantId !== tenantId) throw new ForbiddenException('品牌租户不可访问')
    return { tenantId, ...(actor && !actor.superAdmin ? { userAccess: { some: { tenantId, userId: actor.id } } } : {}) }
  }

  async list(tenantId: number, status?: 'active' | 'disabled', actor?: StaffActor) {
    const scope = this.scope(tenantId, actor)
    const [brands, productCounts] = await Promise.all([
      this.prisma.brand.findMany({
        where: { ...scope, ...(status ? { status } : {}) },
        include: { _count: { select: { products: true } } },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
      }),
      this.prisma.product.groupBy({
        by: ['brandId', 'status'],
        where: { tenantId, ...(actor && !actor.superAdmin ? { brand: scope } : {}) },
        _count: { _all: true }
      })
    ])

    const countByBrand = new Map<number, { current: number; archived: number }>()
    for (const productCount of productCounts) {
      const counts = countByBrand.get(productCount.brandId) || { current: 0, archived: 0 }
      const value = productCount._count._all
      if (productCount.status === 'archived') counts.archived += value
      else counts.current += value
      countByBrand.set(productCount.brandId, counts)
    }

    return brands.map((brand) => {
      const counts = countByBrand.get(brand.id) || { current: 0, archived: 0 }
      return {
        ...brand,
        currentProductCount: counts.current,
        archivedProductCount: counts.archived,
        historicalProductCount: brand._count.products
      }
    })
  }

  suggestCode(name: string) {
    const code = toBrandPrefix(name)
    if (!code) {
      throw new BadRequestException({ message: '无法根据品牌名称生成编码前缀', errorCode: 'BRD_1003' })
    }
    return { code }
  }

  async create(tenantId: number, dto: CreateBrandDto, actor?: StaffActor) {
    this.scope(tenantId, actor)
    if (actor && !actor.superAdmin) throw new ForbiddenException('新建品牌请联系租户管理员分配品牌范围')
    if (dto.code !== undefined && typeof dto.code !== 'string') throw new BadRequestException('品牌编码不能为空')
    const name = dto.name.trim()
    const code = dto.code === undefined ? toBrandPrefix(name) : normalizeBrandPrefix(dto.code)
    this.assertValues(name, code)

    try {
      return await this.prisma.$transaction(async tx => {
        const created = await tx.brand.create({
        data: {
          tenantId,
          name,
          code,
          sortOrder: dto.sortOrder ?? 0,
          logoUrl: dto.logoUrl,
          description: dto.description,
          status: 'active'
        }
        })
        await writeCatalogAudit(tx, { kind: 'brand', tenantId, operatorId: actor?.id, action: 'create', id: created.id, after: created })
        return created
      })
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException({ message: '品牌编码前缀已存在', errorCode: 'BRD_1002' })
      }
      throw error
    }
  }

  async update(tenantId: number, id: number, dto: UpdateBrandDto, actor?: StaffActor) {
    if (dto.name !== undefined && typeof dto.name !== 'string') throw new BadRequestException('品牌名称不能为空')
    if (dto.code !== undefined && typeof dto.code !== 'string') throw new BadRequestException('品牌编码不能为空')
    if (dto.sortOrder !== undefined && (!Number.isInteger(dto.sortOrder) || dto.sortOrder === null || dto.sortOrder < 0)) throw new BadRequestException('品牌排序须为非负整数')
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM brands WHERE tenant_id = ${tenantId} AND id = ${id} FOR UPDATE`)
        const current = await transaction.brand.findFirst({ where: { ...this.scope(tenantId, actor), id } })
        if (!current) {
          throw new NotFoundException({ message: '品牌不存在', errorCode: 'BRD_1001' })
        }

        const name = dto.name === undefined ? current.name : dto.name.trim()
        const code = dto.code === undefined ? current.code : normalizeBrandPrefix(dto.code)
        this.assertValues(name, code)

        const updated = await transaction.brand.update({
          where: { id },
          data: {
            name,
            code,
            sortOrder: dto.sortOrder,
            logoUrl: dto.logoUrl,
            description: dto.description
          }
        })

        if (name !== current.name) {
          const products = await transaction.product.findMany({
            where: { tenantId, brandId: id },
            select: { id: true, category: { select: { name: true } } }
          })
          await Promise.all(products
            .filter((product) => product.category)
            .map((product) => transaction.product.update({
              where: { id: product.id },
              data: { name: `${name}${product.category!.name}` }
            })))
        }

        await writeCatalogAudit(transaction, { kind: 'brand', tenantId, operatorId: actor?.id, action: 'update', id, before: current, after: updated })
        return updated
      })
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException({ message: '品牌编码前缀已存在', errorCode: 'BRD_1002' })
      }
      throw error
    }
  }

  async delete(tenantId: number, id: number, actor?: StaffActor) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM brands WHERE tenant_id = ${tenantId} AND id = ${id} FOR UPDATE`)
      const brand = await transaction.brand.findFirst({ where: { ...this.scope(tenantId, actor), id } })
      if (!brand) {
        throw new NotFoundException({ message: '品牌不存在', errorCode: 'BRD_1001' })
      }

      const linkedProductCount = await transaction.product.count({ where: { tenantId, brandId: id } })
      if (linkedProductCount === 0) {
        await transaction.brand.delete({ where: { id } })
        await writeCatalogAudit(transaction, { kind: 'brand', tenantId, operatorId: actor?.id, action: 'delete', id, before: brand })
        return { id, deletionMode: 'physical' as const, linkedProductCount }
      }

      const updated = await transaction.brand.update({ where: { id }, data: { status: 'disabled' } })
      await writeCatalogAudit(transaction, { kind: 'brand', tenantId, operatorId: actor?.id, action: 'update', id, before: brand, after: updated })
      return { id, deletionMode: 'disabled' as const, linkedProductCount }
    })
  }

  async restore(tenantId: number, id: number, actor?: StaffActor) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM brands WHERE tenant_id = ${tenantId} AND id = ${id} FOR UPDATE`)
      const brand = await tx.brand.findFirst({ where: { ...this.scope(tenantId, actor), id } })
      if (!brand) throw new NotFoundException({ message: '品牌不存在', errorCode: 'BRD_1001' })
      const updated = await tx.brand.update({ where: { id }, data: { status: 'active' } })
      await writeCatalogAudit(tx, { kind: 'brand', tenantId, operatorId: actor?.id, action: 'update', id, before: brand, after: updated })
      return updated
    })
  }

  private assertValues(name: string, code: string) {
    if (!name || name.length > 100) {
      throw new BadRequestException({ message: '品牌名称不能为空', errorCode: 'BRD_1003' })
    }
    if (!code || code.length > 64 || !isValidBrandPrefix(code)) {
      throw new BadRequestException({ message: '品牌编码前缀只能包含大写字母和数字', errorCode: 'BRD_1003' })
    }
  }
}
