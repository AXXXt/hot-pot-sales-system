<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageTable from '../../components/PageTable.vue'
import { createCustomerLevel, getCustomerLevels, getCustomerLevelReadiness, updateCustomerLevel } from '../../api/customer'
import { getBrands } from '../../api/product'

const loading = ref(false), saving = ref(false), visible = ref(false), error = ref('')
const rows = ref<any[]>([]), brands = ref<any[]>([]), readiness = ref<any>(null)
const form = reactive({ id: 0, brandId: null as number | null, name: '', code: '', discountRate: '1', description: '' })
const dataOf = (response: any) => response?.data ?? response

async function load() {
  loading.value = true; error.value = ''
  try {
    const [levels, registered, available]: any[] = await Promise.all([
      getCustomerLevels({ includeDisabled: true }), getCustomerLevelReadiness(), getBrands()
    ])
    rows.value = dataOf(levels) || []; readiness.value = dataOf(registered); brands.value = dataOf(available) || []
  } catch (err: any) { error.value = err.message || '客户等级加载失败' }
  finally { loading.value = false }
}
function edit(row?: any) {
  Object.assign(form, row ? { id: row.id, brandId: row.brandId, name: row.name, code: row.code,
    discountRate: row.discountRate == null ? '1' : String(row.discountRate), description: row.description || '' }
    : { id: 0, brandId: null, name: '', code: '', discountRate: '1', description: '' })
  visible.value = true
}
async function save() {
  if (!form.name.trim() || !form.brandId || (!form.id && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(form.code))) {
    ElMessage.warning('请填写名称、品牌和有效的等级编码'); return
  }
  if (!/^\d+(?:\.\d{1,4})?$/.test(form.discountRate) || Number(form.discountRate) <= 0 || Number(form.discountRate) > 1) {
    ElMessage.warning('折扣率须大于0且不超过1，最多4位小数'); return
  }
  saving.value = true
  try {
    const body = { name: form.name.trim(), discountRate: form.discountRate, description: form.description.trim() }
    if (form.id) await updateCustomerLevel(form.id, body)
    else await createCustomerLevel({ ...body, brandId: form.brandId, code: form.code })
    visible.value = false; ElMessage.success('等级已保存'); await load()
  } catch (err: any) { ElMessage.warning(err.message || '保存失败') }
  finally { saving.value = false }
}
async function toggle(row: any) {
  try {
    const enabling = row.status !== 'active'
    await ElMessageBox.confirm(enabling ? `启用「${row.name}」？` : `停用「${row.name}」后不再用于新客户选择。${row.code === 'normal' ? '这可能影响新客户注册，请先核对默认等级。' : ''}`,
      enabling ? '启用等级' : '停用等级', { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' })
    await updateCustomerLevel(row.id, { status: enabling ? 'active' : 'disabled' })
    await load()
  } catch (err: any) { if (err !== 'cancel' && err !== 'close') ElMessage.warning(err.message || '操作失败') }
}
onMounted(load)
</script>

<template>
  <section>
    <div class="page-heading"><div><h1>客户等级</h1><p>维护等级及折扣，并检查新客户注册的默认配置</p></div><el-button type="primary" @click="edit()">新建等级</el-button></div>
    <el-alert v-if="readiness" :type="readiness.warning ? 'warning' : 'success'" :closable="false" show-icon
      :title="readiness.warning || `注册配置正常：${readiness.defaultLevel?.name || ''}`" class="readiness" />
    <el-card shadow="never">
      <PageTable :loading="loading" :error="error" :empty="!rows.length" @retry="load">
        <el-table :data="rows" row-key="id">
          <el-table-column prop="name" label="等级名称" min-width="150" />
          <el-table-column prop="code" label="编码" min-width="120" />
          <el-table-column label="品牌" min-width="140"><template #default="{ row }">{{ row.brand?.name || row.brandId }}</template></el-table-column>
          <el-table-column label="记录折扣率" width="110"><template #default="{ row }">{{ row.discountRate == null ? '未设置' : row.discountRate }}</template></el-table-column>
          <el-table-column label="客户数" width="90"><template #default="{ row }">{{ row._count?.customers || 0 }}</template></el-table-column>
          <el-table-column label="状态" width="100"><template #default="{ row }">{{ row.status === 'active' ? '启用' : '停用' }}</template></el-table-column>
          <el-table-column label="操作" width="160"><template #default="{ row }"><el-button link type="primary" @click="edit(row)">编辑</el-button><el-button link @click="toggle(row)">{{ row.status === 'active' ? '停用' : '启用' }}</el-button></template></el-table-column>
        </el-table>
      </PageTable>
    </el-card>
    <el-dialog v-model="visible" :title="form.id ? '编辑客户等级' : '新建客户等级'" width="min(520px, 92vw)" :close-on-click-modal="!saving">
      <el-form label-width="90px" :disabled="saving">
        <el-form-item label="品牌" required><el-select v-model="form.brandId" :disabled="!!form.id" placeholder="选择品牌"><el-option v-for="brand in brands" :key="brand.id" :label="brand.name" :value="brand.id" /></el-select></el-form-item>
        <el-form-item label="等级名称" required><el-input v-model="form.name" maxlength="100" /></el-form-item>
        <el-form-item label="等级编码" required><el-input v-model="form.code" :disabled="!!form.id" maxlength="64" placeholder="英文、数字、下划线或短横线" /></el-form-item>
        <p class="hint">编码 normal 用于新注册默认等级；多个启用记录时按最早创建的记录分配。编码和品牌创建后保留。</p>
        <p class="hint">折扣率仅作等级资料记录；当前成交价格由商品基础价及客户协议价确定，不会随等级自动变化。</p>
        <el-form-item label="记录折扣率"><el-input v-model="form.discountRate" placeholder="1为100%，0.95为95%" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="form.description" type="textarea" maxlength="255" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="saving" @click="visible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存等级</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.page-heading { justify-content: space-between; }
.readiness { margin-bottom: 16px; }
.hint { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.7; margin: -4px 0 18px 90px; }
</style>
