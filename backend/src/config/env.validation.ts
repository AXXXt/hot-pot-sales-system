import { plainToInstance } from 'class-transformer'
import { IsIn, IsNotEmpty, IsOptional, validateSync } from 'class-validator'

class EnvSchema {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV!: string

  @IsNotEmpty()
  PORT!: string

  @IsNotEmpty()
  DATABASE_URL!: string

  @IsNotEmpty()
  REDIS_URL!: string

  @IsNotEmpty()
  JWT_ACCESS_SECRET!: string

  @IsNotEmpty()
  JWT_REFRESH_SECRET!: string

  @IsNotEmpty()
  CORS_ORIGIN!: string

  @IsNotEmpty()
  MINIO_ENDPOINT!: string

  @IsNotEmpty()
  MINIO_PORT!: string

  @IsNotEmpty()
  MINIO_ACCESS_KEY!: string

  @IsNotEmpty()
  MINIO_SECRET_KEY!: string

  @IsNotEmpty()
  MINIO_BUCKET!: string

  @IsNotEmpty()
  MINIO_PUBLIC_URL!: string

  @IsOptional()
  SMS_PROVIDER?: string

  @IsOptional()
  SMS_DEV_CODE?: string
}

const developmentDefaults: Record<string, string> = {
  NODE_ENV: 'development',
  PORT: '3000',
  DATABASE_URL: 'mysql://root:password@127.0.0.1:3307/b2b_miniapp',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_ACCESS_SECRET: 'development-access-secret-change-me',
  JWT_REFRESH_SECRET: 'development-refresh-secret-change-me',
  CORS_ORIGIN: 'http://127.0.0.1:5173,http://localhost:5173',
  MINIO_ENDPOINT: '127.0.0.1',
  MINIO_PORT: '9000',
  MINIO_ACCESS_KEY: 'minioadmin',
  MINIO_SECRET_KEY: 'minioadmin',
  MINIO_BUCKET: 'b2b-miniapp',
  MINIO_PUBLIC_URL: 'http://127.0.0.1:9000',
  SMS_PROVIDER: 'development',
  SMS_DEV_CODE: '123456'
}

export function validateEnv(config: Record<string, unknown>) {
  const nodeEnv = String(config.NODE_ENV || 'development')
  const merged = nodeEnv === 'production'
    ? { ...config, NODE_ENV: nodeEnv }
    : { ...developmentDefaults, ...config, NODE_ENV: nodeEnv }
  const env = plainToInstance(EnvSchema, merged, { enableImplicitConversion: true })
  const errors = validateSync(env, { skipMissingProperties: false })
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.toString()}`)
  }

  if (nodeEnv === 'production') {
    const forbiddenDefaults = [
      'development-access-secret-change-me',
      'development-refresh-secret-change-me',
      'change_me_access',
      'change_me_refresh'
    ]
    if (forbiddenDefaults.includes(String(env.JWT_ACCESS_SECRET)) || forbiddenDefaults.includes(String(env.JWT_REFRESH_SECRET))) {
      throw new Error('Production JWT secrets must not use development defaults')
    }
    if (!env.SMS_PROVIDER || env.SMS_PROVIDER === 'development') {
      throw new Error('Production SMS_PROVIDER must be a real provider')
    }
  }

  return {
    ...merged,
    PORT: Number(env.PORT),
    CORS_ORIGIN: String(env.CORS_ORIGIN).split(',').map((value) => value.trim()).filter(Boolean)
  }
}
