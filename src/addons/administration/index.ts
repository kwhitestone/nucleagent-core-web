import type { PluginModule } from "@prism-fusion/plugin-runtime";
import { authenticatedRoute } from "@/contracts/platform-runtime";

const administration: PluginModule = {
  name: "administration",
  description: "Provider, model, skill and tool administration",
  manifest: {
    apiVersion: "prism-fusion/v2",
    kind: "frontend-addon",
    id: "administration",
    version: "0.1.0",
    requires: [{ id: "platform-api" }, { id: "model-catalog" }],
    routeScopes: ["/admin", "/providers"],
  },
  routes: [
    { path: "/providers", redirect: "/admin/providers" },
    {
      path: "/admin",
      component: authenticatedRoute(() => import("./views/admin/AdminLayout.vue")),
      meta: { requiresAuth: true },
      children: [
        { path: "", redirect: "/admin/providers" },
        {
          path: "providers",
          name: "admin-providers",
          component: () => import("./views/Providers.vue"),
        },
        {
          path: "default-model",
          name: "admin-default-model",
          component: () => import("./views/admin/AdminDefaultModel.vue"),
        },
        {
          path: "skills",
          name: "admin-skills",
          component: () => import("./views/admin/AdminSkills.vue"),
        },
        {
          path: "tools",
          name: "admin-tools",
          component: () => import("./views/admin/AdminTools.vue"),
        },
        {
          path: "executors",
          name: "admin-executors",
          component: () => import("./views/admin/AdminExecutors.vue"),
        },
      ],
    },
  ],
};

export default administration;
