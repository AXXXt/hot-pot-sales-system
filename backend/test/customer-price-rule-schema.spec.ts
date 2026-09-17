import fs from 'node:fs'
import path from 'node:path'

describe('customer price rule schema', () => {
  const root = path.resolve(__dirname, '..')

  it('keeps one rule per tenant, customer and SKU', () => {
    const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8')
    const priceRule = schema.match(/model CustomerPriceRule \{[\s\S]*?\n\}/)?.[0]

    expect(priceRule).toBeDefined()
    expect(priceRule).toContain('@@unique([tenantId, customerId, skuId])')
    expect(priceRule).not.toContain('@@unique([tenantId, customerId, skuId, priceType])')
  })

  it('uses the new compound key in the development seed', () => {
    const seed = fs.readFileSync(path.join(root, 'prisma/seed.dev.ts'), 'utf8')

    expect(seed).toContain('tenantId_customerId_skuId:')
    expect(seed).not.toContain('tenantId_customerId_skuId_priceType')
  })

  it('deduplicates legacy rules before adding the new unique index', () => {
    const sql = fs.readFileSync(
      path.join(
        root,
        'prisma/migrations/20260805170000_unique_customer_sku_price_rule/migration.sql'
      ),
      'utf8'
    )

    expect(sql).toMatch(/DELETE `older`/)
    expect(sql).toContain("SET `price_type` = 'agreement'")
    expect(sql).toContain('customer_price_rules_tenant_id_customer_id_sku_id_price_type_key')
    expect(sql).toContain('customer_price_rules_tenant_id_customer_id_sku_id_key')
  })
})