import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('../views/login/LoginView.vue'), meta: { public: true, title: '登录' } },
  {
    path: '/',
    component: () => import('../layouts/MainLayout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'dashboard', component: () => import('../views/dashboard/DashboardView.vue'), meta: { title: '工作台', permission: 'dashboard:view' } },
      { path: 'products', name: 'products', component: () => import('../views/product/ProductListView.vue'), meta: { title: '商品管理', permission: 'product:read' } },
      { path: 'products/brands', name: 'product-brands', component: () => import('../views/product/BrandView.vue'), meta: { title: '品牌管理', permission: 'brand:manage' } },
      { path: 'products/categories', name: 'product-categories', component: () => import('../views/product/CategoryView.vue'), meta: { title: '分类管理', permission: 'product:read' } },
      { path: 'products/create', name: 'product-create', component: () => import('../views/product/ProductEditView.vue'), meta: { title: '新建商品', permission: 'product:create' } },
      { path: 'products/:id/edit', name: 'product-edit', component: () => import('../views/product/ProductEditView.vue'), meta: { title: '编辑商品', permission: 'product:update' } },
      { path: 'customers', name: 'customers', component: () => import('../views/customer/CustomerList.vue'), meta: { title: '客户管理', permission: 'customer:manage' } },
      { path: 'customers/:id', name: 'customer-detail', component: () => import('../views/customer/CustomerDetail.vue'), meta: { title: '客户详情', permission: 'customer:manage' } },
      { path: 'orders', name: 'orders', component: () => import('../views/orders/OrderListView.vue'), meta:{title:'订单管理',permission:'order:read'} },
      { path: 'orders/:id', name: 'order-detail', component: () => import('../views/orders/OrderDetailView.vue'), meta:{title:'订单详情',permission:'order:read'} },
      { path: 'users', name: 'users', component: () => import('../views/user/UserListView.vue'), meta: { title: '用户管理', permission: 'role:manage' } },
      { path: 'audit-logs', name: 'audit-logs', component: () => import('../views/audit/AuditLogView.vue'), meta: { title: '审计日志', permission: 'audit:read', description: '查询后台关键操作记录' } },
      { path: 'system', name: 'system', component: () => import('../views/system/SystemView.vue'), meta: { title: '系统配置', permission: 'role:manage', description: '维护系统键值配置' } },
      { path: 'forbidden', name: 'forbidden', component: () => import('../views/system/ForbiddenView.vue'), meta: { title: '无权限' } }
    ]
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' }
]

export const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.public) return true
  if (!auth.accessToken) return { path: '/login', query: { redirect: to.fullPath } }
  return true
})
