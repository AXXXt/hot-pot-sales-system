import fs from 'node:fs'
import path from 'node:path'

function modelBlock(schema: string, modelName: string) {
  const match = schema.match(new RegExp('model ' + modelName + ' \\{[\\s\\S]*?\\n\\}'))
  if (!match) throw new Error('Missing Prisma model: ' + modelName)
  return match[0]
}

describe('global product category schema', () => {
  it('keeps categories tenant-global without a brand relation', () => {
    const schema = fs.readFileSync(path.resolve(__dirname, '../prisma/schema.prisma'), 'utf8')
    const categoryModel = modelBlock(schema, 'ProductCategory')
    const brandModel = modelBlock(schema, 'Brand')

    expect(categoryModel).not.toMatch(/brandId|brand\s+Brand/)
    expect(categoryModel).toContain('@@unique([tenantId, code])')
    expect(categoryModel).toContain('@@index([tenantId, status])')
    expect(brandModel).not.toMatch(/categories\s+ProductCategory\[\]/)
  })
})
