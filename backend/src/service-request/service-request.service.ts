import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, ServiceRequest } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../prisma.service'
import { StaffAccessService, StaffActor } from '../auth/staff-access.service'
import { CreateServiceRequestDto, ProcessServiceRequestDto, ServiceOrderQuery, ServiceRequestQuery } from './service-request.dto'

@Injectable()
export class ServiceRequestService {
  constructor(private readonly prisma: PrismaService, private readonly access: StaffAccessService) {}

  private async customer(userId: number, client: Pick<Prisma.TransactionClient, 'user'> = this.prisma) {
    const user = await client.user.findUnique({ where: { id: userId }, select: {
      id: true, tenantId: true, customerId: true, userType: true, status: true,
      tenant: { select: { status: true } }, customer: { select: { tenantId: true, status: true } }
    } })
    if (!user || user.userType !== 'customer_user' || user.status !== 'active' || user.tenant.status !== 'active'
      || !user.customerId || user.customer?.status !== 'active' || user.customer.tenantId !== user.tenantId) {
      throw new ForbiddenException('仅有效采购客户可提交或查看服务申请')
    }
    return { ...user, customerId: user.customerId }
  }

  private async staff(userId: number, client?: Prisma.TransactionClient) {
    const actor = await (client ? new StaffAccessService(client as any) : this.access).actor(userId)
    this.access.require(actor, 'customer:manage')
    if (!['super_admin', 'admin', 'sales'].includes(actor.userType)) throw new ForbiddenException('仅客户管理员或负责业务员可处理服务申请')
    return actor
  }

  private staffScope(actor: StaffActor): Prisma.ServiceRequestWhereInput {
    return { tenantId: actor.tenantId, customer: { is: this.access.customerWhere(actor) }, OR: [
      { orderId: null }, { order: { is: this.access.orderWhere(actor) } }
    ] }
  }

  private query(query: ServiceRequestQuery): Prisma.ServiceRequestWhereInput {
    return { ...(query.status ? { status: query.status } : {}), ...(query.type ? { type: query.type } : {}) }
  }

  private async page(where: Prisma.ServiceRequestWhereInput, query: ServiceRequestQuery) {
    const [items, total] = await Promise.all([
      this.prisma.serviceRequest.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        select: { id: true, requestNo: true, type: true, subject: true, status: true, createdAt: true, updatedAt: true,
          customer: { select: { id: true, customerName: true } }, order: { select: { id: true, orderNo: true } } } }),
      this.prisma.serviceRequest.count({ where })
    ])
    return { items, total, page: query.page, pageSize: query.pageSize }
  }

  async mine(userId: number, query: ServiceRequestQuery) {
    const user = await this.customer(userId)
    return this.page({ ...this.query(query), tenantId: user.tenantId, customerId: user.customerId, requesterId: user.id }, query)
  }

  async orderOptions(userId: number, query: ServiceOrderQuery) {
    const user = await this.customer(userId)
    return this.prisma.order.findMany({ where: { tenantId: user.tenantId, customerId: user.customerId,
      ...(query.orderId ? { id: query.orderId } : {}), ...(query.keyword ? { orderNo: { contains: query.keyword } } : {}) },
      select: { id: true, orderNo: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 30 })
  }

  async management(userId: number, query: ServiceRequestQuery) {
    const actor = await this.staff(userId)
    return this.page({ AND: [this.staffScope(actor), this.query(query)] }, query)
  }

  private presentation(record: ServiceRequest & { order?: unknown; customer?: unknown }) {
    return { id: record.id, requestNo: record.requestNo, type: record.type, subject: record.subject,
      description: record.description, status: record.status, resolution: record.resolution,
      events: record.events, version: record.version, orderId: record.orderId,
      createdAt: record.createdAt, updatedAt: record.updatedAt, closedAt: record.closedAt,
      ...('order' in record ? { order: record.order } : {}), ...('customer' in record ? { customer: record.customer } : {}) }
  }

  async myDetail(userId: number, id: number) {
    const user = await this.customer(userId)
    const record = await this.prisma.serviceRequest.findFirst({ where: { id, tenantId: user.tenantId, customerId: user.customerId, requesterId: user.id }, include: {
      order: { select: { id: true, orderNo: true } }
    } })
    if (!record) throw new NotFoundException('申请不存在或不可访问')
    return this.presentation(record)
  }

  async managementDetail(userId: number, id: number) {
    const actor = await this.staff(userId)
    const record = await this.prisma.serviceRequest.findFirst({ where: { AND: [this.staffScope(actor), { id }] }, include: {
      customer: { select: { id: true, customerName: true, contactName: true, contactPhone: true } }, order: { select: { id: true, orderNo: true } }
    } })
    if (!record) throw new NotFoundException('申请不存在或不可访问')
    return this.presentation(record)
  }

  private sameInput(record: ServiceRequest, dto: CreateServiceRequestDto) {
    return record.type === dto.type && record.subject === dto.subject.trim() && record.description === dto.description.trim() && record.orderId === (dto.orderId ?? null)
  }

  async create(userId: number, dto: CreateServiceRequestDto) {
    const owner = await this.customer(userId)
    const record = await this.prisma.$transaction(async tx => {
      // Serialize submissions for this customer, including the outstanding-request cap.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM customers WHERE id = ${owner.customerId} FOR UPDATE`)
      const current = await this.customer(userId, tx)
      if (current.customerId !== owner.customerId || current.tenantId !== owner.tenantId) throw new ConflictException('账号资料已变化，请刷新后重试')
      const prior = await tx.serviceRequest.findUnique({ where: { tenantId_requesterId_clientKey: { tenantId: current.tenantId, requesterId: userId, clientKey: dto.clientKey } } })
      if (prior) {
        if (prior.customerId !== current.customerId) throw new ConflictException('账号所属客户已变化，请重新打开申请表')
        if (!this.sameInput(prior, dto)) throw new ConflictException('重复提交标识对应的内容已变化，请重新打开申请表')
        return prior
      }
      if (dto.orderId && !await tx.order.findFirst({ where: { id: dto.orderId, tenantId: current.tenantId, customerId: current.customerId }, select: { id: true } })) throw new NotFoundException('关联订单不存在或不可访问')
      if (await tx.serviceRequest.count({ where: { tenantId: current.tenantId, requesterId: userId, status: { in: ['pending', 'processing'] } } }) >= 20) throw new BadRequestException('待处理申请较多，请先查看处理进度或联系客服')
      const created = await tx.serviceRequest.create({ data: {
        tenantId: current.tenantId, customerId: current.customerId, requesterId: userId,
        requestNo: `SR${Date.now()}${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        clientKey: dto.clientKey, type: dto.type, subject: dto.subject.trim(), description: dto.description.trim(), orderId: dto.orderId,
        events: [{ at: new Date().toISOString(), status: 'pending', actor: 'customer', message: '已提交，等待工作人员处理' }]
      } })
      await tx.auditLog.create({ data: { tenantId: current.tenantId, operatorId: userId, action: 'create', module: 'customer', targetType: 'service_request', targetId: String(created.id),
        afterData: { type: created.type, status: created.status, orderId: created.orderId }, requestId: `service-${randomUUID()}` } })
      return created
    })
    return this.presentation(record)
  }

  async process(userId: number, id: number, dto: ProcessServiceRequestDto) {
    const previousActor = await this.staff(userId)
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM service_requests WHERE id = ${id} AND tenant_id = ${previousActor.tenantId} FOR UPDATE`)
      const actor = await this.staff(userId, tx)
      const record = await tx.serviceRequest.findFirst({ where: { AND: [this.staffScope(actor), { id }] } })
      if (!record) throw new NotFoundException('申请不存在或不可访问')
      if (record.status === dto.status && record.resolution === dto.message.trim()) return this.presentation(record)
      if (record.version !== dto.expectedVersion) throw new ConflictException('申请已由其他人员更新，请刷新后再处理')
      if (['completed', 'rejected'].includes(record.status) || (record.status === 'pending' && dto.status === 'completed')) throw new ConflictException('请先受理申请，已结束的申请不能再次处理')
      const events = Array.isArray(record.events) ? record.events : []
      const terminal = dto.status === 'completed' || dto.status === 'rejected'
      if (events.length >= 100 && !terminal) throw new BadRequestException('处理记录已达上限，请直接结案或联系管理员核对')
      const result = await tx.serviceRequest.update({ where: { id }, data: { status: dto.status, resolution: dto.message.trim(), processorId: userId,
        version: { increment: 1 },
        closedAt: terminal ? new Date() : null,
        events: [...events, { at: new Date().toISOString(), status: dto.status, actor: 'staff', message: dto.message.trim() }] as Prisma.InputJsonValue
      } })
      await tx.auditLog.create({ data: { tenantId: actor.tenantId, operatorId: userId, action: 'update', module: 'customer', targetType: 'service_request', targetId: String(id),
        beforeData: { status: record.status }, afterData: { status: result.status }, requestId: `service-${randomUUID()}` } })
      return this.presentation(result)
    })
  }
}
