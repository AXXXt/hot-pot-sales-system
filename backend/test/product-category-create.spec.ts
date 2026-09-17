import { ConflictException } from '@nestjs/common'
import { ProductService } from '../src/product/product.service'

describe('ProductService category creation', () => {
  it('maps duplicate category codes to a friendly conflict', async () => {
    const create = jest.fn().mockRejectedValue({ code: 'P2002' })
    const service = new ProductService({ productCategory: { create } } as any, {} as any, {} as any, { write: jest.fn() } as any)

    await expect(service.createCategory({ name: '鸭血', code: '鸭血' })).rejects.toBeInstanceOf(ConflictException)
  })
})
