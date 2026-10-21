import { plainToInstance } from 'class-transformer'
import { IsIn, IsNotEmpty, IsOptional, validateSync } from 'class-validator'
import { experienceSmsSettings } from '../auth/sms-experience.config'

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

  @IsOptional()
  TENCENT_SMS_SECRET_ID?: string

  @IsOptional()
  TENCENT_SMS_SECRET_KEY?: string

  @IsOptional()
  TENCENT_SMS_SDK_APP_ID?: string

  @IsOptional()
  TENCENT_SMS_SIGN_NAME?: string

  @IsOptional()
  TENCENT_SMS_LOGIN_TEMPLATE_ID?: string

  @IsOptional()
  TENCENT_SMS_REGISTER_TEMPLATE_ID?: string

  @IsOptional()
  TENCENT_SMS_REGION?: string
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
  const merged: Record<string, unknown> = nodeEnv === 'production'
    ? { ...config, NODE_ENV: nodeEnv }
    : { ...developmentDefaults, ...config, NODE_ENV: nodeEnv }
  const env = plainToInstance(EnvSchema, merged, { enableImplicitConversion: true })
  const errors = validateSync(env, { skipMissingProperties: false })
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.toString()}`)
  }

  if (env.SMS_PROVIDER === 'experience') {
    const settings = experienceSmsSettings({ get: (key, fallback) => merged[key] ?? fallback })
    // An expired window disables SMS at runtime, not the entire backend on restart.
    if (!settings.valid || settings.expiresAt > Date.now() + 7 * 24 * 60 * 60 * 1000) {
      throw new Error('Experience SMS requires explicit valid SMS_TEST_PHONES and SMS_TEST_EXPIRES_AT no more than 7 days ahead')
    }
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
      throw new Error('Production SMS_PROVIDER must be a real provider or explicitly disabled')
    }
    if (!['disabled', 'experience', 'tencentcloud'].includes(String(env.SMS_PROVIDER))) {
      throw new Error('Production SMS_PROVIDER is not supported')
    }
  }

  if (env.SMS_PROVIDER === 'tencentcloud') {
    const required = [
      'TENCENT_SMS_SECRET_ID',
      'TENCENT_SMS_SECRET_KEY',
      'TENCENT_SMS_SDK_APP_ID',
      'TENCENT_SMS_SIGN_NAME',
      'TENCENT_SMS_LOGIN_TEMPLATE_ID',
      'TENCENT_SMS_REGISTER_TEMPLATE_ID'
    ]
    const missing = required.filter(key => !String(merged[key] || '').trim())
    if (missing.length > 0) {
      throw new Error(`Tencent SMS configuration is incomplete: ${missing.join(', ')}`)
    }
    if (!/^\d{6,20}$/.test(String(merged.TENCENT_SMS_SDK_APP_ID))) {
      throw new Error('TENCENT_SMS_SDK_APP_ID must contain only digits')
    }
    if (!/^\d{5,20}$/.test(String(merged.TENCENT_SMS_LOGIN_TEMPLATE_ID)) ||
        !/^\d{5,20}$/.test(String(merged.TENCENT_SMS_REGISTER_TEMPLATE_ID))) {
      throw new Error('Tencent SMS template IDs must contain only digits')
    }
  }

  return {
    ...merged,
    PORT: Number(env.PORT),
    CORS_ORIGIN: String(env.CORS_ORIGIN).split(',').map((value) => value.trim()).filter(Boolean)
  }
}
