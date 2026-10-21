import { Provider } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Client } from 'minio'

export const PRODUCT_IMAGE_CLIENT = Symbol('PRODUCT_IMAGE_CLIENT')

export type ProductImageClient = Pick<
  Client,
  'bucketExists' | 'makeBucket' | 'getBucketPolicy' | 'setBucketPolicy' | 'putObject' | 'presignedGetObject' | 'getObject' | 'removeObject'
>

export const productImageClientProvider: Provider = {
  provide: PRODUCT_IMAGE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const client = new Client({
    endPoint: config.getOrThrow<string>('MINIO_ENDPOINT'),
    port: Number(config.getOrThrow<string>('MINIO_PORT')),
    useSSL: config.get<string>('MINIO_USE_SSL') === 'true',
    accessKey: config.getOrThrow<string>('MINIO_ACCESS_KEY'),
    secretKey: config.getOrThrow<string>('MINIO_SECRET_KEY')
    })
    const signingHost = config.get<string>('MINIO_SIGNING_ENDPOINT')
    if (signingHost) {
      // Sign with the browser-facing origin, but keep all storage operations internal.
      const signingClient = new Client({
        endPoint: signingHost,
        port: Number(config.get<string>('MINIO_SIGNING_PORT') || '443'),
        useSSL: config.get<string>('MINIO_SIGNING_USE_SSL') !== 'false',
        region: config.get<string>('MINIO_REGION') || 'us-east-1',
        accessKey: config.getOrThrow<string>('MINIO_ACCESS_KEY'),
        secretKey: config.getOrThrow<string>('MINIO_SECRET_KEY')
      })
      client.presignedGetObject = signingClient.presignedGetObject.bind(signingClient)
    }
    return client
  }
}
