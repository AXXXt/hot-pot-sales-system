import { ForbiddenException } from '@nestjs/common'
import { MonitorController } from '../src/monitor/monitor.controller'
import { HealthController } from '../src/health.controller'
import { StaffAccessService } from '../src/auth/staff-access.service'

describe('system monitoring access', () => {
  it('does not expose shared system metrics to ordinary staff even with monitor permission', async () => {
    const actor = { superAdmin: false, permissions: new Set(['monitor:read']) }
    const metrics = { getSummary: jest.fn(), getAlerts: jest.fn() }
    const access = Object.assign(new StaffAccessService({} as any), { actor: async () => actor })
    const controller = new MonitorController(metrics as any, access as any)
    await expect(controller.summary({ user: { sub: 7 } })).rejects.toBeInstanceOf(ForbiddenException)
    await expect(controller.alerts({ user: { sub: 7 } }, 20)).rejects.toBeInstanceOf(ForbiddenException)
    expect(metrics.getSummary).not.toHaveBeenCalled(); expect(metrics.getAlerts).not.toHaveBeenCalled()
  })

  it('keeps the normal automatic super admin permission policy even without an explicit role grant', async () => {
    const metrics = { getSummary: jest.fn().mockResolvedValue({ api: { requests: 1 } }), getAlerts: jest.fn().mockResolvedValue([]) }
    const actor = jest.fn().mockResolvedValue({ superAdmin: true, permissions: new Set<string>() })
    const access = Object.assign(new StaffAccessService({} as any), { actor })
    const controller = new MonitorController(metrics as any, access)
    await expect(controller.summary({ user: { sub: 7 } })).resolves.toEqual({ api: { requests: 1 } })
    await expect(controller.alerts({ user: { sub: 7 } }, 5)).resolves.toEqual([])
    expect(actor).toHaveBeenCalledTimes(2); expect(metrics.getAlerts).toHaveBeenCalledWith(5)
  })

  it('rereads staff state and rejects an old session after the actor is disabled', async () => {
    const metrics = { getSummary: jest.fn() }
    const access = { actor: jest.fn().mockRejectedValue(new ForbiddenException('账号已停用')) }
    const controller = new MonitorController(metrics as any, access as any)
    await expect(controller.summary({ user: { sub: 7 } })).rejects.toBeInstanceOf(ForbiddenException)
    expect(metrics.getSummary).not.toHaveBeenCalled()
  })

  it('keeps liveness and readiness public with fixed non-private results', async () => {
    const controller = new HealthController({ ping: async () => true } as any, { ping: async () => 'PONG' }, { health: async () => true })
    expect(controller.health()).toEqual({ status: 'ok' })
    await expect(controller.ready()).resolves.toEqual({ status: 'ready', checks: { database: 'ok', redis: 'ok', minio: 'ok' } })
  })
})
