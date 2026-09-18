import { getAccessToken, API_BASE_URL } from './request'

export async function downloadExport(path: string, params: Record<string, unknown> = {}) {
  const token = getAccessToken()
  const query = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') query.append(k, String(v))
  })
  const sep = query.toString() ? `?${query.toString()}` : ''
  const res = await fetch(`${API_BASE_URL}${path}${sep}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  if (!res.ok) throw new Error('导出失败')
  const blob = await res.blob()
  const downloadUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = downloadUrl
  a.download = `export-${Date.now()}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(downloadUrl)
}