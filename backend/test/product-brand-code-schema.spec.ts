import fs from 'node:fs'
import path from 'node:path'

describe('product brand code schema', () => {
  const root = path.resolve(__dirname, '..')

  it('stores a per-category historical sequence', () => {
    const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8')
    expect(schema).toMatch(/productSequence\s+Int\s+@default\(0\)\s+@map\("product_sequence"\)/)
  })

  it('backfills from product count and maximum numeric suffix', () => {
    const sql = fs.readFileSync(
      path.join(root, 'prisma/migrations/20260804150000_product_brand_code/migration.sql'),
      'utf8'
    )
    expect(sql).toMatch(/ADD COLUMN `product_sequence`/)
    expect(sql).toMatch(/COUNT\(\*\)/)
    expect(sql).toMatch(/SUBSTRING_INDEX\(`code`, '-', -1\)/)
    expect(sql).toMatch(/GREATEST/)
  })

  it('keeps the development seed idempotent after legacy brand normalization', () => {
    const seed = fs.readFileSync(path.join(root, 'prisma/seed.dev.ts'), 'utf8')
    expect(seed).toMatch(/code:\s*\{\s*in:\s*\[[^\]]*'DEMOBRAND'/)
  })
})
