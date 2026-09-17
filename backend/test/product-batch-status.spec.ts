import { BadRequestException } from '@nestjs/common'
import { ProductService } from '../src/product/product.service'

describe('ProductService batch status updates', () => {
  it('deduplicates product IDs and disables them in one update', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 })
    const prisma = { product: { updateMany } }
    const service = new ProductService(prisma as any, {} as any, {} as any, { write: jest.fn() } as any)

    await expect(service.batchUpdateStatus([3, 3, 7], 'disabled')).resolves.toEqual({
      productIds: [3, 7],
      status: 'disabled',
      updatedCount: 2
    })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: [3, 7] } },
      data: { status: 'disabled' }
    })
  })

  it.each([
    [[], 'disabled'],
    [[1], 'archived']
  ])('rejects invalid batch updates', async (productIds, status) => {
    const service = new ProductService({} as any, {} as any, {} as any, { write: jest.fn() } as any)

    await expect(service.batchUpdateStatus(productIds, status)).rejects.toBeInstanceOf(BadRequestException)
  })
})
