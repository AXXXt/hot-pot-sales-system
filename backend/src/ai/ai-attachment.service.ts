import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import sharp from 'sharp'
import { PrismaService } from '../prisma.service'
import { StaffAccessService, StaffActor } from '../auth/staff-access.service'
import { ProductImageStorageService } from '../upload/product-image-storage.service'
import { ProductImageFile, validateProductImage } from '../upload/product-image.validation'

@Injectable()
export class AiAttachmentService {
  constructor(private readonly prisma: PrismaService, private readonly access: StaffAccessService, private readonly storage: ProductImageStorageService) {}

  async upload(actor: StaffActor, file?: ProductImageFile) {
    this.access.require(actor, 'ai:use', 'product:create')
    validateProductImage(file)
    let buffer: Buffer
    try { buffer = await sharp(file!.buffer, { limitInputPixels: 40000000 }).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer() }
    catch { throw new BadRequestException('图片无法读取，请重新拍摄或选择JPG、PNG、WebP图片') }
    const stored = await this.storage.uploadAiImage(buffer)
    try {
      return await this.prisma.aiAttachment.create({ data: { tenantId: actor.tenantId, ownerId: actor.id, objectKey: stored.objectKey, mimeType: 'image/jpeg', fileSize: buffer.length, expiresAt: new Date(Date.now() + 7 * 86400000) }, select: { id: true, fileSize: true, expiresAt: true } })
    } catch (error) { await this.storage.removeAiImage(stored.objectKey); throw error }
  }

  async bytes(actor: StaffActor, id: string) {
    this.access.require(actor, 'ai:use', 'product:create')
    const file = await this.prisma.aiAttachment.findFirst({ where: { id, tenantId: actor.tenantId, ownerId: actor.id, expiresAt: { gt: new Date() } } })
    if (!file) throw new NotFoundException('图片不存在、已过期或不可访问')
    return this.storage.readAiImage(file.objectKey)
  }

  async modelImages(actor: StaffActor, ids: string[]) {
    const content: unknown[] = []
    for (const id of ids) content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${(await this.bytes(actor, id)).toString('base64')}` } })
    return content
  }
}
