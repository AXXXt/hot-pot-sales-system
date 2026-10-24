import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'
import http, { clearTokens, getAccessToken, setTokens, setUnauthorizedHandler, showRequestError } from './request'

vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn() } }))
const originalAdapter = http.defaults.adapter

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', { getItem: () => null })
})
afterEach(() => { http.defaults.adapter = originalAdapter; vi.restoreAllMocks(); vi.unstubAllGlobals() })

function authenticatedFixture() {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
  setTokens('expired', 'refresh-old')
  setUnauthorizedHandler(() => {})
  return values
}
function unauthorized(config: InternalAxiosRequestConfig) {
  return new AxiosError('expired', 'ERR_BAD_REQUEST', config, undefined,
    { status: 401, statusText: 'Unauthorized', headers: {}, config, data: {} })
}

it('shares a single rotation for concurrent expired requests', async () => {
  authenticatedFixture()
  const refresh = vi.spyOn(axios, 'post').mockResolvedValue({ data: { code: 0, data: { accessToken: 'fresh', refreshToken: 'refresh-new' } } })
  http.defaults.adapter = async config => {
    if (config.headers.Authorization === 'Bearer expired') throw unauthorized(config)
    return { status: 200, statusText: 'OK', config, headers: {}, data: { code: 0, data: {} } }
  }
  await expect(Promise.all([http.get('/products'), http.get('/orders')])).resolves.toHaveLength(2)
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('does not log out the administrator for an incorrect current password', async () => {
  authenticatedFixture()
  const refresh = vi.spyOn(axios, 'post')
  http.defaults.adapter = async config => {
    const error = unauthorized(config)
    error.response!.data = { message: '账号或密码错误，或账号暂不可用', errorCode: 'AUTH_PASSWORD_INVALID' }
    throw error
  }
  await expect(http.post('/auth/password/change', {})).rejects.toBeInstanceOf(AxiosError)
  expect(refresh).not.toHaveBeenCalled()
  expect(getAccessToken()).toBe('expired')
})

it('does not restore a session when an older refresh resolves after logout', async () => {
  authenticatedFixture()
  let finish!: (value: any) => void
  vi.spyOn(axios, 'post').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  http.defaults.adapter = async config => { throw unauthorized(config) }
  const pending = http.get('/orders').catch(error => error)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  clearTokens()
  finish({ data: { code: 0, data: { accessToken: 'stale', refreshToken: 'stale-refresh' } } })
  await pending
  expect(getAccessToken()).toBeNull()
})

it('does not clear a newer account when an older refresh fails', async () => {
  authenticatedFixture()
  let fail!: (reason: any) => void
  vi.spyOn(axios, 'post').mockImplementation(() => new Promise((_, reject) => { fail = reject }))
  http.defaults.adapter = async config => { throw unauthorized(config) }
  const pending = http.get('/orders').catch(error => error)
  await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
  clearTokens(); setTokens('account-B', 'refresh-B')
  fail(new Error('old refresh failed'))
  await pending
  expect(getAccessToken()).toBe('account-B')
})

it('does not deliver an old private response to a different logged-in account', async () => {
  authenticatedFixture()
  let finish!: (value: any) => void, original!: InternalAxiosRequestConfig
  http.defaults.adapter = config => { original = config; return new Promise(resolve => { finish = resolve }) }
  const pending = http.get('/auth/profile').catch(error => error)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  setTokens('account-B', 'refresh-B')
  finish({ status: 200, statusText: 'OK', config: original, headers: {}, data: { code: 0, data: { private: 'account-A' } } })
  expect(await pending).toMatchObject({ message: '登录状态已变化' })
  expect(getAccessToken()).toBe('account-B')
})

it('preserves another tab rotation and retries with its current access token', async () => {
  authenticatedFixture()
  let fail!: (reason: any) => void
  vi.spyOn(axios, 'post').mockImplementation(() => new Promise((_, reject) => { fail = reject }))
  http.defaults.adapter = async config => {
    if (config.headers.Authorization === 'Bearer expired') throw unauthorized(config)
    return { status: 200, statusText: 'OK', config, headers: {}, data: { code: 0, data: {} } }
  }
  const pending = http.get('/orders')
  await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
  localStorage.setItem('accessToken', 'same-session-other-tab')
  localStorage.setItem('refreshToken', 'rotated-by-other-tab')
  fail(new Error('old refresh consumed'))
  await expect(pending).resolves.toMatchObject({ code: 0 })
  expect(getAccessToken()).toBe('same-session-other-tab')
})

it('does not refresh or clear an existing session for an invalid public SMS or application ticket', async () => {
  authenticatedFixture()
  const refresh = vi.spyOn(axios, 'post')
  http.defaults.adapter = async config => { throw unauthorized(config) }
  await expect(http.post('/auth/registration-status', {})).rejects.toBeInstanceOf(AxiosError)
  expect(refresh).not.toHaveBeenCalled()
  expect(getAccessToken()).toBe('expired')
})

it('shows one notification when both the HTTP layer and inventory form handle a failed write', async () => {
  http.defaults.adapter = async config => {
    throw Object.assign(new Error('request failed'), {
      config, response: { status: 400, data: { message: '该规格入库须填写批次号' } }
    })
  }
  try { await http.post('/inventory/adjustments', {}) }
  catch (error) { showRequestError(error, '创建失败') }
  expect(ElMessage.error).toHaveBeenCalledTimes(1)
  expect(ElMessage.error).toHaveBeenCalledWith('该规格入库须填写批次号')
})

it('still reports errors raised before an HTTP response exists', () => {
  showRequestError(new Error('请选择商品规格'), '创建失败')
  expect(ElMessage.error).toHaveBeenCalledWith('请选择商品规格')
})
