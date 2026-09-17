import {
  buildProductCode,
  formatProductSequence,
  normalizeBrandPrefix,
  toBrandPrefix,
  toCategorySegment
} from '../src/product/product-code'

describe('product code helpers', () => {
  it('generates an uppercase brand prefix from Chinese', () => {
    expect(toBrandPrefix('德品')).toBe('DEPIN')
  })

  it('normalizes a manually entered brand prefix', () => {
    expect(normalizeBrandPrefix(' de-pin 01 ')).toBe('DEPIN01')
  })

  it('generates title-cased category pinyin', () => {
    expect(toCategorySegment('鸭血')).toBe('YaXue')
  })

  it('pads only sequences shorter than three digits', () => {
    expect(formatProductSequence(1)).toBe('001')
    expect(formatProductSequence(99)).toBe('099')
    expect(formatProductSequence(1000)).toBe('1000')
  })

  it('builds the approved product code', () => {
    expect(buildProductCode('DEPIN', '鸭血', 1)).toBe('DEPIN-YaXue-001')
  })
})
