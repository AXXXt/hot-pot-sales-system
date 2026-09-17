import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import * as authApi from '../api/auth'
import { clearTokens, getAccessToken, setTokens } from '../api/request'

export const useAuthStore = defineStore('auth', () => {
  const profile = ref<authApi.UserProfile | null>(null)
  const loading = ref(false)
  const accessToken = ref(getAccessToken())

  const isAuthenticated = computed(() => Boolean(accessToken.value))
  const permissionCodes = computed(() => new Set((profile.value?.permissions || []).map((item) => typeof item === 'string' ? item : item.code)))

  async function signIn(phone: string, code: string) {
    loading.value = true
    try {
      const response = await authApi.login(phone, code)
      setTokens(response.data.accessToken, response.data.refreshToken)
      accessToken.value = response.data.accessToken
      await loadProfile()
    } finally {
      loading.value = false
    }
  }

  async function loadProfile() {
    const response = await authApi.getProfile()
    profile.value = response.data
    return response.data
  }

  async function signOut() {
    try {
      if (accessToken.value) await authApi.logout()
    } finally {
      reset()
    }
  }

  function reset() {
    clearTokens()
    accessToken.value = null
    profile.value = null
  }

  function can(permission?: string) {
    return !permission || permissionCodes.value.has(permission)
  }

  return { profile, loading, accessToken, isAuthenticated, permissionCodes, signIn, loadProfile, signOut, reset, can }
})
