import http from './request'

export async function importProductsExcel(file: File, customerId?: number | null) {
  const form = new FormData()
  form.append('file', file)
  try {
    // Use the same session epoch and single 401 refresh queue as every other admin request.
    return await http.post('/imports/products', form, {
      headers: { 'Content-Type': 'multipart/form-data' }, params: customerId ? { customerId } : undefined
    })
  } catch (error: any) {
    const body = error?.response?.data || error
    const importErrors = ['IMP_1002', 'IMP_1003'].includes(body?.errorCode) && Array.isArray(body?.data?.errors) ? body.data.errors
      .filter((item: any) => Number.isSafeInteger(item?.row) && item.row > 0 && typeof item.message === 'string')
      .slice(0, 20).map((item: any) => ({ row: item.row as number, message: item.message.slice(0, 255) as string })) : []
    throw Object.assign(error, { importErrors,
      importErrorCount: Math.max(importErrors.length, Number.isSafeInteger(body?.data?.errorCount) ? body.data.errorCount : 0) })
  }
}

export async function downloadProductImportTemplate() {
  const result = await http.get('/imports/products/template', { responseType: 'blob' })
  const blob = result as unknown as Blob
  if (!(blob instanceof Blob) || !blob.size) throw new Error('模板下载失败，请重试')
  return blob
}
