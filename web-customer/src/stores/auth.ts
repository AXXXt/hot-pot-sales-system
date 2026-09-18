import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import * as authApi from '../api/auth'
import { clearTokens, getAccessToken, setTokens } from '../api/request'

export const useAuthStore = defineStore('client-auth', () => {
  const profile = ref<authApi.ClientProfile | null>(JSON.parse(localStorage.getItem('webProfile') || 'null'))
  const accessToken = ref(getAccessToken())
  const loading = ref(false)

  const isAuthenticated = computed(() => Boolean(accessToken.value))
  const customer = computed(() => profile.value?.customer || null)
  const customerName = computed(() => profile.value?.customer?.customerName || profile.value?.user?.name || '客户用户')

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
    localStorage.setItem('webProfile', JSON.stringify(response.data))
    if (!response.data.customer) {
      throw Object.assign(new Error('当前账号未关联采购客户，请使用客户账号登录'), { handled: true })
    }
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

  return { profile, accessToken, loading, isAuthenticated, customer, customerName, signIn, loadProfile, signOut, reset }
})