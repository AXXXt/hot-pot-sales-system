const assert = require('node:assert/strict')
const https = require('node:https')
const { randomUUID } = require('node:crypto')
const { ConfigService } = require('@nestjs/config')
const { PrismaClient } = require('@prisma/client')
const { productImageClientProvider } = require('./dist/src/upload/product-image-client.provider')
const { ProductImageStorageService } = require('./dist/src/upload/product-image-storage.service')

function request(url, method = 'GET', body, headers = {}) {
  const target = new URL(url)
  const payload = body === undefined ? undefined : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    // Route inside Docker while validating the real certificate, Host and S3 signature.
    const req = https.request({ hostname: 'nginx', port: 443, servername: target.hostname,
      path: target.pathname + target.search, method, headers: { ...headers, Host: target.host,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) }
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }))
    })
    req.setTimeout(15000, () => req.destroy(new Error('HTTPS timeout')))
    req.on('error', reject)
    req.end(payload)
  })
}

async function main() {
  const prisma = new PrismaClient()
  const config = new ConfigService(process.env)
  const client = productImageClientProvider.useFactory(config)
  const storage = new ProductImageStorageService(client, config, prisma)
  const bucket = process.env.MINIO_BUCKET
  const keys = []
  try {
    const admin = await prisma.user.findUnique({ where: { phone: process.env.BOOTSTRAP_ADMIN_PHONE }, select: { userType: true, status: true, userRoles: { select: { roleId: true } } } })
    assert.equal(admin.userType, 'super_admin')
    assert.equal(admin.status, 'active')
    assert.ok(admin.userRoles.length > 0)
    console.log('PASS admin role and status')
    for (const host of ['weiduoxian.cn', 'www.weiduoxian.cn', 'app.weiduoxian.cn', 'admin.weiduoxian.cn']) {
      assert.equal((await request(`https://${host}/`)).status, 200)
      assert.equal((await request(`https://${host}/health`)).status, 200)
    }
    const base = 'https://weiduoxian.cn'
    assert.equal((await request(`${base}/api/docs`)).status, 404)
    assert.equal((await request(`${base}/.env`)).status, 403)
    assert.equal((await request(`${base}/api/v1/auth/profile`)).status, 401)
    assert.equal((await request(`${base}/api/v1/orders`)).status, 401)
    if (process.env.SMS_PROVIDER === 'experience') {
      const { SmsService } = require('./dist/src/auth/sms.service')
      const Redis = require('ioredis')
      const redis = new Redis(process.env.REDIS_URL)
      try {
        const sms = new SmsService(config, redis)
        const phones = process.env.SMS_TEST_PHONES.split(',').map(phone => phone.trim())
        assert.ok(Date.parse(process.env.SMS_TEST_EXPIRES_AT) > Date.now())
        for (const phone of phones) {
          await sms.sendCode(phone, `deployment-smoke-${phone}`)
          assert.equal(await sms.verifyCode(phone, '000000'), false)
          assert.equal(await sms.verifyCode(phone, '123456'), true)
          assert.equal(await sms.verifyCode(phone, '123456'), false)
          await redis.del(`sms:rate:${phone}`, `sms:rate:ip:deployment-smoke-${phone}`, `sms:attempts:${phone}`)
        }
        const deniedPhone = ['13800000000', '13800000001'].find(phone => !phones.includes(phone))
        assert.ok(deniedPhone)
        assert.equal((await request(`${base}/api/v1/auth/send-code`, 'POST', { phone: deniedPhone })).status, 403)
        assert.equal((await request(`${base}/api/v1/auth/login`, 'POST', { phone: deniedPhone, code: '123456' })).status, 403)
        const phone = process.env.BOOTSTRAP_ADMIN_PHONE
        assert.equal((await request(`${base}/api/v1/auth/send-code`, 'POST', { phone })).status, 201)
        const login = await request(`${base}/api/v1/auth/login`, 'POST', { phone, code: '123456' })
        assert.equal(login.status, 201)
        const result = JSON.parse(login.body.toString())
        const data = result.data || result
        assert.ok(data.accessToken)
        const headers = { Authorization: `Bearer ${data.accessToken}` }
        assert.equal((await request(`${base}/api/v1/auth/profile`, 'GET', undefined, headers)).status, 200)
        assert.equal((await request(`${base}/api/v1/auth/logout`, 'POST', {}, headers)).status, 201)
        console.log('PASS experience SMS allowlist, incorrect/reused codes, HTTPS admin login/profile/logout')
      } finally { await redis.quit() }
    } else {
      assert.equal((await request(`${base}/api/v1/auth/send-code`, 'POST', { phone: process.env.BOOTSTRAP_ADMIN_PHONE })).status, 503)
      assert.equal((await request(`${base}/api/v1/auth/login`, 'POST', { phone: process.env.BOOTSTRAP_ADMIN_PHONE, code: '123456' })).status, 401)
      console.log('PASS HTTPS routes, authentication and disabled SMS')
    }
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6NNwAAAAASUVORK5CYII=', 'base64')
    const product = await storage.uploadProductImage(bytes, 'image/png', 'png')
    keys.push(product.objectKey)
    const publicResponse = await request(product.url)
    assert.equal(publicResponse.status, 200)
    assert.deepEqual(publicResponse.body, bytes)
    const proofKey = `payment-proofs/2026/10/${randomUUID()}.png`
    keys.push(proofKey)
    await client.putObject(bucket, proofKey, bytes, bytes.length, { 'Content-Type': 'image/png' })
    const unsigned = `${base}/${bucket}/${proofKey}`
    assert.equal((await request(unsigned)).status, 403)
    const signed = await client.presignedGetObject(bucket, proofKey, 60)
    const privateResponse = await request(signed)
    assert.equal(privateResponse.status, 200)
    assert.deepEqual(privateResponse.body, bytes)
    const tampered = new URL(signed)
    tampered.searchParams.set('X-Amz-Signature', '0'.repeat(64))
    assert.equal((await request(tampered.href)).status, 403)
    console.log('PASS public product image, private payment proof and tamper rejection')
  } finally {
    for (const key of keys) await client.removeObject(bucket, key)
    await prisma.$disconnect()
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
