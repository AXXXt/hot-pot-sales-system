import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('customer price rule management', () => {
  it('provides update and delete controls for one price per SKU', () => {
    const componentPath = fileURLToPath(new URL('./CustomerDetail.vue', import.meta.url))
    const component = readFileSync(componentPath, 'utf8')

    expect(component).toContain('createPriceRule, deletePriceRule')
    expect(component).toContain('openRule(row)')
    expect(component).toContain('removeRule(row)')
    expect(component).toContain('\u5ba2\u6237 + \u5546\u54c1\u89c4\u683c\u552f\u4e00')
    expect(component).not.toContain('value="manual"')
    expect(component).toContain('row.sku?.specText || row.sku?.name || row.sku?.skuCode')
    expect(component).not.toContain('label="规格"')
  })

  it('calls the soft-delete API', () => {
    const apiPath = fileURLToPath(new URL('../../api/customer.ts', import.meta.url))
    const api = readFileSync(apiPath, 'utf8')

    expect(api).toContain('deletePriceRule')
    expect(api).toContain('http.delete(`/customer-price-rules/${id}`)')
  })
})