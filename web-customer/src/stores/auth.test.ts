import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
vi.mock('../api/auth', () => ({ login: vi.fn(), getProfile: vi.fn(), logout: vi.fn() }))
import * as api from '../api/auth'
import { getAccessToken, setTokens } from '../api/request'
import { useAuthStore } from './auth'

beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) })
  setActivePinia(createPinia()); vi.clearAllMocks()
})
afterEach(() => vi.unstubAllGlobals())

it('rejects an account without a customer and leaves no reusable credentials or cached profile', async () => {
  vi.mocked(api.login).mockResolvedValue({ data: { accessToken: 'fixture-access', refreshToken: 'fixture-refresh' } } as any)
  vi.mocked(api.getProfile).mockResolvedValue({ data: { user: { id: 1 }, customer: null } } as any)
  const auth = useAuthStore()
  await expect(auth.signIn('13900000000', '123456')).rejects.toThrow('未关联采购客户')
  expect(getAccessToken()).toBeNull()
  expect(localStorage.getItem('webProfile')).toBeNull()
  expect(auth.profile).toBeNull()
})

it('finishes local logout even when the remote logout endpoint is unavailable', async () => {
  setTokens('fixture-access', 'fixture-refresh')
  vi.mocked(api.logout).mockRejectedValue(new Error('offline fixture'))
  const auth = useAuthStore()
  await expect(auth.signOut()).resolves.toBeUndefined()
  expect(auth.isAuthenticated).toBe(false)
})

it('recovers from malformed cached profile JSON instead of breaking the login screen', () => {
  localStorage.setItem('webProfile', '{broken')
  expect(() => useAuthStore()).not.toThrow()
  expect(useAuthStore().profile).toBeNull()
})

it('does not restore private profile data when a pending load finishes after logout', async () => {
  setTokens('fixture-access', 'fixture-refresh')
  let complete!: (value: any) => void
  vi.mocked(api.getProfile).mockImplementation(() => new Promise(resolve => { complete = resolve }))
  vi.mocked(api.logout).mockResolvedValue({} as any)
  const auth = useAuthStore(), pending = auth.loadProfile().catch(error => error)
  await auth.signOut()
  complete({ data: { user: { id: 1 }, customer: { id: 1 } } })
  await pending
  expect(auth.profile).toBeNull()
  expect(localStorage.getItem('webProfile')).toBeNull()
})

it('coalesces concurrent profile refreshes and replaces cached credit with the current value', async () => {
  setTokens('fixture-access', 'fixture-refresh')
  localStorage.setItem('webProfile', JSON.stringify({ customer: { id: 1, creditRemaining: '100.00' } }))
  let complete!: (value: any) => void
  vi.mocked(api.getProfile).mockImplementation(() => new Promise(resolve => { complete = resolve }))
  const auth = useAuthStore(), first = auth.loadProfile(), second = auth.loadProfile()
  expect(api.getProfile).toHaveBeenCalledTimes(1)
  expect(auth.profileLoading).toBe(true)
  complete({ data: { user: { id: 1 }, customer: { id: 1, creditRemaining: '0.00' } } })
  await Promise.all([first, second])
  expect(auth.customer?.creditRemaining).toBe('0.00')
  expect(auth.profileLoading).toBe(false)
})
