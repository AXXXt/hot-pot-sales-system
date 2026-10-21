<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { sendCode } from '../../api/auth'
import { useAuthStore } from '../../stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const formRef = ref<FormInstance>()
const sending = ref(false)
const seconds = ref(0)
const form = reactive({ phone: '', code: '' })
const rules: FormRules = {
  phone: [{ required: true, pattern: /^1\d{10}$/, message: '请输入有效手机号', trigger: 'blur' }],
  code: [{ required: true, message: '请输入验证码', trigger: 'blur' }]
}

async function handleSendCode() {
  try {
    await formRef.value?.validateField('phone')
    sending.value = true
    await sendCode(form.phone)
    ElMessage.success('验证码已发送')
    seconds.value = 60
    const timer = window.setInterval(() => {
      seconds.value -= 1
      if (seconds.value <= 0) window.clearInterval(timer)
    }, 1000)
  } catch {
    // 请求层统一展示服务端错误，表单校验错误由表单项展示。
  } finally {
    sending.value = false
  }
}

async function handleLogin() {
  try {
    if (!await formRef.value?.validate()) return
    await auth.signIn(form.phone, form.code)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard'
    await router.replace(redirect)
  } catch {
    // 防止请求失败形成未处理的事件 Promise，错误信息由请求层统一展示。
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
        <div class="form-heading"><h2>管理员登录</h2><p>使用已授权手机号完成身份验证</p></div>
        <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="handleLogin">
          <el-form-item label="手机号" prop="phone"><el-input v-model="form.phone" maxlength="11" placeholder="请输入管理员手机号" /></el-form-item>
          <el-form-item label="验证码" prop="code">
            <div class="code-row"><el-input v-model="form.code" maxlength="6" placeholder="请输入验证码" /><el-button :disabled="seconds > 0" :loading="sending" @click="handleSendCode">{{ seconds ? `${seconds}秒` : '获取验证码' }}</el-button></div>
          </el-form-item>
          <el-button native-type="submit" type="primary" :loading="auth.loading" class="submit">登录</el-button>
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
@media (max-width: 600px) { .login-page { align-items: start; padding-top: 24px; } }

</style>
