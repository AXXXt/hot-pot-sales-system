import http, { getSessionEpoch } from './request'

interface ExportReply {
  blob: Blob
  contentType: string
  disposition: string
}

async function exportError(reply?: ExportReply): Promise<Error> {
  if (reply?.blob instanceof Blob && reply.blob.size <= 65536 && /json/i.test(reply.contentType)) {
    try {
      const body = JSON.parse(await reply.blob.text())
      const message = Array.isArray(body.message) ? body.message.join('；') : body.message
      if (typeof message === 'string' && message.trim()) return new Error(message.slice(0, 300))
    } catch { /* Retain the readable fallback for a malformed error body. */ }
  }
  return new Error('导出失败，未生成有效的Excel文件，请稍后重试')
}

function exportFilename(disposition: string) {
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const plain = disposition.match(/filename="([^"]+)"|filename=([^;]+)/i)
  let name = plain?.[1] || plain?.[2] || ''
  if (encoded) { try { name = decodeURIComponent(encoded) } catch { return '' } }
  name = name.trim().split(/[/\\]/).pop() || ''
  return /\.xlsx$/i.test(name) && !/[\r\n\x00]/.test(name) ? name : ''
}

export async function downloadExport(path: string, params: Record<string, unknown> = {}) {
  const epoch = getSessionEpoch()
  let reply: ExportReply
  try {
    // Preserve headers before the shared success interceptor unwraps the response body.
    reply = await http.get<unknown, ExportReply>(path, {
      params,
      responseType: 'blob',
      transformResponse: [(blob: Blob, headers) => ({
        blob,
        contentType: String(headers['content-type'] || ''),
        disposition: String(headers['content-disposition'] || '')
      })]
    })
  } catch (error: any) {
    if (error.response?.data?.blob) throw await exportError(error.response.data)
    throw error
  }
  const filename = exportFilename(reply.disposition) || '导出数据.xlsx'
  if (!(reply.blob instanceof Blob) || !/spreadsheetml\.sheet/i.test(reply.contentType)) throw await exportError(reply)
  const signature = new Uint8Array(await reply.blob.slice(0, 4).arrayBuffer())
  if (signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 3 || signature[3] !== 4) throw await exportError(reply)
  if (getSessionEpoch() !== epoch) throw new Error('登录状态已变化，请重新导出')
  const downloadUrl = URL.createObjectURL(reply.blob)
  const anchor = document.createElement('a')
  anchor.href = downloadUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(downloadUrl)
}
