import http, { getAccessToken } from './request'

export interface PlatformRelease { id: string; version: string; sequence: number; title: string; notes: string[]; publishedAt: string; ready: boolean; supportsControl: boolean }
export interface PlatformOperation { id: string; type: string; source: string; target: string; status: string; phase: string; message: string; createdAt?: number; finishedAt?: number; backup?: string; auditPending?: boolean }
export interface PlatformOverview { current: PlatformRelease; latest: PlatformRelease; releases: PlatformRelease[]; canManage: boolean; operation: PlatformOperation | null; changedAt?: number }
export interface PlatformPlan { token: { payload: string; signature: string }; id: string; type: string; from: PlatformRelease; target: PlatformRelease; expiresAt: number; notice: string }
async function request<T>(path: string, body?: unknown, retry = true): Promise<T> {
  const response = await fetch(`/api/v1/platform/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${getAccessToken() || ''}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' })
  if (response.status === 401 && retry) { await http.get('/auth/profile'); return request<T>(path, body, false) }
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || '版本服务暂不可用')
  return result.data
}
export const getPlatformOverview = () => request<PlatformOverview>('overview')
export const planPlatformChange = (type: string, targetReleaseId: string, expectedCurrentReleaseId: string) => request<PlatformPlan>('plans', { type, targetReleaseId, expectedCurrentReleaseId })
export const executePlatformPlan = (plan: PlatformPlan) => request<PlatformOperation>('operations', { token: plan.token })
export const getPlatformOperation = (id: string) => request<PlatformOperation>(`operations/${id}`)
export const BROWSER_VERSION = import.meta.env.VITE_PLATFORM_VERSION || '开发版'
export const BROWSER_RELEASE = import.meta.env.VITE_PLATFORM_RELEASE_ID || 'development'
