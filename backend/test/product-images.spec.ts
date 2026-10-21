import { BadRequestException } from '@nestjs/common'
import { imageUpdate, productImages } from '../src/product/product-images'

const a = 'https://weiduoxian.cn/images/a.jpg'
const b = 'https://weiduoxian.cn/images/b.jpg'
const c = 'https://weiduoxian.cn/images/c.jpg'

it('backfills legacy covers and normalizes duplicate or corrupt read values', () => {
  expect(productImages({ mainImageUrl: a })).toEqual([a])
  expect(productImages({ images: [b, null, '', b], mainImageUrl: a })).toEqual([b])
})

it('uses the ordered gallery as the cover and supports removing every image', () => {
  expect(imageUpdate({ images: [b, a, b], mainImageUrl: c })).toEqual({ images: [b, a], mainImageUrl: b })
  expect(imageUpdate({ images: [] }, { images: [a, b] })).toEqual({ images: [], mainImageUrl: '' })
  expect(imageUpdate({})).toEqual({})
})

it('preserves the other detail images when an older editor updates only the cover', () => {
  expect(imageUpdate({ mainImageUrl: c }, { images: [a, b] })).toEqual({ images: [c, b], mainImageUrl: c })
  expect(imageUpdate({ mainImageUrl: b }, { images: [a, b] })).toEqual({ images: [b], mainImageUrl: b })
})

it.each([null, [null], [''], ['javascript:alert(1)'], ['data:image/png;base64,abc'], ['https://example.com/' + 'a'.repeat(500)], Array(10).fill(a)])('rejects invalid gallery input %j', images => {
  expect(() => imageUpdate({ images })).toThrow(BadRequestException)
})
