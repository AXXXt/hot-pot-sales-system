import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { UpdateCustomerDto } from '../src/customer/dto/create-customer.dto'

describe('UpdateCustomerDto', () => {
  it('converts a numeric creditDays string to an integer', async () => {
    const dto = plainToInstance(UpdateCustomerDto, { creditDays: '30' })

    expect(dto.creditDays).toBe(30)
    await expect(validate(dto)).resolves.toHaveLength(0)
  })

  it('converts an empty creditDays value to null', async () => {
    const dto = plainToInstance(UpdateCustomerDto, { creditDays: '' })

    expect(dto.creditDays).toBeNull()
    await expect(validate(dto)).resolves.toHaveLength(0)
  })

  it('converts an empty creditLimit value to null', async () => {
    const dto = plainToInstance(UpdateCustomerDto, { creditLimit: '  ' })

    expect(dto.creditLimit).toBeNull()
    await expect(validate(dto)).resolves.toHaveLength(0)
  })

  it('rejects a non-integer creditDays value', async () => {
    const dto = plainToInstance(UpdateCustomerDto, { creditDays: '30.5' })
    const errors = await validate(dto)

    expect(errors).toEqual([
      expect.objectContaining({ property: 'creditDays' })
    ])
  })
})
