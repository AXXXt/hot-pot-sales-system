import { Module } from '@nestjs/common'
import { WxService } from './wx.service'
import { redisProvider } from '../redis.provider'
import { ShipmentNotificationService } from './shipment-notification.service'
import { OrderNotificationService } from './order-notification.service'

@Module({
  providers: [WxService, ShipmentNotificationService, OrderNotificationService, redisProvider],
  exports: [WxService, ShipmentNotificationService, OrderNotificationService]
})
export class NotifyModule {}
