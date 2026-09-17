<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
defineProps<{title:string;description:string;columns:string[];actions?:boolean}>()
const keyword=ref(''),dialog=ref(false),submitting=ref(false),form=reactive({name:'',remark:''})
const rows=computed(()=>[] as Record<string,string>[])
async function submit(){submitting.value=true;dialog.value=false;submitting.value=false}
</script>
<template><section><div class="page-heading"><div><h1>{{ title }}</h1><p>{{ description }}</p></div><el-button v-if="actions" type="primary" @click="dialog=true">新建</el-button></div><el-card shadow="never"><div class="toolbar"><el-input v-model="keyword" clearable placeholder="输入关键词搜索" style="width:260px"/><el-button type="primary">查询</el-button><el-button @click="keyword=''">重置</el-button></div><el-empty v-if="!rows.length" description="页面结构已完成，等待接口接入"/><el-table v-else :data="rows"><el-table-column v-for="column in columns" :key="column" :label="column"/></el-table><el-pagination :total="0" layout="total, prev, pager, next"/></el-card><el-dialog v-model="dialog" :title="`新建${title}`" width="520"><el-form label-width="90"><el-form-item label="名称"><el-input v-model="form.name"/></el-form-item><el-form-item label="备注"><el-input v-model="form.remark" type="textarea"/></el-form-item></el-form><template #footer><el-button @click="dialog=false">取消</el-button><el-button type="primary" :loading="submitting" @click="submit">保存</el-button></template></el-dialog></section></template>
<style scoped>.page-heading{justify-content:space-between}.toolbar{display:flex;gap:10px;margin-bottom:16px}.el-pagination{justify-content:flex-end;margin-top:16px}</style>
