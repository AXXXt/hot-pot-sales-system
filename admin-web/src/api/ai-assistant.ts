import http, { API_BASE_URL, getAccessToken } from './request'

export interface AiCapabilities {
  enabled: boolean; allowWrites: boolean; canConfigure: boolean; canExecute: boolean
  features: Record<string, boolean>; tools: string[]
  scope: { allBrands: boolean; brandCount: number; ownCustomersOnly: boolean }
}
export type AiCard = Record<string, any> & { type: string }
export interface AiMessage { id: string; role: string; content: string; cards?: AiCard[] }
export interface AiDraft extends AiCard { id: string; action: string; payload: any; version: number; digest: string; status: string; missing: string[]; expiresAt: string }
export const unwrap = (response: any) => response?.data ?? response

export const getCapabilities = () => http.get('/admin/ai/capabilities').then(unwrap) as Promise<AiCapabilities>
export const getConversations = () => http.get('/admin/ai/conversations').then(unwrap)
export const newConversation = () => http.post('/admin/ai/conversations').then(unwrap)
export const getConversation = (id: string) => http.get(`/admin/ai/conversations/${id}`).then(unwrap)
export const archiveConversation = (id: string) => http.delete(`/admin/ai/conversations/${id}`).then(unwrap)
export const getCatalogOptions = () => http.get('/admin/ai/catalog-options').then(unwrap)
export const getAiImage = (id: string) => http.get(`/admin/ai/attachments/${id}`, { responseType: 'blob' }) as unknown as Promise<Blob>
export const saveDraft = (id: string, version: number, payload: any) => http.patch(`/admin/ai/drafts/${id}`, { version, payload }).then(unwrap)
export const confirmDraft = (draft: AiDraft) => http.post(`/admin/ai/drafts/${draft.id}/confirm`, { version: draft.version, digest: draft.digest }).then(unwrap)
export const getAiSettings = () => http.get('/admin/ai/settings').then(unwrap)
export const saveAiSettings = (settings: any) => http.patch('/admin/ai/settings', settings).then(unwrap)
export const testAiSettings = () => http.post('/admin/ai/settings/test').then(unwrap)
export const getAiUsage = () => http.get('/admin/ai/usage').then(unwrap)
export const getAiTasks = () => http.get('/admin/ai/tasks').then(unwrap)
export const updateAiTask = (id: string, status: string) => http.patch(`/admin/ai/tasks/${id}`, { status }).then(unwrap)
export const getAiSchedules = () => http.get('/admin/ai/schedules').then(unwrap)
export const createAiSchedule = (value: any) => http.post('/admin/ai/schedules', value).then(unwrap)
export const disableAiSchedule = (id: string) => http.delete(`/admin/ai/schedules/${id}`).then(unwrap)
export const getAiAuthorization = () => http.get('/admin/ai/authorization').then(unwrap)
export const saveAiRole = (id: number, codes: string[]) => http.patch(`/admin/ai/authorization/roles/${id}`, { codes }).then(unwrap)
export const saveAiBrands = (id: number, brandIds: number[]) => http.patch(`/admin/ai/authorization/users/${id}/brands`, { brandIds }).then(unwrap)
export async function downloadAiReport(period = 'week') {
  const blob: any = await http.get('/admin/ai/report', { params: { period }, responseType: 'blob' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a'); link.href = url; link.download = '经营统计.xlsx'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function uploadAiImage(file: File) {
  const data = new FormData(); data.append('file', file)
  return unwrap(await http.post('/admin/ai/attachments', data, { headers: { 'Content-Type': 'multipart/form-data' } }))
}

/** 读取带身份校验的阶段事件；不把令牌放进URL，也不自动重放已开始的请求。 */
export async function runConversation(id: string, input: any, signal: AbortSignal, onProgress: (text: string) => void) {
  const request = () => fetch(`${API_BASE_URL}/admin/ai/conversations/${id}/runs`, { method: 'POST', signal,
    headers: { Authorization: `Bearer ${getAccessToken() || ''}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(input) })
  let response = await request()
  if (response.status === 401) { await http.get('/auth/profile'); response = await request() }
  if (!response.ok || !response.body) throw new Error('助手请求失败，请检查登录状态与权限')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''; let result: any; let streamError = ''
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    let end: number
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end); buffer = buffer.slice(end + 2)
      const event = block.split('\n').find(x => x.startsWith('event:'))?.slice(6).trim()
      const raw = block.split('\n').filter(x => x.startsWith('data:')).map(x => x.slice(5).trim()).join('\n')
      if (!raw) continue
      const data = JSON.parse(raw)
      if (event === 'progress') onProgress(data.text)
      if (event === 'result') result = data
      if (event === 'error') streamError = Array.isArray(data.message) ? data.message.join('；') : data.message
    }
    if (done) break
  }
  if (streamError) throw new Error(streamError)
  if (!result) throw new Error('连接已中断，请查看会话历史后重试')
  return result
}
