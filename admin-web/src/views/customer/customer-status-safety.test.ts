import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('customer status safety UI', () => {
  it('explains that disabling a customer preserves historical data', () => {
    const detailPath = fileURLToPath(new URL('./CustomerDetail.vue', import.meta.url))
    const detail = readFileSync(detailPath, 'utf8')

    expect(detail).toContain('禁用后客户及关联账号将无法登录，历史数据会保留')
    expect(detail).toContain("'禁用客户' : '启用客户'")
    expect(detail).not.toContain('客户已禁用并删除')
  })

  it('submits the rejection reason while preserving customer data', () => {
    const listPath = fileURLToPath(new URL('./CustomerList.vue', import.meta.url))
    const list = readFileSync(listPath, 'utf8')

    expect(list).toContain('驳回后将禁用客户及关联账号，历史数据会保留')
    expect(list).toContain('rejectCustomer(row.id, reason || undefined)')
    expect(list).toContain('已驳回并禁用，历史数据已保留')
  })
})