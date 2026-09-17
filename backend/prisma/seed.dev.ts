import {
  AuditAction,
  BrandStatus,
  CustomerStatus,
  PermissionType,
  PriceType,
  PrismaClient,
  ProductStatus,
  SkuStatus,
  UserStatus,
  UserType
} from '@prisma/client'

const prisma = new PrismaClient()

const permissions = [
  { code: 'dashboard:view', name: '查看工作台', type: PermissionType.menu },
  { code: 'brand:manage', name: '管理品牌', type: PermissionType.action },
  { code: 'product:read', name: '查看商品', type: PermissionType.page },
  { code: 'product:create', name: '创建商品', type: PermissionType.action },
  { code: 'product:update', name: '编辑商品', type: PermissionType.action },
  { code: 'inventory:read', name: '查看库存', type: PermissionType.page },
  { code: 'inventory:adjust', name: '调整库存', type: PermissionType.action },
  { code: 'customer:manage', name: '管理客户', type: PermissionType.action },
  { code: 'order:read', name: '查看订单', type: PermissionType.page },
  { code: 'order:confirm', name: '确认订单', type: PermissionType.action },
  { code: 'audit:read', name: '查看审计日志', type: PermissionType.page },
  { code: 'role:manage', name: '管理角色权限', type: PermissionType.action }
]

const roles = [
  { code: 'super_admin', name: '超级管理员', type: UserType.super_admin },
  { code: 'admin', name: '管理员', type: UserType.admin },
  { code: 'sales', name: '销售', type: UserType.sales },
  { code: 'warehouse', name: '仓库', type: UserType.warehouse },
  { code: 'customer_service', name: '客服', type: UserType.customer_service },
  { code: 'finance', name: '财务', type: UserType.finance }
]

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { code: 'demo' },
    update: { name: '演示租户', status: 'active' },
    create: { name: '演示租户', code: 'demo', status: 'active' }
  })

  const existingBrand = await prisma.brand.findFirst({
    where: { tenantId: tenant.id, code: { in: ['YANSHI', 'DEMOBRAND', 'demo-brand'] } }
  })
  const brand = existingBrand
    ? await prisma.brand.update({
        where: { id: existingBrand.id },
        data: { name: '演示品牌', code: 'YANSHI', status: BrandStatus.active }
      })
    : await prisma.brand.create({
        data: { tenantId: tenant.id, name: '演示品牌', code: 'YANSHI', status: BrandStatus.active }
      })

  const unit = await prisma.unit.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'bag' } },
    update: { name: '袋', status: 'active' },
    create: { tenantId: tenant.id, name: '袋', code: 'bag', status: 'active' }
  })

  const permissionRows = await Promise.all(
    permissions.map((permission) =>
      prisma.permission.upsert({
        where: { code: permission.code },
        update: { name: permission.name, type: permission.type, status: 'active' },
        create: { ...permission, status: 'active' }
      })
    )
  )

  const roleRows = await Promise.all(
    roles.map((role) =>
      prisma.role.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: role.code } },
        update: { name: role.name, status: 'active' },
        create: { tenantId: tenant.id, code: role.code, name: role.name, status: 'active' }
      })
    )
  )

  const superAdminRole = roleRows.find((role) => role.code === 'super_admin')!
  for (const permission of permissionRows) {
    await prisma.rolePermission.upsert({
      where: {
        tenantId_roleId_permissionId: {
          tenantId: tenant.id,
          roleId: superAdminRole.id,
          permissionId: permission.id
        }
      },
      update: {},
      create: { tenantId: tenant.id, roleId: superAdminRole.id, permissionId: permission.id }
    })
  }

  const customerLevel = await prisma.customerLevel.upsert({
    where: { tenantId_brandId_code: { tenantId: tenant.id, brandId: brand.id, code: 'normal' } },
    update: { name: '普通客户', status: 'active' },
    create: {
      tenantId: tenant.id,
      brandId: brand.id,
      code: 'normal',
      name: '普通客户',
      discountRate: '1.0000',
      status: 'active'
    }
  })

  const existingCustomer = await prisma.customer.findFirst({
    where: { tenantId: tenant.id, customerName: '演示客户' }
  })
  const customer = existingCustomer
    ? await prisma.customer.update({
        where: { id: existingCustomer.id },
        data: { customerLevelId: customerLevel.id, productVisibilityMode: 'factory', status: CustomerStatus.active }
      })
    : await prisma.customer.create({
        data: {
          tenantId: tenant.id,
          customerLevelId: customerLevel.id,
          productVisibilityMode: 'factory',
          customerName: '演示客户',
          customerType: 'store',
          contactName: '演示联系人',
          contactPhone: '13900000000',
          status: CustomerStatus.active
        }
      })

  const user = await prisma.user.upsert({
    where: { phone: '13800000000' },
    update: {
      tenantId: tenant.id,
      customerId: customer.id,
      name: '演示账号',
      userType: UserType.super_admin,
      status: UserStatus.active
    },
    create: {
      tenantId: tenant.id,
      customerId: customer.id,
      phone: '13800000000',
      name: '演示账号',
      userType: UserType.super_admin,
      status: UserStatus.active
    }
  })

  await prisma.userRole.upsert({
    where: {
      tenantId_userId_roleId: {
        tenantId: tenant.id,
        userId: user.id,
        roleId: superAdminRole.id
      }
    },
    update: {},
    create: { tenantId: tenant.id, userId: user.id, roleId: superAdminRole.id }
  })

  await prisma.userBrandAccess.upsert({
    where: {
      tenantId_userId_brandId: {
        tenantId: tenant.id,
        userId: user.id,
        brandId: brand.id
      }
    },
    update: {},
    create: { tenantId: tenant.id, userId: user.id, brandId: brand.id }
  })

  const categories = []
  for (let index = 1; index <= 12; index += 1) {
    categories.push(
      await prisma.productCategory.upsert({
        where: {
          tenantId_code: {
            tenantId: tenant.id,
            code: `category-${index}`
          }
        },
        update: { name: `食材分类 ${index}`, sortOrder: index, status: 'active' },
        create: {
          tenantId: tenant.id,
          code: `category-${index}`,
          name: `食材分类 ${index}`,
          sortOrder: index,
          status: 'active'
        }
      })
    )
  }

  for (let index = 1; index <= 20; index += 1) {
    const category = categories[(index - 1) % categories.length]
    const product = await prisma.product.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: `product-${index}` } },
      update: {
        name: `演示火锅食材 ${index}`,
        categoryId: category.id,
        unitId: unit.id,
        status: ProductStatus.active,
        isRecommended: index <= 5,
        isFactoryProduct: index <= 5,
        isNew: index <= 5,
        isHot: index >= 4 && index <= 8
      },
      create: {
        tenantId: tenant.id,
        brandId: brand.id,
        categoryId: category.id,
        unitId: unit.id,
        code: `product-${index}`,
        name: `演示火锅食材 ${index}`,
        subtitle: '工厂直供，适合门店快速复购',
        baseSpec: '500g / 袋',
        deliveryText: '次日配送',
        images: [],
        status: ProductStatus.active,
        isRecommended: index <= 5,
        isFactoryProduct: index <= 5,
        isNew: index <= 5,
        isHot: index >= 4 && index <= 8
      }
    })

    const sku = await prisma.productSku.upsert({
      where: { tenantId_skuCode: { tenantId: tenant.id, skuCode: `SKU-DEMO-${String(index).padStart(3, '0')}` } },
      update: { productId: product.id, status: SkuStatus.active, minOrderQty: 1 },
      create: {
        tenantId: tenant.id,
        productId: product.id,
        skuCode: `SKU-DEMO-${String(index).padStart(3, '0')}`,
        name: `标准规格 ${index}`,
        specText: '500g / 袋',
        saleUnit: '袋',
        basePrice: `${(68 + index).toFixed(2)}`,
        minOrderQty: 1,
        status: SkuStatus.active
      }
    })

    await prisma.customerPriceRule.upsert({
      where: {
        tenantId_customerId_skuId: {
          tenantId: tenant.id,
          customerId: customer.id,
          skuId: sku.id
        }
      },
      update: {
        brandId: brand.id,
        productId: product.id,
        priceType: PriceType.agreement,
        price: `${(64 + index).toFixed(2)}`,
        status: 'active',
        startAt: null,
        endAt: null
      },
      create: {
        tenantId: tenant.id,
        brandId: brand.id,
        customerId: customer.id,
        productId: product.id,
        skuId: sku.id,
        priceType: PriceType.agreement,
        price: `${(64 + index).toFixed(2)}`,
        status: 'active'
      }
    })
  }

  const audit = await prisma.auditLog.findUnique({ where: { requestId: 'seed-request' } })
  if (!audit) {
    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        operatorId: user.id,
        action: AuditAction.login,
        module: 'seed',
        targetType: 'user',
        targetId: String(user.id),
        requestId: 'seed-request',
        ipAddress: '127.0.0.1',
        userAgent: 'seed',
        afterData: { phone: user.phone }
      }
    })
  }

  console.log(JSON.stringify({ tenantId: tenant.id, brandId: brand.id, userId: user.id, productCount: 20 }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
