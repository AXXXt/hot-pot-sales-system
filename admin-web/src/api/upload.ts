import http from './request'

export function getPaymentProofUrl(key: string) {
  return http.get('/uploads/payment-proof-url', { params: { key } })
}