import { AsyncLocalStorage } from 'node:async_hooks'

export interface AuditRequestContext {
  requestId: string
  ip?: string
  userAgent?: string
  userId?: number
  tenantId?: number
}

export const auditStorage = new AsyncLocalStorage<AuditRequestContext>()

export function getAuditContext(): AuditRequestContext | undefined {
  return auditStorage.getStore()
}

export function setAuditUserId(userId: number): void {
  setAuditIdentity(userId)
}

/** Only authentication code supplies the current database tenant; never a request header. */
export function setAuditIdentity(userId?: number, tenantId?: number): void {
  const ctx = auditStorage.getStore()
  if (!ctx) return
  if (Number.isSafeInteger(userId) && userId! > 0) ctx.userId = userId
  else delete ctx.userId
  if (Number.isSafeInteger(tenantId) && tenantId! > 0) ctx.tenantId = tenantId
  else delete ctx.tenantId
}
