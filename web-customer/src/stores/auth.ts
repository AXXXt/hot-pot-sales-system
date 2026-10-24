import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import * as authApi from '../api/auth'
import { clearTokens, getAccessToken, getSessionEpoch, setTokens } from '../api/request'

function cachedProfile(): authApi.ClientProfile | null {
  try { return JSON.parse(localStorage.getItem('webProfile') || 'null') }
  catch { localStorage.removeItem('webProfile'); return null }
}

export const useAuthStore = defineStore('client-auth', () => {
  const profile = ref<authApi.ClientProfile | null>(cachedProfile())
  const accessToken = ref(getAccessToken())
  const loading = ref(false)
  const profileLoading = ref(false), profileError = ref('')
  let profileRequest: Promise<authApi.ClientProfile> | null = null, profileEpoch = -1

  const isAuthenticated = computed(() => Boolean(accessToken.value))
  const customer = computed(() => profile.value?.customer || null)
  const customerName = computed(() => profile.value?.customer?.customerName || profile.value?.user?.name || '客户用户')

  async function signIn(phone: string, code: string, consent?: authApi.LegalConsentInput) {
    const epoch = getSessionEpoch()
    let issuedEpoch = -1
    loading.value = true
    try {
      const response = await authApi.login(phone, code, consent)
      if (getSessionEpoch() !== epoch) throw new Error('登录状态已变化，请重新登录')
      setTokens(response.data.accessToken, response.data.refreshToken)
      issuedEpoch = getSessionEpoch()
      accessToken.value = response.data.accessToken
      await loadProfile()
    } catch (error) {
      if (issuedEpoch === getSessionEpoch()) reset()
      throw error
    } finally {
      loading.value = false
    }
  }

  async function loadProfile(): Promise<authApi.ClientProfile> {
    const epoch = getSessionEpoch()
    if (profileRequest && profileEpoch === epoch) return profileRequest
    profileEpoch = epoch; profileLoading.value = true; profileError.value = ''
    let pending!: Promise<authApi.ClientProfile>
    pending = (async () => {
      try {
        const response = await authApi.getProfile()
        if (getSessionEpoch() !== epoch) throw new Error('登录状态已变化，请重新登录')
        if (!response.data.customer) { reset(); throw new Error('当前账号未关联采购客户，请使用客户账号登录') }
        profile.value = response.data
        localStorage.setItem('webProfile', JSON.stringify(response.data))
        return response.data
      } catch (error) {
        if (getSessionEpoch() === epoch) { profile.value = null; localStorage.removeItem('webProfile'); profileError.value = '账户资料加载失败，请重试' }
        throw error
      } finally {
        if (getSessionEpoch() === epoch) profileLoading.value = false
        if (profileRequest === pending) profileRequest = null
      }
    })()
    profileRequest = pending
    return pending
  }

  async function signOut() {
    const epoch = getSessionEpoch()
    try {
      if (accessToken.value) await authApi.logout()
    } catch { /* 网络层已提示；远端异常仍必须退出本地账户。 */
    } finally {
      if (getSessionEpoch() === epoch) reset()
    }
  }

  function reset() {
    clearTokens()
    accessToken.value = null
    profile.value = null
    profileLoading.value = false; profileError.value = ''
  }

  return { profile, accessToken, loading, profileLoading, profileError, isAuthenticated, customer, customerName, signIn, loadProfile, signOut, reset }
})
