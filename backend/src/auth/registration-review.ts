import { Prisma } from '@prisma/client'

export type RegistrationReviewStatus = 'approved' | 'pending' | 'rejected' | 'disabled'

export interface RegistrationReviewState {
  userStatus: string
  customerStatus: string | null | undefined
  lastAction?: string | null
  tenantActive?: boolean
}

/** A disabled account is pending only when an actual application is the latest decision. */
export function reviewStatusFromState(state: RegistrationReviewState): RegistrationReviewStatus {
  if (state.tenantActive === false) return 'disabled'
  if (state.userStatus === 'active' && state.customerStatus === 'active') return 'approved'
  if (state.customerStatus !== 'disabled') return 'disabled'
  if (state.lastAction === 'submit_registration') return 'pending'
  if (state.lastAction === 'reject') return 'rejected'
  return 'disabled'
}

/** Explicit enable/disable actions must override an older registration or review decision. */
export function registrationDecisionWhere(tenantId: number, customerId: number): Prisma.AuditLogWhereInput {
  return {
    tenantId, module: 'customer', targetType: 'customer', targetId: String(customerId),
    OR: [
      ...['approve', 'reject', 'submit_registration'].map(action => ({ afterData: { path: '$.action', equals: action } })),
      ...['active', 'disabled'].map(status => ({ afterData: { path: '$.status', equals: status } }))
    ]
  }
}
