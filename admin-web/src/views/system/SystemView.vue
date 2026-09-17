<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import PageTable from '../../components/PageTable.vue'
import { getSystemConfigs, updateSystemConfig } from '../../api/system'

const loading = ref(false)
const error = ref('')
const rows = ref<any[]>([])

const dataOf = (r: any) => r?.data ?? r ?? {}

async function load() {
  loading.value = true; error.value = ''
  try {
    const res: any = await getSystemConfigs()
    rows.value = dataOf(res) || []
  } catch (e: any) { error.value = e.message || '加载失败' }
  finally { loading.value = false }
}

const editVisible = ref(false)
const editSaving = ref(false)
const editForm = reactive({ key: '', value: '', remark: '' })

function openEdit(row: any) {
  editForm.key = row.configKey
  editForm.value = row.configValue
  editForm.remark = row.remark || ''
  editVisible.value = true
}

async function saveEdit() {
  editSaving.value = true
  try {
    await updateSystemConfig(editForm.key, { configValue: editForm.value, remark: editForm.remark })
    ElMessage.success('配置已更新')
    editVisible.value = false
    load()
  } catch (e: any) { ElMessage.warning(e.message || '保存失败') }
  finally { editSaving.value = false }
}

onMounted(load)
</script>

<template>
  <section>
    <div class="page-heading">
      <div><h1>系统配置</h1><p>维护系统键值配置，修改后即时生效</p></div>
    </div>
    <el-card shadow="never">
      <PageTable :loading="loading" :error="error" :empty="!rows.length" @retry="load">
        <el-table :data="rows" stripe size="small">
          <el-table-column prop="configKey" label="配置键" width="220" />
          <el-table-column prop="configValue" label="配置值" min-width="240">
            <template #default="{ row }">{{ row.configValue }}</template>
          </el-table-column>
          <el-table-column prop="configType" label="类型" width="100" />
          <el-table-column prop="remark" label="说明" min-width="180">
            <template #default="{ row }">{{ row.remark || '-' }}</template>
          </el-table-column>
          <el-table-column label="更新时间" width="170">
            <template #default="{ row }">{{ new Date(row.updatedAt).toLocaleString('zh-CN') }}</template>
          </el-table-column>
          <el-table-column label="操作" width="90" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            </template>
          </el-table-column>
        </el-table>
      </PageTable>
    </el-card>

    <el-dialog v-model="editVisible" title="编辑系统配置" width="560">
      <el-form label-width="90">
        <el-form-item label="配置键">
          <el-input :model-value="editForm.key" disabled />
        </el-form-item>
        <el-form-item label="配置值">
          <el-input v-model="editForm.value" type="textarea" :rows="4" placeholder="配置值" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="editForm.remark" placeholder="可选说明" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.page-heading { margin-bottom: 20px; }
</style>