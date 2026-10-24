<script setup lang="ts">
import { onUnmounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { sendCode } from '../../api/auth'
import { useAuthStore } from '../../stores/auth'
import legal from '../../../../constants/legal.json'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const formRef = ref<FormInstance>()
const sending = ref(false)
const seconds = ref(0)
const method = ref<'password' | 'sms'>('password')
const form = reactive({ phone: '', code: '', password: '' })
const loginError = ref('')
const agree = ref(false)
let timer: ReturnType<typeof setInterval> | undefined
onUnmounted(() => { if (timer) clearInterval(timer) })
const rules: FormRules = {
  phone: [{ required: true, pattern: /^1\d{10}$/, message: '请输入有效手机号', trigger: 'blur' }],
  code: [{ required: true, message: '请输入验证码', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入登录密码', trigger: 'blur' },
    { validator: (_rule, value, callback) => [...String(value || '')].length > 128 ? callback(new Error('密码最多128个字符，请检查输入')) : callback(), trigger: 'blur' }
  ]
}

async function handleSendCode() {
  try {
    await formRef.value?.validateField('phone')
    sending.value = true
    await sendCode(form.phone)
    ElMessage.success('验证码已发送')
    seconds.value = 60
    if (timer) clearInterval(timer)
    timer = setInterval(() => {
      seconds.value -= 1
      if (seconds.value <= 0) clearInterval(timer)
    }, 1000)
  } catch {
    // 请求层统一展示服务端错误，表单校验错误由表单项展示。
  } finally {
    sending.value = false
  }
}

async function handleLogin() {
  if (auth.loading) return
  loginError.value = ''
  if (!agree.value) { loginError.value = '请先阅读并同意用户协议和隐私政策'; return }
  try {
    if (!await formRef.value?.validate()) return
    await auth.signIn(form.phone, method.value === 'password' ? form.password : form.code, method.value,
      { consentAccepted: agree.value, consentVersion: legal.version, consentChannel: 'admin_web' })
    form.password = ''
    const target = typeof route.query.redirect === 'string' ? route.query.redirect : ''
    const redirect = target.startsWith('/') && !target.startsWith('//') ? target : '/dashboard'
    await router.replace(redirect)
  } catch (error: any) {
    if (error?.message) loginError.value = error.message
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-panel">
      <div class="login-intro">
        <img class="logo" src="/brand/logo.jpg" alt="唯哆鲜" />
        <h1>唯哆鲜运营台</h1>
      </div>
      <div class="login-form-card">
        <div class="form-heading"><h2>管理员登录</h2><p>使用已授权的后台账号登录</p></div>
        <el-radio-group v-model="method" class="login-method" aria-label="登录方式" @change="loginError = ''; formRef?.clearValidate()">
          <el-radio-button value="password">密码登录</el-radio-button>
          <el-radio-button value="sms">验证码登录</el-radio-button>
        </el-radio-group>
        <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="handleLogin">
          <el-form-item label="账号（手机号）" prop="phone" for="login-account"><el-input id="login-account" v-model="form.phone" type="tel" inputmode="tel" autocomplete="username" maxlength="11" placeholder="请输入管理员手机号" /></el-form-item>
          <el-form-item v-if="method === 'password'" label="登录密码" prop="password" for="login-password"><el-input id="login-password" v-model="form.password" type="password" show-password autocomplete="current-password" placeholder="请输入登录密码" /></el-form-item>
          <el-form-item v-else label="验证码" prop="code" for="login-code">
            <div class="code-row"><el-input id="login-code" v-model="form.code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="请输入验证码" /><el-button :disabled="seconds > 0" :loading="sending" @click="handleSendCode">{{ seconds ? `${seconds}秒` : '获取验证码' }}</el-button></div>
          </el-form-item>
          <p v-if="loginError" role="alert" class="login-error">{{ loginError }}</p>
          <div class="agreement"><el-checkbox v-model="agree">我已阅读并同意</el-checkbox><router-link to="/legal/terms" target="_blank" rel="noopener">用户协议</router-link><span>和</span><router-link to="/legal/privacy" target="_blank" rel="noopener">隐私政策</router-link></div>
          <el-button native-type="submit" type="primary" :loading="auth.loading" class="submit">登录</el-button>
          <p v-if="method === 'password'" class="password-help">首次使用或忘记密码，请联系超级管理员获取密码设置链接。</p>
        </el-form>
      </div>
    </section>
  </main>
</template>

<style scoped>

.login-page { min-height: 100dvh; padding: 48px 24px; display: grid; place-items: center; background: white; }
.login-panel { width: min(420px, 100%); }
.login-intro { padding-bottom: 24px; border-bottom: 1px solid var(--brand-border); }
.logo { width: 128px; height: 100px; object-fit: contain; display: block; margin-bottom: 12px; }
.login-intro h1 { margin: 0; font-size: 24px; font-weight: 600; }
.login-form-card { padding-top: 28px; }
.form-heading { margin-bottom: 24px; }
.form-heading h2 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
.form-heading p { margin: 0; color: var(--brand-text-soft); font-size: 14px; line-height: 1.6; }
.code-row { display: grid; grid-template-columns: minmax(0,1fr) 120px; gap: 10px; width: 100%; }
.submit { width: 100%; min-height: 44px; margin-top: 12px; }
.login-method { display:flex; margin-bottom:24px; }
.login-method :deep(.el-radio-button) { flex:1; }
.login-method :deep(.el-radio-button__inner) { width:100%; min-height:44px; display:flex; justify-content:center; align-items:center; }
.password-help { color:var(--brand-text-soft); font-size:13px; line-height:1.7; margin-top:16px; }
.login-error { color:var(--el-color-danger); font-size:14px; line-height:1.6; }
.agreement { display:flex; flex-wrap:wrap; align-items:center; gap:4px 8px; font-size:13px; line-height:1.7; }
.agreement a { color:var(--el-color-primary); text-decoration:underline; }
.agreement .el-checkbox { margin-right:0; }
.login-form-card :deep(.el-input__wrapper) { min-height:44px; }
@media (max-width: 600px) { .login-page { align-items: start; padding-top: 24px; } }

</style>
