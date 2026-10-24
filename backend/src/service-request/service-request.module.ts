import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { ServiceRequestController } from './service-request.controller'
import { ServiceRequestService } from './service-request.service'

@Module({ imports: [AuthModule], controllers: [ServiceRequestController], providers: [ServiceRequestService] })
export class ServiceRequestModule {}
