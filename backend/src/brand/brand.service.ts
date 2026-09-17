import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { isValidBrandPrefix, normalizeBrandPrefix, toBrandPrefix } from '../product/product-code'
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto'

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

@Injectable()
export class BrandService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: number, status?: 'active' | 'disabled') {
    const [brands, productCounts] = await Promise.all([
      this.prisma.brand.findMany({
        where: { tenantId, ...(status ? { status } : {}) },
        include: { _count: { select: { products: true } } },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
      }),
      this.prisma.product.groupBy({
        by: ['brandId', 'status'],
        where: { tenantId },
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

  async create(tenantId: number, dto: CreateBrandDto) {
    const name = dto.name.trim()
    const code = dto.code === undefined ? toBrandPrefix(name) : normalizeBrandPrefix(dto.code)
    this.assertValues(name, code)

    try {
      return await this.prisma.brand.create({
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
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException({ message: '品牌编码前缀已存在', errorCode: 'BRD_1002' })
      }
      throw error
    }
  }

  async update(tenantId: number, id: number, dto: UpdateBrandDto) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.brand.findFirst({ where: { id, tenantId } })
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
            where: { brandId: id },
            select: { id: true, category: { select: { name: true } } }
          })
          await Promise.all(products
            .filter((product) => product.category)
            .map((product) => transaction.product.update({
              where: { id: product.id },
              data: { name: `${name}${product.category!.name}` }
            })))
        }

        return updated
      })
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException({ message: '品牌编码前缀已存在', errorCode: 'BRD_1002' })
      }
      throw error
    }
  }

  async delete(tenantId: number, id: number) {
    return this.prisma.$transaction(async (transaction) => {
      const brand = await transaction.brand.findFirst({ where: { id, tenantId } })
      if (!brand) {
        throw new NotFoundException({ message: '品牌不存在', errorCode: 'BRD_1001' })
      }

      const linkedProductCount = await transaction.product.count({ where: { brandId: id } })
      if (linkedProductCount === 0) {
        await transaction.brand.delete({ where: { id } })
        return { id, deletionMode: 'physical' as const, linkedProductCount }
      }

      await transaction.brand.update({ where: { id }, data: { status: 'disabled' } })
      return { id, deletionMode: 'disabled' as const, linkedProductCount }
    })
  }

  async restore(tenantId: number, id: number) {
    const brand = await this.prisma.brand.findFirst({ where: { id, tenantId } })
    if (!brand) {
      throw new NotFoundException({ message: '品牌不存在', errorCode: 'BRD_1001' })
    }
    return this.prisma.brand.update({ where: { id }, data: { status: 'active' } })
  }

  private assertValues(name: string, code: string) {
    if (!name) {
      throw new BadRequestException({ message: '品牌名称不能为空', errorCode: 'BRD_1003' })
    }
    if (!code || !isValidBrandPrefix(code)) {
      throw new BadRequestException({ message: '品牌编码前缀只能包含大写字母和数字', errorCode: 'BRD_1003' })
    }
  }
}
