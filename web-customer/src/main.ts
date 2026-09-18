import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import './styles/main.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import { router } from './router'
import { setUnauthorizedHandler } from './api/request'
import { useAuthStore } from './stores/auth'

const app = createApp(App)
for (const [name, component] of Object.entries(ElementPlusIconsVue)) app.component(name, component)

app.use(createPinia()).use(router).use(ElementPlus, { locale: zhCn }).mount('#app')

setUnauthorizedHandler(() => {
  useAuthStore().reset()
  void router.replace('/login')
})