import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { AuthService } from '../src/auth/auth.service'
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../src/auth/auth.guard'
import { AuthSessionService, legacyRevokedKey, sessionKey } from '../src/auth/auth-session.service'
import { sessionMemory } from './helpers/session-memory'

function fixture() {
  const { values, redis } = sessionMemory()
  const secret = randomUUID(), jwt = new JwtService()
  const config = new ConfigService({ JWT_ACCESS_SECRET: secret, JWT_REFRESH_SECRET: secret })
  const user = { id: 7, tenantId: 3, phone: 'fixture', status: 'active', tenant: { status: 'active' }, customer: null, staffCredential: null }
  const db = { user: { findUnique: jest.fn(async () => user), update: jest.fn(async () => user) } }
  const sessions = new AuthSessionService(redis)
  const auth = new AuthService(db as any, jwt, config, {} as any, {} as any, redis, sessions)
  const guard = new JwtAuthGuard(jwt, config, db as any, sessions)
  const context = (token: string) => ({ switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }) }) as any
  return { values, redis, jwt, config, db, user, sessions, auth, guard, context }
}

it('revokes access and refresh immediately for only the current login session', async () => {
  const { auth, guard, context, jwt } = fixture()
  const first = await auth.generateTokens(fixture().user, false)
  const second = await auth.generateTokens(fixture().user, false)
  const sid = jwt.decode(first.accessToken).sid
  await expect(guard.canActivate(context(first.accessToken))).resolves.toBe(true)
  await auth.logout(7, sid)
  await expect(guard.canActivate(context(first.accessToken))).rejects.toMatchObject({ status: 401 })
  await expect(auth.refreshToken(first.refreshToken)).rejects.toMatchObject({ status: 401 })
  await expect(guard.canActivate(context(second.accessToken))).resolves.toBe(true)
  await expect(auth.refreshToken(second.refreshToken)).resolves.toHaveProperty('accessToken')
})

it('atomically accepts just one simultaneous refresh and rejects the consumed token', async () => {
  const { auth } = fixture()
  const login = await auth.generateTokens(fixture().user, false)
  const results = await Promise.allSettled([auth.refreshToken(login.refreshToken), auth.refreshToken(login.refreshToken)])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  await expect(auth.refreshToken(login.refreshToken)).rejects.toMatchObject({ status: 401 })
})

it('cannot resurrect a revoked session when refresh and logout interleave', async () => {
  const { auth, jwt, guard, context } = fixture()
  const login = await auth.generateTokens(fixture().user, false)
  const sid = jwt.decode(login.accessToken).sid
  const results = await Promise.allSettled([auth.refreshToken(login.refreshToken), auth.logout(7, sid)])
  expect(results[1].status).toBe('fulfilled')
  await expect(guard.canActivate(context(login.accessToken))).rejects.toMatchObject({ status: 401 })
  if (results[0].status === 'fulfilled') {
    await expect(guard.canActivate(context(results[0].value.accessToken))).rejects.toMatchObject({ status: 401 })
    await expect(auth.refreshToken(results[0].value.refreshToken)).rejects.toMatchObject({ status: 401 })
  }
})

it('upgrades an existing refresh and invalidates its old legacy access', async () => {
  const { auth, jwt, config, values, guard, context } = fixture()
  const payload = { sub: 7, tenantId: 3, phone: 'fixture', cv: 0 }
  const oldAccess = jwt.sign(payload, { secret: config.get('JWT_ACCESS_SECRET'), expiresIn: '15m' })
  const oldRefresh = jwt.sign(payload, { secret: config.get('JWT_REFRESH_SECRET'), expiresIn: '7d' })
  values.set('refresh:7', oldRefresh)
  await expect(guard.canActivate(context(oldAccess))).resolves.toBe(true)
  const replacement = await auth.refreshToken(oldRefresh)
  expect(jwt.decode(replacement.accessToken).sid).toMatch(/^[a-f0-9-]{36}$/)
  expect(values.get(legacyRevokedKey(7))).toBe('1')
  await expect(guard.canActivate(context(oldAccess))).rejects.toMatchObject({ status: 401 })
  await expect(guard.canActivate(context(replacement.accessToken))).resolves.toBe(true)
  await expect(auth.refreshToken(oldRefresh)).rejects.toMatchObject({ status: 401 })
})

it('revokes legacy access immediately but preserves a new independent device', async () => {
  const { auth, jwt, config, values, guard, context } = fixture()
  const legacy = jwt.sign({ sub: 7, tenantId: 3 }, { secret: config.get('JWT_ACCESS_SECRET'), expiresIn: '15m' })
  values.set('refresh:7', 'old-refresh')
  const modern = await auth.generateTokens(fixture().user, false)
  await auth.logout(7)
  expect(values.has('refresh:7')).toBe(false)
  await expect(guard.canActivate(context(legacy))).rejects.toMatchObject({ status: 401 })
  await expect(guard.canActivate(context(modern.accessToken))).resolves.toBe(true)
})

it('fails closed on Redis read, create, rotate or revoke errors without leaking private errors', async () => {
  const { auth, jwt, redis, guard, context } = fixture()
  const login = await auth.generateTokens(fixture().user, false)
  redis.get.mockRejectedValue(new Error('private connection'))
  await expect(guard.canActivate(context(login.accessToken))).rejects.toMatchObject({ status: 503, response: { errorCode: 'AUTH_SESSION_UNAVAILABLE' } })
  redis.set.mockRejectedValue(new Error('private connection'))
  await expect(auth.generateTokens(fixture().user, false)).rejects.toMatchObject({ status: 503 })
  redis.eval.mockRejectedValue(new Error('private connection'))
  await expect(auth.refreshToken(login.refreshToken)).rejects.toMatchObject({ status: 503 })
  await expect(auth.logout(7, jwt.decode(login.accessToken).sid)).rejects.toMatchObject({ status: 503 })
})

it('rejects corrupt session entries and missing modern sessions', async () => {
  const { auth, jwt, values, guard, context } = fixture()
  const login = await auth.generateTokens(fixture().user, false)
  values.set(sessionKey(7, jwt.decode(login.accessToken).sid), 'corrupt')
  await expect(guard.canActivate(context(login.accessToken))).rejects.toMatchObject({ status: 401 })
})

it('does not treat a registration ticket or refresh token as an access token even with shared test secrets', async () => {
  const { jwt, config, guard, context, auth } = fixture()
  for (const tokenUse of ['registration_status', 'refresh']) {
    const token = jwt.sign({ sub: 7, tenantId: 3, tokenUse }, { secret: config.get('JWT_ACCESS_SECRET'), expiresIn: '15m' })
    await expect(guard.canActivate(context(token))).rejects.toMatchObject({ status: 401 })
    if (tokenUse === 'registration_status') await expect(auth.refreshToken(token)).rejects.toMatchObject({ status: 401 })
  }
})

it('still checks the optional bearer session but permits genuinely anonymous catalog reads', async () => {
  const { auth, jwt, config, db, sessions, context } = fixture()
  const guard = new OptionalJwtAuthGuard(jwt, config, db as any, sessions)
  await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }) } as any)).resolves.toBe(true)
  const login = await auth.generateTokens(fixture().user, false)
  await auth.logout(7, jwt.decode(login.accessToken).sid)
  await expect(guard.canActivate(context(login.accessToken))).rejects.toMatchObject({ status: 401 })
})

it('rejects active tokens on the next request after user or customer disablement', async () => {
  const { auth, user, guard, context } = fixture()
  const login = await auth.generateTokens(user, false)
  user.status = 'disabled'
  await expect(guard.canActivate(context(login.accessToken))).rejects.toMatchObject({ status: 401 })
  user.status = 'active'
  ;(user as any).customer = { status: 'disabled', tenantId: 3 }
  await expect(guard.canActivate(context(login.accessToken))).rejects.toMatchObject({ status: 401 })
})
