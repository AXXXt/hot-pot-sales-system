import { pinyin } from 'pinyin-pro'

const BRAND_PREFIX_PATTERN = /^[A-Z0-9]+$/

function syllables(value: string): string[] {
  return pinyin(value.trim(), { toneType: 'none', type: 'array' })
    .map((part) => part.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)
}

export function normalizeBrandPrefix(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function isValidBrandPrefix(value: string): boolean {
  return BRAND_PREFIX_PATTERN.test(value)
}

export function toBrandPrefix(name: string): string {
  return normalizeBrandPrefix(syllables(name).join(''))
}

export function toCategorySegment(name: string): string {
  return syllables(name)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join('')
}

export function formatProductSequence(sequence: number): string {
  return String(sequence).padStart(3, '0')
}

export function buildProductCode(brandPrefix: string, categoryName: string, sequence: number): string {
  return `${normalizeBrandPrefix(brandPrefix)}-${toCategorySegment(categoryName)}-${formatProductSequence(sequence)}`
}
