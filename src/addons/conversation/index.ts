import type { PluginModule } from "@prism-fusion/plugin-runtime";

import router from "@/router";
import { authenticatedRoute } from "@/contracts/platform-runtime";
import { installShellBridge } from "./composables/useShellBridge";

let removeShellBridge: (() => void) | undefined;

const conversation: PluginModule = {
  name: "conversation",
  description: "Conversation creation, execution and streamed task experience",
  manifest: {
    apiVersion: "prism-fusion/v2",
    kind: "frontend-addon",
    id: "conversation",
    version: "0.1.0",
    requires: [{ id: "platform-api" }, { id: "model-catalog" }],
    routeScopes: ["/chat", "/creation", "/tasks", "/c", "/b"],
  },
  routes: [
    {
      path: "/chat",
      name: "chat",
      component: authenticatedRoute(() => import("./views/Home.vue")),
      meta: { requiresAuth: true },
    },
    {
      path: "/creation",
      name: "creation",
      component: authenticatedRoute(() => import("./views/Creation.vue")),
      meta: { requiresAuth: true },
    },
    {
      path: "/tasks",
      name: "tasks",
      component: authenticatedRoute(() => import("./views/TaskSetup.vue")),
      meta: { requiresAuth: true },
    },
    {
      path: "/b/:groupId",
      name: "broadcast-conversation",
      component: authenticatedRoute(() => import("./views/BroadcastConversation.vue")),
      meta: { requiresAuth: true },
      props: (route) => ({ groupId: route.params.groupId as string }),
    },
    {
      path: "/c/:id",
      name: "conversation",
      component: authenticatedRoute(() => import("./views/Conversation.vue")),
      meta: { requiresAuth: true },
      props: (route) => ({ id: route.params.id as string }),
    },
  ],
  setup() {
    removeShellBridge = installShellBridge(router);
  },
  destroy() {
    removeShellBridge?.();
    removeShellBridge = undefined;
  },
};

export default conversation;
