import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import './styles/theme.css'
import PlatformReleaseCenter from './views/platform/PlatformReleaseCenter.vue'
import { getAccessToken, setUnauthorizedHandler } from './api/request'

const app = createApp(PlatformReleaseCenter).use(ElementPlus, { locale: zhCn })
const login = () => location.assign('/login?redirect=%2Fplatform-updates')
setUnauthorizedHandler(login)
if (!getAccessToken()) login()
else app.mount('#app')
