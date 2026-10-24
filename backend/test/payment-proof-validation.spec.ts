import sharp from 'sharp'
import { PAYMENT_PROOF_MAX_PIXELS, PRODUCT_IMAGE_MAX_BYTES, ProductImageFile, validatePaymentProof, validateProductImage } from '../src/upload/product-image.validation'

function file(buffer: Buffer, mimetype = 'image/jpeg', size = buffer.length): ProductImageFile {
  return { buffer, mimetype, size, originalname: 'wx-temp-file.jpg' }
}
const validate = (input?: ProductImageFile) => Promise.resolve().then(() => validatePaymentProof(input))
let png: Buffer, jpeg: Buffer, webp: Buffer

beforeAll(async () => {
  const image = { create: { width: 4, height: 3, channels: 3 as const, background: '#b85127' } }
  png = await sharp(image).png().toBuffer()
  jpeg = await sharp(image).jpeg().toBuffer()
  webp = await sharp(image).webp().toBuffer()
})

describe('payment proof content validation', () => {
  it('accepts a real PNG declared as image/jpeg by a WeChat temporary upload and returns its actual type', async () => {
    await expect(validate(file(png))).resolves.toEqual({ mimetype: 'image/png', extension: 'png' })
  })

  it('normalizes supported declared types only after decoding valid image content', async () => {
    for (const [buffer, mimetype, extension] of [[png, 'image/png', 'png'], [jpeg, 'image/jpeg', 'jpg'], [webp, 'image/webp', 'webp']] as const) {
      for (const declared of ['image/jpeg', 'image/png', 'image/webp']) {
        await expect(validate(file(buffer, declared))).resolves.toEqual({ mimetype, extension })
      }
    }
  })

  it('keeps the strict declared-type requirement for product images', () => {
    expect(() => validateProductImage(file(png))).toThrow('图片文件无效')
  })

  it('rejects missing or empty payment proof data', async () => {
    await expect(validate()).rejects.toThrow('请选择转账凭证')
    await expect(validate(file(Buffer.alloc(0)))).rejects.toThrow('请选择转账凭证')
  })

  it('rejects unsupported declared types even if the bytes form a valid PNG', async () => {
    for (const declared of ['application/octet-stream', 'image/gif', 'image/svg+xml', 'text/html']) {
      await expect(validate(file(png, declared))).rejects.toThrow('仅支持 JPG、PNG、WebP 图片')
    }
  })

  it('rejects non-images, recognized magic bytes alone and truncated real images', async () => {
    for (const buffer of [
      Buffer.from('<html>not an image</html>'),
      Buffer.from([0xff, 0xd8, 0xff, 0x00]),
      png.subarray(0, 8),
      Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]),
      png.subarray(0, Math.floor(png.length / 2)),
      jpeg.subarray(0, Math.floor(jpeg.length / 2)),
      webp.subarray(0, Math.floor(webp.length / 2))
    ]) {
      await expect(validate(file(buffer))).rejects.toThrow('图片文件无效')
    }
  })

  it('rejects missing file trailers even when the decoder can recover the visible pixels', async () => {
    for (const buffer of [png.subarray(0, png.length - 1), png.subarray(0, png.length - 12), jpeg.subarray(0, jpeg.length - 1), webp.subarray(0, webp.length - 1)]) {
      await expect(validate(file(buffer))).rejects.toThrow('图片文件无效')
    }
  })

  it('rejects a valid highly compressed image whose decoded pixel count exceeds the limit', async () => {
    const width = 10000, height = Math.floor(PAYMENT_PROOF_MAX_PIXELS / width) + 1
    const oversized = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).png().toBuffer()
    expect(oversized.length).toBeLessThan(PRODUCT_IMAGE_MAX_BYTES)
    await expect(validate(file(oversized, 'image/png'))).rejects.toThrow('图片文件无效')
  }, 30000)

  it('rejects declared or actual payloads larger than 5MB before decoding', async () => {
    await expect(validate(file(png, 'image/png', PRODUCT_IMAGE_MAX_BYTES + 1))).rejects.toThrow('图片不能超过 5MB')
    await expect(validate(file(Buffer.alloc(PRODUCT_IMAGE_MAX_BYTES + 1), 'image/png', 1))).rejects.toThrow('图片不能超过 5MB')
  })
})
