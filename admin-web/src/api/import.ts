import { getAccessToken, API_BASE_URL } from './request'

export async function importProductsExcel(file: File) {
  const form = new FormData()
  form.append('file', file)
  const token = getAccessToken()
  const res = await fetch(`${API_BASE_URL}/imports/products`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || (body && typeof body.code === 'number' && body.code !== 0)) {
    throw new Error(body?.message || '导入失败')
  }
  return body
}