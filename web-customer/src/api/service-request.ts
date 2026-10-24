import http from './request'
export function getMyServiceRequests(params: Record<string, unknown>) { return http.get('/service-requests/mine', { params }) }
export function getMyServiceRequest(id: number) { return http.get(`/service-requests/mine/${id}`) }
export function createMyServiceRequest(data: Record<string, unknown>) { return http.post('/service-requests/mine', data) }
export function getServiceOrderOptions(params: Record<string, unknown> = {}) { return http.get('/service-requests/order-options', { params }) }
export function serviceRequestKey() { return globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16) }) }
