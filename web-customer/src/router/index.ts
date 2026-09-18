import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { getAccessToken } from '../api/request'

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true, title: '客户登录' } },
  {
    path: '/',
    component: () => import('../layouts/ClientLayout.vue'),
    redirect: '/home',
    children: [
      { path: 'home', name: 'home', component: () => import('../views/catalog/HomeView.vue'), meta: { title: '采购首页' } },
      { path: 'category', name: 'category', component: () => import('../views/catalog/CategoryView.vue'), meta: { title: '全部商品' } },
      { path: 'products/:id', name: 'product-detail', component: () => import('../views/catalog/ProductDetailView.vue'), meta: { title: '商品详情' } },
      { path: 'cart', name: 'cart', component: () => import('../views/checkout/CartView.vue'), meta: { title: '进货单' } },
      { path: 'checkout', name: 'checkout', component: () => import('../views/checkout/CheckoutView.vue'), meta: { title: '确认下单' } },
      { path: 'orders', name: 'orders', component: () => import('../views/orders/OrderListView.vue'), meta: { title: '我的订单' } },
      { path: 'orders/:id', name: 'order-detail', component: () => import('../views/orders/OrderDetailView.vue'), meta: { title: '订单详情' } },
      { path: 'profile', name: 'profile', component: () => import('../views/user/ProfileView.vue'), meta: { title: '我的' } }
    ]
  },
  { path: '/:pathMatch(.*)*', redirect: '/home' }
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

router.beforeEach(async (to) => {
  document.title = `${to.meta.title || '唯多鲜采购'} - 唯多鲜火锅食材`
  if (to.meta.public) return true
  if (!getAccessToken()) return { path: '/login', query: { redirect: to.fullPath } }

  const auth = useAuthStore()
  if (!auth.profile) {
    try {
      await auth.loadProfile()
    } catch {
      return { path: '/login', query: { redirect: to.fullPath } }
    }
  }
  return true
})