// Retain operational routing and request identity without logging raw query strings or headers.
export function httpRequestLog(request: any) {
  return {
    id: request.id,
    method: request.method,
    url: String(request.url || '').split('?')[0],
    remoteAddress: request.remoteAddress,
    remotePort: request.remotePort
  }
}
