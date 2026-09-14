import type { PluginModule } from "@prism-fusion/plugin-runtime";
import { registerPlatformRuntime } from "@/contracts/platform-runtime";
import { getAccessToken } from "@/utils/token";
import router from "@/router";
import { platformRuntime } from "./runtime";

let unregisterRuntime: (() => void) | undefined;
let unregisterAuthGuard: (() => void) | undefined;

const SHELL_URL = import.meta.env.VITE_SHELL_URL ?? "http://localhost:26600";

const platformApi: PluginModule = {
  name: "platform-api",
  description: "Typed API contracts shared by Core frontend features",
  manifest: {
    apiVersion: "prism-fusion/v2",
    kind: "frontend-addon",
    id: "platform-api",
    version: "0.1.0",
    requires: [],
    routeScopes: [],
  },
  setup() {
    unregisterRuntime = registerPlatformRuntime(platformRuntime);
    unregisterAuthGuard = router.beforeEach((to) => {
      if (!to.meta.requiresAuth || getAccessToken()) return true;
      if (!platformRuntime.isInShell() && typeof window !== "undefined") {
        window.location.href = `${SHELL_URL}/auth`;
      }
      return true;
    });
  },
  destroy() {
    unregisterAuthGuard?.();
    unregisterAuthGuard = undefined;
    unregisterRuntime?.();
    unregisterRuntime = undefined;
  },
};

export default platformApi;
