import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn() } }))
import http, { getAccessToken, getRefreshToken, setTokens, setUnauthorizedHandler } from './request'

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
