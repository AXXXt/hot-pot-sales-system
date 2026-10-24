import { UnauthorizedException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma.service'
import { WxService } from '../notify/wx.service'

/** 微信code只由服务器交换；原关联冲突需用户明确确认，不能在启动时静默转移。 */
export async function bindVerifiedWechat(prisma: PrismaService, wx: WxService, code: string, userId: number, confirmTransfer = false) {
  const openid = await wx.codeToOpenid(code)
  if (!openid) return { bound: false, reason: 'wechat_unavailable' }
  try {
    return await prisma.$transaction(async tx => {
      // 对openid唯一索引加锁，绑定/解绑/审计作为一个整体提交，冲突时不会留下半次转移。
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE openid = ${openid} FOR UPDATE`)
      const user = await tx.user.findUnique({ where: { id: userId }, include: { customer: true, tenant: true } })
      if (!user || user.status !== 'active' || user.tenant.status !== 'active' ||
        (user.customer && user.customer.status !== 'active')) throw new UnauthorizedException('账号不可用')
      const owner = await tx.user.findUnique({ where: { openid } })
      if (owner?.id === userId) return { bound: true }
      if (owner && owner.tenantId !== user.tenantId) return { bound: false, reason: 'transfer_not_allowed' }
      if (owner && !confirmTransfer) {
        const account = /^\d{11}$/.test(owner.phone)
          ? owner.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : '****'
        return { bound: false, reason: 'bound_elsewhere', account }
      }
      if (owner) {
        const result = await tx.user.updateMany({ where: { id: owner.id, tenantId: user.tenantId, openid }, data: { openid: null } })
        if (result.count !== 1) throw new Error('Binding changed')
      }
      await tx.user.update({ where: { id: userId }, data: { openid } })
      if (owner) await tx.auditLog.create({ data: {
        tenantId: user.tenantId, operatorId: userId, action: 'update', module: 'wechat_binding',
        targetType: 'wechat_recipient', targetId: String(userId), requestId: randomUUID(),
        afterData: { previousUserId: owner.id, userId, explicitConfirmation: true }
      } })
      return { bound: true }
    })
  } catch (error) {
    if (error instanceof UnauthorizedException) throw error
    // 不返回或记录携带openid的数据库异常；让用户用新的微信code重试。
    return { bound: false, reason: 'temporary_error' }
  }
}
