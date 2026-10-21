const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const { randomBytes } = require('node:crypto')
const { createPlatformServer, verify, ApiError } = require('../platform-api.cjs')
async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-test-'))
  for (const dir of ['queue', 'operations']) fs.mkdirSync(path.join(root, dir))
  const releases = [2, 3].map(sequence => ({ id: `ai-20261021-${sequence}`, sequence, version: `1.${sequence - 1}.0`, title: '更新', notes: ['功能更新'], ready: true, imageId: 'private-image', schema: ['private-schema'], manifestSha256: 'private-digest' }))
  fs.writeFileSync(path.join(root, 'catalog.json'), JSON.stringify({ releases }))
  fs.writeFileSync(path.join(root, 'current.json'), JSON.stringify({ id: releases[0].id }))
  const actor = { id: 1, tenantId: 1, superAdmin: true, userType: 'super_admin', fingerprint: 'fresh-authority' }
  const audits = []; let clock = Date.now()
  const secret = randomBytes(32)
  const server = createPlatformServer({ root, secret, now: () => clock, authenticate: async header => {
    if (!header) throw new ApiError(401, '请先登录')
    return header === 'ordinary' ? { ...actor, superAdmin: false, userType: 'admin' } : header === 'other-tenant' ? { ...actor, tenantId: 2 } : header === 'customer' ? { ...actor, userType: 'customer_user' } : { ...actor }
  }, audit: async job => { if (options.failAudit) throw new Error('private failure'); audits.push(job) } })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }) })
  const request = async (route, body, authorization = 'root') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/platform/${route}`, { method: body ? 'POST' : 'GET', headers: { ...(authorization ? { Authorization: authorization } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, ...(await response.json()) }
  }
  const plan = async () => (await request('plans', { type: 'update', targetReleaseId: releases[1].id, expectedCurrentReleaseId: releases[0].id })).data
  return { root, actor, secret, audits, request, plan, advance: ms => { clock += ms } }
}
test('fresh staff authentication, tenant ownership and safe public metadata', async t => {
  const f = await fixture(t)
  assert.equal((await f.request('overview', null, '')).status, 401)
  assert.equal((await f.request('overview', null, 'customer')).status, 403)
  for (const role of ['ordinary', 'other-tenant']) {
    const result = await f.request('overview', null, role)
    assert.equal(result.data.canManage, false)
    assert.ok(!JSON.stringify(result).includes('private-'))
    assert.equal((await f.request('plans', { type: 'update', targetReleaseId: 'ai-20261021-3', expectedCurrentReleaseId: 'ai-20261021-2' }, role)).status, 403)
  }
  assert.equal((await f.request('overview')).data.canManage, true)
})
test('confirmed operation is signed, audited and idempotent', async t => {
  const f = await fixture(t); const plan = await f.plan()
  assert.equal(fs.readdirSync(path.join(f.root, 'queue')).length, 0)
  const first = await f.request('operations', { token: plan.token })
  const retry = await f.request('operations', { token: plan.token })
  assert.equal(first.status, 201); assert.equal(first.data.id, retry.data.id)
  assert.equal(f.audits.length, 1)
  const envelope = JSON.parse(fs.readFileSync(path.join(f.root, 'queue', `${plan.id}.request.json`)))
  const job = verify(f.secret, 'platform-job', envelope)
  assert.equal(job.target, 'ai-20261021-3'); assert.equal(job.fingerprint, f.actor.fingerprint)
  assert.equal((await f.request(`operations/${plan.id}`)).data.status, 'queued')
  assert.equal((await f.request('plans', { type: 'update', targetReleaseId: 'ai-20261021-3', expectedCurrentReleaseId: 'ai-20261021-2' })).status, 409)
})
test('tampered, expired, revoked and stale plans cannot enqueue', async t => {
  const f = await fixture(t)
  const tampered = await f.plan(); tampered.token.payload += 'x'
  assert.equal((await f.request('operations', { token: tampered.token })).status, 400)
  const revoked = await f.plan(); f.actor.fingerprint = 'revoked'
  assert.equal((await f.request('operations', { token: revoked.token })).status, 403)
  const expired = await f.plan(); f.advance(300001)
  assert.equal((await f.request('operations', { token: expired.token })).status, 409)
  const stale = await f.plan(); fs.appendFileSync(path.join(f.root, 'catalog.json'), ' ')
  assert.equal((await f.request('operations', { token: stale.token })).status, 409)
  assert.equal(fs.readdirSync(path.join(f.root, 'queue')).length, 0)
})
test('no commands, image references, traversal paths or wrong directions are accepted', async t => {
  const f = await fixture(t)
  for (const input of [
    { type: 'rollback', targetReleaseId: 'ai-20261021-3', expectedCurrentReleaseId: 'ai-20261021-2' },
    { type: 'update', targetReleaseId: '../../etc/passwd', expectedCurrentReleaseId: 'ai-20261021-2' },
    { type: 'update', targetReleaseId: 'ai-20261021-3', expectedCurrentReleaseId: 'ai-20261021-2', command: 'arbitrary' }
  ]) assert.equal((await f.request('plans', input)).status, 400)
})
test('audit failure prevents execution and releases the queue', async t => {
  const f = await fixture(t, { failAudit: true }); const plan = await f.plan()
  const result = await f.request('operations', { token: plan.token })
  assert.equal(result.status, 503); assert.ok(!JSON.stringify(result).includes('private failure'))
  assert.equal(fs.readdirSync(path.join(f.root, 'queue')).length, 0)
})
