import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { ProductModule } from '../product/product.module'
import { UploadModule } from '../upload/upload.module'
import { redisProvider } from '../redis.provider'
import { AiAccessGuard } from './ai-access.guard'
import { AiController } from './ai.controller'
import { AiInventoryService } from './ai-inventory.service'
import { AiService } from './ai.service'
import { AiDataService } from './ai-data.service'
import { AiDraftService } from './ai-draft.service'
import { AiAttachmentService } from './ai-attachment.service'
import { AiSettingsService } from './ai-settings.service'
import { AiModelService } from './ai-model.service'
import { AiScheduleService } from './ai-schedule.service'
import { AiAuthorizationService } from './ai-authorization.service'

@Module({
  imports: [AuthModule, ProductModule, UploadModule], controllers: [AiController],
  providers: [AiInventoryService, AiService, AiAccessGuard, AiDataService, AiDraftService, AiAttachmentService, AiSettingsService, AiModelService, AiScheduleService, AiAuthorizationService, redisProvider]
})
export class AiModule {}
