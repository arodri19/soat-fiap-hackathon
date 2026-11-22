import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    guestOnly?: boolean;
    title?: string;
  }
}

export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/videos' },
  {
    path: '/login',
    component: () => import('@/views/LoginView.vue'),
    meta: { guestOnly: true, title: 'Entrar' },
  },
  {
    path: '/cadastro',
    component: () => import('@/views/RegisterView.vue'),
    meta: { guestOnly: true, title: 'Criar conta' },
  },
  {
    path: '/videos',
    component: () => import('@/views/VideosView.vue'),
    meta: { requiresAuth: true, title: 'Meus vídeos' },
  },
  {
    path: '/infraestrutura',
    component: () => import('@/views/InfrastructureView.vue'),
    meta: { requiresAuth: true, title: 'Infraestrutura' },
  },
  {
    path: '/:pathMatch(.*)*',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: 'Página não encontrada' },
  },
];

export const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  await auth.init(); // na 1ª navegação, tenta restaurar a sessão pelo cookie de refresh
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.meta.guestOnly && auth.isAuthenticated) return '/videos';
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · FIAP X` : 'FIAP X';
});
