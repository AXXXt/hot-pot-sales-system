import { Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import { REDIS } from '../redis.provider'

export const SESSION_TTL_SECONDS = 7 * 24 * 3600
const SID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
export type SessionPayload = { sub: number; sid?: string }
export type SessionRedis = {
  get: (key: string) => Promise<string | null>
  set: (...args: any[]) => Promise<unknown>
  eval: (...args: any[]) => Promise<unknown>
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const sessionKey = (userId: number, sid: string) => `auth:session:${userId}:${sid}`
export const legacyRevokedKey = (userId: number) => `auth:legacy-revoked:${userId}`

const rotateScript = `-- auth-session-rotate-v1
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1`
const upgradeScript = `-- auth-session-upgrade-v1
if redis.call('GET', KEYS[1]) ~= ARGV[1] or redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('DEL', KEYS[1])
redis.call('SET', KEYS[2], '1', 'EX', ARGV[3])
redis.call('SET', KEYS[3], ARGV[2], 'EX', ARGV[3])
return 1`
const revokeScript = `-- auth-session-revoke-v1
redis.call('DEL', KEYS[1])
return 1`
const revokeLegacyScript = `-- auth-session-revoke-legacy-v1
redis.call('DEL', KEYS[1])
redis.call('SET', KEYS[2], '1', 'EX', ARGV[1])
return 1`

function validUserId(userId: number) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new UnauthorizedException('登录会话无效，请重新登录')
}
function unavailable() {
  return new ServiceUnavailableException({ message: '登录服务暂不可用，请稍后重试', errorCode: 'AUTH_SESSION_UNAVAILABLE' })
}
function expired() {
  return new UnauthorizedException({ message: '登录会话已失效，请重新登录', errorCode: 'AUTH_3005' })
}

// Shared by ordinary API guards and the independent version-control service.
// Legacy tokens remain readable until their old session logs out or rotates.
export async function assertStoredSession(redis: Pick<SessionRedis, 'get'>, payload: SessionPayload) {
  validUserId(payload.sub)
  if (payload.sid !== undefined && (typeof payload.sid !== 'string' || !SID.test(payload.sid))) throw expired()
  let stored: string | null
  try {
    stored = await redis.get(payload.sid === undefined ? legacyRevokedKey(payload.sub) : sessionKey(payload.sub, payload.sid))
  } catch { throw unavailable() }
  if (payload.sid === undefined ? stored !== null : !stored || !/^[a-f0-9]{64}$/.test(stored)) throw expired()
}

@Injectable()
export class AuthSessionService {
  constructor(@Inject(REDIS) private readonly redis: SessionRedis) {}

  newId() { return randomUUID() }
  assertActive(payload: SessionPayload) { return assertStoredSession(this.redis, payload) }

  async create(userId: number, sid: string, refreshToken: string) {
    validUserId(userId)
    if (!SID.test(sid)) throw expired()
    try {
      const result = await this.redis.set(sessionKey(userId, sid), digest(refreshToken), 'EX', SESSION_TTL_SECONDS)
      if (result !== 'OK') throw unavailable()
    } catch { throw unavailable() }
  }

  async rotate(userId: number, sid: string | undefined, nextSid: string, previous: string, replacement: string) {
    validUserId(userId)
    if (!SID.test(nextSid) || (sid !== undefined && !SID.test(sid))) throw expired()
    let accepted: unknown
    try {
      accepted = sid === undefined
        ? await this.redis.eval(upgradeScript, 3, `refresh:${userId}`, legacyRevokedKey(userId), sessionKey(userId, nextSid), previous, digest(replacement), SESSION_TTL_SECONDS)
        : await this.redis.eval(rotateScript, 1, sessionKey(userId, sid), digest(previous), digest(replacement), SESSION_TTL_SECONDS)
    } catch { throw unavailable() }
    if (accepted !== 0 && accepted !== 1) throw unavailable()
    if (accepted !== 1) throw new UnauthorizedException({ message: '刷新令牌已失效，请重新登录', errorCode: 'AUTH_3003' })
  }

  async revoke(userId: number, sid?: string) {
    validUserId(userId)
    if (sid !== undefined && !SID.test(sid)) throw expired()
    try {
      const result = sid === undefined
        ? await this.redis.eval(revokeLegacyScript, 2, `refresh:${userId}`, legacyRevokedKey(userId), SESSION_TTL_SECONDS)
        : await this.redis.eval(revokeScript, 1, sessionKey(userId, sid))
      if (result !== 1) throw unavailable()
    } catch { throw unavailable() }
  }
}
