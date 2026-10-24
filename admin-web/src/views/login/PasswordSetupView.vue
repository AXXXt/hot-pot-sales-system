<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { passwordSetupInfo, setLoginPassword } from '../../api/auth'
const router = useRouter()
// URL fragments stay out of server request logs and Referer headers.
const token = new URLSearchParams(window.location.hash.slice(1)).get('token') || ''
const loading = ref(true)
const saving = ref(false)
const complete = ref(false)
const error = ref('')
const account = ref('')
const form = reactive({ password: '', confirmation: '' })
onMounted(async () => {
  try {
    if (!token) throw new Error('密码设置链接无效或已过期，请联系超级管理员重新生成。')
    const response: any = await passwordSetupInfo(token)
    account.value = response.data.account
  } catch (e: any) { error.value = e.message || '无法验证链接，请联系超级管理员重新生成。' }
  finally { loading.value = false }
})
async function submit() {
  if (saving.value) return
  error.value = ''
  if ([...form.password].length < 15 || [...form.password].length > 128 || !/\S/.test(form.password)) { error.value = '密码须为15～128个字符，可使用长句，区分大小写。'; return }
  if (form.password !== form.confirmation) { error.value = '两次输入的密码不一致。'; return }
  saving.value = true
  try {
    await setLoginPassword(token, form.password)
    form.password = ''; form.confirmation = ''
    window.history.replaceState(window.history.state, '', '/password/setup')
    complete.value = true
  } catch (e: any) { error.value = e.message || '密码设置失败，请重试。' }
  finally { saving.value = false }
}
</script>
<template>
  <main class="setup-page"><section class="setup-panel">
    <img class="logo" src="/brand/logo.jpg" alt="唯哆鲜" />
    <h1>{{ complete ? '登录密码已设置' : '设置登录密码' }}</h1>
    <p v-if="loading" role="status">正在验证设置链接…</p>
    <template v-else-if="complete">
      <p>现在可以使用手机号账号和新密码登录管理端。</p>
      <el-button type="primary" class="submit" @click="router.replace('/login')">返回登录</el-button>
    </template>
    <template v-else>
      <p v-if="account">账号：{{ account }}</p>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <el-form v-if="account" label-position="top" @submit.prevent="submit">
        <el-form-item label="新密码" for="setup-password" required><el-input id="setup-password" v-model="form.password" type="password" show-password autocomplete="new-password" aria-describedby="password-help" /></el-form-item>
        <p id="password-help" class="hint">15～128个字符，可使用容易记住的长句，区分大小写。</p>
        <el-form-item label="再次输入新密码" for="setup-confirmation" required><el-input id="setup-confirmation" v-model="form.confirmation" type="password" show-password autocomplete="new-password" /></el-form-item>
        <el-button native-type="submit" type="primary" :loading="saving" class="submit">设置密码</el-button>
      </el-form>
      <el-button v-else @click="router.replace('/login')">返回登录</el-button>
    </template>
  </section></main>
</template>
<style scoped>
.setup-page { min-height:100dvh; padding:48px 24px; display:grid; place-items:center; }
.setup-panel { width:min(420px,100%); }
.logo { width:128px; height:100px; object-fit:contain; }
h1 { font-size:24px; line-height:1.5; margin:24px 0 12px; }
p { color:var(--brand-text-soft); line-height:1.7; }
.hint { font-size:13px; margin:-8px 0 20px; }
.error { color:var(--el-color-danger); }
.submit { width:100%; min-height:44px; margin-top:12px; }
:deep(.el-input__wrapper) { min-height:44px; }
@media(max-width:600px) { .setup-page { align-items:start; padding-top:24px; } }
</style>
