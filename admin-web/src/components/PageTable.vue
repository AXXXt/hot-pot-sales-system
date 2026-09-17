<script setup lang="ts">
defineProps<{ loading: boolean; error?: string; empty?: boolean }>()
defineEmits<{ retry: [] }>()
</script>
<template>
  <el-alert v-if="error" :title="error" type="error" show-icon class="state"><el-button size="small" @click="$emit('retry')">重试</el-button></el-alert>
  <el-skeleton v-else-if="loading" :rows="7" animated />
  <el-empty v-else-if="empty" description="暂无数据" />
  <slot v-else />
</template>
<style scoped>.state{margin-bottom:16px}.state :deep(.el-alert__content){width:100%;display:flex;align-items:center;justify-content:space-between}</style>
