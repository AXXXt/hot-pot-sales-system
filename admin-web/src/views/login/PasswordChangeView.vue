<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { changeLoginPassword } from '../../api/auth'
import { useAuthStore } from '../../stores/auth'
const router = useRouter()
const auth = useAuthStore()
const form = reactive({ currentPassword: '', password: '', confirmation: '' })
const error = ref('')
const saving = ref(false)
async function submit() {
  if (saving.value) return
  error.value = ''
  if (!form.currentPassword) { error.value = '请输入当前密码。'; return }
  if ([...form.currentPassword].length > 128) { error.value = '当前密码最多128个字符，请检查输入。'; return }
  if ([...form.password].length < 15 || [...form.password].length > 128 || !/\S/.test(form.password)) { error.value = '新密码须为15～128个字符，可使用长句。'; return }
  if (form.password !== form.confirmation) { error.value = '两次输入的新密码不一致。'; return }
  saving.value = true
  try {
    await changeLoginPassword(form.currentPassword, form.password)
    form.currentPassword = ''; form.password = ''; form.confirmation = ''
    auth.reset()
    await router.replace('/login')
  } catch (e: any) { error.value = e.message || '修改失败，请重试。' }
  finally { saving.value = false }
}
</script>
<template>
  <section class="password-change">
    <h1>修改登录密码</h1>
    <p>修改成功后需使用新密码重新登录。首次设置或忘记密码，请联系超级管理员获取设置链接。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <el-form label-position="top" @submit.prevent="submit">
      <el-form-item label="当前密码" for="current-password" required><el-input id="current-password" v-model="form.currentPassword" type="password" show-password autocomplete="current-password" /></el-form-item>
      <el-form-item label="新密码" for="new-password" required><el-input id="new-password" v-model="form.password" type="password" show-password autocomplete="new-password" /></el-form-item>
      <p class="hint">15～128个字符，可使用长句，区分大小写。</p>
      <el-form-item label="再次输入新密码" for="confirm-password" required><el-input id="confirm-password" v-model="form.confirmation" type="password" show-password autocomplete="new-password" /></el-form-item>
      <el-button native-type="submit" type="primary" :loading="saving">保存新密码并重新登录</el-button>
    </el-form>
  </section>
</template>
<style scoped>
.password-change { max-width:480px; margin-left:0; }
p { color:var(--brand-text-soft); line-height:1.7; }
.error { color:var(--el-color-danger); }
.hint { font-size:13px; margin:-8px 0 20px; }
:deep(.el-input__wrapper), :deep(.el-button) { min-height:44px; }
</style>
