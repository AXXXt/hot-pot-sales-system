<script setup lang="ts">
defineProps<{ action: string; form: any; saved: any }>()
function selectSku(line: any, id: number) {
  const item = line.candidates?.find((x: any) => x.skuId === id)
  if (item) { line.specText = item.specText; line.unit = item.saleUnit }
}
</script>

<template>
  <template v-if="action === 'inventory.batch'">
    <el-form-item label="清单类型"><el-select v-model="form.mode" aria-label="批量库存操作"><el-option label="到货入库" value="increase" /><el-option label="出库 / 报损" value="decrease" /><el-option label="盘点实盘总数" value="set" /></el-select></el-form-item>
    <el-form-item label="原因"><el-input v-model="form.reason" maxlength="200" /></el-form-item>
  </template>
  <template v-else>
    <el-form-item label="客户名称"><el-input v-model="form.customerName" aria-label="采购清单客户" placeholder="填写客户全名后保存核对" @input="form.customerId = null" /></el-form-item>
    <el-form-item v-if="form.customerCandidates?.length > 1" label="选择客户"><el-select v-model="form.customerId" aria-label="选择采购客户"><el-option v-for="item in form.customerCandidates" :key="item.id" :value="item.id" :label="`${item.customerName} · ${item.id}`" /></el-select></el-form-item>
    <el-form-item label="订单备注"><el-input v-model="form.remark" maxlength="500" /></el-form-item>
  </template>
  <div v-for="(line, index) in form.lines" :key="index" class="workflow-line">
    <strong>第{{ Number(index) + 1 }}行</strong>
    <el-form-item label="商品名称或编码"><el-input v-model="line.keyword" :aria-label="`第${Number(index) + 1}行商品`" @input="line.skuId = null" /></el-form-item>
    <el-form-item label="规格"><el-input v-model="line.specText" :aria-label="`第${Number(index) + 1}行规格`" @input="line.skuId = null" /></el-form-item>
    <el-form-item v-if="line.candidates?.length > 1" label="核对商品规格"><el-select v-model="line.skuId" :aria-label="`第${Number(index) + 1}行选择规格`" @change="selectSku(line, $event)"><el-option v-for="item in line.candidates" :key="item.skuId" :value="item.skuId" :label="`${item.productName} · ${item.specText} · ${item.skuCode}`" /></el-select></el-form-item>
    <div class="workflow-pair"><el-form-item :label="form.mode === 'set' ? '实盘总数' : '数量'"><el-input-number v-model="line.quantity" :aria-label="`第${Number(index) + 1}行数量`" :min="form.mode === 'set' ? 0 : 1" :max="2147483647" :precision="0" /></el-form-item><el-form-item label="单位"><el-input v-model="line.unit" :aria-label="`第${Number(index) + 1}行单位`" /></el-form-item></div>
    <template v-if="action === 'inventory.batch'"><el-form-item :label="form.mode === 'decrease' ? '出库批次（空则先到期先出）' : '批次号（启用批次时必填）'"><el-input v-model="line.batchNo" maxlength="64" /></el-form-item><div v-if="form.mode !== 'decrease'" class="workflow-pair"><el-form-item label="生产日期"><el-input v-model="line.productionDate" placeholder="YYYY-MM-DD" /></el-form-item><el-form-item label="到期日期"><el-input v-model="line.expiryDate" placeholder="YYYY-MM-DD" /></el-form-item></div></template>
    <el-button size="small" :disabled="form.lines.length <= 1" @click="form.lines.splice(Number(index), 1)">移除此行</el-button>
  </div>
  <el-button :disabled="form.lines.length >= 50" @click="form.lines.push({ keyword: '', specText: '', skuId: null, quantity: null, unit: '' })">添加清单行</el-button>
  <div class="workflow-summary" aria-live="polite"><strong>已保存的核对结果</strong><p v-for="(line, index) in saved.lines" :key="index">{{ Number(index) + 1 }}. {{ line.item?.productName || line.keyword }} · {{ line.item?.specText || line.specText }}：<template v-if="action === 'inventory.batch'">{{ line.item?.beforeQty ?? '?' }} → {{ line.afterQty ?? '?' }}{{ line.item?.saleUnit }}<span v-if="line.factor > 1">（按1{{ line.unit }}＝{{ line.factor }}{{ line.item.saleUnit }}换算）</span></template><template v-else>{{ line.baseQuantity ?? '?' }}{{ line.item?.saleUnit }} × ¥{{ line.unitPrice ?? '?' }}，金额 ¥{{ line.amount ?? '?' }}</template></p><p v-if="action === 'order.create'">{{ saved.customer?.customerName || '客户待确认' }}；按品牌生成{{ saved.orders?.length || 0 }}张订单草稿，价格及库存在执行前重新核对。</p></div>
  <p class="workflow-note">修改后先保存再核对。库存整单确认后生成流水；订单确认后仍为草稿，需在订单详情继续提交。不会自动发送给客户。</p>
</template>

<style scoped>
.workflow-line { padding:12px 0; border-top:1px solid var(--brand-border); }
.workflow-pair { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.workflow-summary { margin-top:14px; padding:12px; background:var(--brand-surface-muted, #f3f6f3); line-height:1.7; overflow-wrap:anywhere; }
.workflow-summary p { margin:8px 0 0; }
.workflow-note { font-size:12px; color:var(--brand-text-soft); line-height:1.7; }
@media(max-width:420px) { .workflow-pair { grid-template-columns:minmax(0,1fr); gap:0; } }
</style>
