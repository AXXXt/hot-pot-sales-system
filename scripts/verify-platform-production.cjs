// Maintenance verification. Access tokens stay in memory and never enter argv, logs or files.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const sshArgs = ['-i', 'C:/Users/26381/Downloads/codex_sdk.pem', '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'ubuntu@152.136.138.118', 'sudo docker compose --project-directory /opt/weiduoxian exec -T backend node']
function remote(code) { return JSON.parse(execFileSync('ssh', sshArgs, { input: code, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()) }
async function main() {
  const credentials = remote(`const{PrismaClient}=require('@prisma/client');const{JwtService}=require('@nestjs/jwt');const p=new PrismaClient();(async()=>{try{const u=await p.user.findMany({where:{tenantId:1,userType:'super_admin',status:'active'},select:{id:true,tenantId:true}});if(u.length!==1)throw Error('Unique existing operator required');const actor=u[0];const token=new JwtService().sign({sub:actor.id,tenantId:actor.tenantId},{secret:process.env.JWT_ACCESS_SECRET,expiresIn:'5m'});console.log(JSON.stringify({token,actor}));}finally{await p.$disconnect()}})().catch(()=>{console.error('Maintenance authentication failed');process.exitCode=1})`)
  async function api(route, body) {
    const response = await fetch('https://admin.weiduoxian.cn/api/v1/platform/' + route, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + credentials.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) })
    const result = await response.json(); if (!response.ok) throw new Error(`Platform request failed (${response.status}): ${result.message}`)
    return result.data
  }
  const state = await api('overview'); assert.equal(state.canManage, true)
  console.log(JSON.stringify({ current: state.current.id, version: state.current.version, prepared: state.releases.map(x => ({ id: x.id, version: x.version, ready: x.ready })) }))
  if (process.argv[2] === 'update') {
    assert.equal(state.current.id, 'ai-20261021-2')
    const plan = await api('plans', { type: 'update', targetReleaseId: 'ai-20261021-3', expectedCurrentReleaseId: state.current.id })
    assert.equal(plan.from.version, '1.1.0'); assert.equal(plan.target.version, '1.2.0')
    const operation = await api('operations', { token: plan.token }); let phase = ''
    console.log(JSON.stringify({ operationId: operation.id, from: plan.from.version, to: plan.target.version }))
    for (let attempt = 0; attempt < 80; attempt++) {
      const job = await api('operations/' + operation.id)
      if (phase !== job.phase) { console.log(JSON.stringify({ status: job.status, phase: job.phase, message: job.message, backup: job.backup })); phase = job.phase }
      if (['succeeded', 'failed', 'rolled_back'].includes(job.status)) { assert.equal(job.status, 'succeeded'); assert.equal((await api('overview')).current.id, 'ai-20261021-3'); return }
      await new Promise(resolve => setTimeout(resolve, 3000))
    }
    throw new Error('Version operation is still active; inspect the existing operation before retrying')
  }
  if (!['verify', 'browser'].includes(process.argv[2])) return
  assert.equal(state.current.id, 'ai-20261021-3')
  for (const [site, prefix, manifestName] of process.argv[2] === 'browser' ? [] : [['admin', '', 'admin-manifest.json'], ['platform', '/platform-control', 'platform-manifest.json']]) {
    const manifest = JSON.parse(fs.readFileSync(path.resolve('deploy/.work/ai-20261021-3', manifestName)))
    for (const item of manifest.files) {
      const route = site === 'platform' && item.path === 'platform.html' ? '/platform-updates' : `${prefix}/${item.path}`
      const response = await fetch('https://admin.weiduoxian.cn' + route, { signal: AbortSignal.timeout(20000) }); assert.equal(response.status, 200)
      if (route === '/platform-updates') assert.match(response.headers.get('content-type') || '', /^text\/html/)
      assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), item.sha256)
    }
    console.log(JSON.stringify({ site, verifiedAssets: manifest.files.length }))
  }
  const anonymous = await fetch('https://admin.weiduoxian.cn/api/v1/platform/overview'); assert.equal(anonymous.status, 401)
  const otherHost = await fetch('https://app.weiduoxian.cn/api/v1/platform/overview'); assert.equal(otherHost.status, 404)
  const { chromium, expect } = require('../admin-web/node_modules/@playwright/test')
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(token => localStorage.setItem('accessToken', token), credentials.token)
  const attachments = []; const errors = []; const page = await context.newPage()
  page.on('pageerror', e => errors.push(e.message))
  page.on('response', async response => { if (response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/admin/ai/attachments') && response.ok()) { const body = await response.json(); attachments.push(body.data.id) } })
  try {
    await page.goto('https://admin.weiduoxian.cn/dashboard')
    await expect(page.getByRole('button', { name: '查看平台版本与更新' })).toContainText('v1.2.0')
    await page.getByRole('button', { name: '打开AI运营助手' }).click()
    const prompt = page.getByRole('textbox', { name: '向AI运营助手描述需求' }); await prompt.fill('识别这个包装商品，先核对资料')
    const bytes = fs.readFileSync(path.resolve('deploy/.work/ai-20261021-2/release-test.jpg')).toString('base64')
    const dataTransfer = await page.evaluateHandle(encoded => { const value = new DataTransfer(); value.items.add(new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], 'release-check.jpg', { type: 'image/jpeg' })); return value }, bytes)
    await prompt.dispatchEvent('dragenter', { dataTransfer }); await expect(page.getByText('松开即可添加包装照片')).toBeVisible()
    await prompt.dispatchEvent('drop', { dataTransfer })
    await expect(page.getByRole('img', { name: '待识别包装照片1' })).toBeVisible()
    await expect(prompt).toHaveValue('识别这个包装商品，先核对资料')
    await page.getByRole('menuitem', { name: '商品管理', exact: true }).click()
    await expect(page).toHaveURL(/\/products$/)
    await expect(page.getByRole('img', { name: '待识别包装照片1' })).toBeVisible()
    fs.mkdirSync(path.resolve('deploy/.work/screenshots'), { recursive: true })
    await page.screenshot({ path: path.resolve('deploy/.work/screenshots/ai-20261021-3-drop.png'), fullPage: true })
    const releasePage = await context.newPage(); let executions = 0
    releasePage.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/platform/operations')) executions++ })
    await releasePage.goto('https://admin.weiduoxian.cn/platform-updates')
    await expect(releasePage.getByRole('heading', { name: '版本与功能更新' })).toBeVisible()
    await expect(releasePage.getByRole('button', { name: '回滚到此版本' })).toBeEnabled()
    await releasePage.getByRole('button', { name: '回滚到此版本' }).click()
    await expect(releasePage.getByRole('dialog')).toContainText('v1.1.0')
    await releasePage.getByRole('button', { name: '返回检查' }).click(); await expect(releasePage.getByRole('dialog')).toHaveCount(0); assert.equal(executions, 0)
    await releasePage.screenshot({ path: path.resolve('deploy/.work/screenshots/ai-20261021-3-platform.png'), fullPage: true })
    assert.equal(errors.length, 0); assert.equal(attachments.length, 1)
    console.log(JSON.stringify({ productionBrowser: 'passed', privatePhotoDrop: true, crossPagePreserved: true, rollbackPreview: true, rollbackExecuted: false, pageErrors: errors.length }))
  } finally {
    await context.close(); await browser.close()
    // Delete only attachments created by this verification, with both tenant and owner predicates.
    if (attachments.length) {
      const result = remote(`const{PrismaClient}=require('@prisma/client');const{ConfigService}=require('@nestjs/config');const{ProductImageStorageService}=require('./dist/src/upload/product-image-storage.service');const p=new PrismaClient();(async()=>{try{const ids=${JSON.stringify(attachments)},actor=${JSON.stringify(credentials.actor)};const rows=await p.aiAttachment.findMany({where:{id:{in:ids},tenantId:actor.tenantId,ownerId:actor.id}});const config=new ConfigService(process.env);const{productImageClientProvider}=require('./dist/src/upload/product-image-client.provider');const s=new ProductImageStorageService(productImageClientProvider.useFactory(config),config,p);for(const row of rows){await s.removeAiImage(row.objectKey);await p.aiAttachment.delete({where:{id:row.id}})}console.log(JSON.stringify({removedVerificationAttachments:rows.length}));}finally{await p.$disconnect()}})().catch(()=>{console.error('Verification attachment cleanup failed');process.exitCode=1})`)
      console.log(JSON.stringify(result))
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
