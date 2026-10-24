import { BadRequestException } from '@nestjs/common'
import { Workbook } from 'exceljs'
import { ExportController } from '../src/export/export.controller'
import { ExportService } from '../src/export/export.service'

describe('export input and local time boundaries', () => {
  const response = () => ({ setHeader: jest.fn(), send: jest.fn() })
  const access = () => ({ actor: jest.fn().mockResolvedValue({ tenantId: 9 }), orderWhere: () => ({ tenantId: 9 }), customerWhere: () => ({ tenantId: 9 }) })
  it.each(['1oops', '-1', '0', '9007199254740992'])('rejects invalid customer filter %s rather than exporting a wider set', async customerId => {
    const service = { exportOrders: jest.fn().mockResolvedValue(Buffer.from([])) }
    await expect(new ExportController(service as any, access() as any).exportOrders(response() as any, { user: { sub: 7 } }, undefined, customerId)).rejects.toBeInstanceOf(BadRequestException)
    expect(service.exportOrders).not.toHaveBeenCalled()
  })

  it('rejects unsupported order and customer states before touching the database', async () => {
    const service = { exportOrders: jest.fn(), exportCustomers: jest.fn() }, controller = new ExportController(service as any, access() as any)
    await expect(controller.exportOrders(response() as any, { user: { sub: 7 } }, 'invalid')).rejects.toBeInstanceOf(BadRequestException)
    await expect(controller.exportCustomers(response() as any, { user: { sub: 7 } }, undefined, 'invalid')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('writes order timestamps in Shanghai time and keeps user values as literal spreadsheet text', async () => {
    const prisma = { order: { findMany: jest.fn().mockResolvedValue([{ orderNo: '=1+1', customer: { customerName: '+SUM(1,1)' }, items: [{ quantity: 1 }],
      status: 'completed', totalAmount: '10', payableAmount: '10', paymentMethod: 'transfer', createdAt: new Date('2026-10-23T00:15:00.000Z') }]) } }
    const buffer = await new ExportService(prisma as any).exportOrders({}, { tenantId: 9 })
    const workbook = new Workbook(); await workbook.xlsx.load(buffer as any)
    expect(workbook.worksheets[0].getRow(2).getCell(8).value).toBe('2026-10-23 08:15:00')
    expect(workbook.worksheets[0].getRow(2).getCell(1).value).toBe('=1+1')
    expect(workbook.worksheets[0].getRow(2).getCell(1).formula).toBeUndefined()
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ tenantId: 9 }, {}] } }))
  })
})
