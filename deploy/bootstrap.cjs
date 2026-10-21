const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const permissions = [
  ['dashboard:view', '查看工作台', 'menu'], ['brand:manage', '管理品牌', 'action'],
  ['product:read', '查看商品', 'page'], ['product:create', '创建商品', 'action'], ['product:update', '编辑商品', 'action'],
  ['inventory:read', '查看库存', 'page'], ['inventory:adjust', '调整库存', 'action'],
  ['customer:manage', '管理客户', 'action'], ['order:read', '查看订单', 'page'], ['order:confirm', '确认订单', 'action'],
  ['audit:read', '查看审计日志', 'page'], ['role:manage', '管理角色权限', 'action'],
  ['monitor:read', '查看监控告警', 'page'], ['lead:read', '查看获客线索', 'page'], ['lead:manage', '管理获客线索', 'action']
]
async function main() {
  const existing = await prisma.tenant.findUnique({ where: { id: 1 } })
  if (existing && existing.code !== 'weiduoxian') throw new Error('Tenant 1 is already occupied; refusing to overwrite it')
  await prisma.tenant.upsert({ where: { id: 1 }, update: {}, create: { id: 1, code: 'weiduoxian', name: '河南唯哆鲜食品有限公司' } })
  const role = await prisma.role.upsert({ where: { tenantId_code: { tenantId: 1, code: 'super_admin' } }, update: {}, create: { tenantId: 1, code: 'super_admin', name: '超级管理员' } })
  for (const [code, name, type] of permissions) {
    const permission = await prisma.permission.upsert({ where: { code }, update: {}, create: { code, name, type } })
    await prisma.rolePermission.upsert({ where: { tenantId_roleId_permissionId: { tenantId: 1, roleId: role.id, permissionId: permission.id } }, update: {}, create: { tenantId: 1, roleId: role.id, permissionId: permission.id } })
  }
  const phone = process.env.BOOTSTRAP_ADMIN_PHONE
  if (phone) {
    if (!/^1\d{10}$/.test(phone)) throw new Error('Invalid admin phone')
    const existingUser = await prisma.user.findUnique({ where: { phone } })
    if (existingUser && (existingUser.tenantId !== 1 || existingUser.userType !== 'super_admin')) throw new Error('Refusing to promote an existing unrelated account')
    const user = await prisma.user.upsert({ where: { phone }, update: {}, create: { tenantId: 1, phone, name: '管理员', userType: 'super_admin' } })
    await prisma.userRole.upsert({ where: { tenantId_userId_roleId: { tenantId: 1, userId: user.id, roleId: role.id } }, update: {}, create: { tenantId: 1, userId: user.id, roleId: role.id } })
  }
  console.log('Production tenant and permissions initialized. Admin configured:', Boolean(phone))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => prisma.$disconnect())
