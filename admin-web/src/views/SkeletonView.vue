<script setup lang="ts">
import { computed } from 'vue';import { useRoute } from 'vue-router';import ModuleSkeleton from '../components/ModuleSkeleton.vue'
const route=useRoute();const config=computed(()=>({title:String(route.meta.title||'管理页面'),description:String(route.meta.description||'业务数据管理'),columns:(route.meta.columns as string[])||['名称','状态','更新时间','操作'],actions:route.meta.actions!==false}))
</script><template><ModuleSkeleton v-bind="config"/></template>
