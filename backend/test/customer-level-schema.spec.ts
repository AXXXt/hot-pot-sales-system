import fs from 'node:fs'
import path from 'node:path'

describe('customer level schema', () => {
  const root = path.resolve(__dirname, '..')

  it('keeps customer level names unique within a brand', () => {
    const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8')
    const customerLevel = schema.match(/model CustomerLevel \{[\s\S]*?\n\}/)?.[0]

    expect(customerLevel).toBeDefined()
    expect(customerLevel).toContain('@@unique([tenantId, brandId, name])')
  })

  it('merges legacy normal customer levels before adding the unique index', () => {
    const sql = fs.readFileSync(
      path.join(
        root,
        'prisma/migrations/20260805120000_deduplicate_customer_levels/migration.sql'
      ),
      'utf8'
    )

    expect(sql).toMatch(/UPDATE `customers`/)
    expect(sql).toMatch(/DELETE `legacy`/)
    expect(sql).toContain("'regular'")
    expect(sql).toContain("'standard'")
    expect(sql).toContain('customer_levels_tenant_id_brand_id_name_key')
  })
})
