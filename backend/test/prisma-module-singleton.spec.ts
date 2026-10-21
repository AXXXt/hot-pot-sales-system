import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

describe('Prisma module wiring', () => {
  const sourceRoot = join(__dirname, '..', 'src')
  const moduleFiles = readdirSync(sourceRoot, { recursive: true, encoding: 'utf8' })
    .filter(file => file.endsWith('.module.ts'))

  it('provides PrismaService only through the global PrismaModule', () => {
    const offenders = moduleFiles
      .filter(file => file !== 'prisma.module.ts')
      .filter(file => /providers\s*:[^\]]*PrismaService/.test(
        readFileSync(join(sourceRoot, file), 'utf8')
      ))
      .map(file => relative(sourceRoot, join(sourceRoot, file)))

    expect(offenders).toEqual([])
  })

  it('imports PrismaModule into the root application module', () => {
    const appModule = readFileSync(join(sourceRoot, 'app.module.ts'), 'utf8')
    expect(appModule).toMatch(/imports:\s*\[[\s\S]*PrismaModule/)
    expect(appModule).not.toMatch(/providers:\s*\[[^\]]*PrismaService/)
  })
})
