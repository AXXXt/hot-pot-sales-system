export interface DashboardTrendItem {
  date: string
  revenue?: number | string | null
  orders?: number | string | null
  count?: number | string | null
}

export interface TrendPoint {
  date: string
  label: string
  value: number
  plotX: number
  plotY: number
}

export interface DashboardStatusItem {
  name: string
  value: number | string | null
  color?: string | null
}

export interface DonutSegment {
  name: string
  value: number
  color: string
  centerX: number
  centerY: number
  radius: number
  dashArray: string
  dashOffset: string
  percentage: string
}

export const TREND_VIEW_BOX = '0 0 640 220'
export const TREND_GRID_LINES = [24, 78, 132, 186]
export const DONUT_VIEW_BOX = '0 0 172 172'

const TREND_WIDTH = 640
const TREND_PADDING_X = 34
const TREND_TOP = 24
const TREND_BASELINE = 186
const DONUT_CENTER = 86
const DONUT_RADIUS = 58

const STATUS_COLORS: Record<string, string> = {
  草稿: '#c9b0a4',
  待报价: '#d99a53',
  待确认: '#a16207',
  待财务审核: '#c7594f',
  待发货: '#8d1c1c',
  已发货: '#b86a51',
  已完成: '#6f8f5f',
  已取消: '#9ca3af'
}

const STATUS_FALLBACK_COLORS = ['#8d1c1c', '#c7594f', '#d99a53', '#b86a51', '#6f8f5f', '#8f7a70']

function toFiniteNumber(value: unknown): number {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

function trendValue(item: DashboardTrendItem): number {
  const revenue = toFiniteNumber(item.revenue)
  if (revenue > 0) return revenue
  return Math.max(toFiniteNumber(item.orders), toFiniteNumber(item.count))
}

export function buildTrendPlot(items: DashboardTrendItem[] = []): TrendPoint[] {
  if (!items.length) return []

  const values = items.map(trendValue)
  const maxValue = Math.max(...values, 1)
  const usableWidth = TREND_WIDTH - TREND_PADDING_X * 2
  const usableHeight = TREND_BASELINE - TREND_TOP
  const divisor = Math.max(items.length - 1, 1)

  return items.map((item, index) => {
    const value = values[index]
    const plotX = TREND_PADDING_X + (index / divisor) * usableWidth
    const plotY = TREND_BASELINE - (value / maxValue) * usableHeight

    return {
      date: item.date,
      label: item.date?.slice(5) || '',
      value,
      plotX,
      plotY
    }
  })
}

export function formatPlotPoints(points: TrendPoint[]): string {
  return points.map((point) => `${point.plotX.toFixed(1)},${point.plotY.toFixed(1)}`).join(' ')
}

export function buildTrendAreaPath(points: TrendPoint[]): string {
  if (!points.length) return ''

  const firstPoint = points[0]
  const lastPoint = points[points.length - 1]
  return `M${firstPoint.plotX.toFixed(1)},${TREND_BASELINE} L${formatPlotPoints(points)} L${lastPoint.plotX.toFixed(1)},${TREND_BASELINE} Z`
}

export function buildDonutSegments(items: DashboardStatusItem[] = []): DonutSegment[] {
  const statuses = items
    .map((item) => ({ ...item, value: toFiniteNumber(item.value) }))
    .filter((item) => item.value > 0)

  const total = statuses.reduce((sum, item) => sum + item.value, 0)
  if (!total) return []

  const circumference = 2 * Math.PI * DONUT_RADIUS
  let accumulatedLength = 0

  return statuses.map((item, index) => {
    const segmentLength = (item.value / total) * circumference
    const segment = {
      name: item.name,
      value: item.value,
      color: STATUS_COLORS[item.name] || item.color || STATUS_FALLBACK_COLORS[index % STATUS_FALLBACK_COLORS.length],
      centerX: DONUT_CENTER,
      centerY: DONUT_CENTER,
      radius: DONUT_RADIUS,
      dashArray: `${segmentLength.toFixed(1)} ${circumference.toFixed(1)}`,
      dashOffset: (-accumulatedLength).toFixed(1),
      percentage: `${Math.round((item.value / total) * 100)}%`
    }
    accumulatedLength += segmentLength
    return segment
  })
}