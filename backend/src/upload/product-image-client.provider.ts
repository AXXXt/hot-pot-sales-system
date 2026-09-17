import { Provider } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Client } from 'minio'

export const PRODUCT_IMAGE_CLIENT = Symbol('PRODUCT_IMAGE_CLIENT')

export type ProductImageClient = Pick<
  Client,
  'bucketExists' | 'makeBucket' | 'getBucketPolicy' | 'setBucketPolicy' | 'putObject' | 'presignedGetObject'
>

export const productImageClientProvider: Provider = {
  provide: PRODUCT_IMAGE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => new Client({
    endPoint: config.getOrThrow<string>('MINIO_ENDPOINT'),
    port: Number(config.getOrThrow<string>('MINIO_PORT')),
    useSSL: config.get<string>('MINIO_USE_SSL') === 'true',
    accessKey: config.getOrThrow<string>('MINIO_ACCESS_KEY'),
    secretKey: config.getOrThrow<string>('MINIO_SECRET_KEY')
  })
}