import { describe, expect, it } from 'vitest'
import {
  DONUT_VIEW_BOX,
  TREND_VIEW_BOX,
  buildDonutSegments,
  buildTrendAreaPath,
  buildTrendPlot,
  formatPlotPoints
} from './chart-geometry'

describe('dashboard chart geometry', () => {
  it('normalizes sales trend data into a balanced fixed viewport', () => {
    const points = buildTrendPlot([
      { date: '2026-07-23', revenue: 0, orders: 0 },
      { date: '2026-07-24', revenue: 0, orders: 0 },
      { date: '2026-07-25', revenue: 77.5, orders: 1 },
      { date: '2026-07-26', revenue: 0, orders: 0 }
    ])

    expect(TREND_VIEW_BOX).toBe('0 0 640 220')
    expect(points).toHaveLength(4)
    expect(points[0].plotX).toBeCloseTo(34, 1)
    expect(points[0].plotY).toBeCloseTo(186, 1)
    expect(points[2].plotY).toBeCloseTo(24, 1)
    expect(points[3].plotX).toBeCloseTo(606, 1)
    expect(formatPlotPoints(points)).not.toMatch(/NaN|Infinity/)
    expect(buildTrendAreaPath(points)).toContain('L606.0,186')
  })

  it('falls back to order counts when revenue is empty', () => {
    const [point] = buildTrendPlot([{ date: '2026-07-29', revenue: 0, orders: 2 }])

    expect(point.value).toBe(2)
    expect(point.plotY).toBeCloseTo(24, 1)
  })

  it('keeps the order donut compact and aligned to warm brand colors', () => {
    const segments = buildDonutSegments([
      { name: '待发货', value: 1, color: '#409EFF' },
      { name: '已发货', value: 1, color: '#67C23A' },
      { name: '无效状态', value: 0 }
    ])

    expect(DONUT_VIEW_BOX).toBe('0 0 172 172')
    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({ centerX: 86, centerY: 86, radius: 58, color: '#8d1c1c', percentage: '50%' })
    expect(segments[1].color).toBe('#b86a51')
    expect(segments.map((segment) => `${segment.dashArray} ${segment.dashOffset}`).join(' ')).not.toMatch(/NaN|Infinity/)
  })
})