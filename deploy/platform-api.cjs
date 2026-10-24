// Independent release control API. This process has no Docker socket or shell execution.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { randomUUID, createHash, createHmac, timingSafeEqual } = require('node:crypto')
const ID = /^ai-\d{8}-\d+$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const FINAL = new Set(['succeeded', 'failed', 'rolled_back'])
class ApiError extends Error { constructor(status, message) { super(message); this.status = status } }
const fail = (status, message) => { throw new ApiError(status, message) }
async function checkCredentialVersion(prisma, payload) {
  const credentials = await prisma.$queryRaw`SELECT version FROM staff_credentials WHERE user_id = ${Number(payload.sub)}`
  if (Number(payload.cv || 0) !== Number(credentials[0]?.version || 0)) fail(401, '登录已过期，请重新登录')
}
async function checkSession(redis, payload) {
  if (payload.tokenUse !== undefined && payload.tokenUse !== 'access') fail(401, '令牌用途不匹配')
  const userId = Number(payload.sub)
  if (!Number.isSafeInteger(userId) || userId <= 0 || (payload.sid !== undefined && (typeof payload.sid !== 'string' || !UUID.test(payload.sid)))) fail(401, '登录会话无效，请重新登录')
  let stored
  try { stored = await redis.get(payload.sid === undefined ? `auth:legacy-revoked:${userId}` : `auth:session:${userId}:${payload.sid}`) }
  catch { fail(503, '登录服务暂不可用，请稍后重试') }
  if (payload.sid === undefined ? stored !== null : !stored || !/^[a-f0-9]{64}$/.test(stored)) fail(401, '登录会话已失效，请重新登录')
}
function fields(value, allowed) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(400, '请求参数无效') }
function sign(secret, domain, value) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url')
  return { payload, signature: createHmac('sha256', secret).update(`${domain}\n${payload}`).digest('hex') }
}
function verify(secret, domain, envelope) {
  fields(envelope, ['payload', 'signature'])
  if (typeof envelope.payload !== 'string' || envelope.payload.length > 10000 || !/^[a-f0-9]{64}$/.test(envelope.signature || '')) fail(400, '操作凭据无效')
  const expected = createHmac('sha256', secret).update(`${domain}\n${envelope.payload}`).digest()
  if (!timingSafeEqual(expected, Buffer.from(envelope.signature, 'hex'))) fail(400, '操作凭据无效')
  try { return JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8')) } catch { fail(400, '操作凭据无效') }
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }
function atomic(file, value, mode = 0o600) {
  const temporary = `${file}.${randomUUID()}.tmp`
  try { fs.writeFileSync(temporary, JSON.stringify(value), { mode, flag: 'wx' }); fs.renameSync(temporary, file) }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
}
function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0
    req.on('data', chunk => { size += chunk.length; if (size <= 8192) chunks.push(chunk) })
    req.on('end', () => {
      if (size > 8192) return reject(new ApiError(413, '请求内容过大'))
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { reject(new ApiError(400, '请求必须为有效JSON')) }
    })
    req.on('error', reject)
  })
}
function publicRelease(release) {
  return { id: release.id, version: release.version, sequence: release.sequence, title: release.title, notes: release.notes,
    publishedAt: release.publishedAt, ready: release.ready === true, supportsControl: release.supportsControl === true }
}
function publicOperation(job) {
  return Object.fromEntries(['id', 'type', 'source', 'target', 'status', 'phase', 'message', 'createdAt', 'startedAt', 'finishedAt', 'updatedAt', 'backup', 'auditPending'].filter(key => job[key] !== undefined).map(key => [key, job[key]]))
}

function createPlatformServer(options) {
  const { root, secret, authenticate, audit, ownerTenantId = 1, now = Date.now } = options
  if (!Buffer.isBuffer(secret) || secret.length !== 32) throw new Error('Platform signing key must contain 32 bytes')
  const queue = path.join(root, 'queue')
  const lockFile = path.join(queue, 'active.lock')
  function catalog() {
    const bytes = fs.readFileSync(path.join(root, 'catalog.json'))
    const data = JSON.parse(bytes)
    const currentState = readJson(path.join(root, 'current.json'))
    const current = data.releases.find(x => x.id === currentState.id)
    if (!current || !Array.isArray(data.releases) || data.releases.some(x => !ID.test(x.id))) fail(503, '版本信息暂不可用')
    return { data, current, currentState, digest: createHash('sha256').update(bytes).digest('hex') }
  }
  function canManage(actor) { return actor.superAdmin === true && actor.tenantId === ownerTenantId }
  function requireManager(actor) { if (!canManage(actor)) fail(403, '仅平台所属租户的超级管理员可以更新或回滚') }
  function readOperation(id) {
    if (!UUID.test(id)) fail(400, '操作编号无效')
    const completed = path.join(root, 'operations', `${id}.json`)
    if (fs.existsSync(completed)) return readJson(completed)
    for (const suffix of ['request', 'running']) {
      const queued = path.join(queue, `${id}.${suffix}.json`)
      if (fs.existsSync(queued)) return { ...verify(secret, 'platform-job', readJson(queued)), status: 'queued', phase: 'queued', message: '已进入发布队列' }
    }
    return null
  }
  function activeOperation() {
    if (!fs.existsSync(lockFile)) return null
    const active = readJson(lockFile)
    const job = readOperation(active.id)
    return job && !FINAL.has(job.status) ? publicOperation(job) : null
  }
  async function route(req) {
    const url = new URL(req.url, 'http://platform')
    if (url.pathname === '/health' && req.method === 'GET') { catalog(); return { ok: true } }
    const actor = await authenticate(req.headers.authorization)
    if (!actor || actor.userType === 'customer_user') fail(403, '仅运营人员可查看平台版本')
    const manager = canManage(actor)
    if (url.pathname === '/api/v1/platform/overview' && req.method === 'GET') {
      const state = catalog()
      const releases = [...state.data.releases].sort((a, b) => b.sequence - a.sequence)
      return { current: publicRelease(state.current), latest: publicRelease(manager ? releases.find(x => x.ready) || state.current : state.current),
        releases: releases.map(publicRelease), canManage: manager, operation: manager ? activeOperation() : null, changedAt: state.currentState.changedAt }
    }
    requireManager(actor)
    if (url.pathname === '/api/v1/platform/operations' && req.method === 'GET') {
      return fs.readdirSync(path.join(root, 'operations')).filter(name => /^[a-f0-9-]+\.json$/i.test(name)).map(name => readJson(path.join(root, 'operations', name))).filter(job => job.tenantId === actor.tenantId).sort((a, b) => (b.createdAt || b.finishedAt || 0) - (a.createdAt || a.finishedAt || 0)).slice(0, 30).map(publicOperation)
    }
    const operationMatch = url.pathname.match(/^\/api\/v1\/platform\/operations\/([a-f0-9-]+)$/i)
    if (operationMatch && req.method === 'GET') {
      const job = readOperation(operationMatch[1])
      if (!job || job.tenantId !== actor.tenantId) fail(404, '操作记录不存在')
      return publicOperation(job)
    }
    if (url.pathname === '/api/v1/platform/plans' && req.method === 'POST') {
      const input = await body(req); fields(input, ['type', 'targetReleaseId', 'expectedCurrentReleaseId'])
      if (!['update', 'rollback'].includes(input.type) || !ID.test(input.targetReleaseId || '')) fail(400, '请选择已准备的版本')
      if (activeOperation()) fail(409, '已有版本操作正在进行，请等待完成')
      const state = catalog()
      if (state.current.id !== input.expectedCurrentReleaseId) fail(409, '当前版本已变化，请刷新后重新检查')
      const target = state.data.releases.find(x => x.id === input.targetReleaseId)
      if (!target || !target.ready) fail(409, '该版本尚未准备完成')
      if (target.id === state.current.id || (input.type === 'update' ? target.sequence <= state.current.sequence : target.sequence >= state.current.sequence)) fail(400, '版本方向与操作不符')
      const plan = { id: randomUUID(), type: input.type, source: state.current.id, target: target.id, actorId: actor.id, tenantId: actor.tenantId,
        fingerprint: actor.fingerprint, catalogDigest: state.digest, createdAt: now(), expiresAt: now() + 300000 }
      return { token: sign(secret, 'platform-plan', plan), id: plan.id, type: plan.type, from: publicRelease(state.current), target: publicRelease(target), expiresAt: plan.expiresAt,
        notice: '切换管理台和业务接口版本，期间可能短暂重连；业务数据保留，不执行数据库降级。版本管理入口保持可用。' }
    }
    if (url.pathname === '/api/v1/platform/operations' && req.method === 'POST') {
      const input = await body(req); fields(input, ['token'])
      const plan = verify(secret, 'platform-plan', input.token)
      if (!UUID.test(plan.id || '') || plan.actorId !== actor.id || plan.tenantId !== actor.tenantId || plan.fingerprint !== actor.fingerprint) fail(403, '操作确认与当前账号权限不匹配')
      const existing = readOperation(plan.id)
      if (existing) return publicOperation(existing)
      if (plan.expiresAt <= now() || plan.createdAt > now() + 30000) fail(409, '确认已过期，请重新检查版本')
      const state = catalog()
      if (state.current.id !== plan.source || state.digest !== plan.catalogDigest) fail(409, '版本信息已变化，请重新检查')
      const target = state.data.releases.find(x => x.id === plan.target && x.ready)
      if (!target) fail(409, '目标版本不再可用')
      let descriptor
      try { descriptor = fs.openSync(lockFile, 'wx', 0o600) } catch (error) { if (error.code === 'EEXIST') fail(409, '已有版本操作正在进行'); throw error }
      fs.writeFileSync(descriptor, JSON.stringify({ id: plan.id })); fs.closeSync(descriptor)
      const temporary = path.join(queue, `${plan.id}.pending.json`)
      try {
        const job = { ...plan, status: 'queued', phase: 'queued', message: '等待安全发布任务启动' }
        atomic(temporary, sign(secret, 'platform-job', job))
        await audit({ id: plan.id, actorId: actor.id, tenantId: actor.tenantId, type: plan.type, source: plan.source, target: plan.target, status: 'queued' })
        fs.renameSync(temporary, path.join(queue, `${plan.id}.request.json`))
        return publicOperation(job)
      } catch (error) {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
        if (fs.existsSync(lockFile) && readJson(lockFile).id === plan.id) fs.unlinkSync(lockFile)
        throw error
      }
    }
    fail(404, '接口不存在')
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff')
    try { const data = await route(req); res.writeHead(req.method === 'POST' ? 201 : 200); res.end(JSON.stringify({ code: 0, data })) }
    catch (error) {
      const status = error.status || (typeof error.getStatus === 'function' ? error.getStatus() : 503)
      res.writeHead(status); res.end(JSON.stringify({ code: status, message: error instanceof ApiError ? error.message : status === 401 ? '请重新登录' : status === 403 ? '当前账号无权操作' : '版本服务暂不可用，请稍后重试' }))
    }
  })
  server.requestTimeout = 30000
  return server
}

async function runtime() {
  const { PrismaClient } = require('@prisma/client')
  const { JwtService } = require('@nestjs/jwt')
  const { StaffAccessService } = require('./dist/src/auth/staff-access.service')
  const database = new URL(process.env.DATABASE_URL)
  database.searchParams.set('connection_limit', '2')
  const prisma = new PrismaClient({ datasources: { db: { url: database.toString() } } })
  const access = new StaffAccessService(prisma)
  const ownerTenantId = Number(process.env.PLATFORM_OWNER_TENANT_ID || 1)
  const jwt = new JwtService()
  const Redis = require('ioredis')
  // Use the same protected store as the ordinary API; never cache positive authorization.
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL required for session validation')
  const redis = new Redis(process.env.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1, retryStrategy: times => Math.min(times * 200, 3000) })
  redis.on('error', () => {}) // Connection errors may contain credentials; HTTP returns a fixed safe 503.
  const authenticate = async authorization => {
    if (!authorization?.startsWith('Bearer ')) fail(401, '请先登录')
    let payload
    try { payload = jwt.verify(authorization.slice(7), { secret: process.env.JWT_ACCESS_SECRET }) } catch { fail(401, '登录已过期') }
    await checkCredentialVersion(prisma, payload)
    await checkSession(redis, payload)
    const actor = await access.actor(Number(payload.sub))
    if (actor.tenantId !== payload.tenantId) fail(403, '账号租户不匹配')
    return actor
  }
  const audit = async job => {
    if (!UUID.test(job.id || '') || !Number.isSafeInteger(job.actorId) || job.tenantId !== ownerTenantId) throw new Error('Invalid audit record')
    const requestId = `platform-${job.status === 'queued' ? 'request' : 'result'}-${job.id}`
    if (await prisma.auditLog.findFirst({ where: { tenantId: job.tenantId, requestId }, select: { id: true } })) return
    await prisma.auditLog.create({ data: { tenantId: job.tenantId, operatorId: job.actorId, action: job.status === 'queued' ? 'create' : 'update', module: 'platform', targetType: 'platform_operation', targetId: job.id, requestId,
      afterData: { type: job.type, source: job.source, target: job.target, status: job.status, message: job.message || '' } } })
  }
  const mode = process.argv[2]
  if (mode) {
    try {
      if (mode === 'schema') console.log(JSON.stringify(await prisma.$queryRawUnsafe('SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')))
      else {
        const job = JSON.parse(fs.readFileSync(0, 'utf8'))
        if (mode === 'authorize') {
          const actor = await access.actor(job.actorId)
          console.log(JSON.stringify({ allowed: actor.superAdmin && actor.tenantId === ownerTenantId && actor.tenantId === job.tenantId && actor.fingerprint === job.fingerprint }))
        } else if (mode === 'audit') { await audit(job); console.log('{"ok":true}') }
        else throw new Error('Unsupported mode')
      }
    } finally { redis.disconnect(); await prisma.$disconnect() }
    return
  }
  const secret = Buffer.from(process.env.PLATFORM_COMMAND_KEY || '', 'base64')
  const server = createPlatformServer({ root: process.env.PLATFORM_STATE_PATH || '/platform', secret, ownerTenantId, authenticate, audit })
  server.listen(Number(process.env.PORT || 3001), '0.0.0.0', () => console.log('Platform version control API ready'))
  const stop = () => server.close(async () => { redis.disconnect(); await prisma.$disconnect(); process.exit(0) })
  process.on('SIGTERM', stop); process.on('SIGINT', stop)
}
if (require.main === module) runtime().catch(error => { console.error(`PLATFORM_SERVICE_FAILED: ${error.name}`); process.exitCode = 1 })
module.exports = { createPlatformServer, sign, verify, publicRelease, ApiError, checkCredentialVersion, checkSession }
