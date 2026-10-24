import http from './request'
export function getServiceRequests(params: Record<string, unknown>) { return http.get('/service-requests', { params }) }
export function getServiceRequest(id: number) { return http.get(`/service-requests/${id}`) }
export function processServiceRequest(id: number, data: { status: string; message: string; expectedVersion: number }) { return http.patch(`/service-requests/${id}`, data) }
