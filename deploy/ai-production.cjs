// Run inside the release image. Secrets enter through stdin or the root-only server .env.
const fs = require('node:fs')
const https = require('node:https')
const assert = require('node:assert/strict')
const { randomBytes, randomUUID, createHash } = require('node:crypto')

function replaceEnv(text, name, value) {
  const pattern = new RegExp(`^${name}=.*$`, 'm')
  return pattern.test(text) ? text.replace(pattern, `${name}=${value}`) : `${text.trimEnd()}\n${name}=${value}\n`
}

function atomic(file, text, mode) {
  const temporary = `${file}.ai-${randomBytes(6).toString('hex')}`
  try { fs.writeFileSync(temporary, text, { mode, flag: 'wx' }); fs.renameSync(temporary, file) }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
}

function prepare(release) {
  assert.match(release, /^ai-\d{8}-\d+$/)
  const file = '/deployment/.env'
  let text = fs.readFileSync(file, 'utf8')
  const current = text.match(/^AI_ENCRYPTION_KEY=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  if (current) assert.equal(Buffer.from(current, 'base64').length, 32, 'Existing AI encryption key must be valid')
  text = replaceEnv(text, 'AI_ENCRYPTION_KEY', current || randomBytes(32).toString('base64'))
  text = replaceEnv(text, 'RELEASE_TAG', release)
  let compose = fs.readFileSync('/deployment/compose.yml', 'utf8')
  if (!compose.includes('AI_ENCRYPTION_KEY:')) {
    const marker = '      CORS_ORIGIN:'
    assert.ok(compose.includes(marker), 'Expected existing backend environment block')
    compose = compose.replace(marker, '      AI_ENCRYPTION_KEY: ${AI_ENCRYPTION_KEY:?required}\n' + marker)
  }
  const apiFile = '/deployment/nginx/api.inc'
  let api = fs.readFileSync(apiFile, 'utf8')
  if (!api.includes('location ^~ /api/v1/admin/ai/')) api = `# AI operations SSE: emit progress immediately and preserve the existing business routes.
location ^~ /api/v1/admin/ai/ {
    limit_req zone=api burst=40 nodelay;
    proxy_pass http://backend:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 90s;
}
${api}`
  atomic(file, text, 0o600)
  atomic('/deployment/compose.yml', compose, 0o644)
  // nginx bind-mounts this individual file: retain its inode for a graceful reload.
  fs.writeFileSync(apiFile, api, { mode: 0o644 })
  fs.chmodSync(apiFile, 0o644)
  console.log('Production release tag, independent encryption key and SSE proxy prepared; existing settings preserved')
}

function restoreEnv(release) {
  assert.match(release, /^ai-\d{8}-\d+$/)
  const current = fs.readFileSync('/deployment/.env', 'utf8').match(/^AI_ENCRYPTION_KEY=(.*)$/m)?.[1]
  let previous = fs.readFileSync(`/deployment/.release-backups/${release}/.env`, 'utf8')
  // Retain the new key across a rollback so future releases can read stored AI configuration.
  if (current) previous = replaceEnv(previous, 'AI_ENCRYPTION_KEY', current)
  atomic('/deployment/.env', previous, 0o600)
}

function services() {
  const { PrismaClient } = require('@prisma/client')
  const { ConfigService } = require('@nestjs/config')
  const { StaffAccessService } = require('./dist/src/auth/staff-access.service')
  const { AiSettingsService } = require('./dist/src/ai/ai-settings.service')
  const prisma = new PrismaClient()
  const access = new StaffAccessService(prisma)
  const settings = new AiSettingsService(prisma, new ConfigService(process.env), access)
  return { prisma, access, settings }
}

async function administrator(prisma, access) {
  const users = await prisma.user.findMany({ where: { userType: 'super_admin', status: 'active', tenant: { status: 'active' } }, select: { id: true } })
  assert.equal(users.length, 1, 'Select a unique existing production administrator; never create or promote an account')
  return access.actor(users[0].id)
}

async function configure() {
  const apiKey = fs.readFileSync(0, 'utf8').trim()
  assert.ok(/^sk-[A-Za-z0-9_-]+$/.test(apiKey), 'Expected a provider credential on stdin')
  const { prisma, access, settings } = services()
  try {
    const actor = await administrator(prisma, access)
    const previous = await settings.configFor(actor.tenantId)
    assert.ok(!previous, 'Refusing to overwrite an existing production AI configuration')
    const result = await settings.save(actor, { enabled: true, baseUrl: 'https://api.deepseek.com/v1', textModel: 'deepseek-flash', visionModel: 'deepseek-flash', apiKey,
      allowWrites: true, dailyRequests: 100, features: { products: true, vision: true, analytics: true, tasks: true } })
    assert.ok(result.hasKey && result.encryptionReady)
    assert.ok(!JSON.stringify(result).includes(apiKey), 'Configuration must not return the credential')
    console.log(JSON.stringify({ enabled: result.enabled, model: result.textModel, vision: result.visionModel, encrypted: true, explicitConfirmationRequired: true, dailyRequests: result.dailyRequests }))
  } finally { await prisma.$disconnect() }
}

function request(route, method = 'GET', body, headers = {}) {
  const payload = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'nginx', port: 443, servername: 'admin.weiduoxian.cn', path: route, method,
      headers: { Host: 'admin.weiduoxian.cn', ...headers, ...(payload ? { 'Content-Type': headers['Content-Type'] || 'application/json', 'Content-Length': payload.length } : {}) } }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.setTimeout(90000, () => req.destroy(new Error('Production HTTPS timeout')))
    req.on('error', reject)
    req.end(payload)
  })
}

async function verify() {
  const { prisma, access, settings } = services()
  const conversations = []
  const attachments = []
  const { ConfigService } = require('@nestjs/config')
  const { productImageClientProvider } = require('./dist/src/upload/product-image-client.provider')
  const { ProductImageStorageService } = require('./dist/src/upload/product-image-storage.service')
  const config = new ConfigService(process.env)
  const storage = new ProductImageStorageService(productImageClientProvider.useFactory(config), config, prisma)
  let actor
  const prefix = '/api/v1/admin/ai'
  try {
    actor = await administrator(prisma, access)
    const { JwtService } = require('@nestjs/jwt')
    // Short-lived maintenance credential stays in this process and is never logged or exported.
    const jwt = new JwtService()
    const headers = { Authorization: `Bearer ${jwt.sign({ sub: actor.id, tenantId: actor.tenantId }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '5m' })}` }
    const counts = async () => ({ products: await prisma.product.count({ where: { tenantId: actor.tenantId } }), orders: await prisma.order.count({ where: { tenantId: actor.tenantId } }), tasks: await prisma.opsTask.count({ where: { tenantId: actor.tenantId } }) })
    const before = await counts()
    assert.equal((await fetch('http://localhost:3000/health/ready')).status, 200)
    assert.equal((await request('/health')).status, 200)
    assert.equal((await request(`${prefix}/capabilities`)).status, 401)
    assert.equal((await request('/api/v1/orders')).status, 401)
    const manifest = JSON.parse(fs.readFileSync('/app/ai-admin-manifest.json', 'utf8'))
    for (let offset = 0; offset < manifest.files.length; offset += 5) {
      await Promise.all(manifest.files.slice(offset, offset + 5).map(async file => {
        const asset = await request(`/${file.path}`)
        assert.equal(asset.status, 200, `Missing production asset: ${file.path}`)
        assert.equal(createHash('sha256').update(asset.body).digest('hex'), file.sha256, `Production asset differs: ${file.path}`)
      }))
    }
    console.log(`PASS all ${manifest.files.length} production admin files match the release SHA-256 manifest`)
    const mismatched = { Authorization: `Bearer ${jwt.sign({ sub: actor.id, tenantId: actor.tenantId + 999 }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '1m' })}` }
    assert.equal((await request(`${prefix}/capabilities`, 'GET', undefined, mismatched)).status, 403)
    const publicSettings = await request(`${prefix}/settings`, 'GET', undefined, headers)
    assert.equal(publicSettings.status, 200)
    const saved = JSON.parse(publicSettings.body).data
    assert.ok(saved.enabled && saved.hasKey && saved.encryptionReady)
    assert.ok(!('apiKey' in saved) && !('encryptedKey' in saved))
    const profile = await request('/api/v1/auth/profile', 'GET', undefined, headers)
    assert.equal(profile.status, 200)
    const dashboard = await request('/api/v1/dashboard/stats', 'GET', undefined, headers)
    assert.equal(dashboard.status, 200)
    console.log('PASS production readiness, HTTPS, profile, dashboard, missing authentication and tenant mismatch')

    const connection = await request(`${prefix}/settings/test`, 'POST', {}, headers)
    assert.equal(connection.status, 201)
    assert.equal(JSON.parse(connection.body).data.ok, true)
    async function run(input) {
      const created = await request(`${prefix}/conversations`, 'POST', {}, headers)
      assert.equal(created.status, 201)
      const conversation = JSON.parse(created.body).data
      conversations.push(conversation.id)
      const response = await request(`${prefix}/conversations/${conversation.id}/runs`, 'POST', input, headers)
      assert.equal(response.status, 201)
      assert.match(response.headers['content-type'], /text\/event-stream/)
      const events = response.body.toString().split(/\r?\n\r?\n/).map(value => {
        const type = value.match(/^event: (.+)$/m)?.[1]
        const data = value.match(/^data: (.+)$/m)?.[1]
        return type && data ? { type, data: JSON.parse(data) } : null
      }).filter(Boolean)
      assert.ok(events.some(x => x.type === 'progress'))
      assert.ok(!events.some(x => x.type === 'error'), 'Expected successful production assistant request')
      return events.find(x => x.type === 'result')?.data?.message?.cards || []
    }
    const metrics = await run({ kind: 'metrics', period: 'week', text: '发布验证：查询本周经营统计' })
    assert.ok(metrics.some(x => x.type === 'metrics' && /^\d+\.\d{2}$/.test(x.amount)))
    const suffix = randomUUID().slice(0, 8)
    const brandName = `发布核验品牌${suffix}`
    const categoryName = `发布核验分类${suffix}`
    const textDrafts = await run({ kind: 'product', text: `发布验证：为肥牛卷生成商品草稿，品牌“${brandName}”、分类“${categoryName}”均为待新建，规格500g×20袋/箱，销售单价298元/箱，2箱起订。请在同一草稿里填写新品牌分类名称。只生成草稿，禁止正式创建。` })
    assert.ok(textDrafts.some(x => x.type === 'draft' && x.action === 'product.create' && Number(x.payload.skus[0].basePrice) === 298 && x.payload.brandName === brandName && x.payload.categoryName === categoryName && !x.payload.brandId && !x.payload.categoryId && !x.missing.length))
    console.log('PASS production model, statistics and new brand/category product draft through HTTPS SSE')

    // Use a pre-rendered fixture: the lean production image intentionally has no font stack.
    // The upload endpoint still exercises native sharp decoding, validation and sanitization.
    const image = fs.readFileSync('/app/ai-release-test.jpg')
    const boundary = `ai-release-${randomUUID()}`
    const multipart = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="release-test.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), image, Buffer.from(`\r\n--${boundary}--\r\n`)])
    const uploaded = await request(`${prefix}/attachments`, 'POST', multipart, { ...headers, 'Content-Type': `multipart/form-data; boundary=${boundary}` })
    assert.equal(uploaded.status, 201)
    const photo = JSON.parse(uploaded.body).data
    attachments.push(photo.id)
    const privateFile = await prisma.aiAttachment.findUnique({ where: { id: photo.id } })
    assert.equal((await fetch(`http://minio:9000/${process.env.MINIO_BUCKET}-ai-private/${privateFile.objectKey}`)).status, 403)
    assert.equal((await request(`${prefix}/attachments/${photo.id}`)).status, 401)
    const photoDrafts = await run({ kind: 'product', text: '发布验证：根据照片生成中文商品草稿，规格、售价和起订量以照片为准。品牌分类不明确留空。只生成草稿。', attachmentIds: [photo.id] })
    assert.ok(photoDrafts.some(x => x.type === 'draft' && Number(x.payload.skus[0].basePrice) === 298 && /500\s*g/i.test(x.payload.skus[0].specText)))
    assert.deepEqual(await counts(), before, 'Deployment validation must not create products, orders or tasks')
    const encrypted = await settings.configFor(actor.tenantId)
    assert.ok(encrypted.encryptedKey && encrypted.encryptedKey.split('.').length === 3)
    console.log('PASS Linux image processing, private photo storage, real vision draft and unchanged business counts')
  } finally {
    if (actor) {
      const where = { tenantId: actor.tenantId, ownerId: actor.id, conversationId: { in: conversations } }
      await prisma.aiActionDraft.deleteMany({ where })
      await prisma.aiMessage.deleteMany({ where })
      await prisma.aiConversation.deleteMany({ where: { tenantId: actor.tenantId, ownerId: actor.id, id: { in: conversations } } })
      for (const id of attachments) {
        const photo = await prisma.aiAttachment.findFirst({ where: { id, tenantId: actor.tenantId, ownerId: actor.id } })
        if (photo) { await storage.removeAiImage(photo.objectKey); await prisma.aiAttachment.delete({ where: { id } }) }
      }
      console.log('PASS release-only conversations, drafts and private photos removed; usage records retained')
    }
    await prisma.$disconnect()
  }
}

async function main() {
  const mode = process.argv[2]
  if (mode === 'prepare') prepare(process.argv[3])
  else if (mode === 'restore-env') restoreEnv(process.argv[3])
  else if (mode === 'configure') await configure()
  else if (mode === 'verify') await verify()
  else throw new Error('Expected prepare, restore-env, configure or verify')
}
main().catch(error => { console.error(`AI_PRODUCTION_FAILED: ${error.name}: ${String(error.message).replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')}`); process.exitCode = 1 })
