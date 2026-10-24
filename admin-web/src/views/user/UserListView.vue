<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { getUsers, createUser, updateUser, getRoles } from '../../api/user'
import { createPasswordSetupLink, sendCode } from '../../api/auth'
import { useAuthStore } from '../../stores/auth'
import { getSessionEpoch, showRequestError } from '../../api/request'
import RoleManagement from './RoleManagement.vue'
import UserBrandScope from './UserBrandScope.vue'

const auth = useAuthStore()
const passwordLink = ref('')
const passwordLinkExpiry = ref('')
const linkVisible = ref(false)
const linkLoading = ref<number | null>(null)
async function passwordSetup(row: any) {
  if (linkLoading.value) return
  linkLoading.value = row.id
  try {
    const response: any = await createPasswordSetupLink(row.id)
    passwordLink.value = new URL(response.data.path, window.location.origin).href
    passwordLinkExpiry.value = new Date(response.data.expiresAt).toLocaleTimeString('zh-CN')
    linkVisible.value = true
  } catch { /* 请求层展示错误 */ }
  finally { linkLoading.value = null }
}

const loading = ref(true)
const loadFailed = ref(false)
const rows = ref<any[]>([])
const roles = ref<any[]>([])
const page = ref(1), pageSize = 20, total = ref(0)
const roleManagerVisible = ref(false), brandVisible = ref(false), brandTarget = ref<any>(null)
const canManageBrands = computed(() => auth.can('role:manage') && auth.can('ai:configure'))
const drawer = ref(false)
const editTarget = ref<any>(null)
const saving = ref(false)
const sending = ref(false)
const seconds = ref(0)

const form = reactive({ name: '', phone: '', code: '', userType: '', roleIds: [] as number[] })
let generation = 0, smsTimer: ReturnType<typeof setInterval> | undefined

const dataOf = (r: any) => r?.data ?? r ?? {}

async function load() {
  const current = ++generation, epoch = getSessionEpoch()
  loading.value = true
  loadFailed.value = false
  try {
    const [uRes, rRes]: any = await Promise.all([getUsers({ page: page.value, pageSize }), getRoles()])
    if (current !== generation || epoch !== getSessionEpoch()) return
    rows.value = dataOf(uRes).items || dataOf(uRes) || []
    total.value = Number(dataOf(uRes).total ?? rows.value.length)
    roles.value = dataOf(rRes) || []
  } catch (error) { if (current === generation && epoch === getSessionEpoch()) { rows.value = []; roles.value = []; loadFailed.value = true; showRequestError(error) } }
  finally { if (current === generation && epoch === getSessionEpoch()) loading.value = false }
}

function roleTags(ur: any[]) { return (ur || []).map((r: any) => r.name || r.code).join(', ') || '未分配' }

function openCreate() {
  editTarget.value = null
  form.name = ''; form.phone = ''; form.code = ''; form.userType = ''; form.roleIds = []
  drawer.value = true
}

function openEdit(row: any) {
  editTarget.value = row
  form.name = row.name || ''
  form.phone = row.phone || ''
  form.code = ''
  form.userType = row.userType || ''
  form.roleIds = (row.roles || row.userRoles || []).map((r: any) => r.id)
  drawer.value = true
}

async function doSendCode() {
  if (!/^1\d{10}$/.test(form.phone)) { ElMessage.warning('请输入有效手机号'); return }
  sending.value = true
  try {
    await sendCode(form.phone, 'register')
    ElMessage.success('验证码已发送')
    seconds.value = 60
    if (smsTimer) clearInterval(smsTimer)
    smsTimer = setInterval(() => { seconds.value -= 1; if (seconds.value <= 0) clearInterval(smsTimer) }, 1000)
  } catch (e: any) { ElMessage.warning(e.message || '发送失败') }
  finally { sending.value = false }
}

async function save() {
  if (saving.value) return
  if (!form.name.trim()) { ElMessage.warning('请输入姓名'); return }
  if (!editTarget.value && !/^1\d{10}$/.test(form.phone)) { ElMessage.warning('请输入有效手机号'); return }
  if (!editTarget.value && !form.userType) { ElMessage.warning('请选择账号类型'); return }
  if (!editTarget.value && !form.code) { ElMessage.warning('请输入验证码'); return }

  const epoch = getSessionEpoch()
  saving.value = true
  try {
    if (editTarget.value) {
      const originalIds = (editTarget.value.roles || editTarget.value.userRoles || []).map((role: any) => role.id).sort((a: number, b: number) => a - b)
      const changed = JSON.stringify(originalIds) !== JSON.stringify([...form.roleIds].sort((a, b) => a - b))
      await updateUser(editTarget.value.id, { name: form.name.trim(), ...(changed ? { roleIds: [...form.roleIds] } : {}) })
      if (epoch !== getSessionEpoch()) return
      ElMessage.success('已更新')
    } else {
      await createUser({ name: form.name.trim(), phone: form.phone, code: form.code, userType: form.userType, roleIds: [...form.roleIds] })
      if (epoch !== getSessionEpoch()) return
      ElMessage.success('用户已创建')
    }
    drawer.value = false
    await load()
  } catch (error) { if (epoch === getSessionEpoch()) showRequestError(error, '保存失败') }
  finally { if (epoch === getSessionEpoch()) saving.value = false }
}

async function toggleStatus(row: any) {
  const epoch = getSessionEpoch()
  try {
    const newStatus = row.status === 'active' ? 'disabled' : 'active'
    await ElMessageBox.confirm(`确认${newStatus === 'active' ? '启用' : '禁用'} ${row.name}？`, '状态变更', { type: 'warning' })
    if (epoch !== getSessionEpoch()) return
    await updateUser(row.id, { status: newStatus })
    ElMessage.success('已更新')
    await load()
  } catch (e: any) { if (e !== 'cancel' && e !== 'close') ElMessage.warning(e.message || '操作失败') }
}

const typeTag = (t: string) => {
  const m: Record<string, string> = { super_admin: 'danger', admin: 'warning', finance: 'success', sales: '', warehouse: 'info', customer_service: 'info' }
  return m[t] || 'info'
}
const typeName = (t: string) => {
  const m: Record<string, string> = { super_admin: '超级管理员', admin: '管理员', finance: '财务', sales: '销售', warehouse: '仓库', customer_service: '客服', customer_user: '客户账号' }
  return m[t] || t
}

onMounted(load)
onBeforeUnmount(() => { generation++; if (smsTimer) clearInterval(smsTimer) })
</script>

<template>
  <section>
    <div class="page-heading">
      <div><h1>用户与角色</h1><p>后台员工、角色权限及品牌范围管理</p></div>
      <div style="display:flex;gap:8px">
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button @click="roleManagerVisible = true">角色与权限</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">添加用户</el-button>
      </div>
    </div>

    <div v-if="loading" class="inline-loading">加载中…</div>
    <el-alert v-else-if="loadFailed" title="用户加载失败，请刷新后重试" type="error" :closable="false" />

    <el-table v-else :data="rows" size="small" stripe style="width:100%">
      <el-table-column prop="name" label="姓名" width="120" />
      <el-table-column prop="phone" label="手机号" width="140" />
      <el-table-column label="角色" min-width="160">
        <template #default="{row}">{{ roleTags(row.roles || row.userRoles) }}</template>
      </el-table-column>
      <el-table-column label="类型" width="100">
        <template #default="{row}"><el-tag :type="typeTag(row.userType)" size="small">{{ typeName(row.userType) }}</el-tag></template>
      </el-table-column>
      <el-table-column label="状态" width="80">
        <template #default="{row}">
          <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">{{ row.status === 'active' ? '正常' : '禁用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="最后登录" width="160">
        <template #default="{row}">{{ row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString('zh-CN') : '-' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="345" fixed="right">
        <template #default="{row}">
          <el-button size="small" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="canManageBrands && row.userType !== 'customer_user'" size="small" @click="brandTarget = row; brandVisible = true">品牌范围</el-button>
          <el-button v-if="auth.profile?.user.userType === 'super_admin' && row.userType !== 'customer_user' && row.status === 'active'" size="small" :loading="linkLoading === row.id" @click="passwordSetup(row)">设置密码链接</el-button>
          <el-button size="small" :type="row.status === 'active' ? 'danger' : 'success'" @click="toggleStatus(row)">
            {{ row.status === 'active' ? '禁用' : '启用' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination v-if="total > pageSize" v-model:current-page="page" :page-size="pageSize" :total="total" layout="prev, pager, next, total" style="margin-top:18px" @current-change="load" />
    <el-drawer v-model="roleManagerVisible" title="角色与权限" size="min(1040px, 96vw)" destroy-on-close @closed="load"><RoleManagement v-if="roleManagerVisible" /></el-drawer>
    <UserBrandScope v-model="brandVisible" :user="brandTarget" />
    <el-dialog v-model="linkVisible" title="密码设置链接" width="min(560px, 92vw)" @closed="passwordLink = ''">
      <p>请将链接交给该账号本人设置密码。链接仅可使用一次，{{ passwordLinkExpiry }}前有效；重新生成后旧链接失效。</p>
      <el-input :model-value="passwordLink" readonly aria-label="一次性密码设置链接" />
      <p><a :href="passwordLink" target="_blank" rel="noopener noreferrer">打开设置页面</a></p>
      <template #footer><el-button @click="linkVisible = false">关闭</el-button></template>
    </el-dialog>

    <el-drawer v-model="drawer" :title="editTarget ? '编辑用户' : '添加用户'" direction="rtl" size="min(460px, 96vw)" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving">
      <el-form label-width="90">
        <el-form-item label="姓名" required>
          <el-input v-model="form.name" placeholder="真实姓名" maxlength="50" />
        </el-form-item>
        <el-form-item label="手机号" required v-if="!editTarget">
          <el-input v-model="form.phone" placeholder="11位手机号" maxlength="11" :disabled="!!editTarget" />
        </el-form-item>
        <el-form-item label="验证码" required v-if="!editTarget">
          <div style="display:flex;gap:10px;width:100%">
            <el-input v-model="form.code" placeholder="6位验证码" maxlength="6" style="flex:1" />
            <el-button :disabled="seconds > 0" :loading="sending" @click="doSendCode">{{ seconds ? `${seconds}秒` : '获取验证码' }}</el-button>
          </div>
        </el-form-item>
        <el-form-item label="账号类型" required v-if="!editTarget">
          <el-select v-model="form.userType" aria-label="账号类型" placeholder="请选择账号类型" :disabled="saving">
            <el-option v-for="type in ['sales', 'warehouse', 'customer_service', 'finance', 'admin', ...(auth.profile?.user.userType === 'super_admin' ? ['super_admin'] : [])]" :key="type" :value="type" :label="typeName(type)" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色">
          <el-checkbox-group v-model="form.roleIds" :disabled="saving">
            <el-checkbox v-for="r in roles" :key="r.id" :value="r.id" :disabled="r.status === 'disabled' && !form.roleIds.includes(r.id)">{{ r.name }}{{ r.status === 'disabled' ? '（已停用）' : '' }}</el-checkbox>
          </el-checkbox-group>
          <div v-if="!roles.length" class="inline-hint">暂无可分配角色</div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="save" style="width:100%">{{ editTarget ? '保存修改' : '确认添加' }}</el-button>
        </el-form-item>
      </el-form>
    </el-drawer>
  </section>
</template>

<style scoped>
.page-heading { margin-bottom: 20px; }
</style>
