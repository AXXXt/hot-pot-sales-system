import { AsyncLocalStorage } from 'node:async_hooks'

export interface AuditRequestContext {
  requestId: string
  ip?: string
  userAgent?: string
  userId?: number
}

export const auditStorage = new AsyncLocalStorage<AuditRequestContext>()

export function getAuditContext(): AuditRequestContext | undefined {
  return auditStorage.getStore()
}

export function setAuditUserId(userId: number): void {
  const ctx = auditStorage.getStore()
  if (ctx) ctx.userId = userId
}