<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getUser, getUserBrandOptions, updateUserBrands } from '../../api/user'
import { getSessionEpoch, showRequestError } from '../../api/request'
import { useAuthStore } from '../../stores/auth'

const props = defineProps<{ user: { id: number; name: string; userType: string } | null }>()
const visible = defineModel<boolean>({ default: false })
const auth = useAuthStore(), loading = ref(false), ready = ref(false), saving = ref(false)
const brands = ref<Array<{ id: number; name: string }>>([]), selected = ref<number[]>([])
const allowed = computed(() => auth.can('role:manage') && auth.can('ai:configure'))
let generation = 0
const dataOf = (value: any) => value?.data ?? value
async function load() {
  const current = ++generation, epoch = getSessionEpoch(), user = props.user
  ready.value = false; brands.value = []; selected.value = []
  if (!visible.value || !user || !allowed.value) return
  loading.value = true
  try {
    const [detailResponse, optionsResponse] = await Promise.all([getUser(user.id), getUserBrandOptions()])
    if (current !== generation || epoch !== getSessionEpoch() || !visible.value) return
    const detail = dataOf(detailResponse), options = dataOf(optionsResponse)
    if (detail?.id !== user.id || !Array.isArray(detail.brandIds) || !Array.isArray(options?.brands)) throw new Error('员工品牌范围未能完整加载，请重试')
    brands.value = options.brands
    const candidates = new Set(brands.value.map(item => item.id))
    selected.value = detail.brandIds.filter((id: number) => candidates.has(id))
    ready.value = true
  } catch (error) { if (current === generation && epoch === getSessionEpoch()) showRequestError(error) }
  finally { if (current === generation && epoch === getSessionEpoch()) loading.value = false }
}
async function save() {
  if (!ready.value || loading.value || saving.value || !allowed.value || !props.user || props.user.userType === 'super_admin') return
  const user = props.user, ids = [...selected.value], current = generation, epoch = getSessionEpoch()
  saving.value = true
  try {
    await ElMessageBox.confirm(`确认更新“${user.name}”的可管理品牌范围为 ${ids.length} 项？${ids.length ? '' : '未分配品牌时，该员工不能操作品牌范围内的数据。'}`, '确认品牌范围', { confirmButtonText: '确认保存', cancelButtonText: '返回检查', type: 'warning' })
    if (current !== generation || epoch !== getSessionEpoch() || !visible.value || !allowed.value) return
    await updateUserBrands(user.id, ids)
    if (current !== generation || epoch !== getSessionEpoch()) return
    ElMessage.success('员工品牌范围已更新'); visible.value = false
    if (auth.profile?.user.id === user.id) await auth.loadProfile()
  } catch (error) { if (error !== 'cancel' && error !== 'close' && current === generation && epoch === getSessionEpoch()) showRequestError(error) }
  finally { if (current === generation && epoch === getSessionEpoch()) saving.value = false }
}
watch(() => [visible.value, props.user?.id], () => {
  if (visible.value) void load()
  else { generation++; ready.value = false; saving.value = false }
})
onBeforeUnmount(() => generation++)
</script>

<template>
  <el-drawer v-model="visible" :title="`员工品牌范围 · ${user?.name || ''}`" size="min(520px, 96vw)" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving">
    <el-alert v-if="!allowed" title="查看和修改品牌范围同时需要用户角色管理、AI配置权限。" type="warning" :closable="false" />
    <div v-else-if="loading" role="status">正在读取员工当前品牌范围…</div>
    <template v-else-if="!ready"><el-alert title="品牌范围未加载成功，暂不能保存。" type="error" :closable="false" /><el-button style="margin-top:12px" @click="load">重新加载品牌范围</el-button></template>
    <template v-else>
      <el-alert v-if="user?.userType === 'super_admin'" title="超级管理员具有全部品牌范围，此处选择不会限制其权限。" type="info" :closable="false" />
      <p>仅显示你有权分配的有效品牌。保存只更新此范围，员工在其他范围的既有授权由服务器保留；角色操作权限仍需单独分配。</p>
      <el-checkbox-group v-model="selected" :disabled="saving || user?.userType === 'super_admin'" class="brand-options">
        <el-checkbox v-for="brand in brands" :key="brand.id" :value="brand.id">{{ brand.name }}</el-checkbox>
      </el-checkbox-group>
      <el-empty v-if="!brands.length" description="当前没有可分配的有效品牌" :image-size="70" />
      <p class="hint">已选 {{ selected.length }} 项。普通员工未分配品牌时，默认没有品牌数据范围。</p>
    </template>
    <template #footer><el-button :disabled="saving" @click="visible = false">关闭</el-button><el-button v-if="allowed && user?.userType !== 'super_admin'" type="primary" :disabled="!ready || loading" :loading="saving" @click="save">保存品牌范围</el-button></template>
  </el-drawer>
</template>

<style scoped>
p { line-height: 1.7; }
.brand-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.hint { color: var(--el-text-color-secondary); font-size: 13px; }
</style>
