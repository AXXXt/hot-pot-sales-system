import { randomUUID } from 'crypto'
import { NextFunction, Request, Response } from 'express'
import { auditStorage } from './audit/audit-context'

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const headerId = req.header('x-request-id')
  const requestId = headerId && /^[A-Za-z0-9_-]{8,64}$/.test(headerId) ? headerId : randomUUID()
  req.headers['x-request-id'] = requestId
  res.setHeader('x-request-id', requestId)
  ;(req as Request & { requestId?: string }).requestId = requestId
  const ip = req.ip || req.socket?.remoteAddress
  const userAgent = req.headers?.['user-agent']
  auditStorage.run({ requestId, ip, userAgent }, () => next())
}