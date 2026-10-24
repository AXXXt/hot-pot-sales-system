<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createRole, getPermissions, getRoles, updateRole, updateRolePermissions } from '../../api/user'
import { getSessionEpoch, showRequestError } from '../../api/request'
import { useAuthStore } from '../../stores/auth'

interface Permission { id: number; name: string; code: string; status?: string }
interface Role { id: number; name: string; code: string; description?: string; status?: string; _count?: { userRoles: number }; permissions?: Array<{ permissionId: number; permission: Permission }> }
const auth = useAuthStore(), rows = ref<Role[]>([]), loading = ref(false), loadFailed = ref(false)
const editVisible = ref(false), editId = ref<number | null>(null), saving = ref(false)
const form = reactive({ name: '', code: '', description: '' })
const permissionVisible = ref(false), permissionRole = ref<Role | null>(null), permissionLoading = ref(false), permissionReady = ref(false)
const permissions = ref<Permission[]>([]), selected = ref<number[]>([]), search = ref(''), permissionSaving = ref(false), inactiveCount = ref(0)
const dataOf = (value: any) => value?.data ?? value
let generation = 0, permissionGeneration = 0
const valid = (epoch: number) => epoch === getSessionEpoch()
const groups = computed(() => {
  const result = new Map<string, Permission[]>()
  const names: Record<string, string> = { product: '商品', brand: '品牌', inventory: '库存', order: '订单', customer: '客户', role: '用户与角色', ai: 'AI助手', task: '任务', analytics: '统计', export: '导出', dashboard: '工作台', lead: '线索', audit: '审计' }
  for (const permission of permissions.value.filter(item => `${item.name} ${item.code}`.toLowerCase().includes(search.value.trim().toLowerCase()))) {
    const key = permission.code.split(':')[0], name = names[key] || key
    result.set(name, [...(result.get(name) || []), permission])
  }
  return [...result].map(([name, items]) => ({ name, items }))
})
async function load() {
  const current = ++generation, epoch = getSessionEpoch()
  loading.value = true; loadFailed.value = false
  try {
    const response = await getRoles()
    if (current !== generation || !valid(epoch)) return
    rows.value = dataOf(response) || []
  } catch (error) { if (current === generation && valid(epoch)) { loadFailed.value = true; showRequestError(error) } }
  finally { if (current === generation && valid(epoch)) loading.value = false }
}
function openEdit(role?: Role) {
  if (loading.value || saving.value) return
  editId.value = role?.id ?? null
  Object.assign(form, { name: role?.name || '', code: role?.code || '', description: role?.description || '' })
  editVisible.value = true
}
async function saveRole() {
  if (saving.value) return
  if (!form.name.trim()) return void ElMessage.warning('请输入角色名称')
  if (editId.value === null && !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(form.code.trim())) return void ElMessage.warning('角色编码请使用字母开头的英文、数字、下划线或短横线，最多64位')
  const epoch = getSessionEpoch(), id = editId.value
  saving.value = true
  try {
    const details = { name: form.name.trim(), description: form.description.trim() }
    if (id === null) await createRole({ ...details, code: form.code.trim() })
    else await updateRole(id, details)
    if (!valid(epoch)) return
    editVisible.value = false; ElMessage.success(id === null ? '角色已创建，尚未分配任何权限' : '角色资料已更新')
    await load()
  } catch (error) { if (valid(epoch)) showRequestError(error) }
  finally { if (valid(epoch)) saving.value = false }
}
async function openPermissions(role: Role) {
  const current = ++permissionGeneration, epoch = getSessionEpoch()
  permissionRole.value = role; permissionVisible.value = true; permissionLoading.value = true; permissionReady.value = false
  selected.value = []; permissions.value = []; search.value = ''; inactiveCount.value = 0
  try {
    const [roleResponse, permissionResponse] = await Promise.all([getRoles(), getPermissions()])
    if (current !== permissionGeneration || !valid(epoch)) return
    const fresh: Role | undefined = (dataOf(roleResponse) || []).find((item: Role) => item.id === role.id)
    if (!fresh) throw new Error('角色不存在，请关闭后刷新列表')
    // Missing grants must not look like an empty selection that can accidentally erase permissions.
    if (!Array.isArray(fresh.permissions)) throw new Error('未能加载角色当前权限，请刷新后重试')
    permissionRole.value = fresh
    permissions.value = (dataOf(permissionResponse) || []).filter((item: Permission) => !item.status || item.status === 'active')
    const activeIds = new Set(permissions.value.map(item => item.id))
    selected.value = fresh.permissions.map(link => link.permissionId).filter(id => activeIds.has(id))
    inactiveCount.value = fresh.permissions.length - selected.value.length
    permissionReady.value = true
  } catch (error) { if (current === permissionGeneration && valid(epoch)) showRequestError(error) }
  finally { if (current === permissionGeneration && valid(epoch)) permissionLoading.value = false }
}
async function savePermissions() {
  if (!permissionReady.value || permissionLoading.value || permissionSaving.value || !permissionRole.value) return
  const role = permissionRole.value, ids = [...selected.value], current = permissionGeneration, epoch = getSessionEpoch()
  permissionSaving.value = true
  try {
    await ElMessageBox.confirm(`确认将“${role.name}”的权限更新为所选 ${ids.length} 项？${ids.length ? '将撤销未勾选的权限。' : '这将撤销该角色全部权限。'}`, '确认权限变更', { type: 'warning', confirmButtonText: '确认保存', cancelButtonText: '返回检查' })
    if (!valid(epoch) || current !== permissionGeneration || !permissionVisible.value) return
    await updateRolePermissions(role.id, ids)
    if (!valid(epoch) || current !== permissionGeneration) return
    permissionVisible.value = false; ElMessage.success('角色权限已更新')
    if ((auth.profile?.roles || []).some(item => item.id === role.id)) await auth.loadProfile()
    await load()
  } catch (error) { if (error !== 'cancel' && error !== 'close' && valid(epoch)) showRequestError(error) }
  finally { if (valid(epoch) && current === permissionGeneration) permissionSaving.value = false }
}
function closePermissions() { permissionGeneration++; permissionReady.value = false; permissionSaving.value = false }
onMounted(load)
onBeforeUnmount(() => { generation++; permissionGeneration++ })
</script>

<template>
  <div class="role-tools"><p>角色决定操作权限；品牌范围在员工列表单独设置。新建角色默认没有权限。</p><div><el-button :disabled="loading" @click="load">刷新角色</el-button><el-button type="primary" @click="openEdit()">新建角色</el-button></div></div>
  <el-alert v-if="loadFailed" title="角色加载失败，请刷新后重试" type="error" :closable="false" />
  <el-table v-loading="loading" :data="rows" stripe>
    <el-table-column prop="name" label="角色名称" min-width="140" />
    <el-table-column prop="code" label="角色编码" min-width="130" />
    <el-table-column prop="description" label="说明" min-width="180" />
    <el-table-column label="人数" width="70"><template #default="{row}">{{ row._count?.userRoles || 0 }}</template></el-table-column>
    <el-table-column label="状态" width="90"><template #default="{row}">{{ row.status === 'disabled' ? '已停用' : '启用' }}</template></el-table-column>
    <el-table-column label="操作" width="205"><template #default="{row}"><el-button size="small" @click="openEdit(row)">编辑角色</el-button><el-button size="small" @click="openPermissions(row)">分配权限</el-button></template></el-table-column>
  </el-table>
  <el-dialog v-model="editVisible" :title="editId === null ? '新建角色' : '编辑角色'" width="min(540px, 94vw)" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving">
    <el-form label-position="top" @submit.prevent="saveRole">
      <el-form-item label="角色名称" required><el-input v-model="form.name" aria-label="角色名称" maxlength="100" :disabled="saving" /></el-form-item>
      <el-form-item label="角色编码" required><el-input v-model="form.code" aria-label="角色编码" maxlength="64" :disabled="editId !== null || saving" placeholder="例如 warehouse_reader" /><span v-if="editId !== null" class="hint">角色创建后编码保持不变。</span></el-form-item>
      <el-form-item label="角色说明"><el-input v-model="form.description" aria-label="角色说明" type="textarea" maxlength="255" :disabled="saving" /></el-form-item>
    </el-form>
    <template #footer><el-button :disabled="saving" @click="editVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveRole">保存角色</el-button></template>
  </el-dialog>
  <el-dialog v-model="permissionVisible" :title="`分配权限 · ${permissionRole?.name || ''}`" width="min(760px, 96vw)" :close-on-click-modal="!permissionSaving" :close-on-press-escape="!permissionSaving" :show-close="!permissionSaving" @close="closePermissions">
    <div v-if="permissionLoading" role="status">正在读取当前权限…</div>
    <el-alert v-else-if="!permissionReady" title="权限未加载成功，无法保存。请关闭后重新打开。" type="error" :closable="false" />
    <template v-else>
      <p>勾选需要的操作权限。保存会替换该角色当前权限，影响所有分配此角色的员工；服务器继续校验管理权限和管理员恢复规则。</p>
      <el-alert v-if="inactiveCount" :title="`有 ${inactiveCount} 项原权限已停用或不在有效列表，本次保存只保留所选有效权限。`" type="warning" :closable="false" />
      <el-input v-model="search" aria-label="搜索权限" placeholder="搜索权限名称或编码" clearable :disabled="permissionSaving" />
      <p>已选 {{ selected.length }} 项</p>
      <el-checkbox-group v-model="selected" :disabled="permissionSaving" class="permission-groups">
        <fieldset v-for="group in groups" :key="group.name"><legend>{{ group.name }}</legend><el-checkbox v-for="item in group.items" :key="item.id" :value="item.id"><span>{{ item.name }} <small>{{ item.code }}</small></span></el-checkbox></fieldset>
      </el-checkbox-group>
      <el-empty v-if="!groups.length" description="没有匹配的权限" :image-size="50" />
    </template>
    <template #footer><el-button :disabled="permissionSaving" @click="permissionVisible = false">取消</el-button><el-button type="primary" :disabled="!permissionReady || permissionLoading" :loading="permissionSaving" @click="savePermissions">保存权限</el-button></template>
  </el-dialog>
</template>

<style scoped>
.role-tools { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.role-tools p, .hint { color: var(--el-text-color-secondary); font-size: 13px; }
.permission-groups { max-height: 48vh; overflow: auto; }
fieldset { border: 1px solid var(--el-border-color); border-radius: 5px; margin: 12px 0; padding: 8px 14px; }
legend { font-weight: 600; padding: 0 6px; }
fieldset :deep(.el-checkbox) { height: auto; margin: 7px 24px 7px 0; }
small { display: block; color: var(--el-text-color-secondary); line-height: 1.3; }
</style>
