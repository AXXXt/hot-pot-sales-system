<script setup lang="ts">
import { onUnmounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import * as authApi from '../api/auth'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const formRef = ref<FormInstance>()
const sending = ref(false)
const agree = ref(false)
const seconds = ref(0)
const form = reactive({ phone: '', code: '' })
const rules: FormRules = {
  phone: [{ required: true, pattern: /^1\d{10}$/, message: '请输入有效手机号', trigger: 'blur' }],
  code: [{ required: true, message: '请输入验证码', trigger: 'blur' }]
}
let timer = 0

async function handleSendCode() {
  await formRef.value?.validateField('phone').catch(() => Promise.reject())
  sending.value = true
  try {
    await authApi.sendCode(form.phone)
    ElMessage.success('验证码已发送')
    seconds.value = 60
    timer = window.setInterval(() => {
      seconds.value -= 1
      if (seconds.value <= 0) window.clearInterval(timer)
    }, 1000)
  } finally {
    sending.value = false
  }
}

async function handleLogin() {
  if (!agree.value) { ElMessage.warning('请先阅读并同意用户协议和隐私政策'); return }
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  try {
    await auth.signIn(form.phone, form.code)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/home'
    await router.replace(redirect)
  } catch (error: any) {
    if (!error?.handled) ElMessage.error(error?.message || '登录失败，请确认账号已通过审核')
  }
}

onUnmounted(() => window.clearInterval(timer))
</script>

<template>
  <main class="login-page">
    <section class="login-panel">
      <aside>
        <img class="logo" src="/brand/logo.jpg" alt="唯哆鲜" />
        <h1>唯哆鲜采购台</h1>
      </aside>
      <div class="form-area">
        <h2>客户登录</h2>
        <p class="muted">使用已审核通过的采购账号手机号登录</p>
        <el-form ref="formRef" :model="form" :rules="rules" size="large" label-position="top" @submit.prevent="handleLogin">
          <el-form-item label="手机号" prop="phone">
            <el-input v-model="form.phone" type="tel" autocomplete="tel" maxlength="11" placeholder="请输入手机号" />
          </el-form-item>
          <el-form-item label="短信验证码" prop="code">
            <div class="code-row">
              <el-input v-model="form.code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="请输入验证码" />
              <el-button :disabled="seconds > 0" :loading="sending" @click="handleSendCode">
                {{ seconds ? `${seconds}秒` : '获取验证码' }}
              </el-button>
            </div>
          </el-form-item>
          <div class="agreement"><el-checkbox v-model="agree">我已阅读并同意</el-checkbox><router-link to="/legal/terms" target="_blank">用户协议</router-link><span>和</span><router-link to="/legal/privacy" target="_blank">隐私政策</router-link></div>
          <el-button native-type="submit" type="primary" size="large" class="login-submit" :loading="auth.loading">登录采购台</el-button>
          <p class="login-tip">未开通账号？请联系合作热线 13937802005</p>
        </el-form>
      </div>
    </section>
  </main>
</template>

<style scoped>

.login-page { min-height: 100dvh; padding: 48px 24px; display: grid; place-items: center; background: white; }
.login-panel { width: min(420px, 100%); }
aside { padding: 0 0 24px; border-bottom: 1px solid var(--line); }
.logo { width: 128px; height: 100px; object-fit: contain; display: block; margin-bottom: 12px; }
h1 { margin: 0; font-size: 24px; line-height: 1.4; font-weight: 600; }
.form-area { padding-top: 28px; }
h2 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
p { line-height: 1.6; }
.form-area > p { margin-bottom: 24px; }
.code-row { display: grid; grid-template-columns: minmax(0,1fr) 120px; gap: 10px; width: 100%; }
.login-submit { width: 100%; margin-top: 12px; }
.login-tip { margin: 20px 0 0; color: var(--muted); font-size: 13px; }
.agreement { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 13px; margin-bottom: 12px; }
.agreement a { color: var(--green); text-decoration: underline; text-underline-offset: 3px; }
.agreement .el-checkbox { margin-right: 0; }
@media (max-width: 600px) { .login-page { align-items: start; padding-top: 24px; } }

</style>
