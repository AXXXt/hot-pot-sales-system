const { test } = require('node:test')
const assert = require('node:assert/strict')
const { checkCredentialVersion } = require('../platform-api.cjs')

test('independent version center rejects tokens from before a password change', async () => {
  const prisma = { $queryRaw: async () => [{ version: 2 }] }
  await assert.rejects(checkCredentialVersion(prisma, { sub: 1, cv: 1 }), error => error.status === 401)
  await assert.rejects(checkCredentialVersion(prisma, { sub: 1 }), error => error.status === 401)
  await checkCredentialVersion(prisma, { sub: 1, cv: 2 })
  await checkCredentialVersion({ $queryRaw: async () => [] }, { sub: 2 })
})
