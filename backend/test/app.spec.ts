import { requestIdMiddleware } from '../src/request-id.middleware'
import { SuccessInterceptor } from '../src/success.interceptor'
import { firstValueFrom, of } from 'rxjs'

describe('backend phase A basics', () => {
  it('generates a request id when the header is missing', () => {
    const req: any = { headers: {}, header: () => undefined }
    const res: any = { setHeader: jest.fn() }
    requestIdMiddleware(req, res, jest.fn())
    expect(req.requestId).toEqual(expect.any(String))
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.requestId)
  })

  it('preserves a valid request id from the client', () => {
    const req: any = { headers: { 'x-request-id': 'req-client-123' }, header: (name: string) => req.headers[name] }
    const res: any = { setHeader: jest.fn() }
    requestIdMiddleware(req, res, jest.fn())
    expect(req.requestId).toBe('req-client-123')
  })

  it('wraps a successful handler result with the request id', async () => {
    const interceptor = new SuccessInterceptor()
    const context: any = { switchToHttp: () => ({ getRequest: () => ({ requestId: 'req-test-1' }) }) }
    const result = await firstValueFrom(interceptor.intercept(context, { handle: () => of({ status: 'ok' }) }))
    expect(result).toEqual({ code: 0, message: 'success', data: { status: 'ok' }, requestId: 'req-test-1' })
  })
})
