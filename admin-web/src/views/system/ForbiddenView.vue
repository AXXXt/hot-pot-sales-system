<script setup lang="ts">
import { useAuthStore } from '../../stores/auth'
const auth = useAuthStore()
</script>
<template><el-result icon="warning" title="暂无访问权限" sub-title="请从左侧导航进入已授权功能；如没有可用功能，请联系管理员配置岗位权限。"><template v-if="auth.can('dashboard:view')" #extra><el-button type="primary" @click="$router.push('/dashboard')">返回工作台</el-button></template></el-result></template>
