import {
  createRouter,
  createWebHashHistory,
  createWebHistory,
  type RouteRecordRaw,
} from "vue-router";

const isEmbedded =
  (globalThis as Record<string, unknown>).__MICRO_APP_ENVIRONMENT__ === true ||
  (typeof window !== "undefined" && window.parent !== window);

export const coreRoutes: RouteRecordRaw[] = [
  { path: "/", name: "core-root", redirect: "/chat" },
  {
    path: "/:pathMatch(.*)*",
    name: "core-fallback",
    redirect: "/chat",
  },
];

const router = createRouter({
  history: isEmbedded ? createWebHashHistory("/") : createWebHistory("/"),
  routes: coreRoutes,
});

export default router;
