export interface BrandOrderGroup {
  brand: string
  items: Array<{ skuId: number; quantity: number }>
}

// Preserve failed groups and distinguish a saved draft from a submitted order.
export async function submitBrandOrders(
  groups: BrandOrderGroup[],
  actions: {
    create: (group: BrandOrderGroup) => Promise<{ id: number; orderNo: string }>
    submit: (id: number) => Promise<unknown>
    remove: (skuIds: number[]) => void
  }
) {
  const created: Array<{ id: number; orderNo: string; brand: string; submitted: boolean }> = []
  const failures: string[] = []
  for (const group of groups) {
    try {
      const order = await actions.create(group)
      let submitted = true
      try { await actions.submit(order.id) } catch { submitted = false }
      actions.remove(group.items.map(item => item.skuId))
      created.push({ ...order, brand: group.brand, submitted })
    } catch {
      failures.push(group.brand)
    }
  }
  return { created, failures }
}
