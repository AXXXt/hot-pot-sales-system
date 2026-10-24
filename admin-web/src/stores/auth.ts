import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import * as authApi from '../api/auth'
import { clearTokens, getAccessToken, getSessionEpoch, setTokens } from '../api/request'

export const useAuthStore = defineStore('auth', () => {
  const profile = ref<authApi.UserProfile | null>(null)
  const loading = ref(false)
  const accessToken = ref(getAccessToken())

  const isAuthenticated = computed(() => Boolean(accessToken.value))
  const permissionCodes = computed(() => new Set((profile.value?.permissions || []).map((item) => typeof item === 'string' ? item : item.code)))

  async function signIn(phone: string, credential: string, method: 'sms' | 'password' = 'sms', consent?: authApi.LegalConsentInput) {
    const epoch = getSessionEpoch()
    loading.value = true
    try {
      const response = method === 'password' ? await authApi.loginWithPassword(phone, credential, consent) : await authApi.login(phone, credential, consent)
      if (getSessionEpoch() !== epoch) throw new Error('登录状态已变化，请重新登录')
      setTokens(response.data.accessToken, response.data.refreshToken)
      accessToken.value = response.data.accessToken
      await loadProfile()
    } finally {
      loading.value = false
    }
  }

  async function loadProfile() {
    const epoch = getSessionEpoch()
    const response = await authApi.getProfile()
    if (getSessionEpoch() !== epoch) throw new Error('登录状态已变化，请重新登录')
    profile.value = response.data
    return response.data
  }

  async function signOut() {
    const epoch = getSessionEpoch()
    try {
      if (accessToken.value) await authApi.logout()
    } finally {
      if (getSessionEpoch() === epoch) reset()
    }
  }

  function reset() {
    clearTokens()
    accessToken.value = null
    profile.value = null
  }

  function can(permission?: string) {
    return !permission || profile.value?.user.userType === 'super_admin' || permissionCodes.value.has(permission)
  }

  return { profile, loading, accessToken, isAuthenticated, permissionCodes, signIn, loadProfile, signOut, reset, can }
})
