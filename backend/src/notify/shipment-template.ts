// 微信公共模板64645：字段标识由2026-10-22用户提供的模板详情确认。
export const SHIPMENT_TEMPLATE_ID = 'idORoSuKEueBOFOfyYQEXdH7dh5_W8OtmSvpCaUmJSg'

const thing = (value: string) => {
  const text = Array.from(value.replace(/\s+/g, ' ').trim())
  return text.length > 20 ? text.slice(0, 19).join('') + '…' : text.join('')
}

export function shipmentTemplateData(input: {
  orderNo: string; shippedAt: Date; productNames: string[]; logisticsType?: string | null
}) {
  if (!/^[\x21-\x7e]{1,32}$/.test(input.orderNo) || !Number.isFinite(input.shippedAt.getTime())) {
    throw new Error('Invalid shipment notification data')
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(input.shippedAt).map(part => [part.type, part.value]))
  const names = [...new Set(input.productNames.filter(Boolean))]
  const name = (names[0] || '订单商品') + (names.length > 1 ? `等${names.length}款` : '')
  const delivery: Record<string, string> = { 'cold-chain': '冷链配送', regular: '普货配送', tricycle: '本地配送' }
  return {
    character_string1: { value: input.orderNo },
    time2: { value: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}` },
    phrase5: { value: '已发货' },
    thing8: { value: thing(name) },
    thing6: { value: thing(`${delivery[input.logisticsType || ''] || '订单已发货'}，请留意收货`) }
  }
}
