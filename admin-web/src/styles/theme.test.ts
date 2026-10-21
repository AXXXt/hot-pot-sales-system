import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('管理端食品品牌主题', () => {
  it('定义中性底色、克制圆角和 Element Plus 状态绿', () => {
    const themePath = fileURLToPath(new URL('./theme.css', import.meta.url))

    expect(existsSync(themePath)).toBe(true)

    const theme = readFileSync(themePath, 'utf8')
    expect(theme).toContain('--brand-primary: #222625')
    expect(theme).toContain('--brand-accent: #c4461b')
    expect(theme).toContain('--brand-surface: #f4f6f4')
    expect(theme).toContain('--el-color-primary: #43715b')
    expect(theme).toContain('--brand-radius: 4px')
    expect(theme).not.toMatch(/gradient\(/)
    expect(theme).toContain('Microsoft YaHei')
    expect(theme).toContain('PingFang SC')
  })
})
