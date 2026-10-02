import { ConfigService } from '@nestjs/config'
import { LogisticsService } from '../src/logistics/logistics.service'

test('manual tracking does not claim a live integration just because credentials exist', async () => {
  const service = new LogisticsService(new ConfigService({ LALAMOVE_API_KEY: 'configured', LALAMOVE_ENDPOINT: 'https://example.test' }))
  const result = await service.getOrderTrack({ status: 'shipped', logisticsInfo: { logisticsType: 'regular', driverName: 'Test driver', shipmentId: 'test' } })
  expect(result.provider).toBe('manual')
  expect(result.track.some(point => point.text === '货物已发出')).toBe(true)
})
