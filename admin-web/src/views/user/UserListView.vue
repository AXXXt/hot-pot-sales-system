<script setup lang="ts">
import { onMounted, ref, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { getUsers, createUser, updateUser, getRoles } from '../../api/user'
import { sendCode } from '../../api/auth'

const loading = ref(true)
const rows = ref<any[]>([])
const roles = ref<any[]>([])
const drawer = ref(false)
const editTarget = ref<any>(null)
const saving = ref(false)
const sending = ref(false)
const seconds = ref(0)

const form = reactive({ name: '', phone: '', code: '', roleIds: [] as number[] })

const dataOf = (r: any) => r?.data ?? r ?? {}

async function load() {
  loading.value = true
  try {
    const [uRes, rRes]: any = await Promise.all([getUsers({ pageSize: 100 }), getRoles()])
    rows.value = dataOf(uRes).items || dataOf(uRes) || []
    roles.value = dataOf(rRes) || []
  } catch { rows.value = []; roles.value = [] }
  finally { loading.value = false }
}

function roleTags(ur: any[]) { return (ur || []).map((r: any) => r.name || r.code).join(', ') || '未分配' }

function openCreate() {
  editTarget.value = null
  form.name = ''; form.phone = ''; form.code = ''; form.roleIds = []
  drawer.value = true
}

function openEdit(row: any) {
  editTarget.value = row
  form.name = row.name || ''
  form.phone = row.phone || ''
  form.code = ''
  form.roleIds = (row.roles || row.userRoles || []).map((r: any) => r.id)
  drawer.value = true
}

async function doSendCode() {
  if (!/^1\d{10}$/.test(form.phone)) { ElMessage.warning('请输入有效手机号'); return }
  sending.value = true
  try {
    await sendCode(form.phone)
    ElMessage.success('验证码已发送')
    seconds.value = 60
    const timer = window.setInterval(() => { seconds.value -= 1; if (seconds.value <= 0) window.clearInterval(timer) }, 1000)
  } catch (e: any) { ElMessage.warning(e.message || '发送失败') }
  finally { sending.value = false }
}

async function save() {
  if (!form.name) { ElMessage.warning('请输入姓名'); return }
  if (!editTarget.value && !form.code) { ElMessage.warning('请输入验证码'); return }

  saving.value = true
  try {
    if (editTarget.value) {
      await updateUser(editTarget.value.id, { name: form.name, roleIds: form.roleIds })
      ElMessage.success('已更新')
    } else {
      await createUser({ name: form.name, phone: form.phone, code: form.code, userType: 'admin', roleIds: form.roleIds })
      ElMessage.success('用户已创建')
    }
    drawer.value = false
    await load()
  } catch (e: any) { ElMessage.warning(e.message || '保存失败') }
  finally { saving.value = false }
}

async function toggleStatus(row: any) {
  try {
    const newStatus = row.status === 'active' ? 'disabled' : 'active'
    await ElMessageBox.confirm(`确认${newStatus === 'active' ? '禁用' : '启用'} ${row.name}？`, '状态变更', { type: 'warning' })
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
  const m: Record<string, string> = { super_admin: '超级管理员', admin: '管理员', finance: '财务', sales: '销售', warehouse: '仓库', customer_service: '客服' }
  return m[t] || t
}

onMounted(load)
</script>

<template>
  <section>
    <div class="page-heading">
      <div><h1>用户管理</h1><p>后台操作员与角色管理</p></div>
      <div style="display:flex;gap:8px">
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">添加用户</el-button>
      </div>
    </div>

    <div v-if="loading" class="inline-loading">加载中…</div>

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
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{row}">
          <el-button size="small" @click="openEdit(row)">编辑</el-button>
          <el-button size="small" :type="row.status === 'active' ? 'danger' : 'success'" @click="toggleStatus(row)">
            {{ row.status === 'active' ? '禁用' : '启用' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-drawer v-model="drawer" :title="editTarget ? '编辑用户' : '添加用户'" direction="rtl" size="420">
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
        <el-form-item label="角色">
          <el-checkbox-group v-model="form.roleIds">
            <el-checkbox v-for="r in roles" :key="r.id" :label="r.id" :value="r.id">{{ r.name }}</el-checkbox>
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
