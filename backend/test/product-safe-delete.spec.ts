import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ProductService } from '../src/product/product.service'

describe('ProductService safe delete', () => {
  it('archives an existing product', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 17, status: 'active' })
    const update = jest.fn().mockResolvedValue({ id: 17, status: 'archived' })
    const service = new ProductService({ product: { findUnique, update } } as any, {} as any, {} as any)

    await expect(service.archiveProduct(17)).resolves.toEqual({ id: 17, status: 'archived' })
    expect(update).toHaveBeenCalledWith({
      where: { id: 17 },
      data: { status: 'archived' },
      select: { id: true, status: true }
    })
  })

  it('treats an already archived product as a successful idempotent delete', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 17, status: 'archived' })
    const update = jest.fn()
    const service = new ProductService({ product: { findUnique, update } } as any, {} as any, {} as any)

    await expect(service.archiveProduct(17)).resolves.toEqual({ id: 17, status: 'archived' })
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects deleting a missing product', async () => {
    const findUnique = jest.fn().mockResolvedValue(null)
    const service = new ProductService({ product: { findUnique } } as any, {} as any, {} as any)

    await expect(service.archiveProduct(999)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('deduplicates IDs and archives products in one update', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 })
    const service = new ProductService({ product: { updateMany } } as any, {} as any, {} as any)

    await expect(service.batchArchiveProducts([3, 3, 7])).resolves.toEqual({
      productIds: [3, 7],
      status: 'archived',
      updatedCount: 2
    })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: [3, 7] }, status: { not: 'archived' } },
      data: { status: 'archived' }
    })
  })

  const invalidProductIdCases = [{ productIds: [] }, { productIds: [0] }, { productIds: [-1] }, { productIds: [1.5] }]

  it.each(invalidProductIdCases)('rejects invalid archive IDs: $productIds', async ({ productIds }) => {
    const service = new ProductService({} as any, {} as any, {} as any)

    await expect(service.batchArchiveProducts(productIds)).rejects.toBeInstanceOf(BadRequestException)
  })
})
