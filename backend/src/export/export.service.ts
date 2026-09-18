import { Injectable } from '@nestjs/common'
import { Workbook } from 'exceljs'
import { PrismaService } from '../prisma.service'

const ORDER_STATUS_TEXT: Record<string, string> = {
  draft: '草稿',
  pending_quote: '待报价',
  pending_confirm: '待客户确认',
  pending_finance: '待财务审核',
  pending_shipment: '待发货',
  shipped: '已发货',
  completed: '已完成',
  cancelled: '已取消'
}

const PAYMENT_METHOD_TEXT: Record<string, string> = {
  credit: '账期',
  transfer: '转账'
}

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportOrders(query: { status?: string; customerId?: number }) {
    const where: any = { tenantId: 1 }
    if (query.status && query.status !== 'all') where.status = query.status
    if (query.customerId) where.customerId = query.customerId

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        customer: { select: { customerName: true } },
        items: { select: { quantity: true } }
      },
      orderBy: { createdAt: 'desc' }
    })

    const workbook = new Workbook()
    const sheet = workbook.addWorksheet('订单')
    sheet.columns = [
      { header: '订单号', key: 'orderNo', width: 24 },
      { header: '客户', key: 'customer', width: 18 },
      { header: '状态', key: 'status', width: 14 },
      { header: '商品数', key: 'itemCount', width: 10 },
      { header: '订单金额', key: 'totalAmount', width: 14 },
      { header: '应付金额', key: 'payableAmount', width: 14 },
      { header: '支付方式', key: 'paymentMethod', width: 12 },
      { header: '创建时间', key: 'createdAt', width: 20 }
    ]
    for (const order of orders) {
      sheet.addRow({
        orderNo: order.orderNo,
        customer: order.customer?.customerName || '',
        status: ORDER_STATUS_TEXT[order.status] || order.status,
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        totalAmount: Number(order.totalAmount),
        payableAmount: Number(order.payableAmount),
        paymentMethod: PAYMENT_METHOD_TEXT[order.paymentMethod || ''] || '',
        createdAt: order.createdAt.toISOString().slice(0, 19).replace('T', ' ')
      })
    }
    sheet.getRow(1).font = { bold: true }
    return this.toBuffer(workbook)
  }

  async exportCustomers(query: { keyword?: string; status?: string }) {
    const where: any = { tenantId: 1 }
    if (query.keyword) {
      where.OR = [
        { customerName: { contains: query.keyword } },
        { contactPhone: { contains: query.keyword } },
        { contactName: { contains: query.keyword } }
      ]
    }
    if (query.status && query.status !== 'all') where.status = query.status

    const customers = await this.prisma.customer.findMany({
      where,
      include: { level: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }
    })

    const workbook = new Workbook()
    const sheet = workbook.addWorksheet('客户')
    sheet.columns = [
      { header: '客户名称', key: 'customerName', width: 20 },
      { header: '客户类型', key: 'customerType', width: 14 },
      { header: '等级', key: 'level', width: 14 },
      { header: '联系人', key: 'contactName', width: 14 },
      { header: '电话', key: 'contactPhone', width: 16 },
      { header: '状态', key: 'status', width: 10 },
      { header: '信用额度', key: 'creditLimit', width: 14 },
      { header: '已用额度', key: 'creditUsed', width: 14 },
      { header: '账期天数', key: 'creditDays', width: 12 },
      { header: '注册时间', key: 'createdAt', width: 20 }
    ]
    for (const c of customers) {
      sheet.addRow({
        customerName: c.customerName,
        customerType: c.customerType || '',
        level: c.level?.name || '',
        contactName: c.contactName || '',
        contactPhone: c.contactPhone || '',
        status: c.status === 'active' ? '正常' : '已禁用',
        creditLimit: Number(c.creditLimit || 0),
        creditUsed: Number(c.creditUsed || 0),
        creditDays: c.creditDays || 0,
        createdAt: c.createdAt.toISOString().slice(0, 19).replace('T', ' ')
      })
    }
    sheet.getRow(1).font = { bold: true }
    return this.toBuffer(workbook)
  }

  async exportInventory() {
    const skus = await this.prisma.productSku.findMany({
      where: { status: 'active', product: { status: 'active' } },
      include: {
        product: { select: { id: true, name: true, code: true, brand: { select: { name: true } } } }
      },
      orderBy: [{ product: { brandId: 'asc' } }, { skuCode: 'asc' }]
    })

    const workbook = new Workbook()
    const sheet = workbook.addWorksheet('库存')
    sheet.columns = [
      { header: '品牌', key: 'brand', width: 14 },
      { header: '商品编码', key: 'productCode', width: 20 },
      { header: '商品名称', key: 'productName', width: 22 },
      { header: 'SKU编码', key: 'skuCode', width: 20 },
      { header: '规格', key: 'specText', width: 16 },
      { header: '单位', key: 'saleUnit', width: 10 },
      { header: '库存', key: 'stockNum', width: 10 },
      { header: '起订量', key: 'minOrderQty', width: 10 }
    ]
    for (const sku of skus) {
      sheet.addRow({
        brand: sku.product.brand?.name || '',
        productCode: sku.product.code,
        productName: sku.product.name,
        skuCode: sku.skuCode,
        specText: sku.specText,
        saleUnit: sku.saleUnit,
        stockNum: sku.stockNum,
        minOrderQty: sku.minOrderQty
      })
    }
    sheet.getRow(1).font = { bold: true }
    return this.toBuffer(workbook)
  }

  private async toBuffer(workbook: Workbook) {
    return workbook.xlsx.writeBuffer()
  }
}