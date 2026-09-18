import { Module } from '@nestjs/common'
import { WxService } from './wx.service'
import { redisProvider } from '../redis.provider'

@Module({
  providers: [WxService, redisProvider],
  exports: [WxService]
})
export class NotifyModule {}