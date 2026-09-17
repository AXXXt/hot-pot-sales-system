import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('管理端食品品牌主题', () => {
  it('定义品牌色、暖背景和 Element Plus 主色', () => {
    const themePath = fileURLToPath(new URL('./theme.css', import.meta.url))

    expect(existsSync(themePath)).toBe(true)

    const theme = readFileSync(themePath, 'utf8')
    expect(theme).toContain('--brand-primary: #8d1c1c')
    expect(theme).toContain('--brand-deep: #660a0a')
    expect(theme).toContain('--brand-surface: #f8efed')
    expect(theme).toContain('--el-color-primary: #8d1c1c')
    expect(theme).toContain('Microsoft YaHei')
    expect(theme).toContain('PingFang SC')
  })
})
