import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { requestIdMiddleware } from './request-id.middleware'
import { SuccessInterceptor } from './success.interceptor'
import { AppFilter } from './app.filter'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  const config = app.get(ConfigService)
  app.use(helmet())
  app.use(requestIdMiddleware)
  const corsOptions: CorsOptions = {
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      const allowed = config.get<string[]>('CORS_ORIGIN') || []
      if (!origin || allowed.includes(origin)) {
        callback(null, true)
        return
      }
      callback(new Error('Origin is not allowed by CORS'), false)
    },
    credentials: true
  }
  app.enableCors(corsOptions)
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
  app.useGlobalInterceptors(new SuccessInterceptor())
  app.useGlobalFilters(new AppFilter())
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] })

  const swaggerConfig = new DocumentBuilder()
    .setTitle('火锅食材 B2B API')
    .setDescription('统一后端 API 文档')
    .setVersion('1.0')
    .addBearerAuth()
    .build()
  const document = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup('api/docs', app, document)

  app.enableShutdownHooks()
  const port = config.get<number>('PORT', 3000)
  await app.listen(port)
}

bootstrap()
