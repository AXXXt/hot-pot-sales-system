/** Legacy customer links must never widen the authenticated user's tenant. */
export function hasMismatchedCustomerTenant(user: { tenantId?: number; customer?: { tenantId?: number } | null }): boolean {
  return Number.isSafeInteger(user.tenantId) && Number.isSafeInteger(user.customer?.tenantId)
    && user.customer!.tenantId !== user.tenantId
}
