import http from './request'

export interface LeadStats {
  total: number
  new: number
  contacted: number
  converted: number
  invalid: number
  newCount: number
}

export function getLeadStats() {
  return http.get('/leads/stats')
}

export function getLeads(params: Record<string, unknown>) {
  return http.get('/leads', { params })
}

export function getLeadDetail(id: number) {
  return http.get(`/leads/${id}`)
}

export function updateLead(id: number, data: Record<string, unknown>) {
  return http.patch(`/leads/${id}`, data)
}

export function createFollowUp(id: number, data: { content: string; nextFollowUpAt?: string }) {
  return http.post(`/leads/${id}/follow-ups`, data)
}

export function getLeadAssignees() {
  return http.get('/leads/assignees')
}
