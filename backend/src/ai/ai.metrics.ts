import { BadRequestException } from '@nestjs/common'

/** 业务日期使用上海时区，与运行服务的主机时区无关。 */
export function shanghaiDay(now = new Date()) { return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10) }

export function metricRange(period = 'week', now = new Date()) {
  const day = shanghaiDay(now)
  const today = new Date(`${day}T00:00:00+08:00`)
  let start = new Date(today)
  if (period === 'week' || period === 'last_week') {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
    start = new Date(today.getTime() - ((weekday + 6) % 7) * 86400_000)
  } else if (period === 'month') start = new Date(`${day.slice(0, 7)}-01T00:00:00+08:00`)
  else if (period !== 'today') throw new BadRequestException('统计周期仅支持 today、week、month')
  if (period === 'last_week') {
    const end = start
    start = new Date(end.getTime() - 7 * 86400000)
    return { start, end, previousStart: new Date(start.getTime() - 7 * 86400000), previousEnd: start, timezone: 'Asia/Shanghai', period }
  }
  const previousStart = new Date(start.getTime() - (period === 'week' ? 7 : 1) * 86400_000)
  // 月份由上海日期构造，处理一月跨年。
  if (period === 'month') {
    const [year, month] = day.split('-').map(Number)
    previousStart.setTime(Date.parse(`${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}-01T00:00:00+08:00`))
  }
  const previousEnd = new Date(Math.min(start.getTime(), previousStart.getTime() + (now.getTime() - start.getTime())))
  return { start, end: now, previousStart, previousEnd, timezone: 'Asia/Shanghai', period }
}
