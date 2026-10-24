import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn() } }))
import http, { clearTokens, getAccessToken, getRefreshToken, setTokens, setUnauthorizedHandler } from './request'

const originalAdapter = http.defaults.adapter
beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) })
  setTokens('expired', 'refresh-old')
  setUnauthorizedHandler(() => {})
})
afterEach(() => { http.defaults.adapter = originalAdapter; vi.restoreAllMocks(); vi.unstubAllGlobals() })
function unauthorized(config: InternalAxiosRequestConfig) {
  return new AxiosError('expired', 'ERR_BAD_REQUEST', config, undefined,
    { status: 401, statusText: 'Unauthorized', headers: {}, config, data: {} })
}

it('concurrent expired requests share one token rotation and both retry', async () => {
  let complete!: (value: any) => void
  const refresh = vi.spyOn(axios, 'post').mockImplementation(() => new Promise(resolve => { complete = resolve }))
  http.defaults.adapter = async config => {
    if (config.headers.Authorization === 'Bearer expired') throw unauthorized(config)
    return { status: 200, statusText: 'OK', config, headers: {}, data: { code: 0, data: config.url } }
  }
  const requests = Promise.all([http.get('/products'), http.get('/orders')])
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  complete({ data: { code: 0, data: { accessToken: 'fresh', refreshToken: 'refresh-new' } } })
  expect(await requests).toHaveLength(2)
  expect(getAccessToken()).toBe('fresh')
  expect(getRefreshToken()).toBe('refresh-new')
})

it('a rejected retry cannot enter an endless refresh loop', async () => {
  const refresh = vi.spyOn(axios, 'post').mockResolvedValue({ data: { code: 0, data: { accessToken: 'fresh', refreshToken: 'new' } } })
  http.defaults.adapter = async config => { throw unauthorized(config) }
  await expect(http.get('/products')).rejects.toMatchObject({ response: { status: 401 } })
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(getAccessToken()).toBeNull()
})

it('an invalid refresh response clears both credentials and notifies the auth store', async () => {
  const reset = vi.fn()
  setUnauthorizedHandler(reset)
  vi.spyOn(axios, 'post').mockResolvedValue({ data: { code: 0, data: {} } })
  http.defaults.adapter = async config => { throw unauthorized(config) }
  await expect(http.get('/products')).rejects.toBeInstanceOf(AxiosError)
  expect(getRefreshToken()).toBeNull()
  expect(getAccessToken()).toBeNull()
  expect(reset).toHaveBeenCalledTimes(1)
})

it('does not restore a session when its pending refresh resolves after logout', async () => {
  let complete!: (value: any) => void
  vi.spyOn(axios, 'post').mockImplementation(() => new Promise(resolve => { complete = resolve }))
  http.defaults.adapter = async config => {
    if (config.headers.Authorization === 'Bearer expired') throw unauthorized(config)
    return { status: 200, statusText: 'OK', config, headers: {}, data: { code: 0, data: {} } }
  }
  const pending = http.get('/products').catch(error => error)
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
  clearTokens()
  complete({ data: { code: 0, data: { accessToken: 'late', refreshToken: 'late-refresh' } } })
  await pending
  expect(getAccessToken()).toBeNull()
  expect(getRefreshToken()).toBeNull()
})

it('does not clear a new login when an older pending refresh fails', async () => {
  let fail!: (reason: unknown) => void
  vi.spyOn(axios, 'post').mockImplementation(() => new Promise((_, reject) => { fail = reject }))
  http.defaults.adapter = async config => { throw unauthorized(config) }
  const pending = http.get('/orders').catch(error => error)
  await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
  clearTokens(); setTokens('new-account', 'new-account-refresh')
  fail(new Error('old refresh failed'))
  await pending
  expect(getAccessToken()).toBe('new-account')
  expect(getRefreshToken()).toBe('new-account-refresh')
})

it('preserves another tab rotation when the current tab refresh loses the race', async () => {
  let fail!: (reason: any) => void
  vi.spyOn(axios, 'post').mockImplementation(() => new Promise((_, reject) => { fail = reject }))
  http.defaults.adapter = async config => {
    if (config.headers.Authorization === 'Bearer expired') throw unauthorized(config)
    return { status: 200, statusText: 'OK', config, headers: {}, data: { code: 0, data: {} } }
  }
  const pending = http.get('/orders')
  await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
  localStorage.setItem('webAccessToken', 'same-session-other-tab')
  localStorage.setItem('webRefreshToken', 'other-tab-rotation')
  fail(new Error('old refresh consumed'))
  await expect(pending).resolves.toMatchObject({ code: 0 })
  expect(getAccessToken()).toBe('same-session-other-tab')
})

it('does not deliver private data when a different tab has switched accounts', async () => {
  let finish!: (value: any) => void, original!: InternalAxiosRequestConfig
  http.defaults.adapter = config => { original = config; return new Promise(resolve => { finish = resolve }) }
  const pending = http.get('/auth/profile').catch(error => error)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  localStorage.setItem('webSessionGeneration', 'other-tab-new-login')
  localStorage.setItem('webAccessToken', 'account-B')
  localStorage.setItem('webRefreshToken', 'refresh-B')
  finish({ status: 200, statusText: 'OK', config: original, headers: {}, data: { code: 0, data: { private: 'account-A' } } })
  expect(await pending).toMatchObject({ message: '登录状态已变化' })
  expect(getAccessToken()).toBe('account-B')
})

it('keeps public authentication errors separate from an existing access session', async () => {
  const refresh = vi.spyOn(axios, 'post')
  http.defaults.adapter = async config => { throw unauthorized(config) }
  await expect(http.post('/auth/login', {})).rejects.toBeInstanceOf(AxiosError)
  expect(refresh).not.toHaveBeenCalled()
  expect(getAccessToken()).toBe('expired')
  expect(getRefreshToken()).toBe('refresh-old')
})
