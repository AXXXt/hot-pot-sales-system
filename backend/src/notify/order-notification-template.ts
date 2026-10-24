import { shipmentTemplateData } from './shipment-template'

export const QUOTE_TEMPLATE_ID = 'iRCVLcAD9alfLVGcsvG_XbEqGiQL88iX7FPigD5kFAM'
export const QUOTE_FIELDS = { character_string1: 'orderNo', thing2: 'productName', amount4: 'amount', time5: 'eventTime' }

export type OrderNoticeEvent = 'order.quoted' | 'order.approved' | 'order.shipped'
type ValueName = 'orderNo' | 'productName' | 'amount' | 'eventTime' | 'state' | 'remark'
export type NoticeTemplate = { event: OrderNoticeEvent; title: string; templateId: string; fields: Record<string, ValueName> }
const TYPES: Record<ValueName, string[]> = {
  orderNo: ['character_string'], productName: ['thing'], amount: ['amount'],
  eventTime: ['time', 'date'], state: ['phrase', 'thing'], remark: ['thing']
}

/** 字段必须来自实际选用的微信模板，未配置时保持停用，不能猜测字段编号。 */
export function configuredOrderTemplate(event: OrderNoticeEvent, title: string, id?: string, mapping?: string): NoticeTemplate | null {
  if (!id?.trim() && !mapping?.trim()) return null
  try {
    if (!/^[A-Za-z0-9_-]{10,128}$/.test(id?.trim() || '')) throw Error()
    const fields = JSON.parse(mapping || '')
    const entries = Object.entries(fields) as Array<[string, ValueName]>
    if (Array.isArray(fields) || !entries.length || entries.length > 5) throw Error()
    for (const [key, value] of entries) {
      const match = /^([a-z_]+)[1-9]\d*$/.exec(key)
      if (!match || !TYPES[value]?.includes(match[1])) throw Error()
    }
    if (!entries.some(([, value]) => value === 'orderNo')) throw Error()
    return { event, title, templateId: id!.trim(), fields }
  } catch { throw new Error(`Invalid Wechat field configuration for ${event}`) }
}

export function orderNoticeData(template: NoticeTemplate, input: {
  orderNo: string; eventTime: Date; productNames: string[]; amount: string; paymentMethod?: string | null
}) {
  const base = shipmentTemplateData({ ...input, shippedAt: input.eventTime })
  if (!/^\d{1,16}\.\d{2}$/.test(input.amount)) throw new Error('Invalid notice amount')
  const approved = template.event === 'order.approved'
  const values: Record<ValueName, string> = {
    orderNo: input.orderNo, productName: base.thing8.value, amount: input.amount,
    eventTime: base.time2.value, state: approved ? '审核通过' : '报价完成',
    remark: approved ? (input.paymentMethod === 'credit' ? '账期审核通过，请等待发货' : '订单审核通过，请等待发货') : '报价已完成，请进入订单确认'
  }
  return Object.fromEntries(Object.entries(template.fields).map(([key, value]) => [key, {
    value: key.startsWith('date') ? values[value].slice(0, 10) : values[value]
  }]))
}
