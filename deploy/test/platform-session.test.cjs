const { test } = require('node:test')
const assert = require('node:assert/strict')
const { checkSession } = require('../platform-api.cjs')
const sid = '00000000-0000-4000-8000-000000000001'

test('independent version center checks the same current-device session as ordinary APIs', async () => {
  const values = new Map([[`auth:session:7:${sid}`, 'a'.repeat(64)]])
  const redis = { get: async key => values.get(key) ?? null }
  await checkSession(redis, { sub: 7, sid })
  values.delete(`auth:session:7:${sid}`)
  await assert.rejects(checkSession(redis, { sub: 7, sid }), error => error.status === 401)
})

test('legacy sessions remain compatible until explicitly revoked', async () => {
  const values = new Map()
  const redis = { get: async key => values.get(key) ?? null }
  await checkSession(redis, { sub: 7 })
  values.set('auth:legacy-revoked:7', '1')
  await assert.rejects(checkSession(redis, { sub: 7 }), error => error.status === 401)
})

test('session store outage fails closed without exposing the connection error', async () => {
  await assert.rejects(checkSession({ get: async () => { throw new Error('private connection') } }, { sub: 7, sid }), error => error.status === 503 && !error.message.includes('private'))
})

test('invalid session IDs and corrupt entries do not become authenticated', async () => {
  let reads = 0
  const redis = { get: async () => { reads++; return '1' } }
  await assert.rejects(checkSession(redis, { sub: 7, sid: null }), error => error.status === 401)
  await assert.rejects(checkSession(redis, { sub: 7, sid: '../bad' }), error => error.status === 401)
  assert.equal(reads, 0)
  await assert.rejects(checkSession(redis, { sub: 7, sid }), error => error.status === 401)
})

test('a removed or expired SID is never treated as a legacy token, and ticket/refresh purposes are rejected', async () => {
  const redis = { get: async () => null }
  await assert.rejects(checkSession(redis, { sub: 7, sid }), error => error.status === 401)
  for (const tokenUse of ['refresh', 'registration_status']) await assert.rejects(checkSession(redis, { sub: 7, tokenUse }), error => error.status === 401)
  await checkSession(redis, { sub: 7, tokenUse: 'access' })
})
